// Par: the title card shows it, a finished game shows par and the score histogram (your bar marked), Past runs shows
// the distance from par, and the knowledge page lists the game's category.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, puzzle, guess, noHScroll } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "mountains";

for (const vp of VIEWPORTS) {
  test(`par on the results and the knowledge page (${vp.name})`, async () => {
    // Before any game: the knowledge page's empty state.
    const { ctx, page } = await open(browser, vp, "#stats");
    await page.getByTestId("knowledge").waitFor();
    await page.getByTestId("knowledge-empty").waitFor();

    await page.goto(page.url().replace(/#.*$/, `#p-${LIST}`));
    const pars = await page.evaluate(async () => (await fetch("puzzles/par.json")).json());
    const index = await page.evaluate(async () => (await fetch("puzzles/index.json")).json());
    const par = pars[LIST].par;
    await page.getByTestId("title-par").waitFor();

    const p = await puzzle(page, LIST);
    for (const r of [1, 3]) await guess(page, p.answers.find((a) => a.rank === r).name);
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();

    // The results: par, and the histogram with 11 bars, yours (2) marked, par marked.
    const block = page.getByTestId("results").getByTestId("par");
    await block.waitFor();
    assert.equal(Number(await block.getAttribute("data-par")), par);
    const hist = block.getByTestId("histogram");
    assert.equal(await hist.locator("[data-score]").count(), 11);
    assert.equal(await hist.locator("[data-you]").getAttribute("data-score"), "2");
    assert.equal(await hist.locator("[data-par]").getAttribute("data-score"), String(par));
    assert.ok(await noHScroll(page));

    // Past runs: the classic row says how far from par.
    await page.goto(page.url().replace(/#.*$/, "#history"));
    const diff = 2 - par;
    assert.equal(
      await page.getByTestId("history-vs-par").first().textContent(),
      diff === 0 ? "at par" : `${diff > 0 ? "+" : ""}${diff} vs par`,
    );

    // Home links the knowledge page; it lists the game's category.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("knowledge-link").click();
    await page.getByTestId("knowledge").waitFor();
    const category = index.find((m) => m.id === LIST).category;
    const row = page.locator(`[data-testid="know-category"][data-name="${category}"]`);
    await row.waitFor();
    assert.equal(Number(await row.getAttribute("data-vs-par")), 2 - par);
    assert.ok(await noHScroll(page));
    await ctx.close();
  });
}
