// Today's Fathom (owner, Nov 14: "make fathom also daily like the lists ... and remove the unlimited fathom play for
// now- keep access to it via a hidden url", then "add a timer per question (maybe like 20s) ... and change it to 10
// questions"), on the fixture bank and a fixture schedule (e2e/fixtures/fathom/daily.json: Fathom #1 on the 28th of
// October, #2 on the 29th, the e2e clock's today):
// - Home's Today panel: Today's Fathom under Today's list, as wide, as tall as a free-play key, its state and no
//   description (new, playing, then the total), nothing of Fathom left in Free play; the panel's countdown says
//   "new in", for both. Hover and focus move nothing. The menu's Play group: a Today's Fathom tile with the same state.
// - The day's ten: the schedule's, in its order, "Fathom #2" in the header. A day the schedule doesn't cover is seeded
//   by its date (the same ten in any browser), numbered from day one; yesterday's unfinished game doesn't carry over.
// - One try: a game under way resumes where it was; a finished day reopens on its results (a reload, Home's key, the
//   menu's tile), with no key for new questions and the time to the next one; a day played on another device (the
//   synced save) opens on its results too. The share text: "Fathom #2 <total>/1000", ten squares, the link to #fathom.
//   Past runs tags the day's game "Fathom #2".
// - The running score in the question card (owner, Nov 14): the total out of 1000 and ten pixel cells, one a question,
//   filled in the bands' colours, counting up on each reveal (not with reduced motion); it never moves or resizes
//   anything (320, 390, 1440).
// - The clock: 0:20 a question, pink for the last five seconds, paused while the tab is hidden, kept through a reload;
//   at 0 a guess that reads locks in, nothing typed scores 0 and the reveal says Time's up with the answer and the
//   fact; the reveal has no clock, and nothing moves as it ticks.
// - The day's results: where the total stands among the day's players, the players' curve over 0 to 1000 (the
//   player's marker at their total), "you did better than X% of players today", never "estimated"; no crowd on
//   endless Fathom's results or on a past game.
// - Endless Fathom at #fathom-endless still plays (New questions, no number), and nothing links to it.
// The day's total sent once to the backend, and real players in the curve: backend.e2e.cjs.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, VIEWPORTS, TODAY, FRESH, open, go, hash, store, noHScroll, freeze } = require("./helpers.cjs");
const { textLines } = require("./fathom-lib.cjs");

const FIXTURES = path.join(__dirname, "fixtures", "fathom");
const BANK = new Map(JSON.parse(fs.readFileSync(path.join(FIXTURES, "questions.json"), "utf8")).questions.map((q) => [q.id, q]));
const SCHEDULE = JSON.parse(fs.readFileSync(path.join(FIXTURES, "daily.json"), "utf8"));
const DAY = SCHEDULE.find((e) => e.date === TODAY);
const DAILY_KEY = "tentacle:fathom-daily";
const phone = VIEWPORTS.find((v) => v.name === "phone");
const desktop = VIEWPORTS.find((v) => v.name === "desktop");
const at = (width) => (width < 640 ? { viewport: { width, height: 800 }, isMobile: true, hasTouch: true } : { viewport: { width, height: 900 } });

/** The fixture bank and schedule in place of the real ones. */
const serve = async (ctx) => {
  await ctx.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill({ path: path.join(FIXTURES, "questions.json"), contentType: "application/json" }));
  await ctx.route(/\/fathom\/daily\.json(\?.*)?$/, (route) => route.fulfill({ path: path.join(FIXTURES, "daily.json"), contentType: "application/json" }));
};
/** Seeds localStorage keys once per context (reloads keep what the game wrote). */
const seedKeys = (items) => (ctx) =>
  ctx.addInitScript((entries) => {
    if (localStorage.getItem("e2e-keys-seeded")) return;
    for (const [k, v] of entries) localStorage.setItem(k, v);
    localStorage.setItem("e2e-keys-seeded", "1");
  }, Object.entries(items).map(([k, v]) => [k, JSON.stringify(v)]));
const setup = (items) => async (ctx) => {
  await serve(ctx);
  if (items) await seedKeys(items)(ctx);
};

