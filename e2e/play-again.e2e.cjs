// Play again rolls: on a random list it lands on another list, a fresh game, in the same category when the list
// was rolled in one; on a Blitz it lands on another open Blitz list, a fresh round, keeping the category too.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, hash, puzzle, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const index = (page) => page.evaluate(async () => (await fetch("puzzles/index.json")).json());
const listId = async (page) => (await hash(page)).replace(/^#p-/, "");

async function giveUp(page) {
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();
  await page.getByTestId("results").waitFor();
}

for (const vp of VIEWPORTS) {
  test(`list Play again rolls another list (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const lists = await index(page);
    const category = (m) => lists.find((x) => x.id === m).category;

    // Plain random: another list, a fresh game.
    await page.getByTestId("random-list").click();
    await page.getByTestId("give-up").waitFor();
    const first = await listId(page);
    await giveUp(page);
    await page.getByTestId("play-again").click();
    await page.getByTestId("give-up").waitFor();
    const second = await listId(page);
    assert.notEqual(second, first);
    assert.equal(await page.getByTestId("lives").getAttribute("data-lives"), "5");
    assert.equal(await page.locator('[data-testid="slot"][data-state="found"]').count(), 0);

    // Rolled in a category: Play again stays in it.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("random-list-categories").click();
    const counts = {};
    for (const m of lists) counts[m.category] = (counts[m.category] ?? 0) + 1;
    const cat = Object.keys(counts).find((c) => counts[c] >= 3);
    await page.locator(`[data-testid="category"][data-mode="list"][data-category="${cat}"]`).click();
    await page.getByTestId("give-up").waitFor();
    const inCat = await listId(page);
    assert.equal(category(inCat), cat);
    await giveUp(page);
    await page.getByTestId("play-again").click();
    await page.getByTestId("give-up").waitFor();
    const next = await listId(page);
    assert.notEqual(next, inCat);
    assert.equal(category(next), cat);
    await ctx.close();
  });

  test(`Blitz Play again rolls another Blitz list (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const lists = await index(page);
    const screen = page.getByTestId("blitz-screen");
    await page.getByTestId("random-blitz-categories").click();
    const chips = page.locator('[data-testid="category"][data-mode="blitz"]');
    // A category with more than one open Blitz list (the chip shows its count).
    const cats = await chips.evaluateAll((els) => els.map((e) => [e.dataset.category, Number(e.querySelector(".cat-n")?.textContent)]));
    const [cat] = cats.find(([, n]) => n >= 2);
    await page.locator(`[data-testid="category"][data-mode="blitz"][data-category="${cat}"]`).click();
    await screen.waitFor();
    const first = await screen.getAttribute("data-list");
    assert.equal(lists.find((m) => m.id === first).category, cat);

    const p = await puzzle(page, first);
    await guess(page, p.answers[0].name);
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();
    await page.getByTestId("blitz-again").click();
    await page.getByTestId("blitz-clock").waitFor();
    const second = await screen.getAttribute("data-list");
    assert.notEqual(second, first);
    assert.equal(await hash(page), `#blitz-${second}`);
    assert.equal(lists.find((m) => m.id === second).category, cat);
    assert.equal(await page.getByTestId("blitz-clock").getAttribute("data-started"), "false", "a fresh round");
    assert.equal(await page.getByTestId("blitz-hit").count(), 0);
    await ctx.close();
  });
}
