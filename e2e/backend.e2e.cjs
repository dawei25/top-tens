// The backend switched on: this spec builds its own copy with fake Supabase env vars, serves it on a free port, and
// answers Supabase's endpoints itself. Checks: each finished game is sent once with the right payload; results blend
// real players into the estimate (never "(estimated)", owner Nov 14); a list rating goes to rate_list (and
// waits while offline); a Fathom guess goes to submit_fathom_guess once (and waits while offline), and its reveal says
// how real players guessed from 20 of them (fathom_compare asked with the round); a name-it round sends the figure of
// the thing named; Today's Fathom's total goes to submit_fathom_play once, and its results draw the day's real players
// (fathom_day_stats) with the simulated crowd; Home's
// account key in its header (signed out, signing in, signed in by name and never by address, the pink dot for sync
// trouble, each in its icon, name and title; nothing between Today and Free play), the menu without an account
// section and its Feedback, the sign-in sheet in both modes and privacy page; and a signed-in session syncing its save
// (merge both ways), with the account sheet, the comparison with players, and account deletion.
// Notes ("add a note") have their own spec on the same build: note.e2e.cjs.
// (Signing in itself ends at Google's or the email's door: the redirect and the email request are checked, not the
// return trip. The merge and the session handling have unit tests in src/net.) This build has no Google client ID:
// Google sign-in is Supabase's redirect. backend-google.e2e.cjs covers the build with one (from this site to Google
// and back).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { VIEWPORTS, NOW, TODAY, guess, noHScroll } = require("./helpers.cjs");
const { BACKEND_ENV } = require("./backend-env.cjs");
const { SUPA, STATS, FATHOM_DAY, serveBuild, opener, openMenu, openSignIn, accountKey, KEY_COLORS, homeSignedIn, TOKEN, SESSION, PASSWORD, FRESH, UUID, until, settle } = require("./backend-lib.cjs");

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

/**
 * What the results should show with `real` players (list_stats) on a list whose estimate is `est` (par.json): the
 * estimate counts as 30 players (ESTIMATE_WEIGHT, src/net/crowd.ts), real players join it.
 */
function blended(est, real, score) {
  const total = est.counts.reduce((a, b) => a + b, 0);
  const counts = est.counts.map((c, i) => (c * 30) / total + real.counts[i]);
  const all = counts.reduce((a, b) => a + b, 0);
  const below = counts.slice(0, score).reduce((a, b) => a + b, 0);
  return {
    avg: Math.round(((30 * est.par + real.n * real.avg) / (30 + real.n)) * 10) / 10,
    p: Math.round((100 * (below + counts[score] / 2)) / all),
  };
}

