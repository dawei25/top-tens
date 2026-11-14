// One daily a day, Today's list; Blitz is free play only (owner, Nov 10). daily.json still names a `blitz` for each
// day: an old link to that day's Blitz opens it as a free round, and those lists are in random play like any other.
// The archive is a table of the daily lists, one row per date (one try each), with no Blitz column. Random rolls never
// land on today's list, played or not, on a future day's list, or on a new list waiting for its debut as a daily (a
// list first named as a day's Blitz joins on that day).
// The Blitz title card and a miss say what the list is made of (the puzzle's noun). A Blitz on today's unfinished
// list stays closed until that list is done, from a link of either kind.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, go, hash, puzzle, store, noHScroll, guess, giveUp } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const DAY = "2026-11-05";
const NOW = new Date(`${DAY}T12:00:00-05:00`);
/** An older day whose Blitz was played (late), on the list that ran then. */
const OLD = { date: "2026-10-30", blitz: "films-gross", score: 345 };
const SEED = {
  games: {},
  daily: {},
  seenHelp: true,
  blitzDaily: { [OLD.date]: { id: OLD.blitz, score: OLD.score, answers: 4, late: true } },
};
const at = { now: NOW };

const schedule = (page) => page.evaluate(async () => (await fetch("puzzles/daily.json")).json());
const indexOf = (page) => page.evaluate(async () => (await fetch("puzzles/index.json")).json());
/** Play the open Blitz round: one hit (if given), then the clock runs out. */
async function playRound(page, hit) {
  await guess(page, hit ?? "x");
  await page.clock.fastForward(91_000);
  await page.getByTestId("blitz-results").waitFor();
}

for (const vp of VIEWPORTS) {
  test(`a day's old Blitz link opens a free round on the schedule's list (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#dailyblitz-${DAY}`, SEED, at);
    const screen = page.getByTestId("blitz-screen");
    await page.getByTestId("blitz-clock").waitFor();
    const entry = (await schedule(page)).find((e) => e.date === DAY);
    assert.ok(entry.blitz && entry.blitz !== entry.id, "the schedule still names the day a Blitz on another list");
    assert.equal(await screen.getAttribute("data-list"), entry.blitz);
    assert.equal(await hash(page), `#blitz-${entry.blitz}`);

    // The title card says what to name; a guess that isn't on the list says how many of what are.
    const p = await puzzle(page, entry.blitz);
    assert.ok(p.noun);
    assert.match(await page.getByTestId("blitz-rule").textContent(), new RegExp(`\\b${p.noun}\\b`));
    await guess(page, "Tchaikovsky");
    const miss = await page.getByTestId("feedback").textContent();
    assert.ok(miss.includes(`${p.answers.length + p.extras.length} ${p.noun}`), miss);

    // Another topic than today's list: the results show everything, with today's list still unplayed. Free play: a
    // round in the list's history, Roll new list after it, nothing kept as a daily.
    await playRound(page, p.answers[0].name);
    assert.equal(await page.getByTestId("blitz-hit").count(), 1);
    assert.ok((await page.getByTestId("blitz-missed-row").count()) > 0);
    assert.equal(await page.getByTestId("blitz-again").count(), 1);
    assert.ok(await noHScroll(page));
    const s = await store(page);
    assert.equal(s.blitzRuns[entry.blitz].length, 1);
    assert.equal(s.blitzDaily[DAY], undefined);
    await ctx.close();
  });

  test(`the archive lists each day's list, one row per date, no Blitz (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "#archive", SEED, at);
    const rows = page.getByTestId("archive-row");
    await rows.first().waitFor();
    const days = (await schedule(page)).filter((e) => e.date <= DAY);
    const index = await indexOf(page);
    const title = (id) => index.find((m) => m.id === id).title;

    // One row per date, newest first, each the day's list; no Blitz cell, column or header anywhere (an old day whose
    // Blitz was played included).
    const dates = days.map((e) => e.date).sort().reverse();
    assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.dataset.date)), dates);
    assert.deepEqual(await page.getByTestId("archive-day").evaluateAll((els) => els.map((e) => e.dataset.date)), dates);
    for (const id of ["archive-blitz-row", "archive-blitz-none", "archive-col-list", "archive-col-blitz"]) {
      assert.equal(await page.getByTestId(id).count(), 0, id);
    }
    assert.equal(await page.getByTestId("archive-day").locator("a").count(), dates.length, "one link a day");
    for (const e of days) {
      const row = page.locator(`[data-testid="archive-row"][data-date="${e.date}"]`);
      assert.equal(await row.getAttribute("href"), `#daily-${e.date}`);
      assert.ok((await row.textContent()).includes(title(e.id)));
    }
    // The rows line up in one column, and nothing scrolls sideways.
    const xs = await rows.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
    assert.equal(new Set(xs).size, 1, `the rows start at ${[...new Set(xs)].join(", ")}`);
    assert.ok(await noHScroll(page));
    await ctx.close();
  });
}

