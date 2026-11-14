// Free play without an account (owner, Nov 14: "after a user plays more than once in free play, they have to sign in
// with google to continue playing"): src/game/free-games.ts counts the free games played (FREE_GAMES_BEFORE_SIGN_IN,
// 2), and the next one asks for Google sign-in in a sheet, the wall. On the launch build (GOOGLE_ENV: Google alone, a
// client ID; Supabase mocked, Google faked as in backend-google.e2e.cjs). Checks: two free games play (a list game
// counts from a guess, a Blitz round once its clock runs) and the third shows the wall, from Home's keys, a category,
// the menu and Roll new list, over the screen the player was on, which closing leaves as it was; Today's list still
// opens, from Home and from the wall's quiet key; a game in progress resumes; a link to a free list counts, and one
// past the free ones shows the wall alone, closing back where the player came from; an accidental open doesn't count;
// Play again and a finished daily's Random list ask too (no list's results offer its Blitz since Nov 14); signing in starts the game asked for (by popup, and with the popup blocked, after a
// trip to Google and back), and a signed-in player is never asked; the build without a backend has no wall; the
// wall's keys never move anything at 390 and 1440.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, NOW, TODAY, guess, noHScroll, open: openPlain, store } = require("./helpers.cjs");
const { GOOGLE_ENV } = require("./backend-env.cjs");
const { serveBuild, opener, homeSignedIn, openMenu, FRESH, SESSION, until, settle, withGoogle, pressForPopup } = require("./backend-lib.cjs");
const { checkScreen, formatFailures } = require("./states-lib.cjs");

const desktop = VIEWPORTS.find((v) => v.name === "desktop");
const phone = VIEWPORTS.find((v) => v.name === "phone");

let served;
let plainBrowser;
const open = opener(() => served);

before(async () => {
  served = await serveBuild(GOOGLE_ENV, "E2E_GOOGLE_DIST");
  plainBrowser = await chromium.launch();
});

after(async () => {
  await served?.close();
  await plainBrowser?.close();
});

