// Blitz is free play only (owner, Nov 10: "remove todays blitz but keep blitz in the free play section ... it was
// confusing to begin with having 2 different dailies to keep track of"). Home has one daily, Today's list, across the
// row the pair took, and free play keeps Random list and Random Blitz; the menu the same. A finished daily list offers
// Play Blitz on that same list (a free round) and Random list. An old link to a date's Blitz (#dailyblitz-<date>, and
// the /run-<startedAt> Past runs used to link) opens that list's free Blitz; one to a date not here yet goes home.
// Days in a row count daily lists only, and no screen says Today's Blitz or Daily Blitz any more.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, TODAY, FRESH, open, go, hash, puzzle, todaysDaily, store, guess, giveUp, noHScroll } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

/** No word of a second daily anywhere on the page (dialogs included). */
const NO_DAILY_BLITZ = /today'?s blitz|daily blitz|blitz #\d/i;
const saysNoDailyBlitz = async (page, where) => {
  const text = await page.evaluate(() => document.body.innerText);
  assert.doesNotMatch(text, NO_DAILY_BLITZ, `${where} still names a daily Blitz`);
};

/** An older day's Blitz, played back when there was one: its result and its round. */
const OLD = { date: "2026-10-27", id: "mlb-home-runs", startedAt: Date.parse("2026-10-27T15:00:00-04:00") };
const OLD_ROUND = { startedAt: OLD.startedAt, endedAt: OLD.startedAt + 90_000, score: 100, hits: [{ name: "Barry Bonds", rank: 1, n: 762, points: 100 }] };
const SEED = {
  ...FRESH,
  blitzDaily: { [OLD.date]: { id: OLD.id, score: 100, answers: 1, startedAt: OLD.startedAt } },
  blitzRuns: { [OLD.id]: [OLD_ROUND] },
  blitzBest: { [OLD.id]: 100 },
};

