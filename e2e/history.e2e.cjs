// Past runs: a list game and a Blitz round, newest first; a run opens and Back returns to the list; a deep link
// to a run goes Back to that list's Blitz screen with past runs open.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, openTab, hash, store, noHScroll, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "airports";

for (const vp of VIEWPORTS) {
  test(`past runs (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    // A list game, given up.
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();
    await page.getByTestId("results").waitFor();
    await page.clock.runFor(60_000);
    // Then a Blitz round on the same list, from the results' BLITZ key.
    await page.getByTestId("blitz-key").click();
    await page.getByTestId("blitz-clock").waitFor();
    await guess(page, "Dubai");
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();

    await page.getByTestId("nav-home").click();
    await page.getByTestId("history-key").click();
    const rows = page.getByTestId("history-row");
    await rows.first().waitFor();
    assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-kind"))), ["blitz", "list"]);
    assert.ok(await noHScroll(page));

    await rows.first().click();
    await page.getByTestId("run-view").waitFor();
    await page.getByTestId("nav-back").click();
    await rows.first().waitFor();
    assert.equal(await hash(page), "#history");

    // Deep link to the run, no in-app history.
    const run = (await store(page)).blitzRuns[LIST][0];
    const deep = await openTab(ctx, `#blitz-${LIST}/run-${run.startedAt}`);
    await deep.getByTestId("run-view").waitFor();
    await deep.getByTestId("nav-back").click();
    await deep.getByTestId("past-runs").waitFor();
    assert.equal(await hash(deep), `#blitz-${LIST}/runs`);
    assert.equal(await deep.getByTestId("past-runs").getAttribute("open"), "");
    await deep.getByTestId("nav-home").click();
    await deep.getByTestId("today-list").waitFor();
    await ctx.close();
  });
}
