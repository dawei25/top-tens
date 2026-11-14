// Shared by the backend specs (backend.e2e.cjs, backend-google.e2e.cjs): serve a copy built with fake backend env vars,
// a mocked Supabase that records what the game sent, and the fake players and sessions it answers with.
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { chromium, NOW, offlineFonts } = require("./helpers.cjs");
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

/**
 * Real players' numbers (list_stats): 120 on lists and 80 on Blitz, past the 30 players the estimate counts as
 * (ESTIMATE_WEIGHT, src/net/crowd.ts), and 10 high scorers on the airports list, under it.
 */
const STATS = {
  list: { n: 120, counts: [2, 4, 8, 12, 16, 20, 18, 14, 12, 8, 6], avg: 5.2 },
  few: { n: 10, counts: [0, 0, 0, 0, 0, 1, 1, 2, 3, 2, 1], avg: 7.7 },
  blitz: { n: 80, counts: [10, 20, 30, 20], avg: 90 },
};
function stats(id, mode) {
  if (mode === "blitz") return STATS.blitz;
  return id === "airports" ? STATS.few : STATS.list;
}

/**
 * How real players guessed on Fathom's fixture questions (fathom_compare): 37 on the Eiffel Tower, past the 20 the
 * reveal waits for; 12 on the bones, under it; nobody on the rest.
 */
const FATHOM_CROWD = {
  "eiffel-tower-height": { n: 37, median: 300, further_off: 0.7297 },
  "adult-bones": { n: 12, median: 200, further_off: 0.5 },
};

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
  const calls = { submit: [], rate: [], feedback: [], stats: [], fathom: [], compare: [], miss: [], otp: [], authorize: [], saves: [], deleted: [], signup: [], password: [], idToken: [] };
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
      case "/rest/v1/rpc/submit_feedback":
        calls.feedback.push(req.postDataJSON());
        return json(200, true);
      case "/rest/v1/rpc/list_stats":
        calls.stats.push([url.searchParams.get("p_list_id"), url.searchParams.get("p_mode")]);
        return json(200, stats(url.searchParams.get("p_list_id"), url.searchParams.get("p_mode")));
      case "/rest/v1/rpc/list_averages":
        return json(200, averages);
      case "/rest/v1/rpc/submit_fathom_guess":
        calls.fathom.push(req.postDataJSON());
        return json(200, true);
      case "/rest/v1/rpc/submit_miss":
        // The headers too: a miss goes with the public key alone, never the player's session.
        calls.miss.push({ args: req.postDataJSON(), headers: req.headers() });
        return json(200, true);
      case "/rest/v1/rpc/fathom_compare": {
        const args = Object.fromEntries(url.searchParams);
        calls.compare.push(args);
        return json(200, FATHOM_CROWD[args.p_question_id] ?? { n: 0, median: null, further_off: null });
      }
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
    const ctx = await browser.newContext({
      viewport: vp.viewport,
      isMobile: !!vp.isMobile,
      hasTouch: !!vp.hasTouch,
      timezoneId: "America/New_York",
      ...(vp.reducedMotion && { reducedMotion: vp.reducedMotion }),
    });
    // The same font bytes every run, so a layout measured once stays put.
    await offlineFonts(ctx);
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

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/**
 * Google's endpoint, faked for the whole context (popups included), for the build with a Google client ID
 * (backend-google.e2e.cjs, free-wall.e2e.cjs). It answers like Google's implicit flow: a redirect to the redirect_uri
 * with the ID token (carrying the nonce it was asked with) and the state in the fragment. `google.mode` says how the
 * next request is answered: "ok", "stay" (the chooser stays up), "denied", "forged" (another state), "refuse" (a token
 * Supabase refuses) or "sever" (ok, but the window loses its opener on the way). `asks` holds each request's
 * parameters, `hits` every request to Google's host.
 */
