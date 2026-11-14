// Today's Fathom (owner, Nov 14: "make fathom also daily like the lists ... and remove the unlimited fathom play for
// now- keep access to it via a hidden url"), on the fixture bank and a fixture schedule (e2e/fixtures/fathom/daily.json:
// Fathom #1 on the 28th of October, #2 on the 29th, the e2e clock's today):
// - Home's Today panel: Today's Fathom under Today's list, as wide, as tall as a free-play key, its state and no
//   description (new, playing, then the total), nothing of Fathom left in Free play; the panel's countdown says
//   "new in", for both. Hover and focus move nothing. The menu's Play group: a Today's Fathom tile with the same state.
// - The day's five: the schedule's, in its order, "Fathom #2" in the header. A day the schedule doesn't cover is seeded
//   by its date (the same five in any browser), numbered from day one; yesterday's unfinished game doesn't carry over.
// - One try: a game under way resumes where it was; a finished day reopens on its results (a reload, Home's key, the
//   menu's tile), with no key for new questions and the time to the next one; a day played on another device (the
//   synced save) opens on its results too. The share text: "Fathom #2 <total>/500", the squares, the link to #fathom.
//   Past runs tags the day's game "Fathom #2".
// - The running score in the question card (owner, Nov 14): the total out of 500 and a pixel track filled in the
//   bands' colours, counting up on each reveal (not with reduced motion); it never moves or resizes anything (320,
//   390, 1440).
// - The day's results: where the total stands among the day's players, the list results' histogram in 50 bins of 10
//   points (the player's bin lit), "you did better than X% of players today", never "estimated"; no crowd on endless
//   Fathom's results or on a past game.
// - Endless Fathom at #fathom-endless still plays (New questions, no number), and nothing links to it.
// The day's total sent once to the backend, and real players in the histogram: backend.e2e.cjs.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, VIEWPORTS, TODAY, FRESH, open, go, hash, store, noHScroll } = require("./helpers.cjs");
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

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const box = (page, id) => page.getByTestId(id).boundingBox();
const round = (b) => b && Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v)]));
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
  for (let i = from; i < 5; i++) {
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
      assert.equal(lines[0], `Fathom #${DAY.n} ${total}/500  `);
      assert.match(lines[1], /^(\p{Extended_Pictographic}️? ){4}\p{Extended_Pictographic}️? {2}$/u);
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
    assert.equal((await page.getByTestId("today-fathom-status").textContent()).trim(), `${total}/500`);
    assert.equal(await page.getByTestId("today-fathom").getAttribute("data-done"), "true");
    await page.getByTestId("today-fathom").click();
    await page.getByTestId("fathom-results").waitFor();
    assert.equal(await page.getByTestId("fathom-input").count(), 0);
    await page.getByTestId("menu-key").click();
    assert.equal((await page.getByTestId("menu-today-fathom-status").textContent()).trim(), `${total}/500`);
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

test("a day the schedule doesn't cover: seeded by its date, the same five in any browser, numbered from day one", async () => {
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
    assert.equal(new Set(local.ids).size, 5);
    assert.ok(BANK.get(local.ids[0]).easy, "an easy opener");
    assert.equal(await questionId(page), local.ids[0]);
    drawn.push(local.ids);
    await ctx.close();
  }
  assert.deepEqual(drawn[0], drawn[1], "the same five for everyone");
});

