// The backend switched on: this spec builds its own copy with fake Supabase env vars, serves it on a free port, and
// answers Supabase's endpoints itself. Checks: each finished game is sent once with the right payload; results use
// real players' numbers once the stats say 50+; the sign-in key, sheet and privacy page; and a signed-in session
// syncing its save (merge both ways), with the account panel, the comparison with players, and account deletion.
// (Signing in itself ends at Google's or the email's door: the redirect and the email request are checked, not the
// return trip. The merge and the session handling have unit tests in src/net.)
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { chromium, VIEWPORTS, NOW, TODAY, guess, noHScroll } = require("./helpers.cjs");

const { BACKEND_ENV } = require("./backend-env.cjs");

const SUPA = BACKEND_ENV.VITE_SUPABASE_URL;
const desktop = VIEWPORTS.find((v) => v.name === "desktop");
const phone = VIEWPORTS.find((v) => v.name === "phone");

let browser;
let server;
let base;
let outDir;

before(async () => {
  const { build, preview } = await import("vite");
  const root = path.resolve(__dirname, "..");
  // npm run e2e builds this copy up front (E2E_BACKEND_DIST, with the same fake keys); run alone, the spec builds it.
  let dist = process.env.E2E_BACKEND_DIST;
  if (!dist) {
    Object.assign(process.env, BACKEND_ENV);
    dist = outDir = mkdtempSync(path.join(tmpdir(), "tentacle-backend-e2e-"));
    await build({ root, logLevel: "warn", build: { outDir, emptyOutDir: true } });
  }
  // Port 0: whatever port is free, so it never collides with another agent's server.
  server = await preview({ root, logLevel: "warn", build: { outDir: dist }, preview: { port: 0, strictPort: false } });
  base = `http://localhost:${server.httpServer.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((r) => server.httpServer.close(r));
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

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

/** Answer Supabase's endpoints, recording what the game sent. */
async function mockSupabase(ctx, { save = null, averages = [] } = {}) {
  const calls = { submit: [], stats: [], otp: [], authorize: [], saves: [], deleted: [] };
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

/** A tab on the backend build at `hash`, the fake clock installed, storage seeded once. */
async function open(vp, hash, seed, mocks) {
  const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, timezoneId: "America/New_York" });
  await ctx.addInitScript((items) => {
    if (localStorage.getItem("e2e-seeded")) return;
    for (const [k, v] of Object.entries(items)) localStorage.setItem(k, JSON.stringify(v));
    localStorage.setItem("e2e-seeded", "1");
  }, seed);
  const supa = await mockSupabase(ctx, mocks);
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW });
  await page.goto(base + hash);
  return { ctx, page, ...supa };
}

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

test("finished games are sent once, and results use real players from 50 (desktop)", async () => {
  const { ctx, page, calls } = await open(desktop, "#p-mountains", FRESH);
  const p = await page.evaluate(async () => (await fetch("puzzles/mountains.json")).json());
  for (const r of [1, 3]) await guess(page, p.answers.find((a) => a.rank === r).name);
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();

  // Real numbers: 120 players, no "est." mark.
  const block = page.locator('[data-testid="results"] [data-testid="par"][data-source="players"]');
  await block.waitFor();
  assert.equal(await block.getAttribute("data-n"), "120");
  assert.equal(await block.getByRole("button", { name: /^est\./ }).count(), 0);
  assert.equal(await block.getByTestId("histogram").locator("[data-you]").getAttribute("data-score"), "2");

  await until(() => calls.submit.length > 0);
  await settle();
  assert.equal(calls.submit.length, 1);
  const sent = calls.submit[0];
  assert.match(sent.p_client_id, UUID);
  assert.ok(Math.abs(Date.parse(sent.p_started_at) - NOW.getTime()) < 60_000);
  assert.deepEqual(
    { ...sent, p_client_id: "id", p_started_at: "t" },
    { p_list_id: "mountains", p_mode: "list", p_score: 2, p_found: 2, p_client_id: "id", p_started_at: "t", p_daily_date: null },
  );

  // Reopening the finished game doesn't send it again.
  await page.reload();
  await page.locator('[data-testid="par"][data-source="players"]').waitFor();
  await settle();
  assert.equal(calls.submit.length, 1);

  // Today's daily carries its date.
  await page.goto(base + `#daily-${TODAY}`);
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();
  await page.getByTestId("results").waitFor();
  await until(() => calls.submit.length === 2);
  assert.equal(calls.submit[1].p_daily_date, TODAY);
  assert.equal(calls.submit[1].p_client_id, sent.p_client_id);

  // A Blitz round: its points and answers, and the percentile line from 50 players.
  await page.goto(base + "#blitz-airports");
  await page.getByTestId("blitz-clock").waitFor();
  await guess(page, "Dubai");
  await page.clock.fastForward(91_000);
  await page.getByTestId("blitz-results").waitFor();
  await until(() => calls.submit.length === 3);
  const round = calls.submit[2];
  assert.equal(round.p_list_id, "airports");
  assert.equal(round.p_mode, "blitz");
  assert.equal(round.p_found, 1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("top-tens:v1")));
  assert.equal(round.p_score, saved.blitzRuns.airports[0].score);
  assert.equal(Date.parse(round.p_started_at), saved.blitzRuns.airports[0].startedAt);
  assert.ok(round.p_score > 0);
  await page.getByTestId("blitz-crowd").waitFor();
  assert.equal(await page.getByTestId("blitz-crowd").getAttribute("data-n"), "80");
  await ctx.close();
});

