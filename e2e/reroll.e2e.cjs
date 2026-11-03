// Roll again before play: a rolled list (Random list, a category, Roll again) offers it in the guess panel until the
// first guess, a rolled Blitz in its clock card until the clock starts. It lands on another list, keeps offering
// itself there, and goes once play starts (a losing game can't be dodged). Never on a daily, Today's Blitz or a list
// opened directly. It comes and goes without moving anything.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, hash, puzzle, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const top = async (loc) => Math.round((await loc.boundingBox()).y);

for (const vp of VIEWPORTS) {
  test(`Roll again before a rolled list's first guess (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const reroll = page.getByTestId("reroll");
    await page.getByTestId("random-list").click();
    await page.getByTestId("give-up").waitFor();
    const first = await hash(page);
    assert.ok(await reroll.isVisible());

    // It rolls another list, a fresh game, which offers it too.
    await reroll.click();
    await page.waitForFunction((h) => location.hash !== h, first);
    await page.getByTestId("give-up").waitFor();
    const second = await hash(page);
    assert.match(second, /^#p-/);
    assert.notEqual(second, first);
    await reroll.waitFor();
    assert.equal(await page.getByTestId("lives").getAttribute("data-lives"), "5");

    // The first guess ends it, and nothing moved as it went.
    const box = page.getByLabel("Your guess");
    const board = page.getByTestId("slot").first();
    const [boxTop, boardTop] = [await top(box), await top(board)];
    const p = await puzzle(page, second.replace(/^#p-/, ""));
    await guess(page, p.answers[0].name);
    assert.equal(await reroll.count(), 0);
    assert.equal(await top(box), boxTop, "the guess box stays put");
    assert.equal(await top(board), boardTop, "the board stays put");

    // Not on today's list, nor on a list opened directly.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("today-list").click();
    await page.getByTestId("give-up").waitFor();
    assert.equal(await reroll.count(), 0);
    await page.evaluate(() => (location.hash = "#p-mountains"));
    await page.getByTestId("give-up").waitFor();
    assert.equal(await hash(page), "#p-mountains");
    assert.equal(await reroll.count(), 0);
    await ctx.close();
  });

  test(`Roll again before a rolled Blitz starts (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const reroll = page.getByTestId("reroll");
    const screen = page.getByTestId("blitz-screen");
    await page.getByTestId("random-blitz").click();
    await page.getByTestId("blitz-clock").waitFor();
    const first = await screen.getAttribute("data-list");
    assert.ok(await reroll.isVisible());

    // Another list, a fresh round, still before its clock: it offers Roll again too.
    await reroll.click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="blitz-screen"]')?.dataset.list !== id, first);
    const second = await screen.getAttribute("data-list");
    assert.notEqual(second, first);
    assert.equal(await hash(page), `#blitz-${second}`);
    await reroll.waitFor();
    assert.equal(await page.getByTestId("blitz-clock").getAttribute("data-started"), "false");

    // The first keystroke starts the clock and ends it; the clock and score stay where they were.
    const clock = page.getByTestId("blitz-clock");
    const score = page.getByTestId("blitz-score");
    const [clockTop, scoreTop] = [await top(clock), await top(score)];
    await page.getByLabel("Your guess").pressSequentially("a");
    assert.equal(await clock.getAttribute("data-started"), "true");
    assert.equal(await reroll.count(), 0);
    assert.equal(await top(clock), clockTop);
    assert.equal(await top(score), scoreTop);

    // Never on Today's Blitz.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("today-blitz").click();
    await page.getByTestId("blitz-clock").waitFor();
    assert.equal(await reroll.count(), 0);
    await ctx.close();
  });
}