/**
 * The curve has the player where it says: their marker (a pink square) in column `col`, sitting on the curve's top
 * there (or at the plot's edge), the brighter area ending in that column, and the line under the marker.
 */
async function curveMarked(curve, col) {
  const got = await curve.evaluate((el) => {
    const area = el.querySelector(".curve-area").getBoundingClientRect();
    const you = el.querySelector('[data-testid="curve-you"]').getBoundingClientRect();
    const below = el.querySelector('[data-testid="curve-below"]').getBBox();
    const line = el.querySelector(".curve-line").getBBox();
    return { area: { w: area.width, h: area.height }, you: { x: you.x - area.x, y: you.y - area.y, w: you.width, h: you.height }, below: below.x + below.width, line: line.x };
  });
  assert.ok(got.you.x >= 0 && got.you.x + got.you.w <= got.area.w, `the marker inside the curve: ${JSON.stringify(got)}`);
  assert.ok(got.you.y >= 0 && got.you.y + got.you.h <= got.area.h, `the marker inside the curve: ${JSON.stringify(got)}`);
  assert.ok(Math.abs(got.you.x + got.you.w / 2 - (col * 3 + 1)) <= 3, `the marker at column ${col}: ${JSON.stringify(got)}`);
  assert.equal(got.below, (col + 1) * 3, "the brighter area ends at the player");
  assert.equal(got.line, col * 3, "the line under the marker");
}

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const box = (page, id) => page.getByTestId(id).boundingBox();
const questionId = (page) => page.getByTestId("fathom-question").getAttribute("data-question");

/** Locks in a guess a little high on the question on screen and waits for its reveal. */
async function lockIn(page) {
  const field = page.getByTestId("fathom-input");
  await field.waitFor();
  const q = BANK.get(await questionId(page));
  await field.fill(String(q.answer * 1.3));
  await page.getByTestId("fathom-lock").click();
  await page.getByTestId("fathom-reveal").waitFor();
}

/** Plays the questions left on screen, checking each is the next of `ids`; returns the results' total. */
async function playOut(page, ids, from = 0) {
  for (let i = from; i < 10; i++) {
    await page.getByTestId("fathom-input").waitFor();
    assert.equal(await questionId(page), ids[i], `question ${i + 1} is the day's`);
    await lockIn(page);
    await page.getByTestId("fathom-next").click();
  }
  await page.getByTestId("fathom-results").waitFor();
  return Number(await page.getByTestId("fathom-total").getAttribute("data-total"));
}