test("finished games are sent once, and results blend in real players (desktop)", async () => {
  const { ctx, page, calls } = await open(desktop, "#p-mountains", FRESH);
  const p = await page.evaluate(async () => (await fetch("puzzles/mountains.json")).json());
  const pars = await page.evaluate(async () => (await fetch("puzzles/par.json")).json());
  for (const r of [1, 3]) await guess(page, p.answers.find((a) => a.rank === r).name);
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();

  // 120 real players averaging 5.2 (STATS in backend-lib), blended with the estimate's 30: their number named.
  const want = blended(pars.mountains, STATS.list, 2);
  const block = page.locator('[data-testid="results"] [data-testid="par"][data-source="players"]');
  await block.waitFor();
  assert.equal(await block.getAttribute("data-n"), "120");
  assert.equal(Number(await block.getAttribute("data-par")), want.avg);
  assert.equal(Number(await block.getAttribute("data-p")), want.p);
  assert.equal(await block.getByTestId("par-line").textContent(), `better than ${want.p}% of players`);
  assert.equal(await block.getByTestId("histogram").locator("[data-par]").getAttribute("data-score"), String(Math.round(want.avg)));
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

// Owner, Nov 14: "dont specify estimated just say you did better than xx% of players today with a histogram".
test("a few real players move the estimate a little, and nothing says estimated (phone)", async () => {
  const { ctx, page } = await open(phone, "#p-airports", FRESH);
  const pars = await page.evaluate(async () => (await fetch("puzzles/par.json")).json());
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();

  // 10 players averaging 7.7 against the estimate's 30: the average moves a quarter of the way, unnamed.
  const want = blended(pars.airports, STATS.few, 0);
  const block = page.locator('[data-testid="results"] [data-testid="par"][data-n="10"]');
  await block.waitFor();
  assert.equal(await block.getAttribute("data-source"), "estimate");
  assert.equal(Number(await block.getAttribute("data-par")), want.avg);
  assert.ok(want.avg > pars.airports.par && want.avg < STATS.few.avg);
  assert.equal(Number(await block.getAttribute("data-p")), want.p);
  assert.equal(await block.getByTestId("par-line").textContent(), `better than ${want.p}% of players`);
  assert.doesNotMatch(await page.getByTestId("results").innerText(), /estimat/i);
  assert.ok(await noHScroll(page));
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

// What players type that the game doesn't take goes to submit_miss (owner: "real data instead of agents guessing what
// people type"), as short lowercase text linked to nobody: no user id, a random id of its own (not the one plays carry),
// and the public key alone, signed in or not. Once per text on a list and mode; junk too; never an answer, a near
// miss, or an email address; offline it waits.
test("a guess the game doesn't take goes to submit_miss once, lowercase, linked to nobody even signed in (desktop)", async () => {
  const KEY = BACKEND_ENV.VITE_SUPABASE_ANON_KEY;
  const { ctx, page, calls } = await open(desktop, "#p-mountains", { ...FRESH, "top-tens:auth": SESSION }, { save: { data: { games: {}, daily: {}, seenHelp: true }, version: 1 } });
  const plays = [];
  page.on("request", (r) => new URL(r.url()).pathname === "/rest/v1/rpc/submit_play" && plays.push(r.headers()));
  await page.getByLabel("Your guess").waitFor();

  await guess(page, "  Pizza   HUT ");
  await until(() => calls.miss.length === 1);
  const [first] = calls.miss;
  assert.match(first.args.p_client_id, UUID);
  assert.deepEqual(first.args, { p_list_id: "mountains", p_mode: "list", p_kind: "unknown", p_text: "pizza hut", p_client_id: first.args.p_client_id });
  // The public key, not the signed-in player's token.
  assert.equal(first.headers.apikey, KEY);
  assert.equal(first.headers.authorization, `Bearer ${KEY}`);
  assert.equal(first.headers.cookie, undefined);

  // The same text again: once. Junk goes too (false junk calls get found). An answer, a near miss (#12, a life) and an
  // email address never do.
  await guess(page, "PIZZA HUT");
  await guess(page, "xqzzvkw");
  await until(() => calls.miss.length === 2);
  assert.deepEqual({ ...calls.miss[1].args }, { ...first.args, p_kind: "junk", p_text: "xqzzvkw" });
  for (const text of ["Everest", "Broad Peak", "dana@example.com"]) await guess(page, text);
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();
  await page.getByTestId("results").waitFor();
  await until(() => calls.submit.length === 1);
  await settle();
  assert.equal(calls.miss.length, 2);
  // The game itself went with the player's session and the plays id; the misses with neither.
  assert.equal(plays[0].authorization, `Bearer ${TOKEN}`);
  assert.notEqual(first.args.p_client_id, calls.submit[0].p_client_id);

  // A Blitz round: its own mode. A hit sends nothing. Offline, a miss waits and goes when the connection is back.
  await page.goto(base + "#blitz-airports");
  await page.getByTestId("blitz-clock").waitFor();
  await guess(page, "Dubai");
  await guess(page, "Pizza Hut");
  await until(() => calls.miss.length === 3);
  assert.deepEqual(calls.miss[2].args, { ...first.args, p_list_id: "airports", p_mode: "blitz" });
  const rpc = `${SUPA}/rest/v1/rpc/submit_miss`;
  await page.route(rpc, (route) => route.abort("internetdisconnected"));
  await guess(page, "Gatwick Express");
  await settle();
  assert.equal(calls.miss.length, 3);
  const waiting = (await page.evaluate(() => JSON.parse(localStorage.getItem("top-tens:miss-outbox")))).pending;
  assert.deepEqual(waiting.map((m) => [m.listId, m.mode, m.kind, m.text]), [["airports", "blitz", "unknown", "gatwick express"]]);
  await page.unroute(rpc);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await until(() => calls.miss.length === 4);
  assert.equal(calls.miss[3].args.p_text, "gatwick express");
  assert.equal(calls.miss[3].args.p_client_id, first.args.p_client_id);

  // The privacy page says so.
  await page.goto(base + "#privacy");
  await page.getByTestId("privacy-misses").waitFor();
  await ctx.close();
});

// Fathom (the estimation beta) on its fixture bank: each locked-in guess goes to submit_fathom_guess once (offline it
// waits), and a reveal says how real players guessed once 20 of them have answered that question; below 20, nothing.
test("Fathom: each guess is sent once, and a reveal says how players guessed from 20 of them (phone)", async () => {
  const bank = path.join(__dirname, "fixtures", "fathom", "questions.json");
  const ids = ["eiffel-tower-height", "adult-bones", "octopus-hearts", "moon-distance", "everest-height"];
  const { ctx, page, calls } = await open(phone, "#fathom-endless", { ...FRESH, "tentacle:fathom": { recent: [], game: { ids, guesses: [], at: 0 } } }, undefined, (c) =>
    c.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill({ path: bank, contentType: "application/json" })),
  );
  const lockIn = async (text) => {
    await page.getByTestId("fathom-input").fill(text);
    await page.getByTestId("fathom-lock").click();
    await page.getByTestId("fathom-reveal").waitFor();
  };
  const next = async () => {
    await page.getByTestId("fathom-next").click();
    await page.getByTestId("fathom-input").waitFor();
  };

  // 37 players on the Eiffel Tower: the line, from what fathom_compare said about this guess and the answer shown.
  await page.getByTestId("fathom-input").waitFor();
  await lockIn("300");
  await until(() => calls.fathom.length === 1);
  const id = calls.fathom[0].p_client_id;
  assert.match(id, UUID);
  assert.deepEqual(calls.fathom[0], { p_question_id: "eiffel-tower-height", p_guess: 300, p_client_id: id });
  const players = page.getByTestId("fathom-players");
  await players.waitFor();
  assert.deepEqual(
    await players.evaluate((el) => ({ n: el.dataset.n, median: el.dataset.median, further: el.dataset.further })),
    { n: "37", median: "300", further: "0.7297" },
  );
  assert.deepEqual(calls.compare[0], { p_question_id: "eiffel-tower-height", p_round: "estimate", p_guess: "300", p_answer: "330", p_client_id: id });
  assert.ok(await noHScroll(page));

  // 12 players on the bones: nothing about them.
  await next();
  await lockIn("150");
  await until(() => calls.fathom.length === 2 && calls.compare.length === 2);
  await settle();
  assert.equal(calls.fathom[1].p_question_id, "adult-bones");
  assert.equal(await page.getByTestId("fathom-players").count(), 0);

  // Offline, a guess waits in the outbox and goes when the connection is back.
  const rpc = `${SUPA}/rest/v1/rpc/submit_fathom_guess`;
  await page.route(rpc, (route) => route.abort("internetdisconnected"));
  await next();
  await lockIn("8");
  await settle();
  assert.equal(calls.fathom.length, 2);
  const waiting = (await page.evaluate(() => JSON.parse(localStorage.getItem("top-tens:fathom-outbox")))).pending;
  assert.deepEqual(waiting.map((g) => [g.questionId, g.guess]), [["octopus-hearts", 8]]);
  await page.unroute(rpc);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await until(() => calls.fathom.length === 3);
  assert.deepEqual(calls.fathom[2], { p_question_id: "octopus-hearts", p_guess: 8, p_client_id: id });

  // A reload on the reveal sends nothing again.
  await page.reload();
  await page.getByTestId("fathom-reveal").waitFor();
  await settle();
  assert.equal(calls.fathom.length, 3);

  // The privacy page says what a guess sends.
  await page.goto(base + "#privacy");
  await page.getByTestId("privacy-fathom").waitFor();
  await ctx.close();
});

// Today's Fathom (owner, Nov 14): its total goes to submit_fathom_play once, when the day's game finishes (a reload
// sends nothing again), and the results draw the day's real players (fathom_day_stats) with the simulated crowd.
test("Today's Fathom: the day's total is sent once, and its results count the day's real players (phone)", async () => {
  const bank = path.join(__dirname, "fixtures", "fathom", "questions.json");
  const ids = ["eiffel-tower-height", "adult-bones", "octopus-hearts", "moon-distance", "everest-height"];
  const day = { day: { date: TODAY, n: 2 }, ids, guesses: [330, 206, 3, 384400], at: 3, startedAt: NOW.getTime() - 60_000 };
  const { ctx, page, calls } = await open(phone, "#fathom", { ...FRESH, "tentacle:fathom-daily": day }, undefined, (c) =>
    c.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill({ path: bank, contentType: "application/json" })),
  );
  await page.getByTestId("fathom-reveal").waitFor();
  await settle();
  assert.deepEqual(calls.fathomPlay, [], "nothing before the day's game is over");
  await page.getByTestId("fathom-next").click();
  await page.getByTestId("fathom-input").fill("8848");
  await page.getByTestId("fathom-lock").click();
  await page.getByTestId("fathom-reveal").waitFor();
  await until(() => calls.fathomPlay.length === 1);
  await page.getByTestId("fathom-next").click();
  await page.getByTestId("fathom-results").waitFor();
  const total = Number(await page.getByTestId("fathom-total").getAttribute("data-total"));
  assert.deepEqual(calls.fathomPlay[0], { p_date: TODAY, p_total: total, p_client_id: calls.fathomPlay[0].p_client_id });
  assert.match(calls.fathomPlay[0].p_client_id, UUID);
  // The day's real players join the simulated crowd: their bin (400-409) stands out; the line counts them.
  const crowd = page.locator(`[data-testid="fathom-crowd"][data-n="${FATHOM_DAY.n}"]`);
  await crowd.waitFor();
  assert.ok(calls.fathomDay.includes(TODAY));
  const heights = await crowd.locator(".histo-bar").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  assert.equal(Math.max(...heights), heights[40], "the real players' bin is the tallest");
  assert.match(await crowd.getByTestId("fathom-crowd-line").textContent(), /^you did better than \d+% of players today$/);
  assert.doesNotMatch(await page.locator("main").innerText(), /estimat/i);
  // A reload (the results again) sends nothing again.
  await page.reload();
  await page.getByTestId("fathom-results").waitFor();
  await settle();
  assert.equal(calls.fathomPlay.length, 1);
  await ctx.close();
});

// A name-it round sends the figure of the thing named, like any guess (the owner will score questions by how real
// players do): an island on a land-borders round is a 0. It asks for no players' line.
test("Fathom: a name-it round sends the figure of the thing named, 0 land borders included (desktop)", async () => {
  const fixtures = path.join(__dirname, "fixtures", "fathom");
  const questionsIn = (file) => JSON.parse(fs.readFileSync(path.join(fixtures, file), "utf8")).questions;
  const questions = [...questionsIn("questions.json"), ...questionsIn("name-questions.json")];
  const ids = ["eiffel-tower-height", "name-country-6-borders", "adult-bones", "octopus-hearts", "piano-keys"];
  const seed = { ...FRESH, "tentacle:fathom": { recent: [], game: { ids, guesses: [330], at: 1 } } };
  const { ctx, page, calls } = await open(desktop, "#fathom-endless", seed, undefined, async (c) => {
    await c.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 1, questions }) }));
    await c.route(/\/fathom\/lists\/[a-z0-9-]+\.json(\?.*)?$/, (route) => {
      const file = path.join(fixtures, "lists", path.basename(new URL(route.request().url()).pathname));
      return fs.existsSync(file) ? route.fulfill({ path: file, contentType: "application/json" }) : route.fulfill({ status: 404, body: "" });
    });
  });
  await page.locator('[data-testid="fathom-ask"][data-round="name"]').waitFor();
  await page.getByTestId("fathom-input").fill("Japan");
  await page.getByTestId("fathom-lock").click();
  await page.getByTestId("fathom-reveal").waitFor();
  assert.equal(await page.getByTestId("fathom-guess").getAttribute("data-pick"), "Japan");
  await until(() => calls.fathom.length === 1);
  assert.deepEqual(calls.fathom[0], { p_question_id: "name-country-6-borders", p_guess: 0, p_client_id: calls.fathom[0].p_client_id });
  assert.match(calls.fathom[0].p_client_id, UUID);
  await settle();
  assert.equal(await page.getByTestId("fathom-players").count(), 0);
  assert.deepEqual(calls.compare, []);
  await ctx.close();
});

