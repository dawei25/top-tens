// The players' average ("avg" on screen, par in the data): the game's header shows the score alone, a finished game
// shows the average with the score histogram (your bar marked, the average marked), Past runs shows the distance from
// it, and the knowledge page (Home's Stats key, there from the start) lists the game's category. The golf word "par"
// never reaches the screen (players didn't know it).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, hash, puzzle, guess, noHScroll } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "mountains";
const PAR = /\bpar\b/i;

for (const vp of VIEWPORTS) {
  test(`the players' average on the results, Past runs and the knowledge page (${vp.name})`, async () => {
    // Before any game, Home's Stats key is there already; the knowledge page shows its sections with placeholders.
    const { ctx, page } = await open(browser, vp);
    await page.getByTestId("stats-key").click();
    await page.getByTestId("knowledge").waitFor();
    assert.equal(await hash(page), "#stats");
    await page.getByTestId("knowledge-empty").waitFor();
    assert.equal(await page.getByTestId("know-category-empty").count(), 1);
    assert.equal(await page.getByTestId("know-tag-empty").count(), 1);
    assert.equal(await page.getByTestId("know-category").count(), 0);
    assert.doesNotMatch(await page.getByTestId("knowledge").innerText(), PAR);
    assert.ok(await noHScroll(page));

    await page.goto(page.url().replace(/#.*$/, `#p-${LIST}`));
    const pars = await page.evaluate(async () => (await fetch("puzzles/par.json")).json());
    const index = await page.evaluate(async () => (await fetch("puzzles/index.json")).json());
    const par = pars[LIST].par;

    const p = await puzzle(page, LIST);
    for (const r of [1, 3]) await guess(page, p.answers.find((a) => a.rank === r).name);
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();

    // The results: the average, and the histogram with 11 bars, yours (2) marked, the average marked.
    const block = page.getByTestId("results").getByTestId("par");
    await block.waitFor();
    assert.equal(Number(await block.getAttribute("data-par")), par);
    const hist = block.getByTestId("histogram");
    assert.equal(await hist.locator("[data-score]").count(), 11);
    assert.equal(await hist.locator("[data-you]").getAttribute("data-score"), "2");
    assert.equal(await hist.locator("[data-par]").getAttribute("data-score"), String(par));
    assert.doesNotMatch(await page.getByTestId("results").innerText(), PAR);
    // The header shows the score alone: the average is the results' news (par.json has loaded by now).
    assert.equal(await page.getByTestId("title-par").count(), 0);
    assert.doesNotMatch(await page.getByTestId("title-card").innerText(), /\b(par|avg|average)\b/i);
    assert.ok(await noHScroll(page));

    // Past runs: the classic row says how far from the average.
    await page.goto(page.url().replace(/#.*$/, "#history"));
    const diff = 2 - par;
    assert.equal(
      await page.getByTestId("history-vs-par").first().textContent(),
      diff === 0 ? "same as avg" : `${diff > 0 ? "+" : ""}${diff} vs avg`,
    );
    assert.doesNotMatch(await page.locator("main").innerText(), PAR);

    // The knowledge page now lists the game's category, with no placeholder left there.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("stats-key").click();
    await page.getByTestId("knowledge").waitFor();
    const category = index.find((m) => m.id === LIST).category;
    const row = page.locator(`[data-testid="know-category"][data-name="${category}"]`);
    await row.waitFor();
    assert.equal(Number(await row.getAttribute("data-vs-par")), 2 - par);
    assert.equal(await page.getByTestId("knowledge-empty").count(), 0);
    assert.equal(await page.getByTestId("know-category-empty").count(), 0);
    assert.doesNotMatch(await page.getByTestId("knowledge").innerText(), PAR);
    assert.ok(await noHScroll(page));
    await ctx.close();
  });
}
