// Archive -> an old daily -> Back -> archive -> Back -> home; a deep link to an old daily goes Back to the archive.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, openTab, hash, noHScroll } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

for (const vp of VIEWPORTS) {
  test(`archive and Back/Home (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    await page.getByTestId("archive-key").click();
    const rows = page.getByTestId("archive-row");
    await rows.first().waitFor();
    // Newest first; the oldest is the first daily.
    const dates = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-date")));
    assert.deepEqual([...dates].sort().reverse(), dates);
    const old = dates.at(-1);
    await page.locator(`[data-testid="archive-row"][data-date="${old}"]`).click();
    await page.getByTestId("slot").first().waitFor();
    assert.equal(await hash(page), `#daily-${old}`);
    assert.ok(await noHScroll(page));

    await page.getByTestId("nav-back").click();
    await rows.first().waitFor();
    assert.equal(await hash(page), "#archive");
    await page.getByTestId("nav-back").click();
    await page.getByTestId("today-list").waitFor();
    assert.equal(await hash(page), "");

    // No in-app history: Back goes one level up, Home goes home.
    const deep = await openTab(ctx, `#daily-${old}`);
    await deep.getByTestId("slot").first().waitFor();
    await deep.getByTestId("nav-back").click();
    await deep.getByTestId("archive-row").first().waitFor();
    assert.equal(await hash(deep), "#archive");
    await deep.getByTestId("nav-home").click();
    await deep.getByTestId("today-list").waitFor();
    await ctx.close();
  });
}
