// Visual baselines: the key screens at phone 390 and desktop 1440, at rest, plus the Today key hovered on desktop and
// the menu open, compared pixel by pixel with the PNGs in e2e/baselines (docs/UX.md: "The visual baselines are the
// reference").
//
// Deterministic: puzzle data from e2e/fixtures/visual/puzzles (frozen copies, so a puzzle rebuild never moves a
// baseline: only UI changes do), the web font from e2e/fixtures/fonts, a frozen clock, reduced motion, animations
// finished and the caret hidden at capture, the mouse parked in a corner, the ocean (a random, animated canvas) hidden.
//
// On a mismatch the actual and diff images are written to a temp folder and their paths printed. After an intended
// change: UPDATE_BASELINES=1 npm run e2e -- visual, look at the new PNGs, commit them with the change.
// If the puzzle format changes, refresh the fixtures from public/puzzles (same file names) and re-baseline.
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PNG } = require("pngjs");
const { chromium, NOW, TODAY, open, go, guess, freeze, giveUp } = require("./helpers.cjs");

const BASELINES = path.join(__dirname, "baselines");
const FIXTURES = path.join(__dirname, "fixtures", "visual", "puzzles");
const FATHOM_BANK = path.join(__dirname, "fixtures", "fathom", "questions.json");
const UPDATE = !!process.env.UPDATE_BASELINES;
const LIST = "airports";
/** Per pixel: how different two colors must be to count (pixelmatch's perceptual threshold, 0 to 1). */
const THRESHOLD = 0.1;
/** At most this many differing pixels in any 16 x 16 square: scattered noise passes, a real change never does. */
const WINDOW = 16;
const MAX_IN_WINDOW = 8;

let browser;
let pixelmatch;
let outDir;
before(async () => {
  browser = await chromium.launch();
  ({ default: pixelmatch } = await import("pixelmatch"));
});
after(() => browser.close());

const puzzleJson = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));

/** Serves every puzzles/*.json from the fixtures (the junk-guess lexicon is left out); records any it doesn't have. */
function fixtures(missing) {
  return (ctx) =>
    ctx.route(/\/puzzles\/[^/]+\.json(\?.*)?$/, (route) => {
      const name = path.basename(new URL(route.request().url()).pathname);
      const file = path.join(FIXTURES, name);
      if (name !== "lexicon.json" && fs.existsSync(file)) return route.fulfill({ path: file, contentType: "application/json" });
      if (name !== "lexicon.json") missing.add(name);
      return route.fulfill({ status: 404, body: "" });
    });
}

/**
 * For the captures: the ocean hidden, and a whole page in one picture. A sticky box (the phone's guess dock, the wide
 * control column) is drawn in its own place in the page, where the end or the top of the scroll leaves it, instead of
 * over the board; the page's gradient runs down the whole page instead of stopping at the window's height.
 */
const CAPTURE = `
  [data-testid="ocean"] { visibility: hidden !important; }
  * { caret-color: transparent !important; }
  [data-visual-unstick] { position: relative !important; inset: auto !important; }
  html { background-attachment: scroll !important; }
`;

/** The screen as a player leaves it: mouse in a corner, scrolled to the top, fonts in, nothing pending. */
async function settle(page) {
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      if (getComputedStyle(el).position === "sticky") el.setAttribute("data-visual-unstick", "");
    }
    scrollTo(0, 0);
  });
  await page.evaluate(() => document.fonts.ready);
  assert.ok(await page.evaluate(() => document.fonts.check("22px VT323")), "VT323 is loaded");
  await page.clock.runFor(500);
}

