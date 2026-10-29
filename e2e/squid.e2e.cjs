// The squid: one limb lit per answer found (classic), the same after a reload, and per top-10 hit in Blitz.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, puzzle, noHScroll, guess } = require("./helpers.cjs");

const LIST = "countries-population";

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

for (const vp of VIEWPORTS) {
  test(`squid lights a limb per find (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    const squid = page.getByTestId("squid");
    const litRanks = async () =>
      (await squid.locator('[data-limb][data-on="true"]').evaluateAll((els) => els.map((e) => Number(e.dataset.limb)))).sort(
        (a, b) => a - b,
      );
    await squid.waitFor();
    assert.equal(await squid.getAttribute("data-lit"), "0");
    assert.deepEqual(await litRanks(), []);
    assert.equal(await squid.locator("[data-limb]").count(), 10);

    const p = await puzzle(page, LIST);
    for (const r of [1, 4, 7]) await guess(page, p.answers.find((a) => a.rank === r).name);
    assert.equal(await squid.getAttribute("data-lit"), "3");
    assert.deepEqual(await litRanks(), [1, 4, 7]);

    // A costly miss empties an ink sac; the lives element reads the same as ever.
    await guess(page, p.extras.find((e) => e.rank > 10).name);
    assert.equal(await page.getByTestId("lives").getAttribute("data-lives"), "4");
    assert.equal(await squid.getAttribute("data-lit"), "3");

    // Loading the game in progress shows the same limbs lit.
    await page.reload();
    await squid.waitFor();
    assert.deepEqual(await litRanks(), [1, 4, 7]);
    assert.equal(await squid.getAttribute("data-mood"), "play");
    assert.ok(await noHScroll(page));
    await ctx.close();
  });

  test(`blitz squid lights a limb per top-10 hit (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#blitz-${LIST}`);
    const squid = page.getByTestId("squid");
    await squid.waitFor();
    const p = await puzzle(page, LIST);
    await guess(page, p.answers.find((a) => a.rank === 2).name);
    await guess(page, p.extras.find((e) => e.rank > 10).name);
    await page.getByTestId("blitz-hit").nth(1).waitFor();
    assert.equal(await squid.getAttribute("data-lit"), "1");
    assert.equal(await squid.locator('[data-limb="2"]').getAttribute("data-on"), "true");
    await ctx.close();
  });
}