test("a day played on another device (the synced save) opens on its results", async () => {
  const startedAt = Date.parse("2026-10-29T08:00:00-04:00");
  const run = { startedAt, finishedAt: startedAt + 120_000, ids: DAY.ids, guesses: [8, 54, 193, 86400, 88], points: [100, 90, 80, 70, 60], daily: { date: TODAY, n: DAY.n } };
  const seed = { ...FRESH, fathom: { runs: [run], totals: { [startedAt]: 400 }, recent: [] } };
  const { ctx, page } = await open(browser, phone, "", seed, { setup: setup(), reducedMotion: "reduce" });
  assert.equal((await page.getByTestId("today-fathom-status").textContent()).trim(), "400/500");
  await page.getByTestId("today-fathom").click();
  await page.getByTestId("fathom-results").waitFor();
  assert.equal(await page.getByTestId("fathom-total").getAttribute("data-total"), "400");
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
    assert.equal(await bar.getAttribute("data-total"), "0");
    assert.equal(await bar.locator(".tally-fill").count(), 0);
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
          bar: at('[data-testid="fathom-score"]'),
          track: at(".tally-track"),
          sum: at(".tally-sum"),
          title: at('[data-testid="fathom-question"] h1').y,
        };
      });
    const rest = await parts();
    assert.ok(rest.bar.height <= 20, `quiet: ${rest.bar.height}px tall`);
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      await lockIn(page);
      const points = Number(await page.getByTestId("fathom-reveal").getAttribute("data-points"));
      sum += points;
      assert.equal(Number(await bar.getAttribute("data-total")), sum, `after reveal ${i + 1}`);
      assert.equal((await bar.locator(".tally-n").textContent()).trim(), String(sum));
      const fills = bar.locator(".tally-fill");
      assert.equal(await fills.count(), i + 1);
      assert.equal(await fills.nth(i).getAttribute("data-band"), await page.getByTestId("fathom-reveal").getAttribute("data-band"));
      // The newest stretch is its points' share of 500.
      const [fill, track] = [await fills.nth(i).boundingBox(), rest.track];
      assert.ok(Math.abs(fill.width - (track.width * points) / 500) <= 1.5, `stretch ${i + 1}: ${fill.width}px for ${points} points`);
      assert.deepEqual(await parts(), rest, `the reveal moved something (${i + 1})`);
      await page.getByTestId("fathom-next").click();
      await page.getByTestId("fathom-input").waitFor();
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
  test(`the day's results: where the total stands among the day's players, a 50-bin histogram, no estimate (${name})`, async () => {
    // The day's game on its last reveal.
    const game = { day: { date: TODAY, n: DAY.n }, ids: DAY.ids, guesses: DAY.ids.map((id) => BANK.get(id).answer * 1.5), at: 4, startedAt: Date.parse("2026-10-29T09:00:00-04:00") };
    const { ctx, page } = await open(browser, vp, "#fathom", undefined, { setup: setup({ [DAILY_KEY]: game }), reducedMotion: "reduce" });
    await page.getByTestId("fathom-next").click();
    await page.getByTestId("fathom-results").waitFor();
    const total = Number(await page.getByTestId("fathom-total").getAttribute("data-total"));
    const crowd = page.getByTestId("fathom-crowd");
    await crowd.waitFor();
    const hist = crowd.getByTestId("histogram");
    assert.equal(await hist.getAttribute("data-bins"), "50");
    assert.equal(await hist.locator("[data-score]").count(), 50);
    assert.equal(await hist.locator("[data-you]").getAttribute("data-score"), String(Math.min(49, Math.floor(total / 10))));
    assert.equal(await hist.locator("[data-par]").count(), 1, "the average's caret");
    assert.equal(await hist.locator(".histo-axis").textContent(), "0500");
    const p = await crowd.getAttribute("data-p");
    assert.equal(await crowd.getByTestId("fathom-crowd-line").textContent(), `you did better than ${p}% of players today`);
    assert.ok(Number(p) >= 0 && Number(p) <= 99);
    // The simulated crowd alone (no backend): real players none, and nothing says estimated.
    assert.equal(await crowd.getAttribute("data-n"), "0");
    assert.doesNotMatch(await page.locator("main").innerText(), /estimat/i);
    // The bars stay inside the panel, the average beside them on one line.
    const [panel, bars] = [await page.getByTestId("fathom-results").boundingBox(), await hist.locator(".histo-bars").boundingBox()];
    assert.ok(bars.x >= panel.x && bars.x + bars.width <= panel.x + panel.width, "the histogram inside the panel");
    const [stat, histBox] = [await crowd.locator(".par-stat").boundingBox(), await hist.boundingBox()];
    assert.ok(stat.x + stat.width <= histBox.x, "the average beside the histogram");
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
  for (let i = 0; i < 5; i++) {
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