test("sign-in key, sheet and privacy page (desktop)", async () => {
  const { ctx, page, calls } = await open(desktop, "", FRESH);
  const key = page.getByTestId("account-key");
  await key.waitFor();
  assert.equal(await key.getAttribute("data-signed-in"), null);

  // The sheet: an email link.
  await key.click();
  const sheet = page.getByRole("dialog", { name: "Sign in" });
  await sheet.waitFor();
  await page.getByTestId("sign-in-email").fill("dana@example.com");
  await page.getByTestId("sign-in-send").click();
  await page.getByTestId("sign-in-sent").waitFor();
  assert.equal(calls.otp.length, 1);
  assert.equal(calls.otp[0].email, "dana@example.com");
  assert.ok(calls.otp[0].code_challenge, "the email link uses PKCE");
  await page.getByTestId("sign-in-code").waitFor();

  // Escape closes it and gives focus back to the key.
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  assert.equal(await key.evaluate((el) => el === document.activeElement), true);

  // The privacy page, from the footer.
  await page.getByTestId("privacy-link").click();
  await page.getByTestId("privacy").waitFor();
  assert.ok(await noHScroll(page));
  await page.getByTestId("nav-back").click();

  // Google: off to Supabase's authorize endpoint, coming back to this page.
  await page.getByTestId("account-key").click();
  await page.getByTestId("sign-in-google").click();
  await until(() => calls.authorize.length === 1);
  const auth = calls.authorize[0];
  assert.equal(auth.searchParams.get("provider"), "google");
  assert.equal(auth.searchParams.get("redirect_to"), base);
  assert.ok(auth.searchParams.get("code_challenge"));
  await ctx.close();
});

test("the account pieces fit a phone: Home's key, the sheet, the account panel", async () => {
  const { ctx, page } = await open(phone, "", FRESH);
  await page.getByTestId("account-key").waitFor();
  assert.ok(await noHScroll(page));
  await page.getByTestId("account-key").click();
  const sheet = page.getByTestId("sign-in-sheet");
  await sheet.waitFor();
  const box = await sheet.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= phone.viewport.width + 0.5);
  assert.ok(await noHScroll(page));
  await page.getByTestId("sign-in-close").click();
  await sheet.waitFor({ state: "detached" });

  await page.goto(base + "#stats");
  await page.locator('[data-testid="account-panel"][data-signed-in="false"]').waitFor();
  assert.ok(await noHScroll(page));
  await ctx.close();
});