for (const vp of VIEWPORTS) {
  test(`Home: Today's Fathom under Today's list, as tall as a free-play key, its state; the menu's tile (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "", undefined, { setup: setup(), reducedMotion: "reduce" });
    const key = page.getByTestId("today-fathom");
    await key.waitFor();
    // In the Today panel, under Today's list and as wide; nothing of Fathom left in Free play.
    assert.ok(await page.getByTestId("today-group").evaluate((el) => !!el.querySelector('[data-testid="today-fathom"]')));
    assert.equal(await page.getByTestId("free-play").locator(".mode-key.fathom, [data-testid='fathom-key']").count(), 0);
    const [list, fathom, random] = [await box(page, "today-list"), await box(page, "today-fathom"), await box(page, "random-list")];
    assert.ok(fathom.y >= list.y + list.height, "under Today's list");
    assert.equal(Math.round(fathom.x), Math.round(list.x));
    assert.equal(Math.round(fathom.width), Math.round(list.width));
    // As tall as Random list (no description line, no strip); Today's list stays the big key.
    assert.ok(Math.abs(fathom.height - random.height) <= 1, `as tall as a free-play key (${fathom.height} vs ${random.height})`);
    assert.ok(list.height > fathom.height, "Today's list keeps its big key");
    // Its state, on one line: new before it's played.
    assert.equal((await page.getByTestId("today-fathom-status").textContent()).trim(), "new");
    const line = await textLines(page.getByTestId("today-fathom-status"));
    assert.ok(line.lines === 1 && !line.cut);
    assert.match(await key.textContent(), /Today's Fathom/);
    assert.doesNotMatch(await page.locator("body").innerText(), /\bbeta\b/i);
    // The panel's countdown is for both of today's games.
    assert.match(await page.getByTestId("today-group").locator(".countdown").textContent(), /^new in \d\d:\d\d:\d\d$/);
    assert.ok(await noHScroll(page));
    // Hover and focus move nothing.
    const rest = await box(page, "today-fathom");
    if (vp.name === "desktop") await key.hover();
    await key.focus();
    assert.deepEqual(await box(page, "today-fathom"), rest);
    await key.click();
    await page.getByTestId("fathom-question").waitFor();
    assert.equal(await hash(page), "#fathom");

    // The menu's Play group: Today's Fathom in place of the endless tile, its state, marked while it's on show.
    await page.getByTestId("menu-key").click();
    const tile = page.getByTestId("menu-today-fathom");
    await tile.waitFor();
    assert.ok(await page.getByTestId("menu-play").evaluate((el) => !!el.querySelector('[data-testid="menu-today-fathom"]')));
    assert.equal(await page.getByTestId("menu-fathom").count(), 0, "no endless tile");
    assert.equal(await tile.locator("svg.menu-tile-icon").count(), 1);
    assert.equal((await page.getByTestId("menu-today-fathom-status").textContent()).trim(), "new");
    assert.deepEqual(await page.locator('[data-testid="menu"] [aria-current="page"]').evaluateAll((els) => els.map((e) => e.dataset.testid)), ["menu-today-fathom"]);
    // Nothing anywhere links to endless Fathom.
    assert.equal(await page.locator('a[href*="fathom-endless"]').count(), 0);
    assert.doesNotMatch(await page.locator("body").innerText(), /endless|\bbeta\b/i);
    await tile.click();
    await page.getByTestId("menu").waitFor({ state: "detached" });
    assert.equal(await hash(page), "#fathom");
    await ctx.close();
  });

  test(`the day's five from the schedule, Fathom #2; one try: it resumes, then reopens on its results (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "#fathom", undefined, { setup: setup(), reducedMotion: "reduce" });
    if (vp === desktop) await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByTestId("fathom-question").waitFor();
    const mode = page.getByTestId("fathom-mode");
    assert.equal(await mode.textContent(), `Fathom #${DAY.n}`);
    assert.equal(await mode.getAttribute("data-mode"), "daily");
    assert.equal(await questionId(page), DAY.ids[0]);

    // Under way: Home's key says so, and it and the menu's tile resume the game where it was.
    await lockIn(page);
    await page.getByTestId("nav-home").click();
    assert.equal((await page.getByTestId("today-fathom-status").textContent()).trim(), "playing");
    await page.getByTestId("today-fathom").click();
    await page.getByTestId("fathom-reveal").waitFor();
    assert.equal(await questionId(page), DAY.ids[0]);
    await page.reload();
    await page.getByTestId("fathom-reveal").waitFor();
    await page.getByTestId("fathom-next").click();
    await page.getByTestId("menu-key").click();
    assert.equal((await page.getByTestId("menu-today-fathom-status").textContent()).trim(), "playing");
    await page.getByTestId("menu-today-fathom").click();
    await page.getByTestId("menu").waitFor({ state: "detached" });
    const total = await playOut(page, DAY.ids, 1);

    // The results: no key for new questions, the time to the next Fathom.
    assert.equal(await page.getByTestId("fathom-again").count(), 0, "one try a day");
    assert.match(await page.getByTestId("fathom-results").locator(".countdown").textContent(), /^next Fathom in \d\d:\d\d:\d\d$/);
    if (vp === desktop) {
      await page.getByTestId("fathom-share").click();
      const lines = (await page.evaluate(() => navigator.clipboard.readText())).split("\n");
      assert.equal(lines.length, 3);
      assert.equal(lines[0], `Fathom #${DAY.n} ${total}/1000  `);
      assert.match(lines[1], /^(\p{Extended_Pictographic}️? ){9}\p{Extended_Pictographic}️? {2}$/u);
      assert.match(lines[2], /^https?:\/\/[^ ]+\/#fathom$/);
    }
    // Kept with its day: the run is tagged, and once only.
    const saved = await store(page);
    assert.equal(saved.fathom.runs.length, 1);
    assert.deepEqual(saved.fathom.runs[0].daily, { date: TODAY, n: DAY.n });
    assert.deepEqual(saved.fathom.runs[0].ids, DAY.ids);

    // A reload, Home's key and the menu's tile: the results again, never a new game.
    await page.reload();
    await page.getByTestId("fathom-results").waitFor();
    assert.equal(Number(await page.getByTestId("fathom-total").getAttribute("data-total")), total);
    await page.getByTestId("nav-home").click();
    assert.equal((await page.getByTestId("today-fathom-status").textContent()).trim(), `${total}/1000`);
    assert.equal(await page.getByTestId("today-fathom").getAttribute("data-done"), "true");
    await page.getByTestId("today-fathom").click();
    await page.getByTestId("fathom-results").waitFor();
    assert.equal(await page.getByTestId("fathom-input").count(), 0);
    await page.getByTestId("menu-key").click();
    assert.equal((await page.getByTestId("menu-today-fathom-status").textContent()).trim(), `${total}/1000`);
    await page.getByTestId("menu-today-fathom").click();
    await page.getByTestId("fathom-results").waitFor();
    assert.equal((await store(page)).fathom.runs.length, 1, "recorded once");

    // Past runs: tagged with the day's number; its row opens the game, whose key goes back to today's results.
    await go(page, "#history");
    const row = page.locator('[data-testid="history-row"][data-kind="fathom"]');
    await row.waitFor();
    assert.equal((await row.getByTestId("history-tag").textContent()).trim(), `Fathom #${DAY.n}`);
    await row.click();
    await page.getByTestId("fathom-results").waitFor();
    assert.equal(await page.getByTestId("fathom").getAttribute("data-phase"), "past");
    await page.getByTestId("fathom-again").click();
    await page.locator('[data-testid="fathom"][data-phase="results"]').waitFor();
    assert.equal(await hash(page), "#fathom");
    assert.ok(await noHScroll(page));
    await ctx.close();
  });
}

