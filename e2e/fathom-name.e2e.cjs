// Fathom's name-it round (#fathom): "Name a country with about 50 million people". The owner: "brain didn't even
// register": a fair answer must always register, and one locked answer per round. The lists are the fixtures in
// e2e/fixtures/fathom/lists (a subset of each real list, in the data agent's format), served in place of
// public/fathom/lists; the questions are e2e/fixtures/fathom/name-questions.json beside the fixture bank (or, for the
// keyboard check, the real bank's own name-it questions).
// - A round on phone and desktop: its rule in view before the answer, a name field (no unit), a thing of another kind
//   and a name we don't know cost nothing and say so, a misspelling goes in the box to confirm, a name several things
//   share offers them to tap, an alias locks; the reveal shows the target, the pick and its figure, the points by the
//   rule, the miss in plain words, the best answers with their figures, the list's source; the results' recap names the
//   pick, the rule is said again, and the share text has five squares.
// - A steps list (land borders): points by steps off, the miss in borders, the squid on the steps scale.
// - A country on a city question, and the question's own yardstick ("about as big as the UK": not the UK).
// - The draw: the fifth round is name-it when the bank has one and its list loads, never first; an estimate otherwise.
// - A reload on a name-it reveal picks it up, pick and all.
// - At 320px every line takes two lines at most and moves nothing, the choices and keys are 44px to the finger, and
//   nothing scrolls sideways; with a phone's keyboard up the question, the field and LOCK IN stay in view for every
//   name-it question in the real bank.
// - Hover, focus and press move nothing on the round (the choices shown) and its reveal (states-lib.cjs).
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, VIEWPORTS, open, noHScroll, freeze } = require("./helpers.cjs");
const { checkScreen, formatFailures } = require("./states-lib.cjs");
const { shortReach, textLines } = require("./fathom-lib.cjs");

const FIXTURES = path.join(__dirname, "fixtures", "fathom");
const BANK = JSON.parse(fs.readFileSync(path.join(FIXTURES, "questions.json"), "utf8")).questions;
const NAMES = JSON.parse(fs.readFileSync(path.join(FIXTURES, "name-questions.json"), "utf8")).questions;
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "fathom", "questions.json"), "utf8")).questions;
const list = (id) => JSON.parse(fs.readFileSync(path.join(FIXTURES, "lists", `${id}.json`), "utf8"));
const KEY = "tentacle:fathom";

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

/** Serves `questions` as the bank, and the fixture lists (or nothing: `lists: false`, each a 404). */
const serve =
  (questions, { lists = true } = {}) =>
  async (ctx) => {
    if (questions) await ctx.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, questions }) }));
    await ctx.route(/\/fathom\/lists\/([a-z0-9-]+)\.json(\?.*)?$/, (route) => {
      const id = new URL(route.request().url()).pathname.match(/([a-z0-9-]+)\.json$/)[1];
      const file = path.join(FIXTURES, "lists", `${id}.json`);
      if (!lists || !fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: file, contentType: "application/json" });
    });
  };

/** Opens #fathom on `questions` (the fixture bank and the name-it fixtures by default), its save seeded once. */
function openFathom(vp, { questions = [...BANK, ...NAMES], lists = true, save, setup, ...opts } = {}) {
  return open(browser, vp, "#fathom", undefined, {
    reducedMotion: "reduce",
    ...opts,
    setup: async (ctx) => {
      await serve(questions, { lists })(ctx);
      await setup?.(ctx);
      if (save) {
        await ctx.addInitScript(
          ([key, s]) => {
            if (localStorage.getItem("e2e-fathom-seeded")) return;
            localStorage.setItem(key, s);
            localStorage.setItem("e2e-fathom-seeded", "1");
          },
          [KEY, JSON.stringify(save)],
        );
      }
    },
  });
}
/** A game on these questions, at the `at`th with the ones before it answered (100 points each, as their answers). */
const gameAt = (ids, at) => ({ recent: [], game: { ids, guesses: ids.slice(0, at).map((id) => BANK.find((q) => q.id === id).answer), at } });

