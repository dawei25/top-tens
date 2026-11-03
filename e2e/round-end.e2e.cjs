// The end of a round never acts on the key the player was pressing: no result key is autofocused, so Enter pressed
// at the buzzer (or right after the last guess) lands on nothing and the results stay on screen; SHARE takes focus a
// beat later. Confirm keys keep their width while they ask (GIVE UP -> SURE?), so a second press lands on them.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, hash, puzzle, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "mountains"; // a past daily: open as a free list and for Blitz
const focused = (page) => page.evaluate(() => document.activeElement?.dataset.testid ?? document.activeElement?.tagName);

/** Enter, again and again, through the moments after the end (the fake clock moves 100 ms between presses). */
async function hammerEnter(page, times = 5) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press("Enter");
    await page.clock.runFor(100);
  }
}

for (const vp of VIEWPORTS) {
  test(`Enter at the buzzer leaves the Blitz results on screen (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#blitz-${LIST}`);
    await page.getByTestId("blitz-clock").waitFor();
    const p = await puzzle(page, LIST);
    await guess(page, p.answers[0].name);

    // Typing the next guess as time runs out: the buzzer ends the round, and the Enter that was coming lands nowhere.
    await page.getByLabel("Your guess").pressSequentially(p.answers[1].name.slice(0, 3));
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();
    assert.equal(await focused(page), "BODY", "no result key takes focus at the buzzer");
    await hammerEnter(page);
    assert.ok(await page.getByTestId("blitz-results").isVisible());
    assert.equal(await hash(page), `#blitz-${LIST}`);
    assert.equal(await page.getByTestId("blitz-clock").count(), 0, "no new round started");
    // A beat later SHARE has focus (never Roll again).
    await page.clock.runFor(1000);
    assert.equal(await focused(page), "share");
    await ctx.close();
  });

  test(`Enter sent after the buzzer leaves the Blitz results on screen (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#blitz-${LIST}`);
    await page.getByTestId("blitz-clock").waitFor();
    const p = await puzzle(page, LIST);
    await guess(page, p.answers[0].name);
    // The guess goes in after 0 (timers paused, so only the guess can end the round), then Enter keeps coming.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 100);
    await page.getByLabel("Your guess").fill(p.answers[1].name);
    await page.clock.setSystemTime(now + 100 + 90_000);
    await page.getByLabel("Your guess").press("Enter");
    await page.getByTestId("blitz-results").waitFor();
    await hammerEnter(page);
    assert.ok(await page.getByTestId("blitz-results").isVisible());
    assert.equal(await hash(page), `#blitz-${LIST}`);
    assert.equal(await page.getByTestId("blitz-clock").count(), 0);
    await page.clock.runFor(1000);
    assert.equal(await focused(page), "share");
    await ctx.close();
  });

  test(`Enter on the last guess leaves the list's results on screen; GIVE UP keeps its width (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    const giveUp = page.getByTestId("give-up");
    await giveUp.waitFor();
    const p = await puzzle(page, LIST);

    // GIVE UP -> SURE? in the same key, the same size: a second press in the same spot still lands on it.
    const shut = await giveUp.boundingBox();
    await giveUp.click();
    assert.equal(await giveUp.getAttribute("data-confirm"), "true");
    assert.deepEqual(await giveUp.boundingBox(), shut, "the asking key keeps its size and place");
    await page.getByLabel("Your guess").focus();
    assert.equal(await giveUp.getAttribute("data-confirm"), null, "leaving the key backs out");

    // Five misses that cost a life each, the last one sent with Enter, then Enter again and again.
    const misses = p.extras.slice(0, 5);
    assert.equal(misses.length, 5);
    for (const m of misses) await guess(page, m.name);
    await page.getByTestId("results").waitFor();
    assert.equal(await focused(page), "BODY", "no result key takes focus at the end");
    await hammerEnter(page);
    assert.ok(await page.getByTestId("results").isVisible());
    assert.equal(await hash(page), `#p-${LIST}`, "Enter didn't roll another list");
    // Once the board has revealed, SHARE has focus (never Roll again).
    await page.clock.runFor(1500);
    assert.equal(await focused(page), "share");
    await ctx.close();
  });
}
