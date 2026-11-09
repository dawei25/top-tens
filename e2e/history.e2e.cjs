// Past runs: a list game and a Blitz round, newest first, under one header per day, one tag per row; every row opens
// its own run (a list run's view too, even after Play again left a newer game of that list unfinished) and Back
// returns to the list; deep links to a run go Back one level up (a Blitz run: that list's Blitz screen with past
// runs open; a list run: Past runs).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, TODAY, open, openTab, go, hash, store, noHScroll, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "airports";

for (const vp of VIEWPORTS) {
  test(`past runs (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    // A list game, given up.
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();
    await page.getByTestId("results").waitFor();
    await page.clock.runFor(60_000);
    // Then a Blitz round on the same list, from the results' PLAY BLITZ key.
    await page.getByTestId("blitz-key").click();
    await page.getByTestId("blitz-clock").waitFor();
    await guess(page, "Dubai");
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();

    await page.getByTestId("nav-home").click();
    await page.getByTestId("history-key").click();
    const rows = page.getByTestId("history-row");
    await rows.first().waitFor();
    assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-kind"))), ["blitz", "list"]);
    // Both today: one day header, and one tag per row.
    const days = page.getByTestId("history-day");
    assert.deepEqual(await days.evaluateAll((els) => els.map((e) => e.getAttribute("data-date"))), [TODAY]);
    assert.equal(await page.getByTestId("history-tag").count(), 2);
    assert.equal(await page.locator('[data-testid="history-row"] [data-testid="history-tag"]').count(), 2);
    assert.ok(await noHScroll(page));

    await rows.first().click();
    await page.getByTestId("run-view").waitFor();
    await page.getByTestId("nav-back").click();
    await rows.first().waitFor();
    assert.equal(await hash(page), "#history");

    // The list row opens that run's own view: the board as it ended, then Back.
    await rows.nth(1).click();
    await page.getByTestId("run-view").waitFor();
    const run = (await store(page)).listRuns[0];
    assert.equal(await hash(page), `#p-${LIST}/run-${run.startedAt}`);
    assert.equal(await page.locator('[data-testid="slot"][data-state="missed"]').count(), 10);
    assert.ok(await noHScroll(page));
    await page.getByTestId("run-back").click();
    await rows.first().waitFor();
    assert.equal(await hash(page), "#history");

    // Deep link to the Blitz run, no in-app history.
    const blitzRun = (await store(page)).blitzRuns[LIST][0];
    const deep = await openTab(ctx, `#blitz-${LIST}/run-${blitzRun.startedAt}`);
    await deep.getByTestId("run-view").waitFor();
    await deep.getByTestId("nav-back").click();
    await deep.getByTestId("past-runs").waitFor();
    assert.equal(await hash(deep), `#blitz-${LIST}/runs`);
    assert.equal(await deep.getByTestId("past-runs").getAttribute("open"), "");
    await deep.getByTestId("nav-home").click();
    await deep.getByTestId("today-list").waitFor();

    // Deep link to the list run: Back goes up to Past runs.
    const deepList = await openTab(ctx, `#p-${LIST}/run-${run.startedAt}`);
    await deepList.getByTestId("run-view").waitFor();
    await deepList.getByTestId("nav-back").click();
    await deepList.getByTestId("history-row").first().waitFor();
    assert.equal(await hash(deepList), "#history");
    await ctx.close();
  });

  test(`a list row opens its own run, not the list's latest game (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    await guess(page, "Dubai");
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();
    await page.getByTestId("results").waitFor();
    const found = (await store(page)).listRuns[0].found.length;
    assert.ok(found >= 1);

    // Play again from the run view, then leave the fresh game unfinished.
    await go(page, "#history");
    await page.locator('[data-testid="history-row"][data-kind="list"]').first().click();
    await page.getByTestId("replay").click();
    await page.getByTestId("give-up").waitFor();
    assert.equal(await page.locator('[data-testid="slot"][data-state="found"]').count(), 0);

    // The old row still opens the finished run.
    await go(page, "#history");
    const listRows = page.locator('[data-testid="history-row"][data-kind="list"]');
    await listRows.first().waitFor();
    assert.equal(await listRows.count(), 1, "the unfinished replay isn't a past run");
    await listRows.first().click();
    await page.getByTestId("run-view").waitFor();
    assert.equal(await page.getByTestId("run-view").getAttribute("data-found"), String(found));
    assert.equal(await page.locator('[data-testid="slot"][data-state="found"]').count(), found);
    assert.equal(await page.getByTestId("give-up").count(), 0);
    await ctx.close();
  });
}

// Launch audit, Nov 6: "DAILY BLITZ #22" left "#22" alone on a second line at 390. A daily's tag is one name, on one
// line, down to the narrowest phone; a Blitz round (free play only since Nov 10) is tagged "Blitz".
test("today's list and its Blitz in Past runs: each tag on one line at 320 and 390", async () => {
  for (const width of [320, 390]) {
    const { ctx, page } = await open(browser, { viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    await page.getByTestId("today-list").click();
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();
    await page.getByTestId("results").waitFor();
    // The daily's results offer its list as a Blitz.
    await page.getByTestId("blitz-key").click();
    const screen = page.getByTestId("blitz-screen");
    await screen.waitFor();
    const list = await page.evaluate(async (id) => (await fetch(`puzzles/${id}.json`)).json(), await screen.getAttribute("data-list"));
    await guess(page, list.answers[0].name);
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();
    await go(page, "#history");
    await page.getByTestId("history-row").first().waitFor();
    const tags = await page.getByTestId("history-tag").evaluateAll((els) =>
      els.map((el) => ({ text: el.textContent, lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)) })),
    );
    assert.equal(tags.length, 2);
    for (const t of tags) assert.equal(t.lines, 1, `${width}px: "${t.text}" takes ${t.lines} lines`);
    await ctx.close();
  }
});
