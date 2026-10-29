// Shared setup for the e2e specs. Specs select by data-testid and aria labels only, never by visible text.
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  throw new Error("e2e needs the playwright package (pre-installed in this container; NODE_PATH must reach it)");
}

const URL = process.env.E2E_URL || "http://localhost:5101/";
const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
/** A fixed "now": the 29th of October 2026, midday in New York, so today's daily and Blitz are known. */
const NOW = new Date("2026-10-29T12:00:00-04:00");
const TODAY = "2026-10-29";
const FRESH = { games: {}, daily: {}, seenHelp: true };

/** A new tab at `hash` with the fake clock installed and storage seeded once (reloads keep their progress). */
async function open(browser, vp, hash = "", seed = FRESH) {
  const ctx = await browser.newContext({
    viewport: vp.viewport,
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.hasTouch,
    timezoneId: "America/New_York",
  });
  // Seed once per context (a flag in localStorage, so reloads and second tabs keep the progress).
  await ctx.addInitScript((s) => {
    if (localStorage.getItem("e2e-seeded")) return;
    localStorage.setItem("top-tens:v1", JSON.stringify(s));
    localStorage.setItem("e2e-seeded", "1");
  }, seed);
  const page = await ctx.newPage();
  await page.clock.install({ time: NOW });
  await page.goto(URL + hash);
  return { ctx, page };
}

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

module.exports = { chromium, VIEWPORTS, NOW, TODAY, open, openTab, hash, puzzle, todaysDaily, store, noHScroll, guess };
