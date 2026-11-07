// Nothing moves on hover, focus or press (docs/UX.md, principle 11): those states may change color, background,
// shadow, opacity, outline and transform only, never the size or position of anything on the page.
//
// One player's walk through the screens (home, its How to play and category picker, a rolled list before its first
// guess, a list game with its clue confirm, the list's end with and without its facts open and with the rating's
// reasons open, a rolled Blitz before its clock, a Blitz round and its end, home with both dailies played, the
// archive, past runs, stats, the menu open over it, settings, and the Fathom beta's question, reveal and results) at
// three widths: desktop, a mid width just above the 640px breakpoint, and a phone.
// On each screen every visible enabled interactive element is hovered (not on the phone), pressed (pointer down, then
// moved away and released outside, so no click fires) and focused from the keyboard (Tab through the page, so
// focus-visible and keyboard-modality styles apply), and every element's layout box is compared with the screen at
// rest (e2e/states-lib.cjs). Two of each kind of element are checked (two of the nine empty rows, say);
// STATES_ALL=1 npm run e2e -- states checks every one. Real puzzle data: a screen is only ever compared with itself.
// "add a note" and Home's account key (only in a build with a backend) get short walks of their own on the backend
// copy: the note's key and its box open with focus in it; the header's account and sound keys signed out with the
// create-account sheet, and signed in with the account sheet. The static half of the rule is npm run lint:css
// (e2e/css-states.mjs).
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, open, go, puzzle, guess, freeze, giveUp } = require("./helpers.cjs");
const { checkScreen, formatFailures } = require("./states-lib.cjs");
const { BACKEND_ENV } = require("./backend-env.cjs");
const { serveBuild, opener, FRESH: BACKEND_FRESH, SESSION } = require("./backend-lib.cjs");

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
const FATHOM_BANK = require("node:path").join(__dirname, "fixtures", "fathom", "questions.json");

/** Lets the frozen clock run its pending timers (a name typing in, the end reveal), then freezes it again. */
const tick = (page, ms = 3000) => page.clock.runFor(ms);
/** A sheet in its own chunk: once downloaded, React shows it on a timer, which the frozen clock holds; run it on. */
async function lazyShown(page, testId) {
  for (let i = 0; i < 40 && !(await page.getByTestId(testId).count()); i++) await tick(page, 250);
  await page.getByTestId(testId).waitFor();
}
const row = (page, rank) => page.locator(`[data-testid="slot"][data-rank="${rank}"]`);