test("Home's account key signed out, the menu's Feedback, the sign-in sheet and privacy page (desktop)", async () => {
  const { ctx, page, calls } = await open(desktop, "", FRESH);
  await page.getByTestId("today-list").waitFor();
  // Signed out, at a glance on Home (owner): a hollow, quiet player, no dot, and the words in its name and title.
  await page.locator('[data-testid="account-key"][data-state="out"]').waitFor();
  const out = await accountKey(page);
  assert.deepEqual(
    { name: out.name, title: out.title, color: out.color, dot: out.dot, disabled: out.disabled },
    { name: "Account: not signed in", title: "Account: not signed in", color: KEY_COLORS.out, dot: false, disabled: false },
  );
  assert.equal(await page.getByTestId("account-key").getAttribute("aria-haspopup"), "dialog");
  // The menu has no account section any more: the account lives on Home.
  await openMenu(page);
  assert.equal(await page.getByTestId("menu-account").count(), 0);
  assert.equal(await page.getByTestId("menu-sign-in").count(), 0);
  // Feedback mails the contact address, with a subject.
  const mail = new URL(await page.getByTestId("menu-feedback").getAttribute("href"));
  assert.equal(mail.protocol, "mailto:");
  assert.equal(mail.pathname, "privacy@example.com");
  assert.equal(mail.searchParams.get("subject"), "TENtacle feedback");
  await page.keyboard.press("Escape");
  await page.getByTestId("menu").waitFor({ state: "detached" });
  const key = page.getByTestId("account-key");

  // The key opens the sign-in sheet, to sign in: every method this build offers (google,email,password); the password
  // form first, a link one press away.
  await openSignIn(page);
  assert.equal(await page.getByTestId("sign-in-title").getAttribute("data-mode"), "in");
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

  // Escape closes it and gives focus back to the key that opened it.
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.dataset.testid === "account-key");
  assert.equal(await key.evaluate((el) => el === document.activeElement), true);

  // Creating an account is one press inside: the password form's create mode, under its own heading.
  await openSignIn(page, "up");
  assert.equal(await page.getByTestId("sign-in-title").getAttribute("data-mode"), "up");
  assert.equal(await page.getByTestId("sign-in-password").getAttribute("autocomplete"), "new-password");
  // Switching back to sign in there changes the heading with it.
  await page.getByTestId("sign-in-mode").click();
  assert.equal(await page.getByTestId("sign-in-title").getAttribute("data-mode"), "in");
  // The close key, and a press outside, give focus back to the key too.
  await page.getByTestId("sign-in-close").click();
  await page.getByTestId("sign-in-sheet").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.dataset.testid === "account-key");
  await openSignIn(page);
  await page.mouse.click(4, 4);
  await page.getByTestId("sign-in-sheet").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.dataset.testid === "account-key");

  // The privacy page, from the footer: notes have their own part (what's sent, who reads them).
  await page.getByTestId("privacy-link").click();
  await page.getByTestId("privacy").waitFor();
  await page.getByTestId("privacy-notes").waitFor();
  assert.ok(await noHScroll(page));
  // "Deleting it" sends you where those things are: the account key on Home, reset all progress in Settings. (It once
  // said Stats and Home after both had moved.)
  const ways = page.getByTestId("privacy-delete").getByRole("link");
  assert.deepEqual(await ways.evaluateAll((els) => els.map((a) => a.getAttribute("href")).filter((h) => h.startsWith("#"))), ["#", "#settings"]);
  for (const [i, there] of [
    [0, "account-key"],
    [1, "reset-all"],
  ]) {
    await page.getByTestId("privacy-delete").getByRole("link").nth(i).click();
    await page.getByTestId(there).waitFor();
    await page.goBack();
    await page.getByTestId("privacy").waitFor();
  }
  await page.getByTestId("nav-back").click();

  // Google, in a build without VITE_GOOGLE_CLIENT_ID: the same key, off to Supabase's authorize endpoint, coming back
  // to this page. Nothing goes to Google from this page.
  const google = [];
  page.on("request", (r) => new URL(r.url()).hostname === "accounts.google.com" && google.push(r.url()));
  await openSignIn(page);
  assert.equal(await page.getByTestId("sign-in-google").getAttribute("data-flow"), "supabase");
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
  // Home says so at once: signed in as the email's part before the @ (no name yet), never the address itself.
  await homeSignedIn(page, "fox");
  await page.waitForFunction(() => document.activeElement?.dataset.testid === "account-key");
  assert.ok(await noHScroll(page));
  const sent = calls.signup.at(-1);
  assert.equal(sent.email, "fox@example.com");
  assert.equal(sent.password, PASSWORD);
  await until(() => calls.saves.some((c) => c.method === "POST"));
  assert.deepEqual(calls.saves.find((c) => c.method === "POST").body.data.listRuns.map((r) => r.id), ["islands"]);
  assert.ok(await noHScroll(page));
  await ctx.close();
});

