// Blitz: the clock waits for the first keystroke, a hit scores, a guess after 0 doesn't count, the round is
// recorded, and its past run opens and closes with Back.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, hash, puzzle, noHScroll, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "mountains"; // a past daily, so open for Blitz

for (const vp of VIEWPORTS) {
  test(`Blitz round and past run (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#blitz-${LIST}`);
    const clock = page.getByTestId("blitz-clock");
    await clock.waitFor();
    const p = await puzzle(page, LIST);

    // The clock doesn't run before the first keystroke.
    await page.clock.runFor(3000);
    assert.equal(await clock.getAttribute("data-started"), "false");
    assert.equal(await clock.getAttribute("aria-label"), "90 seconds left");
    await page.getByLabel("Your guess").pressSequentially("x");
    assert.equal(await clock.getAttribute("data-started"), "true");
    await page.clock.runFor(2000);
    assert.equal(await clock.getAttribute("aria-label"), "88 seconds left");

    // A hit scores.
    await guess(page, p.answers[0].name);
    assert.equal(await page.getByTestId("blitz-hit").count(), 1);
    const score = await page.getByTestId("blitz-score").textContent();
    assert.ok(Number(score) > 0);

    // A guess sent after time is up doesn't count, even before the screen ticks; the input locks.
    await page.getByLabel("Your guess").fill(p.answers[1].name);
    await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 90_000);
    await page.getByLabel("Your guess").press("Enter");
    await page.getByTestId("blitz-results").waitFor();
    assert.equal(await page.getByTestId("blitz-final").textContent(), score);
    assert.equal(await page.getByLabel("Your guess").count(), 0);
    assert.ok(await noHScroll(page));

    // Its past run: opens at its own address; Back returns to the list's Blitz screen with past runs open.
    await page.getByTestId("past-runs-toggle").click();
    await page.getByTestId("past-run").first().click();
    await page.getByTestId("run-view").waitFor();
    assert.match(await hash(page), new RegExp(`^#blitz-${LIST}/run-\\d+$`));
    await page.getByTestId("nav-back").click();
    await page.getByTestId("past-runs").waitFor();
    assert.equal(await hash(page), `#blitz-${LIST}`);
    assert.equal(await page.getByTestId("run-view").count(), 0);
    assert.equal(await page.getByTestId("past-runs").getAttribute("open"), "");
    await ctx.close();
  });
}
