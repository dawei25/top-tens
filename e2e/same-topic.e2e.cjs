// One topic per day (from 2026-11-05): Today's Blitz plays today's list. Until that list is done, the Blitz shows only
// what you hit (results, locked round, past run); after, everything. Its list has no free Blitz before Today's Blitz
// is played. The archive puts that day's Blitz score on the list's own row, and names the list when an older day's
// Blitz ran on another one. The Blitz title card and a miss say what the list is made of (the puzzle's noun).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, go, hash, puzzle, store, noHScroll, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const DAY = "2026-11-05";
const NOW = new Date(`${DAY}T12:00:00-05:00`);
const LIST = "us-states-area";
const NOUN = "states";
/** An older day whose Blitz ran on another list, with a round played. */
const OLD = { date: "2026-10-30", blitz: "films-gross", score: 345 };
const SEED = {
  games: {},
  daily: {},
  seenHelp: true,
  blitzDaily: { [OLD.date]: { id: OLD.blitz, score: OLD.score, answers: 4, late: true } },
};

/** Serve a schedule whose DAY runs `id` (no explicit Blitz), and LIST with a noun. */
const sameTopicDay = (id) => async (ctx) => {
  await ctx.route("**/puzzles/daily.json", async (route) => {
    const res = await route.fetch();
    const days = (await res.json()).filter((e) => e.date < DAY);
    days.push({ n: Math.max(...days.map((e) => e.n)) + 1, date: DAY, id });
    await route.fulfill({ response: res, json: days });
  });
  await ctx.route(`**/puzzles/${LIST}.json`, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), noun: NOUN } });
  });
};

for (const vp of VIEWPORTS) {
  test(`Today's Blitz on today's list holds the rest until the list is done (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#blitz-${LIST}`, SEED, { now: NOW, setup: sameTopicDay(LIST) });
    // No free Blitz of today's list before it's played.
    await page.getByTestId("blitz-closed").waitFor();
    await go(page, "");
    await page.getByTestId("today-list").waitFor();
    assert.equal(await page.getByTestId("today-blitz").count(), 1);

    // Today's Blitz is today's list. The title card says what to name.
    await page.getByTestId("today-blitz").click();
    const screen = page.getByTestId("blitz-screen");
    await screen.waitFor();
    assert.equal(await hash(page), `#dailyblitz-${DAY}`);
    assert.equal(await screen.getAttribute("data-list"), LIST);
    assert.match(await page.getByTestId("blitz-rule").textContent(), new RegExp(`\\b${NOUN}\\b`));
    assert.ok((await page.getByTestId("title-prompt").textContent()).trim().length > 0);

    // A guess that isn't on the list says how many of what are.
    const p = await puzzle(page, LIST);
    await guess(page, "Tchaikovsky");
    const miss = await page.getByTestId("feedback").textContent();
    assert.ok(miss.includes(`${p.answers.length + p.extras.length} ${NOUN}`), miss);

    // One hit, then time: the results show the hit and nothing else.
    await guess(page, p.answers[0].name);
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();
    assert.equal(await page.getByTestId("blitz-hit").count(), 1);
    assert.equal(await page.getByTestId("blitz-rest-hidden").count(), 1);
    assert.equal(await page.getByTestId("blitz-missed-row").count(), 0);
    assert.ok(await noHScroll(page));
    const score = (await store(page)).blitzDaily[DAY].score;

    // Its past run holds the rest back too.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("history-key").click();
    const row = page.locator('[data-testid="history-row"][data-kind="blitz"]');
    await row.first().waitFor();
    assert.match(await row.first().getAttribute("href"), new RegExp(`^#dailyblitz-${DAY}/run-\\d+$`));
    await row.first().click();
    await page.getByTestId("run-view").waitFor();
    assert.equal(await page.getByTestId("blitz-rest-hidden").count(), 1);
    assert.equal(await page.getByTestId("blitz-missed-row").count(), 0);

    // "Today's list" from the Blitz results: the daily. No Blitz key of its own there.
    await go(page, `#dailyblitz-${DAY}`);
    await page.getByTestId("blitz-results").waitFor();
    assert.equal(await page.getByTestId("blitz-list").getAttribute("href"), `#daily-${DAY}`);
    await page.getByTestId("blitz-list").click();
    await page.getByTestId("give-up").waitFor();
    assert.equal(await page.getByTestId("title-blitz").count(), 0);
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();
    await page.getByTestId("results").waitFor();
    assert.equal(await page.getByTestId("blitz-key").count(), 0);

    // List done: the locked round now shows everything.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("today-blitz").click();
    await page.getByTestId("blitz-results").waitFor();
    assert.equal(await page.getByTestId("blitz-results").getAttribute("data-locked"), "true");
    assert.equal(await page.getByTestId("blitz-rest-hidden").count(), 0);
    assert.ok((await page.getByTestId("blitz-missed-row").count()) > 0);

    // Archive: today's row carries its own Blitz score; the older row names the other list its Blitz ran on.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("archive-key").click();
    const blitzOn = (date) => page.locator(`[data-testid="archive-row"][data-date="${date}"] [data-testid="archive-blitz"]`);
    await blitzOn(DAY).waitFor();
    assert.equal(await blitzOn(DAY).getAttribute("data-list"), LIST);
    assert.equal(await blitzOn(DAY).getAttribute("data-score"), String(score));
    assert.ok(!(await blitzOn(DAY).textContent()).includes(p.title));
    const other = await puzzle(page, OLD.blitz);
    assert.equal(await blitzOn(OLD.date).getAttribute("data-list"), OLD.blitz);
    assert.ok((await blitzOn(OLD.date).textContent()).includes(other.title));
    assert.ok(await noHScroll(page));
    await ctx.close();
  });
}

test("list first: Home goes on to Today's Blitz, which shows everything; its list's free Blitz waits for it", async () => {
  const { ctx, page } = await open(browser, VIEWPORTS[0], `#daily-${DAY}`, SEED, { now: NOW, setup: sameTopicDay(LIST) });
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();
  await page.getByTestId("results").waitFor();
  assert.equal(await page.getByTestId("blitz-key").count(), 0);
  assert.equal(await page.getByTestId("results-daily-blitz").count(), 1);

  // A free Blitz of the list waits for Today's Blitz, and points to it.
  await go(page, `#blitz-${LIST}`);
  await page.getByTestId("blitz-closed").waitFor();
  assert.equal(await page.getByTestId("blitz-closed-go").getAttribute("href"), `#dailyblitz-${DAY}`);

  await go(page, "");
  await page.getByTestId("today-blitz").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "today-blitz");
  await page.keyboard.press("Enter");
  await page.getByTestId("blitz-clock").waitFor();
  assert.equal(await page.getByTestId("blitz-screen").getAttribute("data-list"), LIST);
  await guess(page, "x");
  await page.clock.fastForward(91_000);
  await page.getByTestId("blitz-results").waitFor();
  assert.equal(await page.getByTestId("blitz-rest-hidden").count(), 0);
  assert.ok((await page.getByTestId("blitz-missed-row").count()) > 0);

  // Played: the free Blitz of the list opens.
  await go(page, `#blitz-${LIST}`);
  await page.getByTestId("blitz-clock").waitFor();
  await ctx.close();
});

test("a day whose list can't be a Blitz has no Today's Blitz", async () => {
  const { ctx, page } = await open(browser, VIEWPORTS[0], "", SEED, { now: NOW, setup: sameTopicDay("websites") });
  await page.getByTestId("today-list").waitFor();
  assert.equal(await page.getByTestId("today-blitz").count(), 0);
  await ctx.close();
});