test("email and password: sign in to an existing account; Home and the account say who (desktop)", async () => {
  const { ctx, page, calls } = await open(desktop, "", FRESH);
  await openSignIn(page);
  await page.getByTestId("sign-in-pw-email").fill("fox@example.com");
  await page.getByTestId("sign-in-password").fill(PASSWORD);
  await page.getByTestId("sign-in-password").press("Enter");
  await page.getByTestId("sign-in-sheet").waitFor({ state: "detached" });
  await homeSignedIn(page, "fox");
  // The key, lit now: the account sheet, with the name and the address it signed in with.
  await page.getByTestId("account-key").click();
  await page.getByTestId("account-sheet").waitFor();
  assert.equal(await page.getByTestId("account-name").textContent(), "fox");
  assert.match(await page.getByTestId("account-sheet").textContent(), /fox@example\.com/);
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
  // A guess the game doesn't take: nowhere to send it, so nothing is kept either.
  await guess(page, "pizza");
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
  // No account key on Home: nothing to sign in to.
  assert.equal(await page.getByTestId("account-key").count(), 0);
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

test("the account pieces fit a phone: Home's key, both sheets (320 and 390)", async () => {
  for (const width of [320, 390]) {
    const vp = { ...phone, viewport: { width, height: 844 } };
    const { ctx, page } = await open(vp, "", FRESH);
    await page.getByTestId("today-list").waitFor();
    assert.ok(await noHScroll(page));
    const inside = async (testId) => {
      const box = await page.getByTestId(testId).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 0.5, `${width}: ${testId} fits the width`);
    };
    await inside("account-key");
    for (const mode of ["in", "up"]) {
      await openSignIn(page, mode);
      await inside("sign-in-sheet");
      assert.ok(await noHScroll(page));
      await page.getByTestId("sign-in-close").click();
      await page.getByTestId("sign-in-sheet").waitFor({ state: "detached" });
    }
    await ctx.close();
  }
});

test("signed in: Home's key is lit and names the player, never the address; it opens the account; Sign out closes it and the key goes hollow (phone)", async () => {
  const { ctx, page } = await open(phone, "", { ...FRESH, "top-tens:auth": SESSION }, { save: { data: { games: {}, daily: {}, seenHelp: true }, version: 1 } });
  await page.getByTestId("today-list").waitFor();
  // The Google name (Dana Scully), never dana@example.com.
  await homeSignedIn(page, "Dana Scully");
  assert.doesNotMatch(await page.locator("main").textContent(), /dana@example\.com/);
  await page.locator('[data-testid="account-key"][data-sync="synced"]').waitFor();
  // Synced: lit, filled in (more pixels than the hollow player), no dot, the name and title say who.
  const lit = await accountKey(page);
  assert.deepEqual(
    { name: lit.name, title: lit.title, color: lit.color, dot: lit.dot },
    { name: "Account: signed in as Dana Scully", title: "Account: signed in as Dana Scully", color: KEY_COLORS.in, dot: false },
  );
  assert.ok(await noHScroll(page));

  // The key opens the account over Home, focus on the sheet itself (a second press presses nothing in it).
  await page.getByTestId("account-key").click();
  const sheet = page.getByTestId("account-sheet");
  await sheet.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "account-sheet");
  const box = await sheet.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= phone.viewport.width + 0.5);
  assert.equal(await page.getByTestId("account-name").textContent(), "Dana Scully");
  // Escape closes it, focus back on the key.
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.dataset.testid === "account-key");

  // Sign out: the sheet closes, the key goes hollow and says so, focus stays on it, and the session is gone.
  await page.getByTestId("account-key").click();
  await page.getByTestId("account-sign-out").click();
  await sheet.waitFor({ state: "detached" });
  await page.locator('[data-testid="account-key"][data-state="out"]').waitFor();
  const out = await accountKey(page);
  assert.equal(out.name, "Account: not signed in");
  assert.equal(out.color, KEY_COLORS.out);
  assert.ok(out.pixels < lit.pixels, `the hollow player (${out.pixels} pixels) is less filled in than the lit one (${lit.pixels})`);
  await page.waitForFunction(() => document.activeElement?.dataset.testid === "account-key");
  assert.equal(await page.evaluate(() => localStorage.getItem("top-tens:auth")), null);
  await ctx.close();
});