const T = NOW.getTime();
/** A finished free list game in the history (no daily number). */
const freeRun = (id, ago) => ({ id, startedAt: T - ago, finishedAt: T - ago + 60_000, status: "lost", found: [1], lives: 0, hints: 0 });
/** A save with `n` free games played (finished list games on lists that never run as a daily). */
const FREE_LISTS = ["africa-population", "asia-population", "us-states-area", "us-cities", "world-cities", "lakes"];
const played = (n, more = {}) => ({
  "top-tens:v1": { ...FRESH["top-tens:v1"], listRuns: FREE_LISTS.slice(0, n).map((id, i) => freeRun(id, (i + 2) * 3_600_000)), ...more },
});
const hashOf = (page) => page.evaluate(() => location.hash);
const sheet = (page) => page.getByTestId("free-wall-sheet");
/** The wall is open: its heading, its line, the Google key focused first (no keyboard on a phone). */
async function walled(page) {
  await sheet(page).waitFor();
  await page.getByTestId("sign-in-google").waitFor();
  assert.equal(await sheet(page).getAttribute("role"), "dialog");
  assert.equal(await sheet(page).getAttribute("aria-labelledby"), "free-wall-title");
  await page.getByTestId("free-wall-title").waitFor();
  await page.getByTestId("free-wall-line").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "sign-in-google");
}
const gone = (page) => sheet(page).waitFor({ state: "detached" });
/** A random list from Home: its id, once its game is on screen. */
async function rollList(page) {
  await page.getByTestId("random-list").click();
  await page.waitForFunction(() => /^#p-[\w-]+$/.test(location.hash));
  await page.getByTestId("title-card").waitFor();
  return (await hashOf(page)).slice(3);
}
/** Plays a guess the list takes: its #1. */
async function findTop(page, id) {
  const p = await page.evaluate(async (x) => (await fetch(`puzzles/${x}.json`)).json(), id);
  await guess(page, p.answers[0].name);
  await page.locator('[data-testid="slot"][data-rank="1"][data-state="found"]').waitFor();
}
const home = (page) => page.getByTestId("nav-home").click().then(() => page.getByTestId("today-list").waitFor());

test("two free games play, the third shows the wall over Home; closing leaves Home as it was; Today's list still opens (phone)", async () => {
  const { ctx, page } = await open(phone, "", FRESH, undefined, withGoogle({}));
  await page.getByTestId("today-list").waitFor();

  // Game 1: a random list, played from its first guess.
  const first = await rollList(page);
  await findTop(page, first);
  // Game 2: a random Blitz, counted once its clock starts (the first keystroke).
  await home(page);
  await page.getByTestId("random-blitz").click();
  await page.getByTestId("blitz-clock").waitFor();
  const blitz = (await hashOf(page)).replace(/^#blitz-/, "");
  await page.getByLabel("Your guess").fill("t");
  await page.locator('[data-testid="blitz-clock"][data-started="true"]').waitFor();
  await home(page);

  // Game 3: the wall, over Home; nothing rolled, nothing saved.
  const before = await store(page);
  await page.getByTestId("random-list").click();
  await walled(page);
  assert.equal(await hashOf(page), "");
  assert.deepEqual(await store(page), before, "the save is as it was");
  const box = await sheet(page).boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= phone.viewport.width + 0.5, "the sheet fits the phone");
  assert.ok(await noHScroll(page));
  // Today's list waits: the quiet key goes there.
  assert.equal(await page.getByTestId("free-wall-alt").getAttribute("data-go"), "today");
  await page.getByTestId("free-wall-close").click();
  await gone(page);
  assert.equal(await hashOf(page), "");
  await page.getByTestId("today-list").waitFor();

  // Random Blitz and a category ask too; a press outside closes it.
  await page.getByTestId("random-blitz").click();
  await walled(page);
  await page.mouse.click(phone.viewport.width / 2, 30);
  await gone(page);
  await page.getByTestId("random-list-categories").click();
  await page.locator('[data-testid="category"][data-mode="list"]').first().click();
  await walled(page);
  await page.keyboard.press("Escape");
  await gone(page);
  assert.equal(await hashOf(page), "");

  // The games under way resume, with no wall: the list where it was, the Blitz round with its clock running.
  await page.evaluate((id) => (location.hash = `#p-${id}`), first);
  await page.locator('[data-testid="slot"][data-rank="1"][data-state="found"]').waitFor();
  assert.equal(await sheet(page).count(), 0);
  await page.evaluate((id) => (location.hash = `#blitz-${id}`), blitz);
  await page.locator('[data-testid="blitz-clock"][data-started="true"]').waitFor();
  assert.equal(await sheet(page).count(), 0);

  // Today's list is never walled: from Home, and from the wall's quiet key.
  await home(page);
  await page.getByTestId("today-list").click();
  await page.waitForFunction((d) => location.hash === `#daily-${d}`, TODAY);
  await page.getByLabel("Your guess").waitFor();
  await home(page);
  await page.getByTestId("random-list").click();
  await walled(page);
  await page.getByTestId("free-wall-alt").click();
  await gone(page);
  await page.waitForFunction((d) => location.hash === `#daily-${d}`, TODAY);
  await page.getByLabel("Your guess").waitFor();
  await ctx.close();
});

test("a link to a free list counts, and one past the free ones gets the wall alone; an open alone doesn't count (desktop)", async () => {
  // One free game played; a list opened and left untouched (it doesn't count); a daily played (never counts).
  const untouched = { puzzleId: "rivers", found: [], lives: 5, log: [], status: "playing", startedAt: T - 600_000 };
  const daily = { ...freeRun("youtube-channels", 86_400_000), daily: 9 };
  const seed = played(1, { games: { rivers: untouched } });
  seed["top-tens:v1"].listRuns.push(daily);
  const { ctx, page } = await open(desktop, "", seed, undefined, withGoogle({}));
  await page.getByTestId("today-list").waitFor();

  // A link to a free list (here typed in): game 2, played. The list ran as a daily (Oct 22) and that daily wasn't
  // played: the game under way shares the list's save with it, and counts as free play by the mark it starts with.
  await page.evaluate(() => (location.hash = "#p-mountains"));
  await page.getByTestId("title-card").waitFor();
  await findTop(page, "mountains");

  // The next link (the list opened and left alone, then a new one): the wall alone, no game behind it; closing goes
  // back to the screen the player came from.
  for (const link of ["#p-rivers", "#blitz-lakes"]) {
    await page.evaluate((h) => (location.hash = h), link);
    await walled(page);
    await page.getByTestId("free-wall-screen").waitFor();
    assert.equal(await page.getByTestId("title-card").count(), 0, `nothing of ${link} behind the wall`);
    assert.equal(await page.getByLabel("Your guess").count(), 0);
    await page.getByTestId("free-wall-close").click();
    await gone(page);
    await page.waitForFunction(() => location.hash === "#p-mountains");
    await page.locator('[data-testid="slot"][data-rank="1"][data-state="found"]').waitFor();
  }
  const saved = await store(page);
  assert.deepEqual(saved.games.rivers, untouched, "the untouched list stays as it was");
  assert.equal(saved.blitzLive?.lakes, undefined);

  // From outside (a new tab): the wall alone; closing it goes Home.
  const tab = await ctx.newPage();
  await tab.clock.install({ time: NOW });
  await tab.goto(served.base + "#blitz-lakes");
  await walled(tab);
  await tab.getByTestId("free-wall-close").click();
  await gone(tab);
  await tab.getByTestId("today-list").waitFor();
  assert.equal(await hashOf(tab), "");
  await tab.close();

  // Roll new list on the results asks over the results, and they stay as they were.
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();
  await page.getByTestId("results").waitFor();
  await page.getByTestId("play-again").click();
  await walled(page);
  // Today's list waits: the quiet key says so even here.
  assert.equal(await page.getByTestId("free-wall-alt").getAttribute("data-go"), "today");
  await page.getByTestId("free-wall-close").click();
  await gone(page);
  assert.equal(await hashOf(page), "#p-mountains");
  await page.getByTestId("results").waitFor();

  // So does the menu's Random list.
  await openMenu(page);
  await page.getByTestId("menu-random-list").click();
  await walled(page);
  await page.keyboard.press("Escape");
  await gone(page);
  assert.equal(await hashOf(page), "#p-mountains");

  // Past runs open, and so does a run; its Play again asks.
  await page.evaluate(() => (location.hash = "#history"));
  await page.locator('[data-testid="history-row"][data-kind="list"]').first().click();
  await page.getByTestId("run-view").waitFor();
  const run = await hashOf(page);
  await page.getByTestId("replay").click();
  await walled(page);
  await page.getByTestId("free-wall-close").click();
  await gone(page);
  assert.equal(await hashOf(page), run);
  await ctx.close();
});

test("Random list on today's finished list asks over its results, whose quiet key then goes Home (desktop)", async () => {
  const daily = require("../public/puzzles/daily.json").find((e) => e.date === TODAY);
  const done = { puzzleId: daily.id, found: [1, 2, 3], lives: 0, log: [], status: "lost", startedAt: T - 900_000, finishedAt: T - 600_000 };
  const seed = played(2, { games: { [daily.id]: done }, dailyGames: { [TODAY]: done }, daily: { [TODAY]: daily.id } });
  const { ctx, page } = await open(desktop, `#daily-${TODAY}`, seed, undefined, withGoogle({}));
  await page.getByTestId("results").waitFor();
  // No Play Blitz on a list's results (owner, Nov 14: the modes stay separate).
  assert.equal(await page.getByTestId("blitz-key").count(), 0);
  await page.getByTestId("results-roll").click();
  await walled(page);
  assert.equal(await hashOf(page), `#daily-${TODAY}`);
  // Today's list is played: Home instead.
  assert.equal(await page.getByTestId("free-wall-alt").getAttribute("data-go"), "home");
  await page.getByTestId("free-wall-close").click();
  await gone(page);
  await page.getByTestId("results").waitFor();
  await page.getByTestId("results-roll").click();
  await walled(page);
  await page.getByTestId("free-wall-alt").click();
  await gone(page);
  await page.getByTestId("today-list").waitFor();
  assert.equal(await hashOf(page), "");
  // On Home with today's list played, the wall has only Close and Google: nowhere else to go.
  await page.getByTestId("random-blitz").click();
  await walled(page);
  assert.equal(await page.getByTestId("free-wall-alt").count(), 0);
  await ctx.close();
});

test("signing in at the wall starts the game asked for, the save goes along, and a signed-in player is never asked (desktop)", async () => {
  const fake = {};
  const { ctx, page, calls } = await open(desktop, "", played(2), undefined, withGoogle(fake));
  await page.getByTestId("today-list").waitFor();
  await page.getByTestId("random-blitz").click();
  await walled(page);
  const popup = await pressForPopup(page);
  await popup.waitForEvent("close");
  await gone(page);
  // The Blitz asked for, a fresh round.
  await page.waitForFunction(() => /^#blitz-[\w-]+$/.test(location.hash));
  await page.locator('[data-testid="blitz-clock"][data-started="false"]').waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem("top-tens:free-ask")), null, "nothing left to start later");
  // The device's games went to the account.
  await until(() => calls.saves.some((c) => c.method === "POST"));
  assert.deepEqual(calls.saves.find((c) => c.method === "POST").body.data.listRuns.map((r) => r.id), FREE_LISTS.slice(0, 2));
  // Signed in, free play never runs out.
  await homeSignedIn(page, "Dana Scully");
  for (let i = 0; i < 3; i++) {
    await rollList(page);
    await home(page);
  }
  await page.getByTestId("random-blitz").click();
  await page.getByTestId("blitz-clock").waitFor();
  assert.equal(await sheet(page).count(), 0);
  await ctx.close();
});