function compare(name, actual) {
  const file = path.join(BASELINES, `${name}.png`);
  if (UPDATE) {
    fs.writeFileSync(file, actual);
    console.log(`visual: wrote e2e/baselines/${name}.png`);
    return null;
  }
  outDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "tentacle-visual-"));
  const keep = () => {
    const p = path.join(outDir, `${name}.actual.png`);
    fs.writeFileSync(p, actual);
    return p;
  };
  if (!fs.existsSync(file)) return `${name}: no baseline yet (actual: ${keep()}). Create it: UPDATE_BASELINES=1 npm run e2e -- visual`;
  const a = PNG.sync.read(fs.readFileSync(file));
  const b = PNG.sync.read(actual);
  if (a.width !== b.width || a.height !== b.height) {
    return `${name}: size ${a.width}x${a.height} -> ${b.width}x${b.height} (actual: ${keep()}, baseline: ${file})`;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const total = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: THRESHOLD });
  if (!total) return null;
  const dense = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: THRESHOLD, windowSize: WINDOW });
  if (dense <= MAX_IN_WINDOW) {
    console.log(`visual: ${name}: ${total} scattered pixels differ (at most ${dense} in a ${WINDOW}x${WINDOW} square): passes`);
    return null;
  }
  const diffPath = path.join(outDir, `${name}.diff.png`);
  fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return `${name}: ${total} pixels differ, up to ${dense} in one ${WINDOW}x${WINDOW} square (actual: ${keep()}, diff: ${diffPath}, baseline: ${file})`;
}

const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

