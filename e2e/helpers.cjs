// Shared setup for the e2e specs. Specs select by data-testid and aria labels only, never by visible text.
const fs = require("node:fs");
const path = require("node:path");
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  throw new Error("e2e needs the playwright package (pre-installed in this container; NODE_PATH must reach it)");
}

const URL = process.env.E2E_URL || "http://localhost:5101/";
const FONTS = path.join(__dirname, "fixtures", "fonts");

/**
 * The page's web font (VT323 from Google Fonts) served from e2e/fixtures/fonts: every spec renders the real font,
 * the same bytes each run, with or without the network. A file not there falls through to the network.
 */
async function offlineFonts(ctx) {
  await ctx.route(/^https:\/\/fonts\.googleapis\.com\/css2\?family=VT323/, (route) =>
    route.fulfill({ path: path.join(FONTS, "vt323.css"), contentType: "text/css", headers: { "access-control-allow-origin": "*" } }),
  );
  await ctx.route(/^https:\/\/fonts\.gstatic\.com\/s\/vt323\//, (route) => {
    const file = path.join(FONTS, path.basename(new globalThis.URL(route.request().url()).pathname));
    if (!fs.existsSync(file)) return route.continue();
    return route.fulfill({ path: file, contentType: "font/woff2", headers: { "access-control-allow-origin": "*" } });
  });
}
const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
/** A fixed "now": the 29th of October 2026, midday in New York, so today's daily and Blitz are known. */
const NOW = new Date("2026-10-29T12:00:00-04:00");
const TODAY = "2026-10-29";
const FRESH = { games: {}, daily: {}, seenHelp: true };

/**
 * A new tab at `hash` with the fake clock installed and storage seeded once (reloads keep their progress).
 * `opts.now` sets another date than NOW; `opts.setup(ctx)` runs before the page opens (to route files, say).
 */
async function open(browser, vp, hash = "", seed = FRESH, opts = {}) {
  const ctx = await browser.newContext({
    viewport: vp.viewport,
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.hasTouch,
    timezoneId: "America/New_York",
    ...(opts.reducedMotion && { reducedMotion: opts.reducedMotion }),
  });
  await offlineFonts(ctx);
  if (opts.setup) await opts.setup(ctx);
  // Seed once per context (a flag in localStorage, so reloads and second tabs keep the progress).
  await ctx.addInitScript((s) => {
    if (localStorage.getItem("e2e-seeded")) return;
    localStorage.setItem("top-tens:v1", JSON.stringify(s));
    localStorage.setItem("e2e-seeded", "1");
  }, seed);
  const page = await ctx.newPage();
  await page.clock.install({ time: opts.now ?? NOW });
  await page.goto(URL + hash);
  return { ctx, page };
}

/** Go to `hash` in the app (an in-app navigation, like following a link). */
const go = (page, h) => page.evaluate((x) => (location.hash = x), h);

/** A second tab in the same context (shares storage), for deep links with no in-app history. */
async function openTab(ctx, hash) {
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW });
  await page.goto(URL + hash);
  return page;
}

const hash = (page) => page.evaluate(() => location.hash);
const fetchJson = (page, path) => page.evaluate(async (p) => (await fetch(p)).json(), path);
const puzzle = (page, id) => fetchJson(page, `puzzles/${id}.json`);
const todaysDaily = async (page) => (await fetchJson(page, "puzzles/daily.json")).find((e) => e.date === TODAY);
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("top-tens:v1") || "{}"));
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function guess(page, text) {
  const box = page.getByLabel("Your guess");
  await box.fill(text);
  await box.press("Enter");
}

/**
 * Stops the page's clock (timers, Date, animation frames) at `at`, or a second from now (the clock keeps running
 * while the call travels): nothing ticks until a spec moves it on (clock.runFor, clock.fastForward).
 */
async function freeze(page, at) {
  await page.clock.pauseAt(at ?? (await page.evaluate(() => Date.now())) + 1000);
}

/** Gives up the list game on screen (GIVE UP, then SURE?) and waits for the results. */
async function giveUp(page) {
  await page.getByTestId("give-up").click();
  await page.getByTestId("give-up").click();
  await page.getByTestId("results").waitFor();
}

/**
 * Home's header keys over the logo (left group: the menu; right group: the account key, when the build has accounts,
 * and sound): for every key and every letter of the logo under it, how far the letter's ink starts below the key's
 * base (its 5px shadow counted). Each letter's ink is read from the font itself (canvas metrics) at its place in the
 * line, its 3px pink and cyan fringe included, so a tall "T" or "l" and a short "e" each count as drawn.
 * Returns [{ key, letter, gap }] for the letters under a key; the logo must be at rest (reduced motion).
 */
async function logoClearance(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const logo = document.querySelector(".home .logo");
    const s = getComputedStyle(logo);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${s.fontSize} ${s.fontFamily}`;
    const keys = [...document.querySelectorAll(".home-keys .key")].map((k) => ({ id: k.dataset.testid, r: k.getBoundingClientRect() }));
    const out = [];
    for (const span of logo.querySelectorAll("span")) {
      const text = span.firstChild;
      for (let i = 0; i < text.length; i++) {
        const range = document.createRange();
        range.setStart(text, i);
        range.setEnd(text, i + 1);
        // The letter's box runs from the font's ascent above its baseline; the ink starts lower, by the letter's own.
        const box = range.getBoundingClientRect();
        const m = ctx.measureText(text.data[i]);
        const top = box.top + m.fontBoundingBoxAscent - m.actualBoundingBoxAscent;
        const left = box.left - m.actualBoundingBoxLeft - 3;
        const right = box.left + m.actualBoundingBoxRight + 3;
        for (const k of keys) {
          if (k.r.right > left && k.r.left < right) out.push({ key: k.id, letter: text.data[i], gap: Math.round(top - (k.r.bottom + 5)) });
        }
      }
    }
    return out;
  });
}

module.exports = {
  chromium,
  offlineFonts,
  VIEWPORTS,
  NOW,
  TODAY,
  FRESH,
  open,
  openTab,
  go,
  hash,
  puzzle,
  todaysDaily,
  store,
  noHScroll,
  guess,
  freeze,
  giveUp,
  logoClearance,
};