async function fakeGoogle(ctx) {
  const google = { mode: "ok", asks: [], hits: [], tokens: [] };
  await ctx.route(/^https:\/\/accounts\.google\.com\//, (route) => {
    const url = new URL(route.request().url());
    google.hits.push(url.href);
    if (`${url.origin}${url.pathname}` !== GOOGLE_AUTH) return route.fulfill({ status: 404, body: "" });
    const q = Object.fromEntries(url.searchParams);
    google.asks.push(q);
    const mode = google.mode;
    if (mode === "stay") return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Sign in - Google Accounts</title><p>Choose an account</p>" });
    const iat = Math.floor(NOW.getTime() / 1000);
    const claims = { iss: "https://accounts.google.com", azp: q.client_id, aud: q.client_id, sub: mode === "refuse" ? REFUSED_SUB : "1234", email: "dana@example.com", email_verified: true, nonce: q.nonce, iat, exp: iat + 3600 };
    const token = [b64url({ alg: "RS256", kid: "k1", typ: "JWT" }), b64url(claims), "sig"].join(".");
    google.tokens.push(token);
    const state = mode === "forged" ? "0123456789abcdef0123456789abcdef" : q.state;
    const fragment = mode === "denied" ? `error=access_denied&state=${state}` : `state=${state}&id_token=${token}&authuser=0&prompt=consent`;
    const back = `${q.redirect_uri}#${fragment}`;
    // The window loses its link to the game on the way (as an in-app browser's popup, or a page that cuts it, would).
    if (mode === "sever") return route.fulfill({ status: 200, contentType: "text/html", body: `<script>window.opener = null; location.replace(${JSON.stringify(back)});</script>` });
    return route.fulfill({ status: 302, headers: { location: back } });
  });
  return google;
}

/** A context's setup: Google faked, plus `more(ctx)`. Hands the fake back through `into`. */
const withGoogle = (into, more) => async (ctx) => {
  into.google = await fakeGoogle(ctx);
  if (more) await more(ctx);
};

/** Presses the Google key and returns the popup it opens. */
async function pressForPopup(page) {
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("sign-in-google").click()]);
  return popup;
}

/** Opens the menu once it has slid in; returns it. */
async function openMenu(page) {
  await page.getByTestId("menu-key").click();
  const menu = page.getByTestId("menu");
  await menu.waitFor();
  await menu.evaluate((d) => Promise.all(d.getAnimations().map((a) => a.finished)));
  return menu;
}
/**
 * Home's account key, signed out: opens the sign-in sheet (to sign in; `mode` "up" then switches it to create an
 * account, as "new here? create an account" does, in a build with passwords). Goes Home first if need be. The sheet is
 * ready once its first way in is: the Google key (the launch build has nothing else), or the password form.
 */
async function openSignIn(page, mode = "in") {
  if (await page.evaluate(() => location.hash.length > 1)) await page.evaluate(() => (location.hash = ""));
  await page.locator('[data-testid="account-key"][data-state="out"]').click();
  await page.getByTestId("sign-in-sheet").waitFor();
  await page.locator('[data-testid="sign-in-google"], [data-testid="sign-in-password-form"][data-mode="in"]').first().waitFor();
  if (mode === "up") {
    await page.getByTestId("sign-in-mode").click();
    await page.locator('[data-testid="sign-in-password-form"][data-mode="up"]').waitFor();
  }
}

/**
 * How Home's account key looks and reads: its state, name and title, whether it's pressable, its player's color and
 * how many of its pixels are lit (the lit player is filled in, the hollow one an outline), and whether the pink dot
 * shows.
 */
const accountKey = (page) =>
  page.getByTestId("account-key").evaluate((el) => {
    const icon = el.querySelector("svg");
    return {
      state: el.dataset.state,
      sync: el.dataset.sync ?? null,
      name: el.getAttribute("aria-label"),
      title: el.getAttribute("title"),
      disabled: el.disabled,
      color: getComputedStyle(icon).color,
      pixels: icon.querySelector("path").getAttribute("d").split("M").length - 1,
      dot: !!el.querySelector('[data-testid="account-dot"]'),
    };
  });
/** The player's colors: hollow and quiet (muted) signed out, lit (cyan) signed in, tinted (cyan-edge) signing in. */
const KEY_COLORS = { out: "rgb(125, 147, 184)", in: "rgb(77, 227, 255)", loading: "rgb(47, 191, 232)" };

/**
 * Signed in: Home's account key says so, lit, named for the player (`name`, if given: "Account: signed in as <name>",
 * the title too), and nothing on Home shows an email address. Goes Home first if need be.
 */
async function homeSignedIn(page, name) {
  if (await page.evaluate(() => location.hash.length > 1)) await page.evaluate(() => (location.hash = ""));
  await page.locator('[data-testid="account-key"][data-state="in"]').waitFor();
  const key = await accountKey(page);
  assert.equal(key.color, KEY_COLORS.in, "the player lit");
  assert.equal(key.title, key.name, "the title says what the name says");
  assert.doesNotMatch(key.name, /@/, "the key never says an email address");
  assert.doesNotMatch(await page.locator("main").textContent(), /@/, "Home never shows an email address");
  if (name) assert.match(key.name, new RegExp(`^Account: signed in as ${name}(,|$)`));
}

module.exports = {
  SUPA,
  STATS,
  FATHOM_CROWD,
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
  accountKey,
  KEY_COLORS,
  homeSignedIn,
  fakeGoogle,
  withGoogle,
  pressForPopup,
};