test("Home: the account is a key in the header, never a row; nothing comes between Today and Free play", async () => {
  // Owner: "I hate how the sign-in thing takes up an entire row of space in the center." Signed out and signed in, at
  // every phone size and on a desktop: Free play follows Today directly, the key sits in the header's right group, and
  // Today's key and Free play stand exactly where a build without accounts has them.
  const plain = process.env.E2E_URL;
  const sizes = [
    [320, 568],
    [360, 740],
    [375, 667],
    [390, 844],
    [430, 932],
    [1440, 900],
  ];
  for (const signedIn of [false, true]) {
    for (const [width, height] of sizes) {
      const vp = { viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 };
      const seed = signedIn ? { ...FRESH, "top-tens:auth": SESSION } : FRESH;
      const { ctx, page } = await open(vp, "", seed, { save: { data: { games: {}, daily: {}, seenHelp: true }, version: 1 } });
      await page.locator(`[data-testid="account-key"][data-state="${signedIn ? "in" : "out"}"]`).waitFor();
      const tag = `${width}x${height}${signedIn ? " signed in" : ""}`;
      const between = await page.getByTestId("today-group").evaluate((today) => {
        const next = today.nextElementSibling;
        return {
          next: next?.contains(document.querySelector('[data-testid="free-play"]')) ? "free play" : `${next?.tagName.toLowerCase()}.${next?.className}`,
          key: !!document.querySelector('.home-keys [data-testid="account-key"]'),
        };
      });
      assert.equal(between.next, "free play", `${tag}: Free play comes right after Today`);
      assert.ok(between.key, `${tag}: the account key in Home's header keys`);
      // Measured once the fonts are in and layout has settled: under load the plain build's page was measured while the
      // title still had its fallback font, 49px shorter (two flaky runs, Nov 7 and Nov 8).
      const tops = async (p) => {
        await p.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
        return Promise.all(["today-list", "free-play"].map((id) => p.getByTestId(id).evaluate((el) => Math.round(el.getBoundingClientRect().top))));
      };
      const here = await tops(page);
      assert.ok(await noHScroll(page), tag);
      if (plain) {
        // The same screen in the build without accounts: Today's key and Free play haven't moved.
        const other = await ctx.newPage();
        await other.clock.install({ time: NOW });
        await other.goto(plain);
        await other.getByTestId("today-list").waitFor();
        assert.deepEqual(here, await tops(other), `${tag}: Today's list and Free play where the plain build has them`);
        await other.close();
      }
      await ctx.close();
    }
  }
});

