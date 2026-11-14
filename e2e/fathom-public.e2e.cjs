// Fathom as a full game mode (owner, Nov 9: "ship it now"; Today's Fathom since Nov 14), on phone and desktop:
// - Home's key and the menu's tile (Today's Fathom, in the Today panel and the Play group): fathom-daily.e2e.cjs.
// - How to play: a Today's Fathom rule, with the game's own scoring line.
// - Stats: a Fathom block before the first game (0 games, placeholders) and after one (games, average, best of 1000).
// - Past runs: a finished game under today's header, with its total; the row opens that game's results (the same
//   total and rows, the date it was played); Back returns to Past runs, and a deep link's Back goes up to it.
// - The share text: "Fathom #2 <total>/1000", ten squares and the link to #fathom, every line but the last ending in
//   two spaces so the lines keep in a Reddit comment.
// - A past game's key opens Today's Fathom where it was.
// - Nothing says beta: Home, the menu, How to play, Fathom's question, reveal and results, the share text, Stats,
//   Past runs.
// The sync of Fathom's games with an account: backend.e2e.cjs. The name-it round's lines at 320px: fathom-name.e2e.cjs.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, VIEWPORTS, TODAY, open, openTab, go, hash, store, noHScroll } = require("./helpers.cjs");

const FIXTURE = path.join(__dirname, "fixtures", "fathom", "questions.json");
const BANK = new Map(JSON.parse(fs.readFileSync(FIXTURE, "utf8")).questions.map((q) => [q.id, q]));
const SCHEDULE = path.join(__dirname, "fixtures", "fathom", "daily.json");
const DAY = JSON.parse(fs.readFileSync(SCHEDULE, "utf8")).find((e) => e.date === TODAY);
/** The fixture bank, and the fixture schedule (Fathom #2 today). */
const serveBank = async (ctx) => {
  await ctx.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill({ path: FIXTURE, contentType: "application/json" }));
  await ctx.route(/\/fathom\/daily\.json(\?.*)?$/, (route) => route.fulfill({ path: SCHEDULE, contentType: "application/json" }));
};

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const noBeta = async (page, where) => assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /\bbeta\b/i, `${where} says beta`);

/** Plays the ten questions on screen (each answer a little high), and returns the results' total. */
async function playGame(page) {
  for (let i = 0; i < 10; i++) {
    const field = page.getByTestId("fathom-input");
    await field.waitFor();
    const q = BANK.get(await page.getByTestId("fathom-question").getAttribute("data-question"));
    await field.fill(String(q.answer * 1.2));
    await page.getByTestId("fathom-lock").click();
    await page.getByTestId("fathom-reveal").waitFor();
    if (i === 0) await noBeta(page, "the reveal");
    await page.getByTestId("fathom-next").click();
  }
  await page.getByTestId("fathom-results").waitFor();
  return Number(await page.getByTestId("fathom-total").getAttribute("data-total"));
}

