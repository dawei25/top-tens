// Nothing moves on hover, focus or press (docs/UX.md, principle 11): those states may change color, background,
// shadow, opacity, outline and transform only, never the size or position of anything on the page.
//
// One player's walk through the screens (home, its How to play and category picker, a list game with its clue
// confirm, the list's end with and without its facts open, a Blitz round and its end, home with both dailies played,
// the archive, past runs, stats) at three widths: desktop, a mid width just above the 640px breakpoint, and a phone.
// On each screen every visible enabled interactive element is hovered (not on the phone), pressed (pointer down, then
// moved away and released outside, so no click fires) and focused from the keyboard (Tab through the page, so
// focus-visible and keyboard-modality styles apply), and every element's layout box is compared with the screen at
// rest (e2e/states-lib.cjs). Two of each kind of element are checked (two of the nine empty rows, say);
// STATES_ALL=1 npm run e2e -- states checks every one. Real puzzle data: a screen is only ever compared with itself.
// The static half of the rule is npm run lint:css (e2e/css-states.mjs).
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, open, go, puzzle, guess, freeze, giveUp } = require("./helpers.cjs");
const { checkScreen, formatFailures } = require("./states-lib.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const WIDTHS = [
  { name: "desktop", hover: true, viewport: { width: 1440, height: 900 } },
  { name: "mid", hover: true, viewport: { width: 700, height: 900 } },
  { name: "phone", hover: false, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
const LIST = "mountains";
const BLITZ = "airports";

/** Lets the frozen clock run its pending timers (a name typing in, the end reveal), then freezes it again. */
const tick = (page, ms = 3000) => page.clock.runFor(ms);
const row = (page, rank) => page.locator(`[data-testid="slot"][data-rank="${rank}"]`);

/** In walking order: each screen starts where the one before left off. */
const SCREENS = [
  { name: "home", setup: (page) => page.getByTestId("today-list").waitFor() },
  {
    name: "home, how to play open",
    scope: ".howto",
    setup: async (page) => {
      await page.getByTestId("help-open").click();
      await page.getByTestId("help-close").waitFor();
    },
  },
  {
    name: "home, category picker open",
    scope: "#list-categories",
    keepFocus: true,
    setup: async (page) => {
      await page.getByTestId("help-close").click();
      await page.getByTestId("random-list-categories").click();
      await page.getByTestId("category").first().waitFor();
    },
  },
  {
    name: "list game",
    setup: async (page) => {
      await go(page, `#p-${LIST}`);
      await page.getByLabel("Your guess").waitFor();
      const p = await puzzle(page, LIST);
      await guess(page, p.answers[0].name);
      await guess(page, p.answers[3].name);
      await guess(page, p.extras.find((e) => e.rank > 10).name);
      await row(page, 6).getByTestId("hint-open").click();
      await page.getByTestId("hint-yes").click();
      await tick(page);
    },
  },
  {
    // Unscoped: a press anywhere must leave the confirm (and the board under it) where it is.
    name: "list game, clue confirm open",
    setup: async (page) => {
      await row(page, 8).getByTestId("hint-open").click();
      await page.getByTestId("hint-yes").waitFor();
    },
  },
  {
    name: "list game over",
    setup: async (page) => {
      // Escape closes the clue confirm (if it's still open; without it, Escape would mean Back).
      if (await page.getByTestId("hint-yes").count()) await page.keyboard.press("Escape");
      await giveUp(page);
      await tick(page);
    },
  },
  {
    name: "list game over, facts open",
    setup: async (page) => {
      await page.getByTestId("facts-toggle").click();
      await page.locator(".slot.fact-open").first().waitFor();
    },
  },
  {
    name: "Blitz",
    setup: async (page) => {
      await go(page, `#blitz-${BLITZ}`);
      await page.getByLabel("Your guess").waitFor();
      const p = await puzzle(page, BLITZ);
      await guess(page, p.answers[1].name);
      await guess(page, p.answers[4].name);
      await page.getByTestId("blitz-hit").nth(1).waitFor();
      await tick(page, 1000);
    },
  },
  {
    name: "Blitz over, past runs open",
    setup: async (page) => {
      await page.clock.fastForward(91_000);
      await page.getByTestId("blitz-results").waitFor();
      await page.getByTestId("past-runs-toggle").click();
      await page.getByTestId("past-run").first().waitFor();
      await tick(page);
    },
  },
  {
    name: "home, today's list and Blitz played",
    setup: async (page) => {
      await go(page, "");
      await page.getByTestId("today-list").click();
      await giveUp(page);
      await go(page, "");
      await page.getByTestId("today-blitz").click();
      const screen = page.getByTestId("blitz-screen");
      await screen.waitFor();
      const p = await puzzle(page, await screen.getAttribute("data-list"));
      await guess(page, p.answers[0].name);
      await page.clock.fastForward(91_000);
      await page.getByTestId("blitz-results").waitFor();
      await go(page, "");
      await page.getByTestId("streak-tip").waitFor();
      await tick(page);
    },
  },
  {
    name: "archive",
    setup: async (page) => {
      await go(page, "#archive");
      await page.getByTestId("archive-row").first().waitFor();
    },
  },
  {
    name: "past runs",
    setup: async (page) => {
      await go(page, "#history");
      await page.getByTestId("history-row").first().waitFor();
    },
  },
  {
    name: "stats",
    setup: async (page) => {
      await go(page, "#stats");
      await page.getByTestId("know-category").first().waitFor();
    },
  },
];

// The widths run side by side, each in its own browser context.
describe("interaction states", { concurrency: true }, () => {
  for (const width of WIDTHS) {
    test(`nothing moves on hover, focus or press (${width.name}, ${width.viewport.width}px)`, async () => {
      const started = Date.now();
      const { ctx, page } = await open(browser, width);
      // A frozen clock: nothing ticks (countdowns, the Blitz clock, the ocean) between a screen at rest and its states.
      await freeze(page);
      const failures = [];
      const summary = [];
      for (const screen of SCREENS) {
        const t = Date.now();
        await screen.setup(page);
        const r = await checkScreen(page, screen, { hover: width.hover });
        failures.push(...r.failures);
        const c = r.counts;
        summary.push(
          `${screen.name}: ${width.hover ? `${c.hover} hovered, ` : ""}${c.press} pressed, ${c.focus} focused` +
            (c.same ? ` (+${c.same} more of the same kinds)` : "") +
            (c.covered.length ? ` (${c.covered.length} covered, not hovered: ${c.covered.join(", ")})` : "") +
            ` [${((Date.now() - t) / 1000).toFixed(1)} s]` +
            (r.failures.length ? `: ${r.failures.length} FAILED` : ""),
        );
      }
      await ctx.close();
      console.log(
        `states @ ${width.viewport.width}px (${((Date.now() - started) / 1000).toFixed(1)} s)\n` +
          summary.map((l) => `  ${l}`).join("\n"),
      );
      assert.equal(failures.length, 0, `\n${formatFailures(width.viewport.width, failures)}\n`);
    });
  }
});
