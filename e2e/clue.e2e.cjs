// The clue: every empty row shows a magnifier (labelled, with a tooltip). Pressing it by click, tap or keyboard asks
// first; YES spends a life for the row's first letter, Escape backs out for free. Pressed again on the same row, it
// offers the next letter, for another life. Never on the last life.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, puzzle, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "mountains";
const CLUE = "Clue: first letter, costs a life";
const CLUE_NEXT = "Clue: next letter, costs a life";
/** The confirm's question (CLUE_ASK and CLUE_ASK_NEXT in src/components/copy.ts). */
const ASK = { first: "first letter? 1 life", next: "next letter? 1 life" };
/**
 * What n clues show: the first n letters or digits past a leading article, with whatever stands between them
 * (hintPrefix in src/game/state.ts).
 */
const prefix = (name, n) => {
  const core = name.replace(/^(the|a|an)\s+/i, "");
  const ls = [...core.matchAll(/[\p{L}\p{N}]\p{M}*/gu)].slice(0, n);
  const last = ls[ls.length - 1];
  return core.slice(ls[0].index, last.index + last[0].length).replace(/\s+/g, " ").toUpperCase();
};

for (const vp of VIEWPORTS) {
  test(`the clue icon buys a first letter, then the next (${vp.name})`, async () => {
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

    // Pressing the magnifier asks first (nothing spent yet), in the row's own place on one line: nothing on the board
    // moves. A second press on the row backs out; YES spends a life and shows the first letter.
    const rows = () => Promise.all([3, 4, 10].map(async (r) => (await slot(r).boundingBox()).y + "/" + (await slot(r).boundingBox()).height));
    const shut = await rows();
    await press(slot(3).getByTestId("clue"));
    await page.getByTestId("hint-yes").waitFor();
    assert.deepEqual(await rows(), shut, "the clue confirm moves nothing");
    const ask = await page.getByTestId("hint-ask").boundingBox();
    const row3 = await slot(3).boundingBox();
    assert.ok(ask.y >= row3.y && ask.y + ask.height <= row3.y + row3.height + 0.5, "the confirm stays inside its row");
    const atStart = { position: { x: 4, y: Math.round(ask.height / 2) } };
    await (vp.hasTouch ? page.getByTestId("hint-ask").tap(atStart) : page.getByTestId("hint-ask").click(atStart));
    assert.equal(await page.getByTestId("hint-yes").count(), 0);
    await press(slot(3).getByTestId("clue"));
    await page.getByTestId("hint-yes").waitFor();
    assert.equal(await key3.getAttribute("aria-expanded"), "true");
    assert.equal(await lives(), "5");
    assert.equal(await page.locator('[data-testid="hint-ask"] .hint-q').textContent(), ASK.first);
    await press(page.getByTestId("hint-yes"));
    assert.equal(await lives(), "4");
    assert.equal(await slot(3).getAttribute("data-state"), "hinted");
    const name3 = p.answers[2].name;
    assert.equal(await slot(3).getByTestId("hint-letter").textContent(), prefix(name3, 1));
    assert.ok((await page.getByTestId("feedback").textContent()).includes(`#3 starts with ${prefix(name3, 1)}.`));

    // The row keeps its magnifier, now for the next letter: the same confirm in the same place, another life, and the
    // row shows both letters. Nothing on the board moves as letters appear.
    assert.ok(await slot(3).getByTestId("clue").isVisible());
    const next3 = slot(3).getByRole("button", { name: `#3 not found yet, starts with ${prefix(name3, 1)}. ${CLUE_NEXT}` });
    assert.equal(await next3.getAttribute("title"), CLUE_NEXT);
    await press(slot(3).getByTestId("clue"));
    await page.getByTestId("hint-yes").waitFor();
    assert.equal(await page.locator('[data-testid="hint-ask"] .hint-q').textContent(), ASK.next);
    assert.deepEqual(await rows(), shut, "the next-letter confirm moves nothing");
    assert.equal(await lives(), "4");
    await press(page.getByTestId("hint-yes"));
    assert.equal(await lives(), "3");
    assert.equal(await slot(3).getByTestId("hint-letter").textContent(), prefix(name3, 2));
    assert.ok((await page.getByTestId("feedback").textContent()).includes(`#3 starts with ${prefix(name3, 2)}.`));
    assert.ok(await slot(3).getByTestId("clue").isVisible());
    assert.deepEqual(await rows(), shut, "a second letter moves nothing");

    // From the keyboard: Enter on a row's clue key takes focus to YES; Escape backs out for free, back to the box.
    const key5 = slot(5).getByRole("button", { name: new RegExp(CLUE) });
    await key5.focus();
    await page.keyboard.press("Enter");
    assert.equal(await focused(), "hint-yes");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByTestId("hint-yes").count(), 0);
    assert.equal(await focused(), "Your guess");
    assert.equal(await lives(), "3");
    await key5.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    assert.equal(await lives(), "2");
    assert.equal(await slot(5).getAttribute("data-state"), "hinted");

    // A third letter on row 3 takes it down to the last life.
    await press(slot(3).getByTestId("clue"));
    await press(page.getByTestId("hint-yes"));
    assert.equal(await slot(3).getByTestId("hint-letter").textContent(), prefix(name3, 3));
    assert.equal(await lives(), "1");

    // On the last life, the magnifiers still answer, but only to say no: nothing is spent, on a hinted row too.
    await press(slot(3).getByTestId("clue"));
    await page.getByTestId("hint-refused").waitFor();
    assert.equal(await slot(3).getByTestId("hint-letter").textContent(), prefix(name3, 3));
    await page.keyboard.press("Escape");
    const shut8 = await slot(8).boundingBox();
    await press(slot(8).getByTestId("clue"));
    await page.getByTestId("hint-refused").waitFor();
    assert.deepEqual(await slot(8).boundingBox(), shut8, "the refusal takes the row's place too");
    assert.equal(await page.getByTestId("hint-yes").count(), 0);
    assert.equal(await lives(), "1");
    assert.equal(await slot(8).getAttribute("data-state"), "hidden");
    await ctx.close();
  });
}