// The game itself says no scoring line since Nov 14 (the owner): How to play is where it is explained.
test("How to play has a Fathom rule that says how it scores", async () => {
  const vp = VIEWPORTS.find((v) => v.name === "phone");
  const { ctx, page } = await open(browser, vp, "", undefined, { setup: serveBank, reducedMotion: "reduce" });
  await page.getByTestId("howto-key").click();
  const section = page.getByTestId("howto-fathom");
  await section.waitFor();
  assert.match(await section.textContent(), /the closer your guess, the more points/i);
  await noBeta(page, "How to play");
  // Whole on a phone: no sideways scroll in the rules.
  assert.ok(await page.getByTestId("howto").evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await ctx.close();
});

for (const vp of VIEWPORTS) {
  test(`Stats and Past runs: Fathom before and after a game, a row that opens its results, the share text (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "#stats", undefined, { setup: serveBank, reducedMotion: "reduce" });
    if (vp.name === "desktop") await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    // Before the first game: the block, with placeholders (UX 10).
    const block = page.getByTestId("know-fathom");
    await block.waitFor();
    assert.equal(await block.getAttribute("data-empty"), "");
    assert.equal(await page.getByTestId("know-fathom-games").textContent(), "0");
    for (const id of ["know-fathom-avg", "know-fathom-best"]) assert.match(await page.getByTestId(id).textContent(), /^--/);
    const before = await store(page);

    // A game.
    await page.getByTestId("know-fathom-play").click();
    const total = await playGame(page);
    await noBeta(page, "the results");
    if (vp.name === "desktop") {
      await page.getByTestId("fathom-share").click();
      const shared = await page.evaluate(() => navigator.clipboard.readText());
      const lines = shared.split("\n");
      assert.equal(lines.length, 3);
      assert.equal(lines[0], `Fathom #${DAY.n} ${total}/1000  `);
      assert.match(lines[1], /^(\p{Extended_Pictographic} ){9}\p{Extended_Pictographic} {2}$/u);
      assert.match(lines[2], /^https?:\/\/[^ ]+\/#fathom$/);
      assert.doesNotMatch(shared, /beta/i);
    }
    // Kept in the player's save: the finished game with its day, its total; the list games as they were.
    const saved = await store(page);
    assert.equal(saved.fathom.runs.length, 1);
    const run = saved.fathom.runs[0];
    assert.equal(run.points.reduce((a, b) => a + b, 0), total);
    assert.deepEqual(run.daily, { date: TODAY, n: DAY.n });
    assert.deepEqual(saved.fathom.totals10, { [run.startedAt]: total });
    assert.deepEqual({ ...saved, fathom: undefined }, { ...before, fathom: undefined });

    // Stats after it.
    await go(page, "#stats");
    await page.getByTestId("know-fathom-games").filter({ hasText: "1" }).waitFor();
    assert.equal(await block.getAttribute("data-empty"), null);
    assert.equal(await page.getByTestId("know-fathom-avg").textContent(), String(total));
    assert.equal(await page.getByTestId("know-fathom-best").textContent(), String(total));
    await noBeta(page, "Stats");

    // Past runs: the game, today, with its total and its five squares; the row opens its results.
    await go(page, "#history");
    const row = page.locator('[data-testid="history-row"][data-kind="fathom"]');
    await row.waitFor();
    assert.equal(await page.getByTestId("history-day").getAttribute("data-date"), TODAY);
    assert.match(await row.textContent(), new RegExp(`${total}/1000`));
    assert.equal(await row.locator('[data-testid="history-bands"] [data-band]').count(), 10);
    assert.equal(await row.getByTestId("history-tag").evaluate((el) => el.getClientRects().length), 1, "the tag on one line");
    assert.ok(await noHScroll(page));
    await noBeta(page, "Past runs");
    await row.click();
    await page.getByTestId("fathom-results").waitFor();
    assert.equal(await hash(page), `#fathom/run-${run.startedAt}`);
    assert.equal(await page.getByTestId("fathom").getAttribute("data-phase"), "past");
    assert.equal(Number(await page.getByTestId("fathom-total").getAttribute("data-total")), total);
    assert.equal(await page.getByTestId("fathom-row").count(), 10);
    await page.getByTestId("fathom-when").waitFor();
    assert.ok(await noHScroll(page));
    await page.getByTestId("nav-back").click();
    await row.waitFor();
    assert.equal(await hash(page), "#history");

    // A deep link to it: Back goes up to Past runs. Its key opens Today's Fathom: played, so its results.
    const deep = await openTab(ctx, `#fathom/run-${run.startedAt}`);
    await deep.getByTestId("fathom-results").waitFor();
    await deep.getByTestId("nav-back").click();
    await deep.locator('[data-testid="history-row"][data-kind="fathom"]').waitFor();
    assert.equal(await hash(deep), "#history");
    await deep.locator('[data-testid="history-row"][data-kind="fathom"]').click();
    await deep.getByTestId("fathom-again").click();
    await deep.locator('[data-testid="fathom"][data-phase="results"]').waitFor();
    assert.equal(await hash(deep), "#fathom");
    await ctx.close();
  });
}

// Today's Fathom under way when a past game is opened: its key resumes the day's game, it doesn't start over.
test("a past game's key opens Today's Fathom where it was", async () => {
  const vp = VIEWPORTS.find((v) => v.name === "phone");
  // A past game: endless Fathom's (hidden), finished.
  const { ctx, page } = await open(browser, vp, "#fathom-endless", undefined, { setup: serveBank, reducedMotion: "reduce" });
  await playGame(page);
  const startedAt = (await store(page)).fathom.runs[0].startedAt;
  await go(page, "#fathom");
  await page.getByTestId("fathom-input").fill("42");
  await page.getByTestId("fathom-lock").click();
  await page.getByTestId("fathom-reveal").waitFor();
  const underWay = await page.evaluate(() => localStorage.getItem("tentacle:fathom-daily"));
  await go(page, `#fathom/run-${startedAt}`);
  await page.getByTestId("fathom-results").waitFor();
  await page.getByTestId("fathom-again").click();
  await page.getByTestId("fathom-reveal").waitFor();
  assert.equal(await hash(page), "#fathom");
  assert.equal(await page.evaluate(() => localStorage.getItem("tentacle:fathom-daily")), underWay, "the same game, where it was");
  // A game that isn't kept here says so.
  await go(page, "#fathom/run-123");
  await page.getByTestId("fathom-gone").waitFor();
  await ctx.close();
});
