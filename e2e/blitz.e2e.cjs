// Blitz: the clock waits for the first keystroke, a hit scores, a guess after 0 doesn't count, the round is
// recorded, and its past run opens and closes with Back; neither offers its own list. A list game offers no Blitz at
// all: not on its title card, its results or its past run (the modes stay separate, owner Nov 14).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, TODAY, open, go, hash, puzzle, noHScroll, guess, giveUp } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "mountains"; // a past daily, so open for Blitz

/** Keys in a panel that open `list` as a list game: its free game, or the daily that ran it (by date). */
const ownListKeys = (page, panel, list) =>
  page.getByTestId(panel).evaluate(async (el, list) => {
    const days = await (await fetch("puzzles/daily.json")).json();
    const dates = new Set(days.filter((d) => d.id === list).map((d) => `#daily-${d.date}`));
    return [...el.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => h === `#p-${list}` || dates.has(h));
  }, list);

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
    // The installed clock runs in real time, so the screen's 100 ms tick would end the round (and remove the input)
    // between the jump and Enter. Pause the timers first: then only the submitted guess can see that time is up.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 100);
    await page.getByLabel("Your guess").fill(p.answers[1].name);
    await page.clock.setSystemTime(now + 100 + 90_000);
    await page.getByLabel("Your guess").press("Enter");
    await page.getByTestId("blitz-results").waitFor();
    assert.equal(await page.getByTestId("blitz-final").textContent(), score);
    assert.equal(await page.getByLabel("Your guess").count(), 0);
    assert.ok(await noHScroll(page));
    await page.clock.resume();
    // The results never offer this round's own list as a list game (the owner, Nov 8: "its alr spoiled").
    assert.deepEqual(await ownListKeys(page, "blitz-results", LIST), []);

    // Its past run: opens at its own address; Back returns to the list's Blitz screen with past runs open. No key
    // there to its own list either.
    await page.getByTestId("past-runs-toggle").click();
    await page.getByTestId("past-run").first().click();
    await page.getByTestId("run-view").waitFor();
    assert.match(await hash(page), new RegExp(`^#blitz-${LIST}/run-\\d+$`));
    assert.deepEqual(await ownListKeys(page, "run-view", LIST), []);
    await page.getByTestId("nav-back").click();
    await page.getByTestId("past-runs").waitFor();
    assert.equal(await hash(page), `#blitz-${LIST}`);
    assert.equal(await page.getByTestId("run-view").count(), 0);
    assert.equal(await page.getByTestId("past-runs").getAttribute("open"), "");
    await ctx.close();
  });

  // The owner (Nov 8): "for simplicity remove the play blitz button for lists" (the title card's, beside the score);
  // and (Nov 14) "remove the play blitz option for the post list play screen- moving in a direction to keep the game
  // modes separate". So a list game offers no Blitz anywhere: in play its title card keeps only the score, and every
  // list results screen (free play, Today's list, an archive daily, a past run) offers Share and the next game only.
  test(`a list game offers no Blitz, in play or on any of its results (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    await page.getByLabel("Your guess").waitFor();
    const card = page.getByTestId("title-card");
    // A link or key to a Blitz anywhere on the screen's two columns, and the results' keys, in order.
    const blitzKeys = () => page.locator('.board-col [href^="#blitz-"], .control-col [href^="#blitz-"], [data-testid="blitz-key"]').count();
    const actions = () => page.locator(".results-actions").evaluate((el) => [...el.querySelectorAll("a, button")].map((k) => k.dataset.testid));
    // Nothing to press on the card but its source link.
    const keys = await card.evaluate((el) => [...el.querySelectorAll("a, button")].filter((k) => !k.closest(".asof")).length);
    assert.equal(keys, 0, "a key on the title card");
    assert.equal(await page.locator('[href^="#blitz-"]').count(), 0, "a Blitz key during play");
    // The score keeps its place at the card's top right.
    const [c, score] = await Promise.all([card.boundingBox(), card.locator(".count").boundingBox()]);
    assert.ok(c.x + c.width - (score.x + score.width) < 30, "the score sits at the card's right end");
    assert.ok(await noHScroll(page));

    // A free list's results: Roll new list and Share.
    await giveUp(page);
    assert.equal(await blitzKeys(), 0, "a Blitz key on a free list's results");
    assert.deepEqual(await actions(), ["play-again", "share"]);
    // Its past run: Play again and Back.
    await go(page, "#history");
    await page.locator('[data-testid="history-row"][data-kind="list"]').first().click();
    await page.getByTestId("run-view").waitFor();
    assert.equal(await blitzKeys(), 0, "a Blitz key on a past run");
    assert.deepEqual(await actions(), ["replay", "run-back"]);
    // Today's list and an archive daily: Share and Random list.
    const days = await page.evaluate(async () => (await fetch("puzzles/daily.json")).json());
    for (const date of [TODAY, days.find((d) => d.date < TODAY && d.id !== LIST).date]) {
      await go(page, `#daily-${date}`);
      await page.getByLabel("Your guess").waitFor();
      await giveUp(page);
      assert.equal(await blitzKeys(), 0, `a Blitz key on the daily's results (${date})`);
      assert.deepEqual(await actions(), ["share", "results-roll"], date);
    }
    await ctx.close();
  });
}
