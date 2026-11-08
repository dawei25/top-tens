// Today's list and Today's Blitz are separate topics: a day's Blitz is the list daily.json names in its `blitz`. The
// archive is a table, one row per date: its list and its Blitz side by side, under List and Blitz headers named once
// (one try each). Random rolls never land on today's list or Blitz, played or not, on a future day's list or Blitz,
// or on a new list waiting for its debut as a daily.
// The Blitz title card and a miss say what the list is made of (the puzzle's noun). The spoiler hold still guards a
// Blitz on its day's own list.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, go, hash, puzzle, store, noHScroll, guess } = require("./helpers.cjs");

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
  test(`Today's Blitz is its own list from the schedule (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "", SEED, at);
    await page.getByTestId("today-blitz").waitFor();
    const entry = (await schedule(page)).find((e) => e.date === DAY);
    assert.ok(entry.blitz && entry.blitz !== entry.id, "the schedule gives the day a Blitz on another list");

    await page.getByTestId("today-blitz").click();
    const screen = page.getByTestId("blitz-screen");
    await screen.waitFor();
    assert.equal(await hash(page), `#dailyblitz-${DAY}`);
    assert.equal(await screen.getAttribute("data-list"), entry.blitz);

    // The title card says what to name; a guess that isn't on the list says how many of what are.
    const p = await puzzle(page, entry.blitz);
    assert.ok(p.noun);
    assert.match(await page.getByTestId("blitz-rule").textContent(), new RegExp(`\\b${p.noun}\\b`));
    await guess(page, "Tchaikovsky");
    const miss = await page.getByTestId("feedback").textContent();
    assert.ok(miss.includes(`${p.answers.length + p.extras.length} ${p.noun}`), miss);

    // Another topic than today's list: the results show everything at once, with today's list still unplayed.
    await playRound(page, p.answers[0].name);
    assert.equal(await page.getByTestId("blitz-hit").count(), 1);
    assert.equal(await page.getByTestId("blitz-rest-hidden").count(), 0);
    assert.ok((await page.getByTestId("blitz-missed-row").count()) > 0);
    assert.ok(await noHScroll(page));
    assert.equal((await store(page)).blitzDaily[DAY].id, entry.blitz);
    await ctx.close();
  });

  test(`the archive shows each day's list and Blitz side by side (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "#archive", SEED, at);
    const listRows = page.getByTestId("archive-row");
    await listRows.first().waitFor();
    const days = (await schedule(page)).filter((e) => e.date <= DAY);
    const index = await indexOf(page);
    const title = (id) => index.find((m) => m.id === id).title;

    // One row per date, newest first: the list's cell, then that date's Blitz cell. No old sub-line.
    const order = await page
      .locator('[data-testid="archive-row"], [data-testid="archive-blitz-row"]')
      .evaluateAll((els) => els.map((e) => `${e.dataset.testid === "archive-row" ? "list" : "blitz"} ${e.dataset.date}`));
    const dates = days.map((e) => e.date).sort().reverse();
    assert.deepEqual(order, dates.flatMap((d) => [`list ${d}`, `blitz ${d}`]));
    assert.deepEqual(await page.getByTestId("archive-day").evaluateAll((els) => els.map((e) => e.dataset.date)), dates);
    assert.equal(await page.getByTestId("archive-blitz").count(), 0);
    const row = (date) => page.locator(`[data-testid="archive-row"][data-date="${date}"]`);
    const blitzRow = (date) => page.locator(`[data-testid="archive-blitz-row"][data-date="${date}"]`);

    // Two columns, each named once at the top: a day's Blitz sits beside its list, and every cell lines up under
    // its column's header (phones too).
    const head = { list: page.getByTestId("archive-col-list"), blitz: page.getByTestId("archive-col-blitz") };
    assert.equal(await head.list.count(), 1);
    assert.equal(await head.blitz.count(), 1);
    const [hl, hb] = [await head.list.boundingBox(), await head.blitz.boundingBox()];
    const [lb, bb] = [await row(DAY).boundingBox(), await blitzRow(DAY).boundingBox()];
    assert.ok(Math.abs(bb.y - lb.y) <= 1 && bb.x >= lb.x + lb.width, "the Blitz cell sits beside its list cell");
    assert.ok(hl.y + hl.height <= lb.y, "the headers sit above the first row");
    for (const d of dates) {
      const [l, b] = [await row(d).boundingBox(), await blitzRow(d).boundingBox()];
      assert.ok(Math.abs(l.x - hl.x) <= 1 && Math.abs(b.x - hb.x) <= 1, `${d}: the cells line up under List and Blitz`);
    }

    // Each Blitz cell is the schedule's pick, or the list that was played; it opens that date's Blitz.
    for (const e of days) {
      const b = blitzRow(e.date);
      const id = e.date === OLD.date ? OLD.blitz : e.blitz;
      assert.equal(await b.getAttribute("data-list"), id);
      assert.equal(await b.getAttribute("href"), `#dailyblitz-${e.date}`);
      assert.ok((await b.textContent()).includes(title(id)));
      assert.equal(await row(e.date).getAttribute("href"), `#daily-${e.date}`);
    }
    assert.equal(await blitzRow(OLD.date).getAttribute("data-score"), String(OLD.score));
    assert.equal(await blitzRow(DAY).getAttribute("data-score"), null);
    assert.ok(await noHScroll(page));

    // An old date's Blitz from its cell: one round, locked after, its score on the cell.
    const old = days.find((e) => e.date < DAY && e.date !== OLD.date);
    await blitzRow(old.date).click();
    await page.getByTestId("blitz-clock").waitFor();
    assert.equal(await hash(page), `#dailyblitz-${old.date}`);
    assert.equal(await page.getByTestId("blitz-screen").getAttribute("data-list"), old.blitz);
    await playRound(page);
    await page.getByTestId("nav-back").click();
    await blitzRow(old.date).waitFor();
    assert.equal(await blitzRow(old.date).getAttribute("data-score"), String((await store(page)).blitzDaily[old.date].score));
    await blitzRow(old.date).click();
    await page.getByTestId("blitz-results").waitFor();
    assert.equal(await page.getByTestId("blitz-results").getAttribute("data-locked"), "true");
    assert.equal(await page.getByLabel("Your guess").count(), 0);
    await ctx.close();
  });
}