test("a day the schedule doesn't cover: seeded by its date, the same ten in any browser, numbered from day one", async () => {
  const now = new Date("2026-10-31T12:00:00-04:00");
  const drawn = [];
  for (let i = 0; i < 2; i++) {
    // The second browser has yesterday's game unfinished: it doesn't carry over.
    const yesterday = { day: { date: "2026-10-30", n: 3 }, ids: DAY.ids, guesses: [1], at: 1, startedAt: now.getTime() - 86_400_000 };
    const { ctx, page } = await open(browser, phone, "#fathom", undefined, { now, setup: setup(i ? { [DAILY_KEY]: yesterday } : undefined), reducedMotion: "reduce" });
    await page.getByTestId("fathom-input").waitFor();
    assert.equal(await page.getByTestId("fathom-mode").textContent(), "Fathom #4");
    const local = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), DAILY_KEY));
    assert.deepEqual(local.day, { date: "2026-10-31", n: 4 });
    assert.deepEqual(local.guesses, []);
    assert.equal(new Set(local.ids).size, 10);
    assert.ok(BANK.get(local.ids[0]).easy, "an easy opener");
    assert.equal(await questionId(page), local.ids[0]);
    drawn.push(local.ids);
    await ctx.close();
  }
  assert.deepEqual(drawn[0], drawn[1], "the same five for everyone");
});

test("a day played on another device (the synced save) opens on its results", async () => {
  const startedAt = Date.parse("2026-10-29T08:00:00-04:00");
  const points = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
  const run = { startedAt, finishedAt: startedAt + 120_000, ids: DAY.ids, guesses: DAY.ids.map(() => 1), points, daily: { date: TODAY, n: DAY.n } };
  const seed = { ...FRESH, fathom: { runs: [run], totals10: { [startedAt]: 550 }, recent: [] } };
  const { ctx, page } = await open(browser, phone, "", seed, { setup: setup(), reducedMotion: "reduce" });
  assert.equal((await page.getByTestId("today-fathom-status").textContent()).trim(), "550/1000");
  await page.getByTestId("today-fathom").click();
  await page.getByTestId("fathom-results").waitFor();
  assert.equal(await page.getByTestId("fathom-total").getAttribute("data-total"), "550");
  assert.equal(await page.getByTestId("fathom-again").count(), 0);
  assert.equal(await page.getByTestId("fathom-mode").textContent(), `Fathom #${DAY.n}`);
  // Its crowd too: it is today's.
  await page.getByTestId("fathom-crowd").waitFor();
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), DAILY_KEY), null, "no game started");
  await ctx.close();
});