test("Home's key shows sync trouble: offline and failed light a pink dot and say so; the sheet says what (desktop)", async () => {
  const seed = { ...FRESH, "top-tens:auth": SESSION };
  const save = { data: { games: {}, daily: {}, seenHelp: true }, version: 1 };
  for (const [sync, words, route] of [
    // The server can't be reached: offline, and the games wait on this device.
    ["offline", "offline", (r) => r.abort("internetdisconnected")],
    // The server refuses: the sync failed, said plainly, with a way to try again in the sheet.
    ["error", "couldn't sync", (r) => r.fulfill({ status: 500, contentType: "application/json", body: "{}" })],
  ]) {
    const { ctx, page } = await open(desktop, "", seed, { save }, (c) => c.route(`${SUPA}/rest/v1/saves**`, route));
    await homeSignedIn(page, "Dana Scully");
    await page.locator(`[data-testid="account-key"][data-sync="${sync}"]`).waitFor();
    const key = await accountKey(page);
    assert.deepEqual(
      { name: key.name, title: key.title, color: key.color, dot: key.dot },
      { name: `Account: signed in as Dana Scully, ${words}`, title: `Account: signed in as Dana Scully, ${words}`, color: KEY_COLORS.in, dot: true },
      sync,
    );
    // The dot is pink, inside the key, and takes no presses of its own.
    const dot = await page.getByTestId("account-dot").evaluate((el) => {
      const r = el.getBoundingClientRect();
      const k = el.parentElement.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, events: s.pointerEvents, inside: r.left >= k.left && r.right <= k.right && r.top >= k.top && r.bottom <= k.bottom };
    });
    assert.deepEqual(dot, { bg: "rgb(255, 93, 143)", events: "none", inside: true }, sync);
    await page.getByTestId("account-key").click();
    await page.locator(`[data-testid="account-sync"][data-sync="${sync}"]`).waitFor();
    await ctx.close();
  }
});

