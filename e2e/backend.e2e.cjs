// The backend switched on: this spec builds its own copy with fake Supabase env vars, serves it on a free port, and
// answers Supabase's endpoints itself. Checks: each finished game is sent once with the right payload; results use
// real players' numbers once the stats say 50+; a list rating goes to rate_list (and waits while offline); the menu's
// account section (Sign in, Sign out) and Feedback, the sign-in sheet and privacy page; and a signed-in session
// syncing its save (merge both ways), with the account panel, the comparison with players, and account deletion.
// Notes ("add a note") have their own spec on the same build: note.e2e.cjs.
// (Signing in itself ends at Google's or the email's door: the redirect and the email request are checked, not the
// return trip. The merge and the session handling have unit tests in src/net.) This build has no Google client ID:
// Google sign-in is Supabase's redirect, and Google's own script never loads. backend-google.e2e.cjs covers the build
// with one.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { VIEWPORTS, NOW, TODAY, guess, noHScroll } = require("./helpers.cjs");
const { BACKEND_ENV } = require("./backend-env.cjs");
const { SUPA, serveBuild, opener, openMenu, openSignIn, USER, TOKEN, SESSION, PASSWORD, FRESH, UUID, until, settle } = require("./backend-lib.cjs");

const desktop = VIEWPORTS.find((v) => v.name === "desktop");
const phone = VIEWPORTS.find((v) => v.name === "phone");

let served;
let browser;
let base;
const open = opener(() => served);

before(async () => {
  served = await serveBuild(BACKEND_ENV, "E2E_BACKEND_DIST");
  ({ browser, base } = served);
});

after(async () => {
  await served?.close();
});