test("free Blitz never lands on today's list or Blitz, or a future day's", async () => {
  const { ctx, page } = await open(browser, VIEWPORTS[0], "", SEED, at);
  await page.getByTestId("random-blitz").waitFor();
  const days = await schedule(page);
  const index = await indexOf(page);
  const entry = days.find((e) => e.date === DAY);
  const future = days.filter((e) => e.date > DAY).map((e) => e.id);
  const futureBlitz = days.filter((e) => e.date > DAY && e.blitz).map((e) => e.blitz);
  // New lists (`debut`) wait out of random play until their first day as a daily has run.
  const ran = new Set(days.filter((e) => e.date < DAY).flatMap((e) => [e.id, e.blitz]));
  const debuts = index.filter((m) => m.debut && !ran.has(m.id)).map((m) => m.id);
  const held = new Set([entry.id, ...future, ...futureBlitz, entry.blitz, ...debuts]);
  const openCount = (extra = held) => index.filter((m) => m.blitz && !extra.has(m.id)).length;
  const blitzCount = async () => parseInt(await page.getByTestId("random-blitz-status").textContent(), 10);
  assert.equal(await blitzCount(), openCount());

  // A link straight to any of them is closed; Today's Blitz points to its one round.
  const closed = async (id) => {
    await go(page, `#blitz-${id}`);
    await page.getByTestId("blitz-closed").waitFor();
  };
  await closed(entry.id);
  await closed(future.find((id) => index.find((m) => m.id === id)?.blitz));
  await closed(entry.blitz);
  assert.equal(await page.getByTestId("blitz-closed-go").getAttribute("href"), `#dailyblitz-${DAY}`);

  // Random Blitz rolls stay clear of them.
  for (let i = 0; i < 6; i++) {
    await go(page, "");
    await page.getByTestId("random-blitz").click();
    await page.getByTestId("blitz-clock").waitFor();
    const id = await page.getByTestId("blitz-screen").getAttribute("data-list");
    assert.ok(!held.has(id), `rolled ${id}`);
  }

  // Today's list finished: its results offer Today's Blitz (no Blitz key of its own), and Home moves on to it.
  await go(page, `#daily-${DAY}`);
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();
  await page.getByTestId("results").waitFor();
  assert.equal(await page.getByTestId("results-daily-blitz").count(), 1);
  assert.equal(await page.getByTestId("blitz-key").count(), 0);
  await go(page, "");
  await page.getByTestId("today-blitz").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "today-blitz");

  // Played: rolls still skip today's pair for the rest of the day (its answers were just shown), but a link to
  // Today's Blitz list opens a free round.
  await page.keyboard.press("Enter");
  await page.getByTestId("blitz-clock").waitFor();
  await playRound(page);
  await go(page, "");
  await page.getByTestId("random-blitz").waitFor();
  assert.equal(await blitzCount(), openCount());
  await go(page, `#blitz-${entry.blitz}`);
  await page.getByTestId("blitz-clock").waitFor();
  await ctx.close();
});