test("signing in at a link's wall opens that link's game (phone)", async () => {
  const { ctx, page } = await open(phone, "#p-rivers", played(2), undefined, withGoogle({}));
  await walled(page);
  const popup = await pressForPopup(page);
  await popup.waitForEvent("close");
  await gone(page);
  assert.equal(await hashOf(page), "#p-rivers");
  await page.getByTestId("title-card").waitFor();
  await page.getByLabel("Your guess").waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem("top-tens:free-ask")), null);
  await ctx.close();
});

test("a signed-in player is never asked, from a key or a link (phone)", async () => {
  const seed = { ...played(6), "top-tens:auth": SESSION };
  const { ctx, page } = await open(phone, "#blitz-lakes", seed, { save: { data: seed["top-tens:v1"], version: 1 } }, withGoogle({}));
  await page.getByTestId("blitz-clock").waitFor();
  await home(page);
  await rollList(page);
  await settle();
  assert.equal(await sheet(page).count(), 0);
  await ctx.close();
});

test("with the popup blocked, the tab goes to Google and back, and the game asked for starts (desktop)", async () => {
  const blockPopups = (ctx) => ctx.addInitScript(() => (window.open = () => null));
  const finished = { puzzleId: "tourism", found: [1], lives: 0, log: [], status: "lost", startedAt: T - 900_000, finishedAt: T - 600_000 };
  const seed = played(1, { games: { tourism: finished } });
  seed["top-tens:v1"].listRuns.unshift(freeRun("tourism", 900_000));
  const { ctx, page, calls } = await open(desktop, "#p-tourism", seed, undefined, withGoogle({}, blockPopups));
  await page.getByTestId("results").waitFor();
  await page.getByTestId("play-again").click();
  await walled(page);
  await page.getByTestId("sign-in-google").click();
  // To Google and back to the results it left, signed in; then the roll asked for (never this list).
  await until(() => calls.idToken.length === 1, 10_000);
  await page.waitForFunction(() => /^#p-[\w-]+$/.test(location.hash) && location.hash !== "#p-tourism", null, { timeout: 10_000 });
  await page.getByLabel("Your guess").waitFor();
  assert.equal(await sheet(page).count(), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("top-tens:free-ask")), null);
  await homeSignedIn(page, "Dana Scully");
  await ctx.close();
});