test("finished games are sent once, and results use real players from 50 (desktop)", async () => {
  const { ctx, page, calls } = await open(desktop, "#p-mountains", FRESH);
  const p = await page.evaluate(async () => (await fetch("puzzles/mountains.json")).json());
  for (const r of [1, 3]) await guess(page, p.answers.find((a) => a.rank === r).name);
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();

  // Real numbers: 120 players averaging 5.2, their spread, and no "(estimated)".
  const block = page.locator('[data-testid="results"] [data-testid="par"][data-source="players"]');
  await block.waitFor();
  assert.equal(await block.getAttribute("data-n"), "120");
  assert.equal(await block.getAttribute("data-par"), "5.2");
  assert.equal(await block.getByTestId("histogram").locator("[data-par]").getAttribute("data-score"), "5");
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

test("a rating goes to rate_list: the latest per list and mode, with this browser's id (phone)", async () => {
  const { ctx, page, calls } = await open(phone, "#p-mountains", FRESH);
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();
  await page.getByTestId("results").waitFor();
  await until(() => calls.submit.length === 1);
  const id = calls.submit[0].p_client_id;

  await page.getByTestId("rate-up").click();
  await until(() => calls.rate.length === 1);
  assert.deepEqual(calls.rate[0], { p_list_id: "mountains", p_mode: "list", p_rating: 1, p_reason: null, p_client_id: id });

  // Down, then a reason: the server ends with the reason.
  await page.getByTestId("rate-down").click();
  await page.locator('[data-testid="rate-reason"][data-reason="wrong-data"]').click();
  await until(() => calls.rate.at(-1)?.p_reason === "wrong-data");
  assert.deepEqual(calls.rate.at(-1), { p_list_id: "mountains", p_mode: "list", p_rating: -1, p_reason: "wrong-data", p_client_id: id });
  for (const sent of calls.rate) assert.deepEqual(Object.keys(sent).sort(), ["p_client_id", "p_list_id", "p_mode", "p_rating", "p_reason"]);

  // Taken back: 0. Nothing is left waiting.
  await page.getByTestId("rate-down").click();
  await until(() => calls.rate.at(-1)?.p_rating === 0);
  assert.equal(calls.rate.at(-1).p_reason, null);
  await settle();
  assert.deepEqual((await page.evaluate(() => JSON.parse(localStorage.getItem("top-tens:rating-outbox")))).pending, []);

  // Offline (the request never gets an answer), a rating waits in the outbox and goes when the connection is back.
  const before = calls.rate.length;
  const rpc = `${SUPA}/rest/v1/rpc/rate_list`;
  await page.route(rpc, (route) => route.abort("internetdisconnected"));
  await page.getByTestId("rate-up").click();
  await settle();
  assert.equal(calls.rate.length, before);
  const waiting = (await page.evaluate(() => JSON.parse(localStorage.getItem("top-tens:rating-outbox")))).pending;
  assert.deepEqual(waiting.map((r) => [r.listId, r.mode, r.rating]), [["mountains", "list", 1]]);
  await page.unroute(rpc);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await until(() => calls.rate.length === before + 1);
  assert.deepEqual(calls.rate.at(-1), { p_list_id: "mountains", p_mode: "list", p_rating: 1, p_reason: null, p_client_id: id });

  // A Blitz round's rating is its own (mode blitz).
  await page.goto(base + "#blitz-airports");
  await page.getByTestId("blitz-clock").waitFor();
  await guess(page, "Dubai");
  await page.clock.fastForward(91_000);
  await page.getByTestId("blitz-results").waitFor();
  await page.getByTestId("rate-down").click();
  await until(() => calls.rate.at(-1)?.p_mode === "blitz");
  assert.deepEqual(calls.rate.at(-1), { p_list_id: "airports", p_mode: "blitz", p_rating: -1, p_reason: null, p_client_id: id });
  await ctx.close();
});

test("the menu's account and Feedback, the sign-in sheet and privacy page (desktop)", async () => {
  const { ctx, page, calls } = await open(desktop, "", FRESH);
  await page.getByTestId("today-list").waitFor();
  // Home's Your games has no account key now: it's in the menu.
  assert.equal(await page.getByTestId("account-key").count(), 0);
  await openMenu(page);
  await page.getByTestId("menu-account").waitFor();
  assert.equal(await page.getByTestId("menu-sign-out").count(), 0);
  // Feedback mails the contact address, with a subject.
  const mail = new URL(await page.getByTestId("menu-feedback").getAttribute("href"));
  assert.equal(mail.protocol, "mailto:");
  assert.equal(mail.pathname, "privacy@example.com");
  assert.equal(mail.searchParams.get("subject"), "TENtacle feedback");
  await page.keyboard.press("Escape");
  await page.getByTestId("menu").waitFor({ state: "detached" });
  const key = page.getByTestId("menu-key");

  // The sheet: every method this build offers (google,email,password); the password form first, a link one press away.
  await openSignIn(page);
  const sheet = page.getByRole("dialog", { name: "Sign in" });
  await sheet.waitFor();
  await page.getByTestId("sign-in-google").waitFor();
  await page.locator('[data-testid="sign-in-password-form"][data-mode="in"]').waitFor();
  assert.equal(await page.getByTestId("sign-in-email").count(), 0);
  await page.getByTestId("sign-in-switch").click();
  assert.equal(await page.getByTestId("sign-in-password-form").count(), 0);
  await page.getByTestId("sign-in-email").fill("dana@example.com");
  await page.getByTestId("sign-in-send").click();
  await page.getByTestId("sign-in-sent").waitFor();
  assert.equal(calls.otp.length, 1);
  assert.equal(calls.otp[0].email, "dana@example.com");
  assert.ok(calls.otp[0].code_challenge, "the email link uses PKCE");
  await page.getByTestId("sign-in-code").waitFor();

  // Escape closes it and gives focus back to the menu key.
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  assert.equal(await key.evaluate((el) => el === document.activeElement), true);

  // The privacy page, from the footer: notes have their own part (what's sent, who reads them).
  await page.getByTestId("privacy-link").click();
  await page.getByTestId("privacy").waitFor();
  await page.getByTestId("privacy-notes").waitFor();
  assert.ok(await noHScroll(page));
  await page.getByTestId("nav-back").click();

  // Google, in a build without VITE_GOOGLE_CLIENT_ID: our key, off to Supabase's authorize endpoint, coming back to
  // this page. Google's own script never loads.
  const google = [];
  page.on("request", (r) => new URL(r.url()).hostname === "accounts.google.com" && google.push(r.url()));
  await openSignIn(page);
  assert.equal(await page.getByTestId("sign-in-google-gis").count(), 0);
  assert.equal(await page.locator('script[src*="accounts.google.com"]').count(), 0);
  await page.getByTestId("sign-in-google").click();
  await until(() => calls.authorize.length === 1);
  const auth = calls.authorize[0];
  assert.equal(auth.searchParams.get("provider"), "google");
  assert.equal(auth.searchParams.get("redirect_to"), base);
  assert.ok(auth.searchParams.get("code_challenge"));
  assert.deepEqual(google, []);
  await ctx.close();
});

test("email and password: refusals in plain words, confirm-first, create an account and sync (phone)", async () => {
  const mine = { id: "islands", startedAt: NOW.getTime() - 3_600_000, finishedAt: NOW.getTime() - 3_300_000, status: "lost", found: [1, 2, 3], lives: 0, hints: 0 };
  const { ctx, page, calls } = await open(phone, "", { "top-tens:v1": { games: {}, daily: {}, seenHelp: true, listRuns: [mine] } });
  await openSignIn(page);
  const form = page.getByTestId("sign-in-password-form");
  await form.waitFor();
  const sheet = page.getByTestId("sign-in-sheet");
  /** Still signed out: the sheet stays open (it closes itself on signing in). */
  const signedOut = async () => assert.ok(await sheet.isVisible(), "still signed out");
  const box = await sheet.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= phone.viewport.width + 0.5);
  assert.ok(await noHScroll(page));
  // No reset by email yet: the sheet says who to ask (the privacy contact).
  assert.equal(await page.getByTestId("sign-in-forgot").getByRole("link").getAttribute("href"), "mailto:privacy@example.com");
  const email = page.getByTestId("sign-in-pw-email");
  const password = page.getByTestId("sign-in-password");
  const submit = page.getByTestId("sign-in-password-submit");
  const error = page.getByTestId("sign-in-error");

  // A wrong password: refused, nothing else happens.
  await email.fill("fox@example.com");
  await password.fill("wrong one");
  assert.equal(await password.getAttribute("type"), "password");
  await page.getByTestId("sign-in-show-password").click();
  assert.equal(await password.getAttribute("type"), "text");
  await submit.click();
  await error.waitFor();
  assert.deepEqual(calls.password, [{ email: "fox@example.com", password: "wrong one", gotrue_meta_security: {} }]);
  await signedOut();

  // Create an account: too short is caught here; a taken address and a confirm-first project are explained.
  await page.getByTestId("sign-in-mode").click();
  await page.locator('[data-testid="sign-in-password-form"][data-mode="up"]').waitFor();
  assert.equal(await page.getByTestId("sign-in-forgot").count(), 0);
  assert.equal(await password.getAttribute("autocomplete"), "new-password");
  await password.fill("abc");
  await submit.click();
  await error.waitFor();
  assert.equal(calls.signup.length, 0);
  await email.fill("taken@example.com");
  await password.fill(PASSWORD);
  await submit.click();
  await until(() => calls.signup.length === 1);
  await error.waitFor();
  await email.fill("confirm@example.com");
  await submit.click();
  await page.getByTestId("sign-in-confirm").waitFor();
  await page.locator('[data-testid="sign-in-password-form"][data-mode="in"]').waitFor();
  await signedOut();

  // A new account: signed in at once, the sheet closes, and this device's games go to the account.
  await page.getByTestId("sign-in-mode").click();
  await email.fill("fox@example.com");
  await password.fill(PASSWORD);
  await submit.click();
  await sheet.waitFor({ state: "detached" });
  // The menu shows the account now: its address and Sign out.
  await openMenu(page);
  assert.equal(await page.getByTestId("menu-account-email").textContent(), "fox@example.com");
  await page.getByTestId("menu-sign-out").waitFor();
  assert.equal(await page.getByTestId("menu-sign-in").count(), 0);
  assert.ok(await noHScroll(page));
  await page.keyboard.press("Escape");
  const sent = calls.signup.at(-1);
  assert.equal(sent.email, "fox@example.com");
  assert.equal(sent.password, PASSWORD);
  await until(() => calls.saves.some((c) => c.method === "POST"));
  assert.deepEqual(calls.saves.find((c) => c.method === "POST").body.data.listRuns.map((r) => r.id), ["islands"]);
  assert.ok(await noHScroll(page));
  await ctx.close();
});

test("email and password: sign in to an existing account (desktop)", async () => {
  const { ctx, page, calls } = await open(desktop, "#stats", FRESH);
  await page.locator('[data-testid="account-panel"][data-signed-in="false"]').waitFor();
  await page.getByTestId("account-sign-in").click();
  await page.getByTestId("sign-in-pw-email").fill("fox@example.com");
  await page.getByTestId("sign-in-password").fill(PASSWORD);
  await page.getByTestId("sign-in-password").press("Enter");
  await page.locator('[data-testid="account-panel"][data-signed-in="true"]').waitFor();
  assert.equal(await page.getByTestId("account-name").textContent(), "fox");
  assert.equal(calls.password.length, 1);
  assert.equal(calls.signup.length, 0);
  await ctx.close();
});

// The suite's main build has no backend env (run.mjs clears it): it must stay a plain static game.
test("a build without the env vars sends nothing anywhere and offers no sign-in", { skip: !process.env.E2E_URL }, async () => {
  const ctx = await browser.newContext({ viewport: desktop.viewport, timezoneId: "America/New_York" });
  const outside = [];
  ctx.on("request", (r) => {
    const host = new URL(r.url()).hostname;
    // The page's own server, and the font (Google Fonts), are all a plain build talks to.
    if (!["localhost", "127.0.0.1", "fonts.googleapis.com", "fonts.gstatic.com"].includes(host)) outside.push(r.url());
  });
  await ctx.addInitScript((save) => localStorage.setItem("top-tens:v1", JSON.stringify(save)), FRESH["top-tens:v1"]);
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW });
  const url = process.env.E2E_URL;
  await page.goto(url + "#p-mountains");
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();
  await page.locator('[data-testid="results"] [data-testid="par"][data-source="estimate"]').waitFor();
  // A rating stays in the save. No note option: nowhere to send one.
  await page.getByTestId("rate-down").click();
  await page.locator('[data-testid="rate-reason"][data-reason="boring"]').click();
  assert.equal(await page.getByTestId("rate").getAttribute("data-reason"), "boring");
  assert.equal(await page.getByTestId("note").count(), 0);
  await page.goto(url);
  await page.getByTestId("stats-key").waitFor();
  assert.equal(await page.getByTestId("privacy-link").count(), 0);
  // The menu has no account section and no Feedback (no contact address).
  await openMenu(page);
  assert.equal(await page.getByTestId("menu-account").count(), 0);
  assert.equal(await page.getByTestId("menu-feedback").count(), 0);
  await page.goto(url + "#stats");
  await page.getByTestId("knowledge").waitFor();
  await settle();
  assert.equal(await page.getByTestId("account-panel").count(), 0);
  assert.deepEqual(outside, []);
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  assert.deepEqual(keys, ["top-tens:v1"]);
  await ctx.close();
});

