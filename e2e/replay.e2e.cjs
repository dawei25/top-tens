// Play again on a past run: a run opened from Past runs (a list run's view, a Blitz run's view) leads with Play again,
// a fresh free game on that same list, except for a list held right now (today's list or a future day's): a
// quiet line instead. A list's results never offer Play again, just ended or opened again (Roll new list is the way on).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, TODAY, open, go, hash, store, guess, puzzle, noHScroll } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

/** Old dailies (Oct 22 and 27), open to free play on TODAY. */
const LIST = "mountains";
const BLITZ = "airports";

async function giveUp(page) {
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();
  await page.getByTestId("results").waitFor();
}

/** Past runs, then the row that opens `href` (or, for a list, the newest row whose href starts with `#p-<id>/run-`). */
async function openRun(page, href) {
  await go(page, "#history");
  const sel = href.startsWith("#p-") ? `[href^="${href}/run-"]` : `[href="${href}"]`;
  await page.locator(`[data-testid="history-row"]${sel}`).first().click();
}

for (const vp of VIEWPORTS) {
  test(`Play again on a past run (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    const p = await puzzle(page, LIST);

    // A free list, one found, given up: results that just ended roll on, no Play again.
    await guess(page, p.answers[0].name);
    await giveUp(page);
    assert.equal(await page.getByTestId("replay").count(), 0);
    assert.equal(await page.getByTestId("play-again").count(), 1);

    // Its run view from Past runs: Play again starts a fresh game on the same list; the old run stays in the history.
    await openRun(page, `#p-${LIST}`);
    await page.getByTestId("run-view").waitFor();
    await page.getByTestId("replay").waitFor();
    assert.equal(await page.getByTestId("replay-held").count(), 0);
    assert.equal((await store(page)).listRuns.filter((r) => r.id === LIST).length, 1);

    // A free Blitz round, then its run from the screen's own past runs (the screen stays mounted): Play again is a
    // fresh round on the same list, not the finished one still in memory.
    await go(page, `#blitz-${BLITZ}`);
    await page.getByTestId("blitz-clock").waitFor();
    await guess(page, (await puzzle(page, BLITZ)).answers[0].name);
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();
    await page.getByTestId("past-runs-toggle").click();
    await page.getByTestId("past-run").first().click();
    await page.getByTestId("run-view").waitFor();
    assert.ok(await noHScroll(page));
    await page.getByTestId("replay").click();
    await page.getByTestId("blitz-clock").waitFor();
    assert.equal(await hash(page), `#blitz-${BLITZ}`);
    assert.equal(await page.getByTestId("run-view").count(), 0);
    assert.equal(await page.getByTestId("blitz-results").count(), 0);
    assert.equal(await page.getByTestId("blitz-clock").getAttribute("data-started"), "false", "a fresh round");
    assert.equal(await page.getByTestId("blitz-hit").count(), 0);

    // Today's list finished, and a Blitz on it from its results: held today, so their past runs have no Play again,
    // just the quiet line.
    await go(page, "");
    await page.getByTestId("today-list").click();
    await page.getByTestId("give-up").waitFor();
    await giveUp(page);
    const todays = (await store(page)).dailyGames[TODAY].puzzleId;
    await page.getByTestId("blitz-key").click();
    const screen = page.getByTestId("blitz-screen");
    await page.getByTestId("blitz-clock").waitFor();
    assert.equal(await screen.getAttribute("data-list"), todays);
    await guess(page, (await puzzle(page, todays)).answers[0].name);
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();

    await openRun(page, `#p-${todays}`);
    await page.getByTestId("run-view").waitFor();
    await page.getByTestId("replay-held").waitFor();
    assert.equal(await page.getByTestId("replay").count(), 0);

    const round = (await store(page)).blitzRuns[todays][0];
    await openRun(page, `#blitz-${todays}/run-${round.startedAt}`);
    await page.getByTestId("run-view").waitFor();
    assert.equal(await page.getByTestId("replay").count(), 0);
    assert.ok(await page.getByTestId("replay-held").isVisible());
    await ctx.close();
  });
}
