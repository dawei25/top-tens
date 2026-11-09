// Today's daily: exact guess, typo fixed in the box, a real wrong answer costs a life, junk is free, a clue,
// give up -> results (days in a row explained), Back -> home.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, hash, puzzle, todaysDaily, noHScroll, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

for (const vp of VIEWPORTS) {
  test(`today's daily (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const lives = () => page.getByTestId("lives").getAttribute("data-lives");
    const slot = (rank) => page.locator(`[data-testid="slot"][data-rank="${rank}"]`);

    await page.getByTestId("today-list").click();
    const entry = await todaysDaily(page);
    assert.equal(await hash(page), `#daily-${entry.date}`);
    const p = await puzzle(page, entry.id);

    // Exact name: found at once.
    await guess(page, p.answers[0].name);
    assert.equal(await slot(1).getAttribute("data-state"), "found");

    // A typo is corrected in the box, not submitted; Enter then guesses it.
    const target = [...p.answers.slice(1)].sort((a, b) => b.name.length - a.name.length)[0];
    const typo = target.name.slice(0, 3) + target.name.slice(4);
    await guess(page, typo);
    assert.equal(await page.getByLabel("Your guess").inputValue(), target.name);
    assert.equal(await slot(target.rank).getAttribute("data-state"), "hidden");
    await page.getByLabel("Your guess").press("Enter");
    assert.equal(await slot(target.rank).getAttribute("data-state"), "found");

    // A real answer outside the top 10 costs a life; junk costs nothing.
    assert.equal(await lives(), "5");
    await guess(page, p.extras.find((e) => e.rank > 10).name);
    assert.equal(await lives(), "4");
    await guess(page, "qzxv kwpj");
    assert.equal(await page.getByTestId("feedback").getAttribute("data-tone"), "warn");
    assert.equal(await lives(), "4");

    // Hint: first letter of a hidden row for a life.
    const hidden = page.locator('[data-testid="slot"][data-state="hidden"]').first();
    const rank = await hidden.getAttribute("data-rank");
    await hidden.getByTestId("hint-open").click();
    await page.getByTestId("hint-yes").click();
    assert.equal(await lives(), "3");
    assert.equal(await slot(rank).getByTestId("hint-letter").count(), 1);

    // Give up (with its confirm): results.
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();
    await page.getByTestId("results").waitFor();
    assert.equal(await page.getByTestId("score").getAttribute("data-found"), "2");
    assert.ok(await noHScroll(page));

    // One try: no Roll new list; this list as a free Blitz, and a random list, instead (no Today's Blitz since Nov 10).
    assert.equal(await page.getByTestId("play-again").count(), 0);
    assert.equal(await page.getByTestId("results-daily-blitz").count(), 0);
    assert.equal(await page.getByTestId("blitz-key").getAttribute("href"), `#blitz-${entry.id}`);
    assert.equal(await page.getByTestId("results-roll").count(), 1);

    // The days-in-a-row count explains itself: a tap or click opens its note (Home's record has the same). The note
    // floats: the results panel doesn't grow. A second press closes it, and so does Escape (without leaving).
    const tip = page.getByTestId("results").getByTestId("streak-tip");
    // Measured once the panel has risen into place (its own entrance only; the squid in it animates forever).
    await page
      .getByTestId("results")
      .evaluate((el) => Promise.all(el.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)));
    const resultsBox = async () => {
      const { width, height } = await page.getByTestId("results").boundingBox();
      return { width, height };
    };
    const shut = await resultsBox();
    const note = page.locator(`#${await tip.getAttribute("aria-controls")}`);
    assert.equal(await tip.getAttribute("aria-describedby"), await tip.getAttribute("aria-controls"));
    await (vp.hasTouch ? tip.tap() : tip.click());
    assert.equal(await tip.getAttribute("aria-expanded"), "true");
    assert.ok(await note.isVisible());
    assert.deepEqual(await resultsBox(), shut, "the note doesn't grow the results");
    await (vp.hasTouch ? tip.tap() : tip.click());
    assert.equal(await tip.getAttribute("aria-expanded"), "false");
    await (vp.hasTouch ? tip.tap() : tip.click());
    await page.keyboard.press("Escape");
    assert.equal(await tip.getAttribute("aria-expanded"), "false");
    assert.equal(await note.isVisible(), false);
    await page.getByTestId("results").waitFor();

    // Reopening it (reload) shows the finished board and results, never a fresh game.
    await page.reload();
    await page.getByTestId("results").waitFor();
    assert.equal(await page.getByTestId("score").getAttribute("data-found"), "2");
    assert.equal(await page.getByLabel("Your guess").count(), 0);
    assert.equal(await page.locator('[data-testid="slot"][data-state="hidden"]').count(), 0);

    await page.getByTestId("nav-home").click();
    await page.getByTestId("today-list").waitFor();
    assert.equal(await page.getByTestId("today-list").getAttribute("data-done"), "true");
    assert.equal(await page.getByTestId("streak-tip").count(), 1);
    // Home's note floats too: the record panel keeps its height.
    const record = page.getByTestId("streak-tip").locator("xpath=ancestor::section[1]");
    const recordHeight = async () => (await record.boundingBox()).height;
    const recordShut = await recordHeight();
    await (vp.hasTouch ? page.getByTestId("streak-tip").tap() : page.getByTestId("streak-tip").click());
    assert.equal(await page.getByTestId("streak-tip").getAttribute("aria-expanded"), "true");
    assert.equal(await recordHeight(), recordShut, "the note doesn't grow Your record");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByTestId("streak-tip").getAttribute("aria-expanded"), "false");
    // From Home too.
    await page.getByTestId("today-list").click();
    await page.getByTestId("results").waitFor();
    assert.equal(await page.getByTestId("give-up").count(), 0);

    // Random list rolls a different list, a fresh game.
    await page.getByTestId("results-roll").click();
    await page.getByTestId("give-up").waitFor();
    const rolled = await hash(page);
    assert.match(rolled, /^#p-/);
    assert.notEqual(rolled, `#p-${entry.id}`);
    assert.equal(await lives(), "5");
    await ctx.close();
  });
}