test("the account pieces fit a phone: the menu, the sheet, the account panel", async () => {
  const { ctx, page } = await open(phone, "", FRESH);
  await page.getByTestId("today-list").waitFor();
  assert.ok(await noHScroll(page));
  await openMenu(page);
  await page.getByTestId("menu-sign-in").waitFor();
  assert.ok(await noHScroll(page));
  await page.getByTestId("menu-sign-in").click();
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

test("Sign out from the menu: the menu stays, Sign in takes its place and focus (phone)", async () => {
  const { ctx, page } = await open(phone, "", { ...FRESH, "top-tens:auth": SESSION }, { save: { data: { games: {}, daily: {}, seenHelp: true }, version: 1 } });
  await page.getByTestId("today-list").waitFor();
  await openMenu(page);
  assert.equal(await page.getByTestId("menu-account-email").textContent(), USER.email);
  await page.getByTestId("menu-sign-out").click();
  await page.getByTestId("menu-sign-in").waitFor();
  await page.waitForFunction(() => document.activeElement?.dataset.testid === "menu-sign-in");
  assert.equal(await page.getByTestId("menu-account-email").count(), 0);
  assert.ok(await page.getByTestId("menu").isVisible());
  assert.equal(await page.evaluate(() => localStorage.getItem("top-tens:auth")), null);
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

  // The menu shows the account (its address, Sign out); its Stats tile leads back to the panel.
  await page.getByTestId("nav-home").click();
  await openMenu(page);
  assert.equal(await page.getByTestId("menu-account-email").textContent(), USER.email);
  await page.getByTestId("menu-sign-out").waitFor();
  await page.getByTestId("menu-stats").click();
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