// The owner, Nov 14: "add points to a visible counter with some sort of visual that lets u know ur current score some
// kind of bar at the top ... sleek and minimalistic".
for (const width of [320, 390, 1440]) {
  test(`the running score: the total and the track count each reveal, and nothing moves (${width})`, async () => {
    const { ctx, page } = await open(browser, at(width), "#fathom", undefined, { setup: setup(), reducedMotion: "reduce" });
    const bar = page.getByTestId("fathom-score");
    await bar.waitFor();
    // The clock ticks on its own here: stopped, so the parts are measured as they stand.
    await freeze(page);
    assert.equal(await bar.getAttribute("data-total"), "0");
    const cells = bar.getByTestId("fathom-cell");
    assert.equal(await cells.count(), 10);
    assert.equal(await bar.locator(".tally-fill").count(), 0);
    assert.equal(await cells.nth(0).getAttribute("data-now"), "true");
    // Where each part sits on the page (not in the viewport: a reveal may scroll to show itself).
    const parts = () =>
      page.evaluate(() => {
        const at = (sel) => {
          const r = document.querySelector(sel).getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) };
        };
        return {
          card: at('[data-testid="fathom-question"]').y,
          top: at(".fathom-q .prompt-top"),
          clock: at('[data-testid="fathom-clock"]'),
          bar: at('[data-testid="fathom-score"]'),
          track: at(".tally-track"),
          cells: [...document.querySelectorAll('[data-testid="fathom-cell"]')].map((c) => Math.round(c.getBoundingClientRect().width)),
          sum: at(".tally-sum"),
          title: at('[data-testid="fathom-question"] h1').y,
        };
      });
    const rest = await parts();
    assert.ok(rest.bar.height <= 20, `quiet: ${rest.bar.height}px tall`);
    assert.ok(rest.clock.x + rest.clock.width <= rest.top.x + rest.top.width + 0.5, "the clock inside the header");
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      // The clock ticking down moves nothing.
      await page.clock.runFor(3000);
      assert.deepEqual(await parts(), rest, `the clock moved something (${i + 1})`);
      await lockIn(page);
      const points = Number(await page.getByTestId("fathom-reveal").getAttribute("data-points"));
      sum += points;
      assert.equal(Number(await bar.getAttribute("data-total")), sum, `after reveal ${i + 1}`);
      assert.equal((await bar.locator(".tally-n").textContent()).trim(), String(sum));
      assert.equal(await bar.locator(".tally-fill").count(), i + 1);
      assert.equal(await cells.nth(i).getAttribute("data-band"), await page.getByTestId("fathom-reveal").getAttribute("data-band"));
      // The question's cell filled by its points' share of 100.
      const [fill, cell] = [await cells.nth(i).locator(".tally-fill").boundingBox(), await cells.nth(i).boundingBox()];
      assert.ok(Math.abs(fill.width - (cell.width * points) / 100) <= 1, `cell ${i + 1}: ${fill.width}px of ${cell.width} for ${points} points`);
      assert.deepEqual(await parts(), rest, `the reveal moved something (${i + 1})`);
      await page.getByTestId("fathom-next").click();
      await page.getByTestId("fathom-input").waitFor();
      assert.equal(await cells.nth(i + 1).getAttribute("data-now"), "true");
      assert.deepEqual(await parts(), rest, `the next question moved something (${i + 2})`);
    }
    // With reduced motion, nothing counts or grows.
    assert.equal(await bar.locator(".tally-n").evaluate((el) => getComputedStyle(el).animationName), "none");
    assert.ok(await noHScroll(page));
    await ctx.close();
  });
}

