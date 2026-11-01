// Home's free play: each key rolls at once; its "by category" strip opens that mode's categories (one picker at a
// time), closes on Escape, an outside press or a pick, and a chip rolls a list (or a Blitz) in that category.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, hash } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const focusedTestId = (page) => page.evaluate(() => document.activeElement?.dataset.testid ?? null);
const focusedMode = (page) => page.evaluate(() => document.activeElement?.dataset.mode ?? null);

for (const vp of VIEWPORTS) {
  test(`free play by category (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const listStrip = page.getByTestId("random-list-categories");
    const blitzStrip = page.getByTestId("random-blitz-categories");
    const chips = page.getByTestId("category");
    await listStrip.waitFor();
    assert.equal(await chips.count(), 0, "closed until asked");
    assert.equal(await listStrip.getAttribute("aria-expanded"), "false");

    // The list picker: classic chips only, focus on the first one.
    await listStrip.click();
    assert.equal(await listStrip.getAttribute("aria-expanded"), "true");
    assert.ok((await chips.count()) > 1);
    assert.equal(await page.locator('[data-testid="category"][data-mode="blitz"]').count(), 0);
    assert.equal(await focusedTestId(page), "category");
    assert.equal(await focusedMode(page), "list");

    // Opening the Blitz picker closes the list one.
    await blitzStrip.click();
    assert.equal(await listStrip.getAttribute("aria-expanded"), "false");
    assert.equal(await blitzStrip.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator('[data-testid="category"][data-mode="list"]').count(), 0);
    assert.equal(await focusedMode(page), "blitz");

    // Escape closes it and gives focus back to its strip.
    await page.keyboard.press("Escape");
    assert.equal(await chips.count(), 0);
    assert.equal(await focusedTestId(page), "random-blitz-categories");

    // A press outside closes it too.
    await blitzStrip.click();
    await page.mouse.click(4, 200);
    assert.equal(await chips.count(), 0);
    assert.equal(await blitzStrip.getAttribute("aria-expanded"), "false");
    await page.goto(page.url().split("#")[0]);

    // Every Blitz chip's category has open Blitz lists; a pick lands on a fresh Blitz in that category.
    await blitzStrip.click();
    const index = await page.evaluate(async () => (await fetch("puzzles/index.json")).json());
    const blitzChips = page.locator('[data-testid="category"][data-mode="blitz"]');
    for (const c of await blitzChips.evaluateAll((els) => els.map((e) => e.dataset.category))) {
      assert.ok(index.some((m) => m.category === c && m.blitz), `${c} has Blitz lists`);
    }
    const pick = blitzChips.last();
    const category = await pick.getAttribute("data-category");
    await pick.click();
    await page.getByTestId("blitz-screen").waitFor();
    assert.match(await hash(page), /^#blitz-/);
    const id = await page.getByTestId("blitz-screen").getAttribute("data-list");
    assert.equal(index.find((m) => m.id === id).category, category);
    assert.equal(await page.getByTestId("blitz-clock").getAttribute("data-started"), "false", "a fresh round");

    // A list chip rolls a classic list in that category.
    await page.getByTestId("nav-home").click();
    await listStrip.click();
    const listPick = page.locator('[data-testid="category"][data-mode="list"]').first();
    const listCategory = await listPick.getAttribute("data-category");
    await listPick.click();
    await page.getByTestId("lives").waitFor();
    const listId = (await hash(page)).replace(/^#p-/, "");
    assert.equal(index.find((m) => m.id === listId).category, listCategory);
    await ctx.close();
  });
}