/** The scoring rules (src/game/fathom.ts), to check the screen against. */
const ratioPoints = (figure, target) =>
  Math.abs(figure - target) <= target * 0.01 ? 100 : Math.min(99, Math.round(100 * Math.max(0, 1 - Math.abs(Math.log10(figure / target))) ** 2));
const stepPoints = (figure, target) => Math.max(0, 100 - 30 * Math.abs(figure - target));

const attr = (page, testId, name) => page.getByTestId(testId).getAttribute(name);
const text = async (page, testId) => (await page.getByTestId(testId).textContent()).trim();
const saved = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
/** Types a name that doesn't lock and presses LOCK IN (or Enter); what the line says, as { read, tone, text }. */
async function say(page, name, how = "click") {
  const field = page.getByTestId("fathom-input");
  await field.fill(name);
  if (how === "enter") await field.press("Enter");
  else await page.getByTestId("fathom-lock").click();
  const echo = page.getByTestId("fathom-echo");
  return { read: await echo.getAttribute("data-read"), tone: await echo.getAttribute("data-tone"), text: (await echo.textContent()).trim() };
}
/** Types a name the list knows and locks it in; returns once the reveal shows. */
async function lockName(page, name) {
  await page.getByTestId("fathom-input").fill(name);
  await page.getByTestId("fathom-lock").click();
  await page.getByTestId("fathom-reveal").waitFor();
}
async function next(page) {
  await page.getByTestId("fathom-next").click();
  await page.locator('[data-testid="fathom-input"], [data-testid="fathom-results"]').first().waitFor();
}
/** The squid's place on the sonar, from -1 (the left edge, where the score is 0) to 1. */
const squidAt = (page) =>
  page.getByTestId("fathom-gauge").evaluate((el) => {
    const cols = el.querySelector("svg").viewBox.baseVal.width;
    const mid = (cols - 1) / 2;
    return (Number(el.querySelector(".g-squid").dataset.x) - mid) / (mid - 4);
  });

const POP = list("countries-population");
const figure = (l, name) => l.entries.find((e) => e.name === name).value;

