// Today's Blitz: one round. It counts, there is no Roll again, reopening shows that round (locked), home shows it
// as done, and Random Blitz rolls a fresh round on another list.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, TODAY, open, hash, puzzle, todaysDaily, store, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

for (const vp of VIEWPORTS) {
  test(`Today's Blitz (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    assert.equal(await page.getByTestId("today-blitz").getAttribute("data-done"), null);
    await page.getByTestId("today-blitz").click();
    const screen = page.getByTestId("blitz-screen");
    await screen.waitFor();
    assert.equal(await hash(page), `#dailyblitz-${TODAY}`);
    const id = await screen.getAttribute("data-list");
    assert.notEqual(id, (await todaysDaily(page)).id, "never today's daily list");
    const p = await puzzle(page, id);

    // The round counts; no Roll again after it.
    await guess(page, p.answers[0].name);
    await page.clock.fastForward(91_000);
    await page.getByTestId("daily-blitz-line").waitFor();
    const first = (await store(page)).blitzDaily[TODAY].score;
    assert.ok(first > 0);
    assert.equal(await page.getByTestId("blitz-again").count(), 0);
    assert.equal(await page.getByTestId("blitz-roll").count(), 1);

    // Reopening it (reload) shows that round, locked: no guess box, no second round.
    await page.reload();
    const results = page.getByTestId("blitz-results");
    await results.waitFor();
    assert.equal(await results.getAttribute("data-locked"), "true");
    assert.equal(await page.getByTestId("blitz-final").textContent(), String(first));
    assert.equal(await page.getByTestId("blitz-hit").first().isVisible(), true);
    assert.equal(await page.getByLabel("Your guess").count(), 0);
    assert.equal(await page.getByTestId("blitz-again").count(), 0);
    assert.equal((await store(page)).blitzRuns[id].length, 1, "no extra round recorded");

    await page.getByTestId("nav-home").click();
    await page.getByTestId("today-blitz").waitFor();
    assert.equal(await page.getByTestId("today-blitz").getAttribute("data-done"), "true");
    assert.match(await page.getByTestId("today-blitz-status").textContent(), new RegExp(`^${first} `));

    // From Home it's still the locked round; Random Blitz goes to another list, a fresh round.
    await page.getByTestId("today-blitz").click();
    await results.waitFor();
    assert.equal(await results.getAttribute("data-locked"), "true");
    await page.getByTestId("blitz-roll").click();
    await page.getByTestId("blitz-clock").waitFor();
    assert.match(await hash(page), /^#blitz-/);
    assert.notEqual(await screen.getAttribute("data-list"), id);
    assert.equal(await page.getByTestId("blitz-clock").getAttribute("data-started"), "false");
    assert.equal((await store(page)).blitzDaily[TODAY].score, first);
    await ctx.close();
  });
}