/** In walking order: each screen starts where the one before left off. */
const SCREENS = [
  { name: "home", setup: (page) => page.getByTestId("today-list").waitFor() },
  {
    name: "home, how to play open",
    scope: ".howto",
    setup: async (page) => {
      await page.getByTestId("howto-key").click();
      await page.getByTestId("howto-close").waitFor();
    },
  },
  {
    name: "home, category picker open",
    scope: "#list-categories",
    keepFocus: true,
    setup: async (page) => {
      await page.getByTestId("howto-close").click();
      await page.getByTestId("random-list-categories").click();
      await page.getByTestId("category").first().waitFor();
    },
  },
  {
    // A Random list before its first guess: the roll box beside the guess panel. (The picker has closed: focus left it.)
    name: "rolled list, Roll new list",
    setup: async (page) => {
      await page.getByTestId("random-list").click();
      await page.getByTestId("reroll").waitFor();
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
    name: "list game over, a fact open",
    setup: async (page) => {
      await page.locator('[data-testid="slot"][data-rank="1"]').click();
      await page.locator(".slot.fact-open").first().waitFor();
    },
  },
  {
    // "Good list?": after a thumbs down the reasons float over the result card; nothing in or around them moves.
    name: "list game over, rating reasons open",
    scope: '[data-testid="rate-reasons"]',
    keepFocus: true,
    setup: async (page) => {
      await page.getByTestId("rate-down").click();
      await page.getByTestId("rate-reason").first().waitFor();
    },
  },
  {
    // A Random Blitz before its clock starts: the roll box beside the guess panel.
    name: "rolled Blitz, Roll new list",
    setup: async (page) => {
      await go(page, "");
      await page.getByTestId("random-blitz").click();
      await page.getByTestId("reroll").waitFor();
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
  {
    // The menu over the page: its tiles and close key; the page behind is measured too and must not move.
    name: "stats, menu open",
    scope: '[data-testid="menu"]',
    setup: async (page) => {
      await page.getByTestId("menu-key").click();
      await page.getByTestId("menu").waitFor();
      await tick(page);
    },
  },
  {
    name: "settings",
    setup: async (page) => {
      await page.keyboard.press("Escape");
      await page.getByTestId("menu").waitFor({ state: "detached" });
      await go(page, "#settings");
      await page.getByTestId("settings").waitFor();
    },
  },
  {
    // Fathom (beta, #fathom), on the fixture bank: a long number typed (grouped as it's typed), its reveal, then the
    // results.
    name: "Fathom, a number typed",
    setup: async (page) => {
      await page.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill({ path: FATHOM_BANK, contentType: "application/json" }));
      await go(page, "#fathom");
      await lazyShown(page, "fathom-input");
      await page.getByTestId("fathom-input").fill("8800000");
    },
  },
  {
    name: "Fathom, the reveal",
    setup: async (page) => {
      await page.getByTestId("fathom-lock").click();
      await page.getByTestId("fathom-reveal").waitFor();
      await tick(page);
    },
  },
  {
    name: "Fathom, results",
    setup: async (page) => {
      for (let i = 0; i < 4; i++) {
        await page.getByTestId("fathom-next").click();
        await page.getByTestId("fathom-input").fill("12");
        await page.getByTestId("fathom-lock").click();
        await page.getByTestId("fathom-reveal").waitFor();
      }
      await page.getByTestId("fathom-next").click();
      await page.getByTestId("fathom-results").waitFor();
      await tick(page);
    },
  },
];

/**
 * "add a note" under "Good list?" exists only in a build with a backend, so it gets its own walk on the copy built with
 * the fake backend (backend-lib.cjs): a list's end with the note's key, then with the box open, words in it (so SEND
 * is enabled) and focus in it.
 */
const NOTE_SCREENS = [
  {
    name: "list game over, add a note (backend)",
    scope: '[data-testid="note"]',
    setup: async (page) => {
      await page.getByLabel("Your guess").waitFor();
      await giveUp(page);
      await tick(page);
    },
  },
  {
    name: "list game over, note open (backend)",
    scope: '[data-testid="note"]',
    keepFocus: true,
    setup: async (page) => {
      await page.getByTestId("note-open").click();
      await page.getByTestId("note-text").fill("which state is each park in?");
    },
  },
];

/**
 * Home's account key (only in a build with accounts), on the same backend copy: the header's right-hand keys signed
 * out, and the sign-in sheet the key opens, switched to create an account; then, in a second tab signed in, the keys
 * with the lit player and the account sheet it opens.
 */
const ACCOUNT_OUT_SCREENS = [
  {
    name: "home, account key signed out (backend)",
    scope: '[data-testid="home-keys-end"]',
    setup: (page) => page.locator('[data-testid="account-key"][data-state="out"]').waitFor(),
  },
  {
    name: "home, create account sheet (backend)",
    scope: '[data-testid="sign-in-sheet"]',
    setup: async (page) => {
      await page.getByTestId("account-key").click();
      await lazyShown(page, "sign-in-sheet");
      await page.getByTestId("sign-in-mode").click();
      await page.locator('[data-testid="sign-in-password-form"][data-mode="up"]').waitFor();
    },
  },
];
const ACCOUNT_IN_SCREENS = [
  {
    name: "home, account key signed in (backend)",
    scope: '[data-testid="home-keys-end"]',
    setup: (page) => page.locator('[data-testid="account-key"][data-state="in"]').waitFor(),
  },
  {
    name: "home, account sheet open (backend)",
    scope: '[data-testid="account-sheet"]',
    setup: async (page) => {
      await page.getByTestId("account-key").click();
      await lazyShown(page, "account-sheet");
      await page.getByTestId("account-panel").waitFor();
    },
  },
];

/** Walks `screens` in order on `page` (its clock frozen), then fails with every element that moved. */
async function walk(page, width, screens) {
  const started = Date.now();
  // A frozen clock: nothing ticks (countdowns, the Blitz clock, the ocean) between a screen at rest and its states.
  await freeze(page);
  const failures = [];
  const summary = [];
  for (const screen of screens) {
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
  console.log(
    `states @ ${width.viewport.width}px (${((Date.now() - started) / 1000).toFixed(1)} s)\n` + summary.map((l) => `  ${l}`).join("\n"),
  );
  assert.equal(failures.length, 0, `\n${formatFailures(width.viewport.width, failures)}\n`);
}

// The widths run side by side, each in its own browser context.
describe("interaction states", { concurrency: true }, () => {
  for (const width of WIDTHS) {
    test(`nothing moves on hover, focus or press (${width.name}, ${width.viewport.width}px)`, async () => {
      const { ctx, page } = await open(browser, width);
      try {
        await walk(page, width, SCREENS);
      } finally {
        await ctx.close();
      }
    });
  }
});

describe("interaction states, with a backend (the note, Home's account)", { concurrency: true }, () => {
  let served;
  before(async () => (served = await serveBuild(BACKEND_ENV, "E2E_BACKEND_DIST")));
  after(() => served?.close());
  const openBackend = opener(() => served);
  for (const width of WIDTHS) {
    test(`nothing moves on hover, focus or press: the note (${width.name}, ${width.viewport.width}px)`, async () => {
      const { ctx, page } = await openBackend(width, `#p-${LIST}`, BACKEND_FRESH);
      try {
        await walk(page, width, NOTE_SCREENS);
      } finally {
        await ctx.close();
      }
    });
    test(`nothing moves on hover, focus or press: Home's account (${width.name}, ${width.viewport.width}px)`, async () => {
      const save = { save: { data: { games: {}, daily: {}, seenHelp: true }, version: 1 } };
      for (const [seed, screens] of [
        [BACKEND_FRESH, ACCOUNT_OUT_SCREENS],
        [{ ...BACKEND_FRESH, "top-tens:auth": SESSION }, ACCOUNT_IN_SCREENS],
      ]) {
        const { ctx, page } = await openBackend(width, "", seed, save);
        try {
          await walk(page, width, screens);
        } finally {
          await ctx.close();
        }
      }
    });
  }
});