describe("Fathom: the name-it round", { concurrency: true }, () => {
  for (const vp of VIEWPORTS) {
    test(`a wrong kind costs nothing, a right answer locks, the reveal shows the best answers (${vp.name})`, async () => {
      const ids = ["eiffel-tower-height", "name-country-50m-people", "adult-bones", "octopus-hearts", "piano-keys"];
      const { ctx, page } = await openFathom(vp, { save: gameAt(ids, 1) });
      if (vp.name === "desktop") await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
      const field = page.getByTestId("fathom-input");
      await field.waitFor();
      assert.equal(await attr(page, "fathom-question", "data-round"), "name");

      // Its rule, one plain line, in view before the answer (UX 21).
      const rule = page.getByTestId("fathom-rule");
      assert.equal(await rule.getAttribute("data-round"), "name");
      assert.equal(await text(page, "fathom-rule"), "The closer to the target, the more points.");
      const box = await rule.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= vp.viewport.height && box.y < (await field.boundingBox()).y, "the rule in view, before the field");

      // A name field: a phone's own keyboard, no unit, a placeholder that says what to name, LOCK IN waiting for it.
      assert.equal(await field.getAttribute("inputmode"), "text");
      assert.equal(await field.getAttribute("placeholder"), "your country");
      assert.equal(await page.getByTestId("fathom-unit").count(), 0);
      assert.equal(await page.getByTestId("fathom-lock").isDisabled(), true);
      assert.equal(await noHScroll(page), true);

      // Nothing locks but a name the list knows, and nothing else costs anything.
      const nothingLocked = async (what) => {
        assert.equal(await page.getByTestId("fathom-reveal").count(), 0, `${what}: no reveal`);
        assert.equal((await saved(page)).game.guesses.length, 1, `${what}: no guess saved`);
      };
      assert.deepEqual(await say(page, "Paris"), { read: "other", tone: "error", text: "Paris is a city, not a country. Try again." });
      assert.equal(await field.getAttribute("aria-invalid"), "true");
      await nothingLocked("a city");
      // No dependencies on the lists: Greenland is a territory, Hong Kong a city on the city list.
      assert.deepEqual(await say(page, "Greenland"), { read: "other", tone: "error", text: "Greenland is a territory, not a country. Try again." });
      assert.deepEqual(await say(page, "hong kong"), { read: "other", tone: "error", text: "Hong Kong is a city, not a country. Try again." });
      await nothingLocked("a territory");
      assert.deepEqual(await say(page, "Lagos", "enter"), { read: "other", tone: "error", text: "Lagos is a city, not a country. Try again." });
      assert.equal(await field.inputValue(), "Lagos", "not turned into Laos");
      assert.deepEqual(await say(page, "brain"), { read: "unknown", tone: "error", text: "Not one we know. Try again." });
      await nothingLocked("an unknown name");
      // Typing clears what was said.
      await field.fill("b");
      assert.equal(await attr(page, "fathom-echo", "data-tone"), "none");
      // Enter on an empty field says what to type.
      await field.fill("");
      await field.press("Enter");
      assert.equal(await attr(page, "fathom-echo", "data-read"), "empty");

      // A misspelling goes in the box to confirm; a name two things share offers both, and a tap fills the box.
      assert.deepEqual(await say(page, "Frnace"), { read: "confirm", tone: "value", text: "France? Lock in to confirm." });
      assert.equal(await field.inputValue(), "France");
      await nothingLocked("a misspelling");
      const choose = await say(page, "Irak");
      assert.deepEqual([choose.read, choose.tone], ["choose", "choose"]);
      assert.deepEqual(await page.getByTestId("fathom-choice").evaluateAll((els) => els.map((el) => el.dataset.name)), ["Iran", "Iraq"]);
      await page.locator('[data-testid="fathom-choice"][data-name="Iraq"]').click();
      assert.equal(await field.inputValue(), "Iraq");
      assert.equal(await field.evaluate((el) => el === document.activeElement), true, "the box keeps focus after a tap");
      await nothingLocked("a choice tapped");

      // An alias locks: "Colombia" by its own name, here "UK" would too; the guess is its figure.
      const pick = "Colombia";
      await field.fill(pick.toLowerCase());
      await field.press("Enter");
      await page.getByTestId("fathom-reveal").waitFor();
      const value = figure(POP, pick);
      const want = ratioPoints(value, 50e6);
      assert.equal(Number(await attr(page, "fathom-reveal", "data-points")), want);
      assert.equal(await attr(page, "fathom-guess", "data-pick"), pick);
      assert.equal(Number(await attr(page, "fathom-guess", "data-value")), value);
      assert.equal(await text(page, "fathom-guess"), pick);
      assert.equal(await text(page, "fathom-pick-figure"), "52.89 million people");
      assert.equal(Number(await attr(page, "fathom-answer", "data-value")), 50e6);
      assert.equal(await text(page, "fathom-answer"), "50 million people");
      assert.equal(await text(page, "fathom-off"), "6% more people");
      assert.ok(Math.abs((await squidAt(page)) - Math.log10(value / 50e6)) < 0.05, "the squid right, on the powers-of-ten scale");
      assert.equal(Number(await attr(page, "fathom-running", "data-total")), 100 + want);
      // The best answers, closest first, with their figures; the source is the list's.
      const best = await page
        .getByTestId("fathom-best-row")
        .evaluateAll((els) => els.map((el) => [el.dataset.name, Number(el.dataset.value), [...el.children].map((c) => c.textContent.trim()).join(" | ")]));
      assert.deepEqual(best, [
        ["Uganda", 49924252, "Uganda | 49.92 million"],
        ["Sudan", 50448963, "Sudan | 50.45 million"],
        ["Spain", 48592909, "Spain | 48.59 million"],
        ["South Korea", 51717590, "South Korea | 51.72 million"],
      ]);
      assert.equal(await page.getByTestId("fathom-source").getAttribute("href"), POP.source.url);
      assert.equal(await page.getByTestId("fathom-players").count(), 0, "no players' line on a name-it round");
      assert.equal(await page.getByTestId("fathom-rule").count(), 1, "the rule stays with the reveal");
      assert.equal((await saved(page)).game.picks["name-country-50m-people"], pick);
      assert.equal(await noHScroll(page), true);

      // The rest of the game, then the results.
      for (let i = 0; i < 3; i++) {
        await next(page);
        const id = await attr(page, "fathom-question", "data-question");
        await page.getByTestId("fathom-input").fill(String(BANK.find((q) => q.id === id).answer));
        await page.getByTestId("fathom-lock").click();
        await page.getByTestId("fathom-reveal").waitFor();
      }
      await next(page);
      await page.getByTestId("fathom-results").waitFor();
      const row = page.locator('[data-testid="fathom-row"][data-round="name"]');
      assert.equal(await row.getAttribute("data-pick"), pick);
      assert.equal(Number(await row.getAttribute("data-points")), want);
      assert.match((await row.getByTestId("fathom-row-nums").textContent()).replace(/\s+/g, " "), /^you Colombia 52\.89 million · target 50 million people$/);
      const total = 400 + want;
      assert.equal(Number(await attr(page, "fathom-total", "data-total")), total);
      assert.deepEqual(await page.getByTestId("fathom-rule").evaluateAll((els) => els.map((el) => el.dataset.round)), ["estimate", "name"]);
      assert.equal(await noHScroll(page), true);
      if (vp.name === "desktop") {
        await page.getByTestId("fathom-copy").click();
        const shared = await page.evaluate(() => navigator.clipboard.readText());
        assert.match(shared, new RegExp(`^Fathom ${total}/500  \\n\\S( \\S){4}  \\nhttps?://\\S+/#fathom$`));
      }
      await ctx.close();
    });
  }

  test("a steps list: points by borders off, the miss in borders, the squid on the steps scale (phone)", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "phone");
    const ids = ["eiffel-tower-height", "name-country-6-borders", "adult-bones", "octopus-hearts", "piano-keys"];
    const { ctx, page } = await openFathom(vp, { save: gameAt(ids, 1) });
    await page.getByTestId("fathom-input").waitFor();
    assert.equal(await text(page, "fathom-rule"), "The closer to the target, the more points.");
    // "Congo": two countries are called that.
    const congo = await say(page, "Congo");
    assert.equal(congo.read, "choose");
    assert.deepEqual(await page.getByTestId("fathom-choice").evaluateAll((els) => els.map((el) => el.dataset.name)), ["Democratic Republic of the Congo", "Republic of the Congo"]);
    // Germany has 9: three too many.
    await page.getByTestId("fathom-input").fill("Germany");
    await page.getByTestId("fathom-lock").click();
    await page.getByTestId("fathom-reveal").waitFor();
    assert.equal(Number(await attr(page, "fathom-reveal", "data-points")), stepPoints(9, 6));
    assert.equal(stepPoints(9, 6), 10);
    assert.equal(await text(page, "fathom-off"), "3 land borders too many");
    assert.equal(await text(page, "fathom-pick-figure"), "9 land borders");
    assert.equal(await text(page, "fathom-answer"), "6 land borders");
    assert.ok(Math.abs((await squidAt(page)) - 3 / (100 / 30)) < 0.05, "the squid right, 3 of the 3.3 steps to the edge");
    assert.deepEqual(await page.getByTestId("fathom-best-row").evaluateAll((els) => els.map((el) => el.dataset.name)), ["Italy", "Ethiopia", "Afghanistan", "Chad"]);
    await ctx.close();
  });

  test("a country on a city question, the yardstick on its own question, and aliases (desktop)", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "desktop");
    const ids = ["eiffel-tower-height", "name-city-10m-people", "name-country-as-big-as-uk", "octopus-hearts", "piano-keys"];
    const { ctx, page } = await openFathom(vp, { save: gameAt(ids, 1) });
    await page.getByTestId("fathom-input").waitFor();
    assert.equal(await page.getByTestId("fathom-input").getAttribute("placeholder"), "your city");
    assert.deepEqual(await say(page, "France"), { read: "other", tone: "error", text: "France is a country, not a city. Try again." });
    assert.deepEqual(await say(page, "Greenland"), { read: "other", tone: "error", text: "Greenland is a territory, not a city. Try again." });
    // A real city under the list's 5 million: the game's lexicon knows it, the list doesn't, and the line says so.
    await page.locator('[data-testid="fathom-ask"][data-lexicon]').waitFor();
    assert.deepEqual(await say(page, "berlin"), { read: "offList", tone: "error", text: `Berlin isn't one of our ${list("cities-population").entries.length} cities. Try again.` });
    // An alias locks as its city.
    await lockName(page, "Bombay");
    assert.equal(await attr(page, "fathom-guess", "data-pick"), "Mumbai");
    assert.equal(await text(page, "fathom-off"), "2x too many people");
    await next(page);
    // "about as big as the UK": the UK itself doesn't count, by any of its names.
    assert.deepEqual(await say(page, "UK"), { read: "except", tone: "error", text: "Any country but United Kingdom. Try again." });
    assert.equal((await say(page, "Great Britain")).read, "except");
    await lockName(page, "ghana");
    assert.equal(await text(page, "fathom-answer"), "244,376 square kilometres");
    assert.equal(await text(page, "fathom-pick-figure"), "238,533 square kilometres");
    assert.equal(await text(page, "fathom-off"), "2% low");
    assert.ok(!(await page.getByTestId("fathom-best-row").evaluateAll((els) => els.map((el) => el.dataset.name))).includes("United Kingdom"));
    await ctx.close();
  });

  test("the draw: the fifth round is name-it when its list loads, never first; an estimate when it doesn't", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "phone");
    // Many new draws on one bank: each game has one name-it round, never the opener.
    const { ctx, page } = await openFathom(vp);
    await page.getByTestId("fathom-input").waitFor();
    const names = new Set(NAMES.map((q) => q.id));
    for (let i = 0; i < 6; i++) {
      const ids = (await saved(page)).game.ids;
      assert.equal(ids.filter((id) => names.has(id)).length, 1, `game ${i}: one name-it round (${ids.join(", ")})`);
      assert.ok(!names.has(ids[0]), `game ${i}: not first`);
      await page.evaluate((k) => {
        const s = JSON.parse(localStorage.getItem(k));
        localStorage.setItem(k, JSON.stringify({ recent: s.recent }));
      }, KEY);
      await page.reload();
      await page.getByTestId("fathom-input").waitFor();
    }
    await ctx.close();
    // The lists not there: no name-it round, an estimate in its place.
    const without = await openFathom(vp, { lists: false });
    await without.page.getByTestId("fathom-input").waitFor();
    const ids = (await saved(without.page)).game.ids;
    assert.equal(ids.length, 5);
    assert.equal(ids.filter((id) => names.has(id)).length, 0, "no name-it round without its list");
    await without.ctx.close();
  });

  test("a reload on a name-it reveal picks it up, the pick and all (phone)", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "phone");
    const ids = ["eiffel-tower-height", "name-country-50m-people", "adult-bones", "octopus-hearts", "piano-keys"];
    const { ctx, page } = await openFathom(vp, { save: gameAt(ids, 1) });
    await page.getByTestId("fathom-input").waitFor();
    await lockName(page, "USA");
    const points = await attr(page, "fathom-reveal", "data-points");
    await page.reload();
    await page.getByTestId("fathom-reveal").waitFor();
    assert.equal(await attr(page, "fathom-guess", "data-pick"), "United States");
    assert.equal(await attr(page, "fathom-reveal", "data-points"), points);
    assert.equal(await text(page, "fathom-off"), "6.8x too many people");
    await ctx.close();
  });

  // UX 20 at the narrowest phone: every line whole in two lines at most, the keys where they were, the choices 44px to
  // the finger, nothing sideways.
  test("at 320px: two lines at most, nothing moves, 44px choices and keys, no sideways scroll", async () => {
    const vp = { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true };
    const ids = ["eiffel-tower-height", "name-country-50m-people", "adult-bones", "octopus-hearts", "piano-keys"];
    const { ctx, page } = await openFathom(vp, { save: gameAt(ids, 1) });
    const field = page.getByTestId("fathom-input");
    await field.waitFor();
    await page.locator('[data-testid="fathom-ask"][data-lexicon]').waitFor();
    await field.fill("x");
    const rest = await page.getByTestId("fathom-lock").boundingBox();
    // The longest lines: a long name of another kind, a misspelling of a long name, and the rest.
    for (const [typed, read] of [
      ["Ho Chi Minh City", "other"],
      ["Saint Petersburg", "other"],
      ["Puerto Rico", "other"],
      ["Northern Ireland", "other"],
      ["Turks and Caicos Islands", "other"],
      // The longest of the places no list has (Nov 8): a plural territory, a part of a country, a region, a former one.
      ["US Virgin Islands", "other"],
      ["French Polynesia", "other"],
      ["Galápagos Islands", "other"],
      ["Western Australia", "other"],
      ["Bohemia", "other"],
      ["Canary Islands", "other"],
      ["Central America", "other"],
      ["Czechoslovakia", "other"],
      ["Scotland", "other"],
      ["Tasmania", "other"],
      ["Papua New Ginea", "confirm"],
      // A real name somewhere in the game, not a country: the lexicon knows it.
      ["Atlantis", "offList"],
      ["brain", "unknown"],
      ["", "empty"],
    ]) {
      const r = await say(page, typed, typed ? "click" : "enter");
      assert.equal(r.read, read, `"${typed}"`);
      const seen = await textLines(page.locator('[data-testid="fathom-echo"] > span'));
      assert.ok(seen.lines <= 2 && !seen.cut, `"${typed}": "${seen.text}" takes ${seen.lines} lines${seen.cut ? ", cut" : ""}`);
      assert.deepEqual(await page.getByTestId("fathom-lock").boundingBox(), rest, `"${typed}": LOCK IN moved`);
    }
    // The choices: each whole, inside the card, and 44px to the finger.
    await say(page, "Congo");
    assert.equal(await page.getByTestId("fathom-choice").count(), 2);
    const inside = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="fathom-ask"]').getBoundingClientRect();
      return [...document.querySelectorAll('[data-testid="fathom-choice"]')].every((b) => {
        const r = b.getBoundingClientRect();
        return r.left >= card.left && r.right <= card.right && b.scrollWidth <= b.clientWidth + 0.5;
      });
    });
    assert.ok(inside, "a choice runs out of the card");
    assert.equal(await noHScroll(page), true);
    for (const y of [0, 99999]) {
      await page.evaluate((y) => scrollTo(0, y), y);
      await page.waitForTimeout(50);
      assert.deepEqual(await shortReach(page), [], "the round");
    }
    await page.locator('[data-testid="fathom-choice"]').first().click();
    await page.getByTestId("fathom-lock").click();
    await page.getByTestId("fathom-reveal").waitFor();
    assert.equal(await noHScroll(page), true);
    for (const y of [0, 99999]) {
      await page.evaluate((y) => scrollTo(0, y), y);
      await page.waitForTimeout(50);
      assert.deepEqual(await shortReach(page), [], "the reveal");
    }
    // The best answers and the pick: every name whole.
    const cut = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="fathom-best-row"] span, [data-testid="fathom-guess"] span')].filter((el) => el.scrollWidth > el.clientWidth + 0.5).map((el) => el.textContent),
    );
    assert.deepEqual(cut, [], "names cut short");
    await ctx.close();
  });

  // Every name-it question in the real bank, played on the fixture lists: with a phone's keyboard up (the page shrunk,
  // or iOS's overlay) the question, the field and LOCK IN stay in view.
  test("with the keyboard up, every name-it question in the real bank keeps its field and LOCK IN in view", async () => {
    const real = REAL.filter((q) => q.round === "name");
    assert.ok(real.length >= 10, "the real bank has its name-it questions");
    const opener = REAL.find((q) => q.round !== "name" && q.easy);
    const fails = [];
    for (const { width, height, visible } of [
      { width: 375, height: 400 },
      { width: 375, height: 667, visible: 400 },
    ]) {
      for (const q of real) {
        const fill = REAL.filter((x) => x.round !== "name" && x !== opener).slice(0, 3).map((x) => x.id);
        const ids = [opener.id, q.id, ...fill];
        const { ctx, page } = await openFathom(
          { viewport: { width, height }, isMobile: true, hasTouch: true },
          {
            questions: null,
            save: { recent: [], game: { ids, guesses: [opener.answer], at: 1 } },
            setup: visible ? (c) => c.addInitScript((h) => Object.defineProperty(visualViewport, "height", { get: () => h }), visible) : undefined,
          },
        );
        const field = page.getByTestId("fathom-input");
        await field.waitFor();
        assert.equal(await attr(page, "fathom-question", "data-question"), q.id, `${q.id} plays on the fixture lists`);
        await field.focus();
        // The longest message: a name the game's lexicon knows ("Atlantis isn't one of our ... countries."), two lines.
        await page.locator('[data-testid="fathom-ask"][data-lexicon]').waitFor();
        for (const typed of ["x", "Atlantis"]) {
          if (typed === "Atlantis") assert.equal((await say(page, typed)).read, "offList");
          else await field.fill(typed);
          const ok = await page.evaluate((bottom) => {
            const r = (s) => document.querySelector(s).getBoundingClientRect();
            const b = bottom ?? innerHeight;
            return ['[data-testid="fathom-question"] h1', '[data-testid="fathom-input"]', '[data-testid="fathom-lock"]'].every((s) => r(s).top >= 0 && r(s).bottom <= b + 0.5);
          }, visible);
          if (!ok) fails.push(`${width}x${height}${visible ? ` showing ${visible}` : ""} ${q.id} (${typed})`);
        }
        await ctx.close();
      }
    }
    assert.deepEqual(fails, [], "LOCK IN under the keyboard");
  });

  // DESIGN.md 5a: hover, focus and press change nothing's size or place, on the round with its choices shown and on its
  // reveal, at a desktop and a phone width.
  for (const width of [
    { name: "desktop", hover: true, viewport: { width: 1440, height: 900 } },
    { name: "phone", hover: false, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  ]) {
    test(`hover, focus and press move nothing on the round and its reveal (${width.name})`, async () => {
      const ids = ["eiffel-tower-height", "name-country-50m-people", "adult-bones", "octopus-hearts", "piano-keys"];
      const { ctx, page } = await openFathom(width, { save: gameAt(ids, 1) });
      await page.getByTestId("fathom-input").waitFor();
      await say(page, "Korea");
      assert.equal(await page.getByTestId("fathom-choice").count(), 2);
      await freeze(page);
      const failures = [];
      const round = await checkScreen(page, { name: "Fathom, name-it with choices", scope: '[data-testid="fathom-ask"]' }, { hover: width.hover });
      failures.push(...round.failures);
      await page.clock.resume();
      await page.locator('[data-testid="fathom-choice"]').first().click();
      await page.getByTestId("fathom-lock").click();
      await page.getByTestId("fathom-reveal").waitFor();
      await page.waitForTimeout(400);
      await freeze(page);
      const reveal = await checkScreen(page, { name: "Fathom, name-it reveal", scope: '[data-testid="fathom-reveal"]' }, { hover: width.hover });
      failures.push(...reveal.failures);
      assert.ok(round.counts.press >= 3, `the round's controls were pressed (${round.counts.press})`);
      assert.equal(failures.length, 0, formatFailures(width.viewport.width, failures));
      await ctx.close();
    });
  }
});