test("the running score counts up and the stretch grows in, with motion", async () => {
  const { ctx, page } = await open(browser, phone, "#fathom", undefined, { setup: setup() });
  const bar = page.getByTestId("fathom-score");
  await bar.waitFor();
  await lockIn(page);
  assert.equal(await bar.locator(".tally-n").evaluate((el) => getComputedStyle(el).animationName), "fathom-count");
  assert.equal(await bar.locator(".tally-fill[data-new]").evaluate((el) => getComputedStyle(el).animationName), "fathom-grow");
  await ctx.close();
});

for (const vp of [at(320), phone, desktop]) {
  const name = vp.name ?? `${vp.viewport.width}`;
  test(`the day's results: where the total stands among the day's players, on the players' curve, no estimate (${name})`, async () => {
    // The day's game on its last reveal.
    const game = { day: { date: TODAY, n: DAY.n }, ids: DAY.ids, guesses: DAY.ids.map((id) => BANK.get(id).answer * 1.5), at: 9, startedAt: Date.parse("2026-10-29T09:00:00-04:00") };
    const { ctx, page } = await open(browser, vp, "#fathom", undefined, { setup: setup({ [DAILY_KEY]: game }), reducedMotion: "reduce" });
    await page.getByTestId("fathom-next").click();
    await page.getByTestId("fathom-results").waitFor();
    const total = Number(await page.getByTestId("fathom-total").getAttribute("data-total"));
    const crowd = page.getByTestId("fathom-crowd");
    await crowd.waitFor();
    const hist = crowd.getByTestId("crowd-curve");
    const cols = Number(await hist.getAttribute("data-cols"));
    // The player's marker in the column of their total, on the curve, inside it.
    const col = Math.min(cols - 1, Math.floor((total / 1000) * cols));
    assert.equal(await hist.getByTestId("curve-you").getAttribute("data-col"), String(col));
    await curveMarked(hist, col);
    assert.equal(await hist.getByTestId("curve-avg").count(), 1, "the average's caret");
    assert.equal(await hist.locator(".histo-axis").textContent(), "01000");
    const p = await crowd.getAttribute("data-p");
    assert.equal(await crowd.getByTestId("fathom-crowd-line").textContent(), `you did better than ${p}% of players today`);
    assert.ok(Number(p) >= 0 && Number(p) <= 99);
    // The simulated crowd alone (no backend): real players none, and nothing says estimated.
    assert.equal(await crowd.getAttribute("data-n"), "0");
    assert.doesNotMatch(await page.locator("main").innerText(), /estimat/i);
    // The bars stay inside the panel, the average beside them on one line.
    const [panel, plot] = [await page.getByTestId("fathom-results").boundingBox(), await hist.locator(".curve-plot").boundingBox()];
    assert.ok(plot.x >= panel.x && plot.x + plot.width <= panel.x + panel.width, "the curve inside the panel");
    const [stat, histBox] = [await crowd.locator(".par-stat").boundingBox(), await hist.boundingBox()];
    assert.ok(stat.x + stat.width <= histBox.x, "the average beside the curve");
    assert.ok(await noHScroll(page));
    // A past game (Past runs) shows no crowd.
    const run = (await store(page)).fathom.runs[0];
    await go(page, `#fathom/run-${run.startedAt}`);
    await page.locator('[data-testid="fathom"][data-phase="past"]').waitFor();
    assert.equal(await page.getByTestId("fathom-crowd").count(), 0);
    await ctx.close();
  });
}

test("endless Fathom at its hidden address: New questions, no number, no crowd", async () => {
  const { ctx, page } = await open(browser, phone, "#fathom-endless", undefined, { setup: setup(), reducedMotion: "reduce" });
  await page.getByTestId("fathom-question").waitFor();
  assert.equal(await page.getByTestId("fathom-mode").textContent(), "Fathom");
  assert.equal(await page.getByTestId("fathom-mode").getAttribute("data-mode"), "endless");
  for (let i = 0; i < 10; i++) {
    await lockIn(page);
    await page.getByTestId("fathom-next").click();
  }
  await page.getByTestId("fathom-results").waitFor();
  assert.equal(await page.getByTestId("fathom-crowd").count(), 0);
  await page.getByTestId("fathom-again").click();
  await page.getByTestId("fathom-input").waitFor();
  // Its games stay out of Today's Fathom: the day is still new.
  const saved = await store(page);
  assert.equal(saved.fathom.runs.length, 1);
  assert.equal(saved.fathom.runs[0].daily, undefined);
  await page.getByTestId("nav-home").click();
  assert.equal((await page.getByTestId("today-fathom-status").textContent()).trim(), "new");
  await ctx.close();
});

