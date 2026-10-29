// Today's Blitz: the first round finished today counts, a replay doesn't change it, home shows it as done.
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

    // First round counts.
    await guess(page, p.answers[0].name);
    await page.clock.fastForward(91_000);
    const line = page.getByTestId("daily-blitz-line");
    await line.waitFor();
    assert.equal(await line.getAttribute("data-counted"), "true");
    const first = (await store(page)).blitzDaily[TODAY].score;

    // A replay with more points doesn't change it.
    await page.getByTestId("blitz-again").click();
    await guess(page, p.answers[0].name);
    await guess(page, p.answers[1].name);
    await page.clock.fastForward(91_000);
    await line.waitFor();
    assert.equal(await line.getAttribute("data-counted"), "false");
    assert.equal((await store(page)).blitzDaily[TODAY].score, first);

    await page.getByTestId("nav-home").click();
    await page.getByTestId("today-blitz").waitFor();
    assert.equal(await page.getByTestId("today-blitz").getAttribute("data-done"), "true");
    assert.match(await page.getByTestId("today-blitz-status").textContent(), new RegExp(`^${first} `));
    await ctx.close();
  });
}