describe("visual baselines", { concurrency: true }, () => {
  for (const vp of VIEWPORTS) {
    test(`the key screens look as they did (${vp.name})`, async () => {
      const missing = new Set();
      const { ctx, page } = await open(browser, vp, "", undefined, { reducedMotion: "reduce", setup: fixtures(missing) });
      await page.getByTestId("today-list").waitFor();
      // Frozen at a fixed moment, then the pending timers run, so the countdowns read the same every time.
      await freeze(page, NOW.getTime() + 30_000);
      await page.clock.runFor(2000);
      await page.addStyleTag({ content: CAPTURE });
      const problems = [];
      // The whole page, or (`window`) what the window shows: a panel fixed over the page (the menu).
      const shot = async (name, target = page, { window = false } = {}) => {
        if (target === page) await settle(page);
        const png = await target.screenshot({
          animations: "disabled",
          caret: "hide",
          scale: "css",
          ...(target === page && !window && { fullPage: true }),
        });
        const p = compare(`${name}-${vp.name}`, png);
        if (p) problems.push(p);
      };

      // Home, fresh.
      await shot("home");

      // Desktop: the Today key under the mouse (lift, glow, ENTER cap; nothing else moves).
      if (vp.name === "desktop") {
        await settle(page);
        const today = page.locator("section.home-group").first();
        const box = await page.getByTestId("today-list").boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await shot("today-list-hover", today);
        await page.mouse.move(0, 0);
      }

      // A list game in progress: two found, a miss that cost a life, a clue.
      const p = puzzleJson(LIST);
      await go(page, `#p-${LIST}`);
      await page.getByLabel("Your guess").waitFor();
      await guess(page, p.answers[0].name);
      await guess(page, p.answers[2].name);
      await guess(page, p.extras.find((e) => e.rank > 10).name);
      await page.locator('[data-testid="slot"][data-rank="5"]').getByTestId("hint-open").click();
      await page.getByTestId("hint-yes").click();
      await shot("list-playing");

      // Its end: the full board with a fact open (a tap on its row), and the results.
      await giveUp(page);
      await page.locator('[data-testid="slot"][data-rank="1"]').click();
      await page.locator(".slot.fact-open").first().waitFor();
      await shot("list-over");

      // A Blitz round on the same list, 15 seconds in.
      await go(page, `#blitz-${LIST}`);
      await page.getByLabel("Your guess").waitFor();
      await guess(page, p.answers[1].name);
      await guess(page, p.answers[4].name);
      await page.getByTestId("blitz-hit").nth(1).waitFor();
      await page.clock.runFor(15_000);
      await shot("blitz-playing");

      // Its end.
      await page.clock.fastForward(91_000);
      await page.getByTestId("blitz-results").waitFor();
      await shot("blitz-over");

      // Today's list played, then the archive.
      await go(page, "");
      await page.getByTestId("today-list").click();
      await giveUp(page);
      await go(page, "#archive");
      await page.getByTestId("archive-row").first().waitFor();
      await shot("archive");

      // Stats, with the two list games in.
      await go(page, "#stats");
      await page.getByTestId("know-category").first().waitFor();
      await shot("stats");

      // The menu open over it: today's list played, Stats marked as the screen on show.
      await page.getByTestId("menu-key").click();
      await page.getByTestId("menu").waitFor();
      await shot("menu", page, { window: true });

      await ctx.close();
      assert.deepEqual([...missing], [], "every puzzle file the flow loads has a fixture in e2e/fixtures/visual/puzzles");
      assert.equal(problems.length, 0, `\n${problems.join("\n")}\n`);
    });
  }

  // Today's Fathom (#fathom), on its fixture bank with a fixed day (Fathom #2, seeded as a game under way): a question
  // with a number typed (grouped with a comma) under the running score, a reveal (a close guess, the sonar), and the
  // results of ten set guesses with the day's players (the simulated crowd: no backend here).
  for (const vp of VIEWPORTS) {
    test(`Fathom looks as it did (${vp.name})`, async () => {
      const draw = ["eiffel-tower-height", "moon-distance", "piano-keys", "speed-of-light", "africa-countries", "octopus-hearts", "fat-calories", "un-members", "everest-height", "adult-bones"];
      const { ctx, page } = await open(browser, vp, "#fathom", undefined, {
        reducedMotion: "reduce",
        setup: async (c) => {
          await c.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill({ path: FATHOM_BANK, contentType: "application/json" }));
          await c.addInitScript((save) => {
            if (localStorage.getItem("e2e-fathom-seeded")) return;
            localStorage.setItem("tentacle:fathom-daily", save);
            localStorage.setItem("e2e-fathom-seeded", "1");
          }, JSON.stringify({ day: { date: TODAY, n: 2 }, ids: draw, guesses: [], at: 0, startedAt: NOW.getTime() }));
        },
      });
      await page.getByTestId("fathom-input").waitFor();
      // The question's clock from a known time: stopped, its time used set to a second, and the screen opened again, so
      // it reads 0:19 every run (how long the page took to load would show in it otherwise).
      await freeze(page);
      await page.evaluate((key) => localStorage.setItem("tentacle:fathom-clock", JSON.stringify({ key, used: 1000 })), `${NOW.getTime()}:0:${draw[0]}`);
      await go(page, "#");
      await page.getByTestId("today-list").waitFor();
      await go(page, "#fathom");
      for (let i = 0; i < 40 && !(await page.getByTestId("fathom-input").count()); i++) await page.clock.runFor(100);
      await page.getByTestId("fathom-input").waitFor();
      await page.addStyleTag({ content: CAPTURE });
      const problems = [];
      const shot = async (name) => {
        await settle(page);
        const png = await page.screenshot({ animations: "disabled", caret: "hide", scale: "css", fullPage: true });
        const p = compare(`${name}-${vp.name}`, png);
        if (p) problems.push(p);
      };

      await page.getByTestId("fathom-input").fill("2500");
      await shot("fathom-question");

      await page.getByTestId("fathom-input").fill("290");
      await page.getByTestId("fathom-lock").click();
      await page.getByTestId("fathom-reveal").waitFor();
      await page.clock.runFor(2000);
      await shot("fathom-reveal");

      for (const guess of ["400k", "60", "1m", "2000", "8", "9", "193", "8848", "206"]) {
        await page.getByTestId("fathom-next").click();
        await page.getByTestId("fathom-input").fill(guess);
        await page.getByTestId("fathom-lock").click();
        await page.getByTestId("fathom-reveal").waitFor();
      }
      await page.getByTestId("fathom-next").click();
      await page.getByTestId("fathom-results").waitFor();
      // The time to the next Fathom from a fixed time (the clock stopped a second after the question showed, which
      // varies), so its seconds are the same every run.
      await page.clock.setSystemTime(NOW.getTime() + 60_000);
      await page.clock.runFor(2000);
      await shot("fathom-results");

      await ctx.close();
      assert.equal(problems.length, 0, `\n${problems.join("\n")}\n`);
    });
  }
});
