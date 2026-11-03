// Shared by the backend specs (backend.e2e.cjs, backend-google.e2e.cjs): serve a copy built with fake backend env vars,
// a mocked Supabase that records what the game sent, and the fake players and sessions it answers with.
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { chromium, NOW } = require("./helpers.cjs");
const { BACKEND_ENV } = require("./backend-env.cjs");

const SUPA = BACKEND_ENV.VITE_SUPABASE_URL;

/**
 * Serve a copy of the game built with `env`. npm run e2e builds it up front (its folder in `process.env[distVar]`);
 * run alone, the spec builds it here. Port 0: whatever port is free, so it never collides with another agent's server.
 * Returns { base, browser, close }.
 */
async function serveBuild(env, distVar) {
  const { build, preview } = await import("vite");
  const root = path.resolve(__dirname, "..");
  let dist = process.env[distVar];
  let outDir;
  if (!dist) {
    Object.assign(process.env, env);
    dist = outDir = mkdtempSync(path.join(tmpdir(), "tentacle-backend-e2e-"));
    await build({ root, logLevel: "warn", build: { outDir, emptyOutDir: true } });
  }
  const server = await preview({ root, logLevel: "warn", build: { outDir: dist }, preview: { port: 0, strictPort: false } });
  const browser = await chromium.launch();
  return {
    base: `http://localhost:${server.httpServer.address().port}/`,
    browser,
    async close() {
      await browser.close();
      await new Promise((r) => server.httpServer.close(r));
      if (outDir) rmSync(outDir, { recursive: true, force: true });
    },
  };
}

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "dana@example.com",
  app_metadata: { provider: "google", providers: ["google"] },
  user_metadata: { full_name: "Dana Scully" },
  created_at: "2026-10-01T00:00:00Z",
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const EXP = Math.floor(NOW.getTime() / 1000) + 3600;
const TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, exp: EXP, aud: "authenticated", role: "authenticated", email: USER.email })}.sig`;
const SESSION = { access_token: TOKEN, token_type: "bearer", expires_in: 3600, expires_at: EXP, refresh_token: "refresh-me", user: USER };

/** Real players' numbers per list and mode: 120 on lists, 80 on Blitz (both past the 50 the game waits for). */
function stats(id, mode) {
  if (mode === "blitz") return { n: 80, counts: [10, 20, 30, 20], avg: 90 };
  return { n: 120, counts: [2, 4, 8, 12, 16, 20, 18, 14, 12, 8, 6], avg: 5.2 };
}

/** Someone who signs up with an email and password. */
const PW_USER = { ...USER, id: "22222222-2222-4222-8222-222222222222", email: "fox@example.com", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {} };
const PW_SESSION = { ...SESSION, user: PW_USER };
const PASSWORD = "trustno1";
/** Auth's refusals, as the server words them. */
const refusal = (status, code, msg) => ({ status, body: { code: status, error_code: code, msg } });

/** The `sub` of a Google ID token Supabase refuses (as it would one for another client, or a wrong nonce). */
const REFUSED_SUB = "refuse-me";

/**
 * Answer Supabase's endpoints, recording what the game sent. Password sign-in knows one account (fox@example.com,
 * trustno1); sign-up takes any new address, refuses taken@example.com, and asks confirm@example.com to confirm first.
 * A Google ID token signs Dana in, unless its `sub` is REFUSED_SUB.
 */
async function mockSupabase(ctx, { save = null, averages = [] } = {}) {
  const calls = { submit: [], rate: [], stats: [], otp: [], authorize: [], saves: [], deleted: [], signup: [], password: [], idToken: [] };
  let row = save;
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-expose-headers": "*",
  };
  await ctx.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    switch (url.pathname) {
      case "/rest/v1/rpc/submit_play":
        calls.submit.push(req.postDataJSON());
        return json(200, true);
      case "/rest/v1/rpc/rate_list":
        calls.rate.push(req.postDataJSON());
        return json(200, true);
      case "/rest/v1/rpc/list_stats":
        calls.stats.push([url.searchParams.get("p_list_id"), url.searchParams.get("p_mode")]);
        return json(200, stats(url.searchParams.get("p_list_id"), url.searchParams.get("p_mode")));
      case "/rest/v1/rpc/list_averages":
        return json(200, averages);
      case "/rest/v1/saves": {
        const method = req.method();
        const body = method === "GET" ? null : req.postDataJSON();
        calls.saves.push({ method, query: url.search, body });
        if (method === "GET") return json(200, row ? [row] : []);
        if (method === "POST") {
          if (row) return json(409, { code: "23505", message: "duplicate key" });
          row = { data: body.data, version: 1 };
          return json(201, { version: 1 });
        }
        if (method === "PATCH") {
          const want = Number(url.searchParams.get("version")?.replace("eq.", ""));
          if (!row || row.version !== want) return json(200, []);
          row = { data: body.data, version: want + 1 };
          return json(200, [{ version: row.version }]);
        }
        return json(405, {});
      }
      case "/auth/v1/otp":
        calls.otp.push(req.postDataJSON());
        return json(200, {});
      case "/auth/v1/signup": {
        const body = req.postDataJSON();
        calls.signup.push(body);
        if (body.email === "taken@example.com") {
          const r = refusal(422, "user_already_exists", "User already registered");
          return json(r.status, r.body);
        }
        if (body.email === "confirm@example.com") return json(200, { ...PW_USER, email: body.email, identities: [{}] });
        return json(200, PW_SESSION);
      }
      case "/auth/v1/token": {
        const grant = url.searchParams.get("grant_type");
        const body = req.postDataJSON();
        if (grant === "id_token") {
          calls.idToken.push(body);
          const claims = JSON.parse(Buffer.from(String(body.id_token).split(".")[1], "base64url").toString());
          if (claims.sub !== REFUSED_SUB) return json(200, SESSION);
          const r = refusal(400, "bad_oauth_callback", "Unacceptable audience in id_token");
          return json(r.status, r.body);
        }
        if (grant !== "password") return json(400, {});
        calls.password.push(body);
        if (body.email === PW_USER.email && body.password === PASSWORD) return json(200, PW_SESSION);
        const r = refusal(400, "invalid_credentials", "Invalid login credentials");
        return json(r.status, r.body);
      }
      case "/auth/v1/authorize":
        calls.authorize.push(url);
        return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Google</title>" });
      case "/auth/v1/user":
        if (req.method() === "PUT") {
          const { data } = req.postDataJSON();
          calls.renamed = data.display_name;
          return json(200, { ...USER, user_metadata: { ...USER.user_metadata, ...data } });
        }
        return json(200, USER);
      case "/auth/v1/logout":
        return route.fulfill({ status: 204, headers: cors });
      default:
        return json(404, { message: `not mocked: ${url.pathname}` });
    }
  });
  return { calls, row: () => row };
}

/**
 * `open(vp, hash, seed, mocks, setup)`: a tab on the build at `served().base` + `hash`, the fake clock installed,
 * storage seeded once, Supabase mocked; `setup(ctx)` runs before the page opens (to route more, say).
 */
const opener = (served) =>
  async function open(vp, hash, seed, mocks, setup) {
    const { browser, base } = served();
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, timezoneId: "America/New_York" });
    await ctx.addInitScript((items) => {
      if (localStorage.getItem("e2e-seeded")) return;
      for (const [k, v] of Object.entries(items)) localStorage.setItem(k, JSON.stringify(v));
      localStorage.setItem("e2e-seeded", "1");
    }, seed);
    const supa = await mockSupabase(ctx, mocks);
    if (setup) await setup(ctx);
    const page = await ctx.newPage();
    await page.clock.install({ time: NOW });
    await page.goto(base + hash);
    return { ctx, page, ...supa };
  };

const FRESH = { "top-tens:v1": { games: {}, daily: {}, seenHelp: true } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 50));
  }
};
const settle = () => new Promise((r) => setTimeout(r, 400));

/** Opens the menu (the account lives there) once it has slid in; returns it. */
async function openMenu(page) {
  await page.getByTestId("menu-key").click();
  const menu = page.getByTestId("menu");
  await menu.waitFor();
  await menu.evaluate((d) => Promise.all(d.getAnimations().map((a) => a.finished)));
  return menu;
}
/** The menu's Sign in tile: opens the sign-in sheet (the menu closes behind it). */
async function openSignIn(page) {
  await openMenu(page);
  await page.getByTestId("menu-sign-in").click();
  await page.getByTestId("sign-in-sheet").waitFor();
}
/** Signed in: the menu shows the account's address and Sign out (it closes again). */
async function menuSignedIn(page, email) {
  await openMenu(page);
  await page.getByTestId("menu-sign-out").waitFor();
  const shown = await page.getByTestId("menu-account-email").textContent();
  await page.keyboard.press("Escape");
  await page.getByTestId("menu").waitFor({ state: "detached" });
  if (email) assert.equal(shown, email);
}

module.exports = {
  SUPA,
  serveBuild,
  USER,
  TOKEN,
  SESSION,
  PW_USER,
  PASSWORD,
  REFUSED_SUB,
  mockSupabase,
  opener,
  FRESH,
  UUID,
  until,
  settle,
  openMenu,
  openSignIn,
  menuSignedIn,
};