test("a date with no Blitz keeps its Blitz column, empty", async () => {
  const NONE = "2026-10-25";
  const { ctx, page } = await open(browser, VIEWPORTS[0], "#archive", SEED, {
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
  const cell = (id, date) => page.locator(`[data-testid="${id}"][data-date="${date}"]`);
  await cell("archive-row", NONE).waitFor();
  assert.equal(await cell("archive-blitz-row", NONE).count(), 0);
  assert.equal(await cell("archive-blitz-row", DAY).count(), 1);

  // Its Blitz cell is empty but holds the column: the same place and width as any Blitz cell, nothing to open, and
  // its list cell is as wide as any other.
  const none = cell("archive-blitz-none", NONE);
  assert.equal(await none.count(), 1);
  assert.equal(await none.getAttribute("href"), null);
  const [nb, bb] = [await none.boundingBox(), await cell("archive-blitz-row", DAY).boundingBox()];
  assert.ok(Math.abs(nb.x - bb.x) <= 1 && Math.abs(nb.width - bb.width) <= 1, "the empty cell sits in the Blitz column");
  const [nl, dl] = [await cell("archive-row", NONE).boundingBox(), await cell("archive-row", DAY).boundingBox()];
  assert.ok(Math.abs(nl.x - dl.x) <= 1 && Math.abs(nl.width - dl.width) <= 1, "its list cell lines up with the others");
  await ctx.close();
});

test("a Blitz on its day's own list holds the rest until that list is done", async () => {
  // Not in the schedule any more, but still guarded: serve DAY with its own list as its Blitz.
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
  await page.getByTestId("blitz-clock").waitFor();
  assert.equal(await page.getByTestId("blitz-screen").getAttribute("data-list"), id);
  await playRound(page, (await puzzle(page, id)).answers[0].name);
  assert.equal(await page.getByTestId("blitz-hit").count(), 1);
  assert.equal(await page.getByTestId("blitz-rest-hidden").count(), 1);
  assert.equal(await page.getByTestId("blitz-missed-row").count(), 0);

  // No list key there, not even to its daily: a Blitz never offers its own list (the owner, Nov 8). Once that daily is
  // done (from its address here), the locked round shows everything.
  assert.equal(await page.getByTestId("blitz-list").count(), 0);
  await go(page, `#daily-${DAY}`);
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();
  await page.getByTestId("results").waitFor();
  await go(page, `#dailyblitz-${DAY}`);
  await page.getByTestId("blitz-results").waitFor();
  assert.equal(await page.getByTestId("blitz-results").getAttribute("data-locked"), "true");
  assert.equal(await page.getByTestId("blitz-rest-hidden").count(), 0);
  assert.ok((await page.getByTestId("blitz-missed-row").count()) > 0);
  await ctx.close();
});