// The owner, Nov 14: "add a timer per question (maybe like 20s)".
test("the clock: 20 seconds a question, pink at the end, paused while hidden, kept through a reload; at 0 a typed guess locks in, nothing typed is Time's up", async () => {
  const { ctx, page } = await open(browser, phone, "#fathom", undefined, { setup: setup(), reducedMotion: "reduce" });
  const clock = page.getByTestId("fathom-clock");
  await page.getByTestId("fathom-input").waitFor();
  await freeze(page);
  const left = async () => Number(await clock.getAttribute("data-left"));
  const start = await left();
  assert.ok(start >= 18 && start <= 20, `starts at 20: ${start}`);
  assert.match(await clock.textContent(), /^0:\d\d$/);
  // Quiet until the last five seconds, then pink.
  assert.equal(await clock.getAttribute("data-warn"), null);
  const quiet = await clock.evaluate((el) => getComputedStyle(el).color);
  await page.clock.runFor((start - 5) * 1000);
  assert.equal(await left(), 5);
  assert.equal(await clock.getAttribute("data-warn"), "true");
  await page.waitForFunction((q) => getComputedStyle(document.querySelector('[data-testid="fathom-clock"]')).color !== q, quiet, { timeout: 3000 });
  // Hidden (another tab, the phone locked): it waits.
  const hide = (hidden) =>
    page.evaluate((h) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await hide(true);
  await page.clock.runFor(10_000);
  assert.equal(await left(), 5, "paused while hidden");
  await hide(false);
  await page.clock.runFor(2000);
  assert.equal(await left(), 3);
  // A reload doesn't give it its time back (the page's clock running again while it loads).
  await page.clock.resume();
  await page.reload();
  await page.getByTestId("fathom-input").waitFor();
  await freeze(page);
  assert.ok((await left()) <= 4, `kept through a reload: ${await left()}`);
  // At 0 a guess that reads locks in, as LOCK IN would.
  const first = BANK.get(await questionId(page));
  await page.getByTestId("fathom-input").fill(String(first.answer));
  await page.clock.runFor(5000);
  await page.getByTestId("fathom-reveal").waitFor();
  assert.equal(await page.getByTestId("fathom-reveal").getAttribute("data-timeout"), null);
  assert.equal(Number(await page.getByTestId("fathom-guess").getAttribute("data-value")), first.answer);
  // The reveal has no clock (its place kept).
  assert.equal(await clock.isVisible(), false);
  // The next question starts at 20 again; nothing that reads at 0 is Time's up: 0 points, the answer and the fact.
  await page.getByTestId("fathom-next").click();
  await page.getByTestId("fathom-input").waitFor();
  assert.equal(await left(), 20);
  const second = BANK.get(await questionId(page));
  await page.getByTestId("fathom-input").fill("abc");
  await page.clock.runFor(21_000);
  const reveal = page.getByTestId("fathom-reveal");
  await reveal.waitFor();
  assert.equal(await reveal.getAttribute("data-timeout"), "true");
  assert.equal(await reveal.getAttribute("data-points"), "0");
  assert.equal(await page.getByTestId("fathom-band").textContent(), "Time's up");
  assert.equal(Number(await page.getByTestId("fathom-answer").getAttribute("data-value")), second.answer);
  if (second.fact) await page.getByTestId("fathom-fact").waitFor();
  assert.equal(await page.getByTestId("fathom-guess").count(), 0, "no guess to show");
  assert.equal(await page.getByTestId("fathom-cell").nth(1).getAttribute("data-band"), "lost");
  // Kept with the game: a reload shows it again.
  const local = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), DAILY_KEY));
  assert.deepEqual(local.timeouts, [second.id]);
  await page.clock.resume();
  await page.reload();
  await page.locator('[data-testid="fathom-reveal"][data-timeout="true"]').waitFor();
  await ctx.close();
});
