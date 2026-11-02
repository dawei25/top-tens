// The clue: every empty row shows a magnifier (labelled, with a tooltip). Pressing it by click, tap or keyboard asks
// first; YES spends a life for the row's first letter, Escape backs out for free. Never on the last life.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, puzzle, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "mountains";
const CLUE = "Clue: first letter, costs a life";
/** The letter a clue shows: the first letter or digit, past a leading article (hintLetter in src/game/state.ts). */
const firstLetter = (name) => name.replace(/^(the|a|an)\s+/i, "").match(/[\p{L}\p{N}]/u)[0].toUpperCase();

for (const vp of VIEWPORTS) {
  test(`the clue icon buys a first letter (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    const lives = () => page.getByTestId("lives").getAttribute("data-lives");
    const slot = (rank) => page.locator(`[data-testid="slot"][data-rank="${rank}"]`);
    const press = (el) => (vp.hasTouch ? el.tap() : el.click());
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.getAttribute("aria-label"));
    await page.getByTestId("give-up").waitFor();
    const p = await puzzle(page, LIST);

    // Every empty row shows the magnifier, with its label and tooltip; a found row has none.
    await guess(page, p.answers[0].name);
    assert.equal(await page.getByTestId("clue").count(), 9);
    assert.equal(await slot(1).getByTestId("clue").count(), 0);
    assert.ok(await slot(3).getByTestId("clue").isVisible());
    const key3 = slot(3).getByRole("button", { name: `#3 not found yet. ${CLUE}` });
    assert.equal(await key3.getAttribute("title"), CLUE);

    // Pressing the magnifier asks first (nothing spent yet); YES spends a life and shows the first letter.
    await press(slot(3).getByTestId("clue"));
    await page.getByTestId("hint-yes").waitFor();
    assert.equal(await key3.getAttribute("aria-expanded"), "true");
    assert.equal(await lives(), "5");
    await press(page.getByTestId("hint-yes"));
    assert.equal(await lives(), "4");
    assert.equal(await slot(3).getAttribute("data-state"), "hinted");
    assert.equal(await slot(3).getByTestId("hint-letter").textContent(), firstLetter(p.answers[2].name));
    assert.equal(await slot(3).getByTestId("clue").count(), 0);

    // From the keyboard: Enter on a row's clue key takes focus to YES; Escape backs out for free, back to the box.
    const key5 = slot(5).getByRole("button", { name: new RegExp(CLUE) });
    await key5.focus();
    await page.keyboard.press("Enter");
    assert.equal(await focused(), "hint-yes");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByTestId("hint-yes").count(), 0);
    assert.equal(await focused(), "Your guess");
    assert.equal(await lives(), "4");
    await key5.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    assert.equal(await lives(), "3");
    assert.equal(await slot(5).getAttribute("data-state"), "hinted");

    // Down to the last life, the magnifier still answers, but only to say no: nothing is spent.
    for (const r of [6, 7]) {
      await press(slot(r).getByTestId("clue"));
      await press(page.getByTestId("hint-yes"));
    }
    assert.equal(await lives(), "1");
    await press(slot(8).getByTestId("clue"));
    await page.getByTestId("hint-refused").waitFor();
    assert.equal(await page.getByTestId("hint-yes").count(), 0);
    assert.equal(await lives(), "1");
    assert.equal(await slot(8).getAttribute("data-state"), "hidden");
    await ctx.close();
  });
}