test("a sign-in coming back: Home's key waits, then shows the dot, and its sheet says why it didn't work (phone)", async () => {
  // The backend code held back for a moment: the key is finding out.
  let release;
  const held = new Promise((r) => (release = r));
  const hold = (ctx) =>
    ctx.route(/\/assets\/service-[\w-]+\.js$/, async (route) => {
      await held;
      return route.continue();
    });
  const { ctx, page } = await open(phone, "?code=not-a-real-code", FRESH, undefined, hold);
  await page.locator('[data-testid="account-key"][data-state="loading"]').waitFor();
  const waiting = await accountKey(page);
  assert.deepEqual(
    { name: waiting.name, title: waiting.title, color: waiting.color, dot: waiting.dot, disabled: waiting.disabled },
    { name: "Account: signing in", title: "Account: signing in", color: KEY_COLORS.loading, dot: false, disabled: true },
  );
  release();
  // The link was opened in a browser that didn't ask for it: signed out, the dot, and the sheet says why.
  await page.locator('[data-testid="account-key"][data-state="out"]').waitFor();
  const failed = await accountKey(page);
  assert.deepEqual(
    { name: failed.name, color: failed.color, dot: failed.dot, disabled: failed.disabled },
    { name: "Account: not signed in, sign-in didn't finish", color: KEY_COLORS.out, dot: true, disabled: false },
  );
  await page.getByTestId("account-key").click();
  await page.getByTestId("sign-in-sheet").getByRole("alert").waitFor();
  // Said and seen: closing the sheet takes the dot away, focus back on the key.
  await page.getByTestId("sign-in-close").click();
  await page.getByTestId("sign-in-sheet").waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.dataset.testid === "account-key");
  const seen = await accountKey(page);
  assert.deepEqual({ name: seen.name, dot: seen.dot }, { name: "Account: not signed in", dot: false });
  await ctx.close();
});

// Fathom's games travel with the account the way list games do (Nov 9: out of beta): the save carries its finished
// games, their totals and the last draws; a sync merges both devices' and writes the union back, and a game finished
// here asks for a sync of its own.
test("signed in: Fathom's games, totals and draws sync both ways, and a game finished here goes to the account (phone)", async () => {
  const bank = path.join(__dirname, "fixtures", "fathom", "questions.json");
  const fixture = JSON.parse(fs.readFileSync(bank, "utf8")).questions;
  const ids = (from) => fixture.slice(from, from + 5).map((q) => q.id);
  const game = (startedAt, from) => ({ startedAt, finishedAt: startedAt + 120_000, ids: ids(from), guesses: [1, 1, 1, 1, 1], points: [90, 80, 70, 60, 50] });
  const mine = game(NOW.getTime() - 3_600_000, 0);
  const theirs = game(NOW.getTime() - 86_400_000, 5);
  const fathom = (g, drawn) => ({ runs: [g], totals: { [g.startedAt]: 350 }, recent: [{ startedAt: g.startedAt, ids: drawn }] });
  const { ctx, page, calls, row } = await open(
    phone,
    "",
    { "top-tens:v1": { games: {}, daily: {}, seenHelp: true, fathom: fathom(mine, mine.ids) }, "top-tens:auth": SESSION },
    { save: { data: { games: {}, daily: {}, seenHelp: true, fathom: fathom(theirs, theirs.ids) }, version: 2 } },
    (c) => c.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill({ path: bank, contentType: "application/json" })),
  );
  await page.locator('[data-testid="account-key"][data-sync="synced"]').waitFor();
  // The server got both games, both totals and both draws, newest first, over the version it read.
  const first = calls.saves.find((c) => c.method === "PATCH");
  assert.ok(first, "the merged save was written back");
  assert.match(first.query, /version=eq\.2/);
  assert.deepEqual(first.body.data.fathom.runs.map((r) => r.startedAt), [mine.startedAt, theirs.startedAt]);
  assert.deepEqual(Object.keys(first.body.data.fathom.totals).sort(), [mine.startedAt, theirs.startedAt].map(String).sort());
  assert.deepEqual(first.body.data.fathom.recent.map((d) => d.ids), [mine.ids, theirs.ids]);
  // This device has the other device's game: in Past runs and in Stats.
  await page.getByTestId("history-key").click();
  await page.locator('[data-testid="history-row"][data-kind="fathom"]').nth(1).waitFor();
  await page.getByTestId("nav-home").click();
  await page.getByTestId("stats-key").click();
  await page.getByTestId("know-fathom-games").filter({ hasText: "2" }).waitFor();

  // A game here: none of the last draws' questions (on either device), and once it's over the account has it.
  // (Endless Fathom: its draw holds back the last games'.)
  await page.evaluate(() => (location.hash = "#fathom-endless"));
  for (let i = 0; i < 5; i++) {
    await page.getByTestId("fathom-input").waitFor();
    await page.getByTestId("fathom-input").fill("42");
    await page.getByTestId("fathom-lock").click();
    await page.getByTestId("fathom-reveal").waitFor();
    await page.getByTestId("fathom-next").click();
  }
  await page.getByTestId("fathom-results").waitFor();
  await page.clock.runFor(2000);
  await until(() => (row().data.fathom?.runs?.length ?? 0) === 3);
  assert.equal(Object.keys(row().data.fathom.totals).length, 3);
  // The draw held back both devices' last games: the two questions neither played are in this one.
  const played = row().data.fathom.runs[0].ids;
  assert.deepEqual(row().data.fathom.recent.map((d) => d.ids), [played, mine.ids, theirs.ids]);
  for (const q of fixture.slice(10)) assert.ok(played.includes(q.id), `${q.id} drawn`);
  assert.ok(row().version > 3);
  await ctx.close();
});