test("signed in: the save syncs both ways, the account panel, players' averages, delete (desktop)", async () => {
  const mine = { id: "islands", startedAt: NOW.getTime() - 3_600_000, finishedAt: NOW.getTime() - 3_300_000, status: "lost", found: [1, 2, 3, 4], lives: 0, hints: 0 };
  const theirs = { id: "mountains", startedAt: NOW.getTime() - 86_400_000, finishedAt: NOW.getTime() - 86_000_000, status: "won", found: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], lives: 2, hints: 0 };
  const { ctx, page, calls, row } = await open(
    desktop,
    "#stats",
    { "top-tens:v1": { games: {}, daily: {}, seenHelp: true, listRuns: [mine] }, "top-tens:auth": SESSION },
    {
      save: { data: { games: {}, daily: { "2026-10-28": "youtube-channels" }, seenHelp: true, listRuns: [theirs] }, version: 4 },
      averages: [
        { list_id: "mountains", n: 200, avg: 4.5 },
        { list_id: "islands", n: 30, avg: 6 },
      ],
    },
  );
  const panel = page.locator('[data-testid="account-panel"][data-signed-in="true"]');
  await panel.waitFor();
  assert.equal(await page.getByTestId("account-name").textContent(), "Dana Scully");
  await page.locator('[data-testid="account-sync"][data-sync="synced"]').waitFor();

  // The server got the union, written over the version it read.
  const patch = calls.saves.find((c) => c.method === "PATCH");
  assert.ok(patch, "the merged save was written back");
  assert.match(patch.query, /version=eq\.4/);
  assert.deepEqual(patch.body.data.listRuns.map((r) => r.id), ["islands", "mountains"]);
  assert.equal(row().version, 5);
  // And this device has the other device's game and streak day.
  const local = await page.evaluate(() => JSON.parse(localStorage.getItem("top-tens:v1")));
  assert.deepEqual(local.listRuns.map((r) => r.id), ["islands", "mountains"]);
  assert.equal(local.daily["2026-10-28"], "youtube-channels");

  // A new display name.
  await page.getByTestId("account-rename").click();
  await page.getByTestId("account-name-input").fill("  Agent   Scully ");
  await page.getByTestId("account-name-save").click();
  await page.getByTestId("account-name").filter({ hasText: "Agent Scully" }).waitFor();
  assert.equal(calls.renamed, "Agent Scully");

  // Players' averages: only the list with 50+ players.
  await page.getByTestId("crowd-panel").waitFor();
  assert.deepEqual(await page.getByTestId("crowd-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-id"))), ["mountains"]);
  assert.ok(await noHScroll(page));

  // Home's key shows the account.
  await page.getByTestId("nav-home").click();
  const key = page.locator('[data-testid="account-key"][data-signed-in="true"]');
  await key.waitFor();
  assert.equal(await key.getByTestId("sync-status").getAttribute("data-sync"), "synced");
  await key.click();
  await panel.waitFor();

  // Delete account: an inline confirm, then the server function with this session's token.
  let auth;
  await page.route("**/api/delete-account", (route) => {
    auth = route.request().headers().authorization;
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"deleted":true}' });
  });
  await page.getByTestId("account-delete").click();
  assert.equal(auth, undefined, "the first press only asks");
  await page.getByTestId("account-delete").click();
  await page.locator('[data-testid="account-panel"][data-signed-in="false"]').waitFor();
  assert.equal(auth, `Bearer ${TOKEN}`);
  assert.equal(await page.evaluate(() => localStorage.getItem("top-tens:auth")), null);
  // This device keeps its games.
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("top-tens:v1")))).listRuns.length, 2);
  await ctx.close();
});