test("free Blitz never lands on today's list or a future day's; the days' Blitz lists are free play", async () => {
  const { ctx, page } = await open(browser, VIEWPORTS[0], "", SEED, at);
  await page.getByTestId("random-blitz").waitFor();
  const days = await schedule(page);
  const index = await indexOf(page);
  const entry = days.find((e) => e.date === DAY);
  const future = days.filter((e) => e.date > DAY).map((e) => e.id);
  // New lists (`debut`) wait out of random play until their first day as Today's list has run, or (named as a day's
  // Blitz) until that day.
  const out = new Set(days.flatMap((e) => [...(e.date < DAY ? [e.id] : []), ...(e.blitz && e.date <= DAY ? [e.blitz] : [])]));
  const debuts = index.filter((m) => m.debut && !out.has(m.id)).map((m) => m.id);
  const held = new Set([entry.id, ...future, ...debuts]);
  const openCount = () => index.filter((m) => m.blitz && !held.has(m.id)).length;
  const blitzCount = async () => parseInt(await page.getByTestId("random-blitz-status").textContent(), 10);
  assert.equal(await blitzCount(), openCount());

  // A link straight to today's list or a future one is closed; today's points to its daily.
  const closed = async (id) => {
    await go(page, `#blitz-${id}`);
    await page.getByTestId("blitz-closed").waitFor();
  };
  await closed(entry.id);
  assert.equal(await page.getByTestId("blitz-closed-go").getAttribute("href"), `#daily-${DAY}`);
  await closed(future.find((id) => index.find((m) => m.id === id)?.blitz));
  // The day's Blitz list, and a later day's, open as free rounds.
  const laterBlitz = days.find((e) => e.date > DAY && e.blitz && !held.has(e.blitz)).blitz;
  for (const id of [entry.blitz, laterBlitz]) {
    await go(page, `#blitz-${id}`);
    await page.getByTestId("blitz-clock").waitFor();
    assert.equal(await page.getByTestId("blitz-screen").getAttribute("data-list"), id);
  }

  // Random Blitz rolls stay clear of the held ones.
  for (let i = 0; i < 6; i++) {
    await go(page, "");
    await page.getByTestId("random-blitz").click();
    await page.getByTestId("blitz-clock").waitFor();
    const id = await page.getByTestId("blitz-screen").getAttribute("data-list");
    assert.ok(!held.has(id), `rolled ${id}`);
  }

  // Today's list finished: its results offer no Blitz (owner, Nov 14), and Home keeps its focus on Today's list.
  await go(page, `#daily-${DAY}`);
  await giveUp(page);
  assert.equal(await page.getByTestId("results-daily-blitz").count(), 0);
  assert.equal(await page.getByTestId("blitz-key").count(), 0);
  await go(page, "");
  await page.getByTestId("today-list").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "today-list");

  // Played: rolls still skip today's list for the rest of the day (its answers were just shown), but its own Blitz
  // opens.
  assert.equal(await blitzCount(), openCount());
  await go(page, `#blitz-${entry.id}`);
  await page.getByTestId("blitz-clock").waitFor();
  await ctx.close();
});

test("an old link to a date with no Blitz list goes home", async () => {
  const NONE = "2026-10-25";
  const { ctx, page } = await open(browser, VIEWPORTS[0], `#dailyblitz-${NONE}`, SEED, {
    ...at,
    // No list can be a Blitz, and NONE has no pick of its own.
    setup: async (c) => {
      await c.route("**/puzzles/index.json", async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, json: (await res.json()).map((m) => ({ ...m, blitz: false })) });
      });
      await c.route("**/puzzles/daily.json", async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, json: (await res.json()).map(({ blitz, ...e }) => (e.date === NONE ? e : { ...e, blitz })) });
      });
    },
  });
  await page.getByTestId("today-list").waitFor();
  assert.equal(await hash(page), "");
  await ctx.close();
});

test("a Blitz on today's unfinished list stays closed until that list is done, from an old link too", async () => {
  // Not in the schedule, but still guarded: serve DAY with its own list as its Blitz.
  let id;
  const { ctx, page } = await open(browser, VIEWPORTS[0], `#dailyblitz-${DAY}`, SEED, {
    ...at,
    setup: (c) =>
      c.route("**/puzzles/daily.json", async (route) => {
        const res = await route.fetch();
        const days = (await res.json()).map((e) => (e.date === DAY ? ((id = e.id), { ...e, blitz: e.id }) : e));
        await route.fulfill({ response: res, json: days });
      }),
  });
  await page.getByTestId("blitz-closed").waitFor();
  assert.equal(await hash(page), `#blitz-${id}`);
  assert.equal(await page.getByLabel("Your guess").count(), 0, "nothing of the list shows");
  assert.equal(await page.getByTestId("blitz-closed-go").getAttribute("href"), `#daily-${DAY}`);

  // Once the daily is done, the same link opens a round.
  await page.getByTestId("blitz-closed-go").click();
  await giveUp(page);
  await go(page, `#dailyblitz-${DAY}`);
  await page.getByTestId("blitz-clock").waitFor();
  assert.equal(await page.getByTestId("blitz-screen").getAttribute("data-list"), id);
  assert.equal(await hash(page), `#blitz-${id}`);
  await ctx.close();
});