test("signed in: the save syncs both ways; Home, the account sheet, players' averages, delete (desktop)", async () => {
  const mine = { id: "islands", startedAt: NOW.getTime() - 3_600_000, finishedAt: NOW.getTime() - 3_300_000, status: "lost", found: [1, 2, 3, 4], lives: 0, hints: 0 };
  const theirs = { id: "mountains", startedAt: NOW.getTime() - 86_400_000, finishedAt: NOW.getTime() - 86_000_000, status: "won", found: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], lives: 2, hints: 0 };
  const { ctx, page, calls, row } = await open(
    desktop,
    "",
    { "top-tens:v1": { games: {}, daily: {}, seenHelp: true, listRuns: [mine] }, "top-tens:auth": SESSION },
    {
      save: { data: { games: {}, daily: { "2026-10-28": "youtube-channels" }, seenHelp: true, listRuns: [theirs] }, version: 4 },
      averages: [
        { list_id: "mountains", n: 200, avg: 4.5 },
        { list_id: "islands", n: 30, avg: 6 },
      ],
    },
  );
  // Home: signed in as Dana Scully, synced (no dot).
  await homeSignedIn(page, "Dana Scully");
  await page.locator('[data-testid="account-key"][data-sync="synced"]').waitFor();
  assert.equal((await accountKey(page)).dot, false);

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

  // The account sheet: the name, synced, and a new display name (Home's key follows).
  await page.getByTestId("account-key").click();
  await page.locator('[data-testid="account-sheet"] [data-testid="account-panel"]').waitFor();
  assert.equal(await page.getByTestId("account-name").textContent(), "Dana Scully");
  await page.locator('[data-testid="account-sync"][data-sync="synced"]').waitFor();
  await page.getByTestId("account-rename").click();
  await page.getByTestId("account-name-input").fill("  Agent   Scully ");
  await page.getByTestId("account-name-save").click();
  await page.getByTestId("account-name").filter({ hasText: "Agent Scully" }).waitFor();
  assert.equal(calls.renamed, "Agent Scully");
  // Escape while renaming cancels the rename, not the sheet.
  await page.getByTestId("account-rename").click();
  await page.getByTestId("account-name-input").press("Escape");
  await page.getByTestId("account-name").waitFor();
  assert.ok(await page.getByTestId("account-sheet").isVisible());
  await page.keyboard.press("Escape");
  await page.getByTestId("account-sheet").waitFor({ state: "detached" });
  await homeSignedIn(page, "Agent Scully");

  // Players' averages on Stats: only the list with 50+ players. Stats has no account section now (it's on Home).
  await page.getByTestId("stats-key").click();
  await page.getByTestId("crowd-panel").waitFor();
  assert.deepEqual(await page.getByTestId("crowd-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-id"))), ["mountains"]);
  assert.equal(await page.getByTestId("account-panel").count(), 0);
  assert.ok(await noHScroll(page));
  // The menu has no account section, and inner screens have no account key: the account is one press on HOME away.
  await openMenu(page);
  assert.equal(await page.getByTestId("menu-account").count(), 0);
  await page.keyboard.press("Escape");
  await page.getByTestId("menu").waitFor({ state: "detached" });
  assert.equal(await page.getByTestId("account-key").count(), 0);
  await page.getByTestId("nav-home").click();

  // Delete account: an inline confirm, then the server function with this session's token.
  let auth;
  await page.route("**/api/delete-account", (route) => {
    auth = route.request().headers().authorization;
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"deleted":true}' });
  });
  await page.getByTestId("account-key").click();
  await page.getByTestId("account-delete").click();
  assert.equal(auth, undefined, "the first press only asks");
  await page.getByTestId("account-delete").click();
  // The sheet stays to say so; Home's key is hollow behind it.
  await page.getByTestId("account-deleted").waitFor();
  await page.locator('[data-testid="account-key"][data-state="out"]').waitFor();
  assert.equal(auth, `Bearer ${TOKEN}`);
  assert.equal(await page.evaluate(() => localStorage.getItem("top-tens:auth")), null);
  await page.getByTestId("account-close").click();
  await page.waitForFunction(() => document.activeElement?.dataset.testid === "account-key");
  // This device keeps its games.
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("top-tens:v1")))).listRuns.length, 2);
  await ctx.close();
});
