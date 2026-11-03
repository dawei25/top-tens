// Archive -> an old daily -> Back -> archive -> Back -> home; a deep link to an old daily goes Back to the archive.
// An old daily is one try: once finished it stays on its result, even after a roll replays the same list. Unplayed
// cells show only their title (no "not played" thirty times for a new player); played ones show their score.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, openTab, hash, store, noHScroll } = require("./helpers.cjs");

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
    assert.equal(await page.getByTestId("archive-status").count(), 0, "nothing played: no status anywhere");
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

  test(`an archived daily is one try (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "#archive");
    const rows = page.getByTestId("archive-row");
    await rows.first().waitFor();
    const old = (await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-date")))).at(-1);
    const row = page.locator(`[data-testid="archive-row"][data-date="${old}"]`);
    await row.click();
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();
    await page.getByTestId("results").waitFor();
    assert.equal(await page.getByTestId("play-again").count(), 0);
    const id = (await store(page)).dailyGames[old].puzzleId;

    // A later roll of the same list replaces the list's own save; the daily stays locked on its result.
    await page.evaluate((listId) => {
      const s = JSON.parse(localStorage.getItem("top-tens:v1"));
      delete s.games[listId];
      localStorage.setItem("top-tens:v1", JSON.stringify(s));
    }, id);
    await page.getByTestId("nav-back").click();
    await row.waitFor();
    assert.equal(await row.getByTestId("archive-status").count(), 1, "a played cell shows its score");
    assert.equal(await page.getByTestId("archive-status").count(), 1);
    await row.click();
    await page.getByTestId("results").waitFor();
    assert.equal(await page.getByTestId("give-up").count(), 0);
    assert.equal(await page.getByLabel("Your guess").count(), 0);
    await ctx.close();
  });
}
