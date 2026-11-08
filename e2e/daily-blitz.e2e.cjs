// Today's Blitz: one round. It counts, there is no Roll new list, reopening shows that round (locked), home shows
// it as done, and Random Blitz rolls a fresh round on another list. Its results offer Today's list while that is
// unplayed, the Blitz's own list once it's done.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, TODAY, open, go, hash, puzzle, todaysDaily, store, guess, giveUp } = require("./helpers.cjs");

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

    // The round counts; no Roll new list after it.
    await guess(page, p.answers[0].name);
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();
    const first = (await store(page)).blitzDaily[TODAY].score;
    assert.ok(first > 0);
    // The day's score is the big number; no second line repeats it, and a first round says nothing about a best.
    assert.equal(await page.getByTestId("blitz-final").textContent(), String(first));
    assert.equal(await page.getByTestId("daily-blitz-line").count(), 0);
    assert.equal(await page.getByTestId("blitz-best").count(), 0);
    assert.equal(await page.getByTestId("blitz-again").count(), 0);
    assert.equal(await page.getByTestId("blitz-roll").count(), 1);
    // Launch audit (Nov 6): with Today's list unplayed, the results offered "Play the list", the same list as a top 10
    // right after showing its whole top 10. They offer Today's list instead (as a daily's results offer Today's Blitz).
    assert.equal(await page.getByTestId("blitz-list").getAttribute("href"), `#daily-${TODAY}`);

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

    // Once Today's list is done, the locked round offers no list at all: never its own (the owner, Nov 8: "if someone
    // played blitz no point to give them option to play the same list since its alr spoiled").
    await go(page, `#daily-${TODAY}`);
    await giveUp(page);
    await go(page, `#dailyblitz-${TODAY}`);
    await results.waitFor();
    assert.equal(await page.getByTestId("blitz-list").count(), 0);
    assert.equal(await results.locator(`a[href="#p-${id}"]`).count(), 0, "the Blitz results offer their own list");
    await ctx.close();
  });
}