for (const vp of VIEWPORTS) {
  test(`one daily: Today's list on Home and in the menu, Blitz in free play (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    await page.getByTestId("today-list").waitFor();
    const group = page.getByTestId("today-group");
    assert.equal(await page.getByTestId("today-blitz").count(), 0);
    // Today's list and, under it, Today's Fathom (owner, Nov 14): no daily Blitz.
    assert.deepEqual(await group.locator("button, a").evaluateAll((els) => els.map((e) => e.dataset.testid)), ["today-list", "today-fathom"]);
    // It takes the whole row the pair had (UX 6): the card's full content width.
    const spare = await page.getByTestId("today-list").evaluate((key) => {
      const card = key.closest('[data-testid="today-group"]');
      const s = getComputedStyle(card);
      return Math.round(card.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - key.getBoundingClientRect().width);
    });
    assert.ok(Math.abs(spare) <= 1, `Today's list leaves ${spare}px of its row`);
    // Free play: both modes, each with its by-category picker.
    for (const id of ["random-list", "random-blitz", "random-list-categories", "random-blitz-categories"]) {
      assert.equal(await page.getByTestId("free-play").getByTestId(id).count(), 1, id);
    }
    assert.ok(await noHScroll(page));
    await saysNoDailyBlitz(page, "Home");

    // How to play says nothing of a second daily.
    await page.getByTestId("howto-key").click();
    await page.getByTestId("howto").waitFor();
    await saysNoDailyBlitz(page, "How to play");
    await page.getByTestId("howto-close").click();
    await page.getByTestId("howto").waitFor({ state: "detached" });

    // The menu: Today's list across the row, then Random list and Random Blitz side by side.
    await page.getByTestId("menu-key").click();
    const menu = page.getByTestId("menu");
    await menu.waitFor();
    await menu.evaluate((d) => Promise.all(d.getAnimations().map((a) => a.finished)));
    assert.equal(await page.getByTestId("menu-today-blitz").count(), 0);
    const [t, l, b] = await Promise.all(["menu-today-list", "menu-random-list", "menu-random-blitz"].map((id) => page.getByTestId(id).boundingBox()));
    assert.ok(Math.abs(t.x - l.x) <= 1 && Math.abs(t.x + t.width - (b.x + b.width)) <= 1, "Today's list spans the row");
    assert.ok(Math.abs(l.y - b.y) <= 1 && l.y >= t.y + t.height, "Random list and Random Blitz share the row under it");
    await saysNoDailyBlitz(page, "the menu");
    await ctx.close();
  });

  test(`a finished daily offers Play Blitz on its own list, and Random list (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const daily = await todaysDaily(page);
    await page.getByTestId("today-list").click();
    await giveUp(page);
    // One try: no Roll new list; Play Blitz on this list where Today's Blitz was, and a random list.
    assert.equal(await page.getByTestId("results-daily-blitz").count(), 0);
    assert.equal(await page.getByTestId("play-again").count(), 0);
    assert.equal(await page.getByTestId("results-roll").count(), 1);
    const key = page.getByTestId("blitz-key");
    assert.equal(await key.getAttribute("href"), `#blitz-${daily.id}`);
    await saysNoDailyBlitz(page, "a daily's results");

    // A free round on the same list, open at once (the daily is done), counted as free play.
    await key.click();
    await page.getByTestId("blitz-clock").waitFor();
    assert.equal(await page.getByTestId("blitz-screen").getAttribute("data-list"), daily.id);
    assert.equal(await page.getByTestId("blitz-closed").count(), 0);
    await guess(page, (await puzzle(page, daily.id)).answers[1].name);
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();
    assert.equal(await page.getByTestId("blitz-again").count(), 1, "free play: Roll new list");
    await saysNoDailyBlitz(page, "a Blitz's results");
    const s = await store(page);
    assert.equal(s.blitzRuns[daily.id].length, 1);
    assert.equal(s.blitzDaily?.[TODAY], undefined, "no daily Blitz result");
    // Days in a row: the daily list counted, the Blitz added nothing.
    assert.deepEqual(Object.keys(s.daily), [TODAY]);
    await ctx.close();
  });

  test(`an old link to a date's Blitz opens that list's free Blitz (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#dailyblitz-${TODAY}`, SEED);
    // Today's old pick (the schedule's `blitz`, kept in daily.json), as a free round with its address.
    const pick = (await todaysDaily(page)).blitz;
    const screen = page.getByTestId("blitz-screen");
    await page.getByTestId("blitz-clock").waitFor();
    assert.equal(await screen.getAttribute("data-list"), pick);
    assert.equal(await hash(page), `#blitz-${pick}`);
    assert.equal(await page.getByTestId("blitz-closed").count(), 0);
    await saysNoDailyBlitz(page, "an old date's Blitz");

    // A date the player played: the list they had that day.
    await go(page, `#dailyblitz-${OLD.date}`);
    await page.getByTestId("blitz-clock").waitFor();
    assert.equal(await hash(page), `#blitz-${OLD.id}`);
    assert.equal(await screen.getAttribute("data-list"), OLD.id);

    // Its round, from the link Past runs used to give it: that round's view, on the list's own Blitz screen.
    await go(page, `#dailyblitz-${OLD.date}/run-${OLD.startedAt}`);
    await page.getByTestId("run-view").waitFor();
    assert.equal(await hash(page), `#blitz-${OLD.id}/run-${OLD.startedAt}`);

    // Past runs keeps that round as a Blitz, and its row opens the same view.
    await go(page, "#history");
    const row = page.locator('[data-testid="history-row"][data-kind="blitz"]');
    await row.waitFor();
    assert.equal(await row.getAttribute("href"), `#blitz-${OLD.id}/run-${OLD.startedAt}`);
    await saysNoDailyBlitz(page, "Past runs");
    await row.click();
    await page.getByTestId("run-view").waitFor();

    // A date with no list yet goes home; nothing breaks.
    await go(page, "#dailyblitz-2027-01-01");
    await page.getByTestId("today-list").waitFor();
    assert.equal(await hash(page), "");
    await ctx.close();
  });
}

test("a Blitz round alone never counts toward days in a row", async () => {
  const { ctx, page } = await open(browser, VIEWPORTS[0]);
  await page.getByTestId("random-blitz").click();
  const screen = page.getByTestId("blitz-screen");
  await page.getByTestId("blitz-clock").waitFor();
  await guess(page, (await puzzle(page, await screen.getAttribute("data-list"))).answers[0].name);
  await page.clock.fastForward(91_000);
  await page.getByTestId("blitz-results").waitFor();
  assert.deepEqual((await store(page)).daily, {});
  await go(page, "");
  await page.getByTestId("home-record").waitFor();
  assert.equal(await page.getByTestId("home-record").getAttribute("data-empty"), "true", "no list game yet: the record is empty");
  await ctx.close();
});