test("the build without a backend has no wall: free play runs on (desktop)", async () => {
  const { ctx, page } = await openPlain(plainBrowser, desktop, "", played(6)["top-tens:v1"]);
  await page.getByTestId("today-list").waitFor();
  for (let i = 0; i < 2; i++) {
    await rollList(page);
    await home(page);
  }
  await page.getByTestId("random-blitz").click();
  await page.getByTestId("blitz-clock").waitFor();
  await page.evaluate(() => (location.hash = "#p-rivers"));
  await page.getByTestId("title-card").waitFor();
  assert.equal(await sheet(page).count(), 0);
  assert.equal(await page.getByTestId("account-key").count(), 0);
  await ctx.close();
});

test("the wall's keys never move anything on hover, press or focus (390 and 1440)", async () => {
  for (const vp of [phone, desktop]) {
    const { ctx, page } = await open(vp, "", played(2), undefined, withGoogle({}));
    await page.getByTestId("random-list").click();
    await walled(page);
    await settle();
    const r = await checkScreen(page, { name: "free-play wall", scope: '[data-testid="free-wall-sheet"]' }, { hover: vp === desktop });
    assert.equal(r.failures.length, 0, formatFailures(vp.viewport.width, r.failures));
    assert.ok(r.counts.press >= 3, "its keys were pressed");
    assert.ok(r.counts.focus >= 3, "its keys took focus");
    await ctx.close();
  }
});
