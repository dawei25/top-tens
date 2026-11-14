// Fathom, the estimation game (#fathom): five questions that ask for a number. The questions come from
// e2e/fixtures/fathom/questions.json (twelve real facts, one per kind, all estimates, so a draw from it fills the
// percent and year rounds with estimates), served in place of public/fathom/questions.json; the percent and year
// rounds add two real questions of their own (PERCENT, YEAR).
// - A full game on phone and desktop: the draw (five kinds, the first easy), no scoring line anywhere (the owner, Nov
//   14; How to play explains it), the field (no scale keys or words, the number grouped with commas
//   as it's typed and the caret after the same digit, "2.5m" still read), invalid input, the reveal (plain closeness,
//   the same for every question; no "most people miss by" line), the running total from the second question, the
//   results (the total is the sum), SHARE (the total, the squares and the link, lines that keep in a Reddit
//   comment), NEW QUESTIONS draws new questions, the player's save gains only Fathom's part (the finished game, its
//   total, the draws), and a build without a backend sends and queues nothing.
// - A percent round and a year round on phone and desktop: no rule line on either or on the results, the field (a decimal keypad and "%" for a percent, 0 to 100; a number pad for a year, never grouped
//   as "2,007"), the points by each round's rule (a percent by points off and times off its share, or past 50 what's
//   left; a year by how long ago it was), the miss in points or years, the sonar on the distance the points come from, the
//   results and the share text; at 320px every message on one line, no sideways scroll, and every control 44px.
// - A unit with a scale word ("million people"): the short number typed, and the whole amount read back in the unit.
// - A reload picks the game up where it was, the results included.
// - The sonar: the answer in the middle, the squid left for too low and right for too high by how far off (clamped at
//   10x), the miss under it, no bands and no numbers on the scale.
// - Dead on and Close celebrate (the squid hops among sparkles), others don't, and reduced motion never does.
// - Sound: nothing when off; with it on, LOCK IN plays its click, ping and band, and the results a fanfare.
// - Lost at sea's squares stand apart from empty ones.
// - With a phone's keyboard up, the question, the field and LOCK IN stay in view (the real bank's longest questions).
// - At 320px the echo keeps every message on one line and the keys where they were.
// - No horizontal scroll at 320px, and every control 44px to the finger.
// - A missing questions file says so.
// Its Home key, menu tile, How to play rule, Stats block and Past runs rows: fathom-public.e2e.cjs.
// Its hover, focus and press states are in the states walk (states.e2e.cjs); its look in visual.e2e.cjs.
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, VIEWPORTS, open, store, noHScroll } = require("./helpers.cjs");
const { shortReach } = require("./fathom-lib.cjs");

const { PNG } = require("pngjs");

const FIXTURE = path.join(__dirname, "fixtures", "fathom", "questions.json");
const BANK = JSON.parse(fs.readFileSync(FIXTURE, "utf8")).questions;
const byId = new Map(BANK.map((q) => [q.id, q]));
const KEY = "tentacle:fathom";
const QUESTIONS = 5;

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

/** Serves the fixture bank (or `fulfill`, for a broken one) as the questions file. */
const bank =
  (fulfill = { path: FIXTURE, contentType: "application/json" }) =>
  (ctx) =>
    ctx.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill(fulfill));

/** Opens #fathom with the fixture bank, and Fathom's own save seeded once (`save`), if given. */
function openFathom(vp, { save, serve = bank(), setup, ...opts } = {}) {
  return open(browser, vp, "#fathom", undefined, {
    ...opts,
    setup: async (ctx) => {
      await serve(ctx);
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

/**
 * The scoring rule (src/game/fathom.ts), to check the screen against: plain closeness, the same for every question.
 * Spot on (within 1%) is 100, and only that; otherwise 100 x (1 - d)^2 with d the distance in powers of ten, 0 from 10x.
 */
const curve = (d) => Math.round(100 * Math.max(0, 1 - Math.abs(d)) ** 2);
const points = (guess, answer) => (Math.abs(guess - answer) <= answer * 0.01 ? 100 : Math.min(99, curve(Math.log10(guess / answer))));
/**
 * A percent: the average of points off (100 - 3 a point, never under 0) and the curve on how many powers of ten off it
 * is on the answer's side of 50 (past 50, what's left; each share kept to 0.5 to 99.5), the sonar's distance; within
 * half a point, 100. A year: the curve on 2 x the powers of ten in how long ago it was (from this year, at least 1),
 * the sonar's distance too; the year itself, 100.
 */
const share = (p) => Math.min(99.5, Math.max(0.5, p));
const percentOff = (guess, answer) => (answer > 50 ? Math.log10(share(100 - answer) / share(100 - guess)) : Math.log10(share(guess) / share(answer)));
const byPoints = (guess, answer) => Math.max(0, Math.round(100 - 3 * Math.abs(guess - answer)));
const percentPoints = (guess, answer) =>
  Math.abs(guess - answer) < 0.5 ? 100 : Math.min(99, Math.round((byPoints(guess, answer) + curve(percentOff(guess, answer))) / 2));
const THIS_YEAR = new Date().getFullYear();
const ago = (year, now) => Math.max(1, now - year);
const yearOff = (guess, answer, now = THIS_YEAR) => 2 * Math.log10(ago(answer, now) / ago(guess, now));
const yearPoints = (guess, answer, now = THIS_YEAR) => (guess === answer ? 100 : Math.min(99, curve(yearOff(guess, answer, now))));

/** A real percent question and a real year question (as in public/fathom/questions.json), for the new rounds. */
const PERCENT = {
  id: "moon-visible-share",
  kind: "space",
  round: "percent",
  question: "How much of the Moon's surface can we see from Earth?",
  unit: "percent",
  answer: 59,
  definition: "added up over time",
  fact: "It always turns the same face to us, but it wobbles as it orbits, so we see a little way round its edges.",
  source: { title: "Libration", url: "https://en.wikipedia.org/wiki/Libration" },
  easy: false,
};
const YEAR = {
  id: "harry-potter-first-book-year",
  kind: "culture",
  round: "year",
  question: "In what year did the first Harry Potter book come out?",
  unit: "year",
  answer: 1997,
  fact: "Its first print run was just 500 hardback copies, 300 of them sent to libraries.",
  source: { title: "Harry Potter and the Philosopher's Stone", url: "https://en.wikipedia.org/wiki/Harry_Potter_and_the_Philosopher%27s_Stone" },
  easy: true,
};
/** The fixture bank with the percent and the year question. */
const ROUNDS_BANK = bank({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, questions: [...BANK, PERCENT, YEAR] }) });

const attr = (page, testId, name) => page.getByTestId(testId).getAttribute(name);
const shownQuestion = async (page) => byId.get(await attr(page, "fathom-question", "data-question"));
const echoValue = async (page) => {
  const v = await attr(page, "fathom-echo", "data-value");
  return v === null ? null : Number(v);
};
/** Types `text` in the field and locks it in with Enter; returns once the reveal shows. */
async function lockIn(page, text) {
  const field = page.getByTestId("fathom-input");
  await field.fill(text);
  await field.press("Enter");
  await page.getByTestId("fathom-reveal").waitFor();
}
/** NEXT, and the next question's field (or the results). */
async function next(page) {
  await page.getByTestId("fathom-next").click();
  await page.locator('[data-testid="fathom-input"], [data-testid="fathom-results"]').first().waitFor();
}

describe("Fathom", { concurrency: true }, () => {
  for (const vp of VIEWPORTS) {
    test(`a full game: the field, the reveal, the results, new questions (${vp.name})`, async () => {
      const { ctx, page } = await openFathom(vp);
      if (vp.name === "desktop") await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
      const before = await store(page);
      await page.getByTestId("fathom-input").waitFor();
      // No backend in this build: nothing goes anywhere but this site (and the font), whatever is played.
      const origin = new URL(page.url()).origin;
      const away = [];
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (u.origin !== origin && !/^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) away.push(r.url());
      });

      // The field: no number in it to start, a decimal keypad, type big enough that a phone doesn't zoom.
      const field = page.getByTestId("fathom-input");
      assert.equal(await field.inputValue(), "");
      assert.equal(await field.getAttribute("inputmode"), "decimal");
      assert.doesNotMatch((await field.getAttribute("placeholder")) ?? "", /\d/, "no digits in the placeholder");
      assert.ok(parseFloat(await field.evaluate((el) => getComputedStyle(el).fontSize)) >= 16);
      assert.equal(await page.getByTestId("fathom-lock").isDisabled(), true, "LOCK IN waits for a number");

      const first = await shownQuestion(page);
      assert.ok(first, "the question is one of the bank's");
      assert.equal(first.easy, true, "the first question is an easy one");
      assert.ok((await page.getByTestId("fathom-unit").textContent()).trim().length > 0, "the unit shows beside the field");
      assert.equal(await noHScroll(page), true);
      // No scoring line on the card (the owner, Nov 14: "self intuitive already enough"; How to play explains it).
      assert.equal(await page.getByTestId("fathom-rule").count(), 0, "no rule line on the first question");

      // Nov 5 (owner): no thousand, million or billion option; the player types the number. Nothing on the ask card
      // offers a scale: LOCK IN is its only key, and no scale word shows.
      const ask = page.getByTestId("fathom-ask");
      assert.deepEqual(await ask.locator("button").evaluateAll((els) => els.map((el) => el.dataset.testid)), ["fathom-lock"]);
      assert.doesNotMatch(await ask.innerText(), /thousand|million|billion/i);
      // The number is grouped with commas as it's typed, the caret after the digit just typed.
      await field.focus();
      await page.keyboard.type("8800000");
      assert.equal(await field.inputValue(), "8,800,000");
      assert.equal(await field.evaluate((el) => el.selectionStart), 9);
      assert.equal(await echoValue(page), 8_800_000);
      assert.equal((await page.getByTestId("fathom-echo").textContent()).trim(), "", "the echo doesn't repeat the field");
      // Typed in the middle ("8|,800,000"): the caret stays after that digit, before the comma.
      await field.evaluate((el) => el.setSelectionRange(1, 1));
      await page.keyboard.type("9");
      assert.equal(await field.inputValue(), "89,800,000");
      assert.equal(await field.evaluate((el) => el.selectionStart), 2);
      await page.keyboard.press("End");
      for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
      assert.equal(await field.inputValue(), "89,800");
      assert.doesNotMatch(await ask.innerText(), /thousand|million|billion/i, "no scale word for a big number either");
      // A short form still reads, silently: 2.5m is 2.5 million, unless "m" is a unit of the question's kind (2.5
      // metres, in kilometres too; 2.5 minutes), and the echo says what it read.
      await field.fill("2.5m");
      const m = { metres: 2.5, kilometres: 0.0025, seconds: 150, minutes: 2.5 }[first.unit] ?? 2_500_000;
      assert.equal(await echoValue(page), m);
      assert.equal(await attr(page, "fathom-echo", "role"), "status", "the echo is read out politely");

      // Invalid input says what's wrong and locks nothing in.
      for (const bad of ["abc", "0", "-5"]) {
        await field.fill(bad);
        await page.getByTestId("fathom-lock").click();
        assert.equal(await attr(page, "fathom-echo", "data-tone"), "error", `"${bad}" is refused`);
        assert.equal(await field.getAttribute("aria-invalid"), "true");
        assert.equal(await page.getByTestId("fathom-reveal").count(), 0);
      }
      await field.fill("");
      await field.press("Enter");
      assert.equal(await attr(page, "fathom-echo", "data-tone"), "error", "Enter on an empty field says so");
      assert.equal(await page.getByTestId("fathom-reveal").count(), 0);
      // Typing again clears the complaint.
      await field.fill("3");
      assert.notEqual(await attr(page, "fathom-echo", "data-tone"), "error");
      assert.equal((await page.getByTestId("fathom-echo").textContent()).trim(), "");
      assert.equal(await echoValue(page), 3);

      // Dead on: the exact answer, locked in with Enter.
      const played = [first];
      const expected = [];
      await lockIn(page, String(first.answer));
      expected.push(100);
      assert.equal(Number(await attr(page, "fathom-reveal", "data-points")), 100);
      assert.equal(await attr(page, "fathom-band", "data-band"), "dead-on");
      assert.equal(Number(await attr(page, "fathom-answer", "data-value")), first.answer);
      assert.equal(Number(await attr(page, "fathom-guess", "data-value")), first.answer);
      for (const id of ["fathom-points", "fathom-off", "fathom-fact"]) {
        assert.ok((await page.getByTestId(id).textContent()).trim(), `${id} says something`);
      }
      // No made-up yardstick ("most people miss by about x feels made up"), and no rule line. No running total yet: it
      // would only repeat the points.
      assert.equal(await page.getByTestId("fathom-typical").count(), 0, "no typical-miss line");
      assert.equal(await page.getByTestId("fathom-rule").count(), 0, "no rule line on the reveal");
      assert.equal(await page.getByTestId("fathom-running").count(), 0, "no running total on the first question");
      assert.equal(await page.getByTestId("fathom-gauge").locator("svg").count(), 1, "the sonar is drawn");
      const source = page.getByTestId("fathom-source");
      assert.equal(await source.getAttribute("href"), first.source.url);
      assert.equal(await source.getAttribute("target"), "_blank");
      assert.equal(await noHScroll(page), true);
      // NEXT takes focus a beat after the reveal (so a held Enter presses nothing), then Enter moves on.
      await page.waitForFunction(() => document.activeElement?.dataset.testid === "fathom-next");

      // Four more: typed with separators, a third of the answer, plain digits (grouped as typed), and far off (a short
      // form, read silently).
      const guesses = [
        (q) => ({ text: Math.round(q.answer * 2).toLocaleString("en-US"), value: Math.round(q.answer * 2) }),
        (q) => ({ text: `${q.answer / 3}`, value: q.answer / 3 }),
        () => ({ text: "4000", shown: "4,000", value: 4000 }),
        () => ({ text: "1.5bn", value: 1.5e9 }),
      ];
      for (const make of guesses) {
        await page.keyboard.press("Enter");
        await page.getByTestId("fathom-input").waitFor();
        assert.equal(await page.getByTestId("fathom-rule").count(), 0, "no rule line");
        const q = await shownQuestion(page);
        played.push(q);
        const g = make(q);
        await page.getByTestId("fathom-input").fill(g.text);
        if (g.shown) assert.equal(await page.getByTestId("fathom-input").inputValue(), g.shown);
        await page.getByTestId("fathom-lock").click();
        await page.getByTestId("fathom-reveal").waitFor();
        assert.equal(Number(await attr(page, "fathom-guess", "data-value")), g.value);
        const want = points(g.value, q.answer);
        expected.push(want);
        assert.equal(Number(await attr(page, "fathom-reveal", "data-points")), want, `${q.id}: ${g.value} vs ${q.answer}`);
        // The running total, between questions.
        const sum = expected.reduce((a, b) => a + b, 0);
        assert.equal(Number(await attr(page, "fathom-running", "data-total")), sum, `${q.id}: the running total`);
        await page.waitForFunction(() => document.activeElement?.dataset.testid === "fathom-next");
      }
      assert.equal(new Set(played.map((q) => q.kind)).size, 5, "five questions, five kinds");

      // The results: the total is the sum of the five, and each question is there with the guess.
      await page.keyboard.press("Enter");
      await page.getByTestId("fathom-results").waitFor();
      const rows = page.getByTestId("fathom-row");
      assert.equal(await rows.count(), 5);
      const rowPoints = await rows.evaluateAll((els) => els.map((el) => Number(el.dataset.points)));
      assert.deepEqual(rowPoints, expected);
      const total = Number(await attr(page, "fathom-total", "data-total"));
      assert.equal(total, expected.reduce((a, b) => a + b, 0));
      assert.deepEqual(
        await rows.evaluateAll((els) => els.map((el) => el.dataset.question)),
        played.map((q) => q.id),
      );
      assert.equal(await page.getByTestId("fathom-bands").locator("[data-band]").count(), 5);
      assert.equal(await noHScroll(page), true);
      // Neither a rule line nor "a typical guesser scores about 250".
      assert.equal(await page.getByTestId("fathom-rule").count(), 0, "no rule line on the results");
      assert.equal(await page.getByTestId("fathom-typical-total").count(), 0, "no typical-guesser line");
      // The key that draws new questions says so: "Play again" read as the same five again (UX.md 1 and 14).
      assert.doesNotMatch(await page.getByTestId("fathom-again").innerText(), /again/i);

      // SHARE: "Fathom <total>/500", five squares in the bands' colours and the link (two spaces end each line but the
      // last, so a Reddit comment keeps them).
      if (vp.name === "desktop") {
        await page.getByTestId("fathom-share").click();
        const text = await page.evaluate(() => navigator.clipboard.readText());
        assert.match(text, new RegExp(`^Fathom ${total}/500  \\n(\\p{Extended_Pictographic} ){4}\\p{Extended_Pictographic}  \\nhttps?://\\S+/#fathom$`, "u"));
      }

      // NEW QUESTIONS: a new draw, none of the five just played (the bank has room).
      const firstIds = played.map((q) => q.id);
      await page.getByTestId("fathom-again").click();
      await page.getByTestId("fathom-input").waitFor();
      const saved = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY));
      assert.equal(saved.game.ids.length, 5);
      assert.deepEqual(saved.game.ids.filter((id) => firstIds.includes(id)), [], "NEW QUESTIONS holds back the last game's questions");
      assert.equal(saved.game.ids[0], (await shownQuestion(page)).id);
      assert.equal((await shownQuestion(page)).easy, true);
      assert.deepEqual(saved.recent[1], firstIds, "the last games are remembered, newest first");

      // The player's save gains Fathom's part only (the game played, its total, the draws); the rest is as it was.
      const kept = await store(page);
      assert.deepEqual({ ...kept, fathom: undefined }, { ...before, fathom: undefined });
      assert.deepEqual(kept.fathom.runs.map((r) => r.ids), [firstIds]);
      assert.deepEqual(Object.values(kept.fathom.totals), [total]);
      assert.deepEqual(kept.fathom.recent.map((d) => d.ids).slice(0, 2), [saved.game.ids, firstIds]);
      // Without a backend, no guess was sent or queued.
      assert.deepEqual(away, [], "requests off the site");
      assert.equal(await page.evaluate(() => localStorage.getItem("top-tens:fathom-outbox")), null, "no guesses queued");
      await ctx.close();
    });
  }

  // Nov 5 (owner): big counts are asked in a unit with a scale word ("million people"), so the player types a short
  // number. One who types every digit anyway gets the amount read back in the unit, not millions of millions.
  test("a unit with a scale word: the short number, and the whole amount read back in the unit (phone)", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "phone");
    const city = {
      id: "new-york-city-population",
      kind: "places",
      question: "What is the population of New York City?",
      unit: "million people",
      answer: 8.80419,
      definition: "city proper, 2020 census",
      fact: "An estimated 800 languages are spoken there.",
      source: { title: "New York City", url: "https://en.wikipedia.org/wiki/New_York_City" },
      typical: 2,
      easy: true,
    };
    const ids = [city.id, "adult-bones", "octopus-hearts", "moon-distance", "piano-keys"];
    const { ctx, page } = await openFathom(vp, {
      serve: bank({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, questions: [...BANK, city] }) }),
      save: { recent: [], game: { ids, guesses: [], at: 0 } },
      reducedMotion: "reduce",
    });
    const field = page.getByTestId("fathom-input");
    await field.waitFor();
    assert.equal((await page.getByTestId("fathom-unit").textContent()).trim(), "million people");
    await field.fill("8.8");
    assert.equal(await echoValue(page), 8.8);
    assert.equal((await page.getByTestId("fathom-echo").textContent()).trim(), "", "the field says it");
    for (const text of ["8800000", "8.8 million", "8.8m"]) {
      await field.fill(text);
      assert.equal(await echoValue(page), 8.8, `"${text}"`);
      assert.equal(await attr(page, "fathom-echo", "data-tone"), "value");
      assert.equal((await page.getByTestId("fathom-echo").textContent()).trim(), "8.8 million people", `"${text}": the echo says what it read`);
    }
    await field.fill("8800000");
    assert.equal(await field.inputValue(), "8,800,000");
    await page.getByTestId("fathom-lock").click();
    await page.getByTestId("fathom-reveal").waitFor();
    assert.equal(Number(await attr(page, "fathom-guess", "data-value")), 8.8);
    assert.equal(await attr(page, "fathom-band", "data-band"), "dead-on");
    await ctx.close();
  });

  // The owner's revamp: a percent round and a year round beside the estimates (the owner's calibration, Nov 8): a
  // percent by points off and times off its share, a year by how many times off how long ago it was.
  // Each says its own rule before its answer (UX 21), and its field fits a phone (UX 20).
  for (const vp of VIEWPORTS) {
    test(`a percent round and a year round: the rule, the field, the points, the sonar, the results (${vp.name})`, async () => {
      const ids = ["eiffel-tower-height", PERCENT.id, YEAR.id, "adult-bones", "piano-keys"];
      const { ctx, page } = await openFathom(vp, { serve: ROUNDS_BANK, save: { recent: [], game: { ids, guesses: [], at: 0 } }, reducedMotion: "reduce" });
      if (vp.name === "desktop") await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
      const field = page.getByTestId("fathom-input");
      await field.waitFor();
      /** The squid's place on the sonar, from -1 (the left edge, where the score is 0) to 1. */
      const squidAt = () =>
        page.getByTestId("fathom-gauge").evaluate((el) => {
          const cols = el.querySelector("svg").viewBox.baseVal.width;
          const mid = (cols - 1) / 2;
          return (Number(el.querySelector(".g-squid").dataset.x) - mid) / (mid - 4);
        });

      // The estimate first: no rule line on any round (the owner, Nov 14).
      assert.equal(await page.getByTestId("fathom-rule").count(), 0, "estimate: no rule line");
      await lockIn(page, "330");
      await next(page);

      // The percent: "%" beside a decimal keypad, its rule, 0 to 100.
      assert.equal(await attr(page, "fathom-question", "data-round"), "percent");
      assert.equal(await page.getByTestId("fathom-rule").count(), 0, "percent: no rule line");
      assert.equal((await page.getByTestId("fathom-unit").textContent()).trim(), "%");
      assert.equal(await field.getAttribute("inputmode"), "decimal");
      for (const [text, want] of [["59%", 59], ["59.5", 59.5], ["0", 0]]) {
        await field.fill(text);
        assert.equal(await echoValue(page), want, `"${text}"`);
        assert.equal((await page.getByTestId("fathom-echo").textContent()).trim(), "", `"${text}": the field says it`);
      }
      await field.fill("59 percent");
      assert.equal(await echoValue(page), 59);
      assert.equal((await page.getByTestId("fathom-echo").textContent()).trim(), "59%", "the echo says what it read");
      for (const bad of ["150", "-5", "abc"]) {
        await field.fill(bad);
        await page.getByTestId("fathom-lock").click();
        assert.equal(await attr(page, "fathom-echo", "data-tone"), "error", `"${bad}" is refused`);
        assert.equal(await page.getByTestId("fathom-reveal").count(), 0);
      }
      // 6 points low (82), and 47 left against 41, 1.15x off (88).
      await lockIn(page, "53");
      const percentWant = percentPoints(53, PERCENT.answer);
      assert.equal(percentWant, 85);
      assert.equal(Number(await attr(page, "fathom-reveal", "data-points")), percentWant);
      assert.equal(Number(await attr(page, "fathom-guess", "data-value")), 53);
      assert.equal((await page.getByTestId("fathom-answer").textContent()).trim(), "59%");
      assert.equal((await page.getByTestId("fathom-guess").textContent()).trim(), "53%");
      assert.match(await page.getByTestId("fathom-off").textContent(), /^6 too low$/, "the miss in percentage points, without the word");
      assert.ok(Math.abs((await squidAt()) - percentOff(53, PERCENT.answer)) < 0.05, "the squid left, by the distance the points come from");
      assert.equal(await page.getByTestId("fathom-rule").count(), 0, "no rule line on the percent's reveal");
      assert.equal(Number(await attr(page, "fathom-running", "data-total")), 100 + percentWant, "the running total");
      assert.equal(await noHScroll(page), true);
      await next(page);

      // The year: a number pad, typed as four digits and never grouped.
      assert.equal(await attr(page, "fathom-question", "data-round"), "year");
      assert.equal(await page.getByTestId("fathom-rule").count(), 0, "year: no rule line");
      assert.equal(await field.getAttribute("inputmode"), "numeric");
      assert.ok((await page.getByTestId("fathom-unit").textContent()).trim().length > 0, "the unit shows beside the field");
      await field.focus();
      await page.keyboard.type("2007");
      assert.equal(await field.inputValue(), "2007", "a year shows as typed, not 2,007");
      assert.equal(await field.evaluate((el) => el.selectionStart), 4);
      assert.equal(await echoValue(page), 2007);
      assert.equal((await page.getByTestId("fathom-echo").textContent()).trim(), "");
      for (const bad of ["2007.5", "10000", "abc"]) {
        await field.fill(bad);
        await page.getByTestId("fathom-lock").click();
        assert.equal(await attr(page, "fathom-echo", "data-tone"), "error", `"${bad}" is refused`);
        assert.equal(await page.getByTestId("fathom-reveal").count(), 0);
      }
      // 3 years early: 32 years ago against 29 (in 2026), 1.1x off, scores 84.
      await lockIn(page, "1994");
      assert.equal(yearPoints(1994, YEAR.answer, 2026), 84);
      const yearWant = yearPoints(1994, YEAR.answer);
      assert.equal(Number(await attr(page, "fathom-reveal", "data-points")), yearWant);
      assert.equal((await page.getByTestId("fathom-answer").textContent()).trim(), "1997");
      assert.equal((await page.getByTestId("fathom-guess").textContent()).trim(), "1994");
      assert.match(await page.getByTestId("fathom-off").textContent(), /^3 years? early$/, "the miss in years");
      assert.ok(Math.abs((await squidAt()) - yearOff(1994, YEAR.answer)) < 0.05, "the squid left, by the distance the points come from");
      assert.equal(await noHScroll(page), true);

      // Two estimates more, without a rule line.
      for (const id of ["adult-bones", "piano-keys"]) {
        await next(page);
        assert.equal(await page.getByTestId("fathom-rule").count(), 0, `${id}: no rule line`);
        await lockIn(page, String(byId.get(id).answer));
      }
      await next(page);
      await page.getByTestId("fathom-results").waitFor();
      const rows = page.getByTestId("fathom-row");
      assert.deepEqual(await rows.evaluateAll((els) => els.map((el) => el.dataset.round)), ["estimate", "percent", "year", "estimate", "estimate"]);
      const expected = [100, percentWant, yearWant, 100, 100];
      assert.deepEqual(await rows.evaluateAll((els) => els.map((el) => Number(el.dataset.points))), expected);
      const total = expected.reduce((a, b) => a + b, 0);
      assert.equal(Number(await attr(page, "fathom-total", "data-total")), total);
      // The recap shows a percent with its sign and a year as typed.
      const nums = await page.getByTestId("fathom-row-nums").allTextContents();
      assert.match(nums[1], /\b53%.*\b59%/);
      assert.match(nums[2], /\b1994\b.*\b1997\b/);
      assert.doesNotMatch(nums[2], /1,99/);
      assert.equal(await page.getByTestId("fathom-rule").count(), 0, "no rule line on the results");
      assert.equal(await noHScroll(page), true);
      if (vp.name === "desktop") {
        await page.getByTestId("fathom-share").click();
        const text = await page.evaluate(() => navigator.clipboard.readText());
        assert.match(text, new RegExp(`^Fathom ${total}/500  \\n(\\p{Extended_Pictographic} ){4}\\p{Extended_Pictographic}  \\nhttps?://\\S+/#fathom$`, "u"));
      }
      await ctx.close();
    });
  }

  // UX 20 for the new rounds at the narrowest phone: every message on one line, the keys where they were, no sideways
  // scroll and every control 44px to the finger, on the question, its reveal and the results.
  test("a percent and a year at 320px: one-line messages, no sideways scroll, 44px controls", async () => {
    const vp = { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true };
    const ids = [PERCENT.id, YEAR.id, "speed-of-light", "moon-distance", "un-members"];
    const { ctx, page } = await openFathom(vp, { serve: ROUNDS_BANK, save: { recent: [], game: { ids, guesses: [], at: 0 } }, reducedMotion: "reduce" });
    const field = page.getByTestId("fathom-input");
    const reach = async (where) => {
      assert.equal(await noHScroll(page), true, `${where} scrolls sideways`);
      for (const y of [0, 99999]) {
        await page.evaluate((y) => scrollTo(0, y), y);
        await page.waitForTimeout(50);
        assert.deepEqual(await shortReach(page), [], where);
      }
    };
    const messages = {
      percent: [["", true], ["150", true], ["-5", true], ["abc", true], ["5 kg", true], ["59 percent", false]],
      year: [["", true], ["2007.5", true], ["10000", true], ["0", true], ["-5", true], ["abc", true], ["AD 1997", false]],
    };
    for (const [round, guess] of [["percent", "53"], ["year", "1994"]]) {
      await field.waitFor();
      await field.fill("42");
      const rest = await page.getByTestId("fathom-lock").boundingBox();
      for (const [text, refused] of messages[round]) {
        await field.fill(text);
        if (refused && text) await page.getByTestId("fathom-lock").click();
        else if (refused) await field.press("Enter");
        const echo = await page.getByTestId("fathom-echo").evaluate((el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          const lines = new Set([...r.getClientRects()].map((b) => Math.round(b.top))).size;
          return { lines, cut: el.scrollWidth > el.clientWidth + 0.5, tone: el.dataset.tone, text: el.textContent };
        });
        assert.ok(echo.lines <= 1 && !echo.cut, `${round} "${text}": "${echo.text}" takes ${echo.lines} lines${echo.cut ? ", cut" : ""}`);
        assert.equal(echo.tone, refused ? "error" : "value", `${round} "${text}"`);
        assert.deepEqual(await page.getByTestId("fathom-lock").boundingBox(), rest, `${round} "${text}": the keys moved`);
      }
      await field.fill(guess);
      await reach(`the ${round} question`);
      await page.getByTestId("fathom-lock").click();
      await page.getByTestId("fathom-reveal").waitFor();
      await reach(`the ${round} reveal`);
      await next(page);
    }
    for (const text of ["300000", "400k", "190"]) {
      await lockIn(page, text);
      await next(page);
    }
    await page.getByTestId("fathom-results").waitFor();
    await reach("the results");
    await ctx.close();
  });

  test("a reload picks the game up where it was (phone)", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "phone");
    const { ctx, page } = await openFathom(vp);
    await page.getByTestId("fathom-input").waitFor();
    const q = await shownQuestion(page);
    await lockIn(page, "42");
    await page.reload();
    await page.getByTestId("fathom-reveal").waitFor();
    assert.equal((await shownQuestion(page)).id, q.id);
    assert.equal(Number(await attr(page, "fathom-guess", "data-value")), 42);
    await next(page);
    await page.reload();
    await page.getByTestId("fathom-input").waitFor();
    assert.notEqual((await shownQuestion(page)).id, q.id, "on to the second question");
    await ctx.close();
  });

  // Nov 5 review: a reload on the results silently started a new game and the score was gone.
  test("a reload on the results reopens them; only NEW QUESTIONS draws again (phone)", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "phone");
    const { ctx, page } = await openFathom(vp, { reducedMotion: "reduce" });
    await page.getByTestId("fathom-input").waitFor();
    for (let i = 0; i < 5; i++) {
      await lockIn(page, "42");
      await next(page);
    }
    await page.getByTestId("fathom-results").waitFor();
    const total = await attr(page, "fathom-total", "data-total");
    const saved = await page.evaluate((k) => localStorage.getItem(k), KEY);
    await page.reload();
    await page.getByTestId("fathom-results").waitFor();
    assert.equal(await attr(page, "fathom-total", "data-total"), total, "the same score");
    assert.equal(await page.getByTestId("fathom-row").count(), 5);
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), saved, "no new draw on a reload");
    await page.getByTestId("fathom-again").click();
    await page.getByTestId("fathom-input").waitFor();
    assert.notEqual(await page.evaluate((k) => localStorage.getItem(k), KEY), saved, "NEW QUESTIONS draws");
    await ctx.close();
  });

  // The owner, after playing the beta: "the bar doesn't make sense". Now the answer is in the middle and the squid sits
  // left (too low) or right (too high) by how far off, on a log scale clamped at 10x, with the miss written under it;
  // no coloured bands, no numbers on the scale.
  test("the sonar: the answer in the middle, the squid left or right by how far off, the miss under it", async () => {
    // Twice too high, twice too low, 20x and a million times too high (both clamped at the edge), and spot on.
    const ids = ["eiffel-tower-height", "adult-bones", "octopus-hearts", "moon-distance", "everest-height"];
    const ratios = [2, 0.5, 20, 1e6, 1];
    for (const vp of VIEWPORTS) {
      const { ctx, page } = await openFathom(vp, { save: { recent: [], game: { ids, guesses: [], at: 0 } }, reducedMotion: "reduce" });
      const seen = [];
      for (const [i, ratio] of ratios.entries()) {
        if (i) await next(page);
        await page.getByTestId("fathom-input").waitFor();
        await lockIn(page, String(byId.get(ids[i]).answer * ratio));
        seen.push(
          await page.getByTestId("fathom-gauge").evaluate((el) => {
            const art = el.querySelector(".gauge-art").getBoundingClientRect();
            const label = el.querySelector('[data-testid="fathom-off"]');
            const r = label.getBoundingClientRect();
            return {
              cols: el.querySelector("svg").viewBox.baseVal.width,
              squid: Number(el.querySelector(".g-squid").dataset.x),
              buoy: el.querySelector(".g-buoy").getBBox().x + 2,
              extras: el.querySelectorAll(".g-band, .g-tick, .gauge-ticks").length,
              label: { said: label.textContent.trim().length > 0, inside: r.left >= art.left - 0.5 && r.right <= art.right + 0.5 },
            };
          }),
        );
      }
      const [high, low, far, wild, spot] = seen;
      const mid = (high.cols - 1) / 2;
      for (const s of seen) {
        assert.equal(s.buoy, Math.round(mid), `${vp.name}: the answer in the middle`);
        assert.equal(s.extras, 0, `${vp.name}: no bands or tick numbers`);
        assert.deepEqual({ said: s.label.said, inside: s.label.inside }, { said: true, inside: true }, `${vp.name}: the miss written, inside the sonar`);
      }
      assert.ok(high.squid > mid && low.squid < mid, `${vp.name}: too high right (${high.squid}), too low left (${low.squid})`);
      assert.ok(Math.abs(high.squid - mid - (mid - low.squid)) <= 1, `${vp.name}: twice and half as far either side`);
      // Half or double sits about 30% of the way out (log10 2), short of the 10x edge.
      assert.ok(Math.abs((high.squid - mid) / (far.squid - mid) - Math.log10(2)) < 0.05, `${vp.name}: the scale is in powers of ten`);
      assert.equal(far.squid, wild.squid, `${vp.name}: 20x and a million times sit at the same edge`);
      assert.ok(far.squid > high.squid && far.squid <= far.cols - 4, `${vp.name}: the edge, the squid whole`);
      assert.equal(spot.squid, Math.round(mid), `${vp.name}: spot on, on the answer`);
      await ctx.close();
    }
  });

  // The owner: "make close feel good". Dead on and Close: the squid hops among sparkles; the rest stay quiet; reduced
  // motion gets none of it (the word and the verdict are all there at once).
  test("Dead on and Close celebrate, the others don't, and never with reduced motion (phone)", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "phone");
    const ids = ["eiffel-tower-height", "adult-bones", "octopus-hearts", "moon-distance", "everest-height"];
    // Dead on, 30% high (Close), double (Near), 4x (Far).
    const plays = [
      [1, "dead-on"],
      [1.3, "close"],
      [2, "near"],
      [4, "far"],
    ];
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const { ctx, page } = await openFathom(vp, { save: { recent: [], game: { ids, guesses: [], at: 0 } }, reducedMotion });
      for (const [i, [ratio, band]] of plays.entries()) {
        if (i) await next(page);
        await page.getByTestId("fathom-input").waitFor();
        await lockIn(page, String(byId.get(ids[i]).answer * ratio));
        assert.equal(await attr(page, "fathom-band", "data-band"), band);
        const party = await page.getByTestId("fathom-reveal").evaluate((el) => ({
          hop: el.querySelector(".g-squid").getAnimations().length > 0,
          sparks: [...el.querySelectorAll(".g-spark")].some((s) => s.getAnimations().length > 0),
          word: el.querySelector(".band-word").getAnimations().length > 0,
        }));
        const want = reducedMotion === "no-preference" && (band === "dead-on" || band === "close");
        assert.deepEqual(party, { hop: want, sparks: want, word: want }, `${band}, ${reducedMotion}`);
      }
      await ctx.close();
    }
  });

  // The owner: "satisfying sounds when they get super close". The speaker key (off by default) decides: nothing when
  // off; with it on, LOCK IN clicks, pings and plays its band (Dead on fuller than Near), and the results a fanfare.
  test("sound: nothing when off; with it on, each reveal and the results play (desktop)", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "desktop");
    const ids = ["eiffel-tower-height", "adult-bones", "octopus-hearts", "moon-distance", "everest-height"];
    const { ctx, page } = await openFathom(vp, {
      save: { recent: [], game: { ids, guesses: [], at: 0 } },
      setup: (c) =>
        c.addInitScript(() => {
          window.__voices = 0;
          const C = window.AudioContext;
          if (!C) return;
          for (const name of ["createOscillator", "createBufferSource"]) {
            const make = C.prototype[name];
            C.prototype[name] = function () {
              window.__voices += 1;
              return make.call(this);
            };
          }
        }),
    });
    const voices = () => page.evaluate(() => window.__voices);
    await page.getByTestId("fathom-input").waitFor();
    await lockIn(page, String(byId.get(ids[0]).answer));
    assert.equal(await voices(), 0, "sound off: silent");
    await page.getByTestId("sound-toggle").click();
    await next(page);
    let before = await voices();
    await lockIn(page, String(byId.get(ids[1]).answer));
    const deadOn = (await voices()) - before;
    await next(page);
    before = await voices();
    await lockIn(page, String(byId.get(ids[2]).answer * 2));
    const near = (await voices()) - before;
    assert.ok(near > 0, "a reveal plays");
    assert.ok(deadOn > near, `Dead on (${deadOn} voices) is fuller than Near (${near})`);
    for (const i of [3, 4]) {
      await next(page);
      await lockIn(page, String(byId.get(ids[i]).answer));
    }
    before = await voices();
    await next(page);
    await page.getByTestId("fathom-results").waitFor();
    assert.ok((await voices()) > before, "the results play a fanfare");
    await ctx.close();
  });

  // Nov 5 review: lost at sea's square was a slate barely darker than an unplayed one, and it shared as an empty box.
  test("lost at sea marks its square as played, apart from an empty one (phone)", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "phone");
    const { ctx, page } = await openFathom(vp, { reducedMotion: "reduce" });
    await page.getByTestId("fathom-input").waitFor();
    await lockIn(page, "1e15");
    assert.equal(await attr(page, "fathom-band", "data-band"), "lost");
    await next(page);
    // The progress squares: the first lost, the second on screen, the rest empty.
    const pips = page.locator(".fathom-pips .pip");
    assert.ok(await standsOut(page, pips.nth(0), await meanColor(pips.nth(3))), "the lost square looks like an empty one");
    for (let i = 1; i < 5; i++) {
      await lockIn(page, "42");
      await next(page);
    }
    await page.getByTestId("fathom-results").waitFor();
    // The results' row, against the card behind it, and the recap's square.
    const row = page.getByTestId("fathom-bands");
    const box = await row.boundingBox();
    const behind = await meanColor(page, { x: box.x + box.width - 8, y: box.y + 4, width: 6, height: box.height - 8 });
    assert.ok(await standsOut(page, row.locator(".band-sq").first(), behind), "the lost square fades into the card");
    const recap = page.locator('[data-testid="fathom-row"] .band-sq').first();
    const rbox = await recap.boundingBox();
    const rbehind = await meanColor(page, { x: rbox.x + rbox.width + 1, y: rbox.y, width: 4, height: rbox.height });
    assert.ok(await standsOut(page, recap, rbehind), "the recap's lost square fades into the card");
    await ctx.close();
  });

  // Every question in the bank, not just the longest by characters: wrapping decides the height, and a 99-character
  // question (bering-strait-width) pushed LOCK IN under the keyboard while longer ones fit.
  test("with the keyboard up on a small phone, LOCK IN stays in view for every question in the bank", async () => {
    // The number questions (the name-it ones need their lists: fathom-name.e2e.cjs plays them with the keyboard up).
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "fathom", "questions.json"), "utf8")).questions.filter((q) => q.round !== "name");
    const all = real.map((q) => q.id);
    const fails = [];
    for (let g = 0; g < all.length; g += QUESTIONS) {
      const ids = all.slice(g, g + QUESTIONS);
      while (ids.length < QUESTIONS) ids.push(all[ids.length]);
      const { ctx, page } = await openFathom({ viewport: { width: 375, height: 400 }, isMobile: true, hasTouch: true }, {
        serve: async () => {},
        save: { recent: [], game: { ids, guesses: [], at: 0 } },
        reducedMotion: "reduce",
      });
      for (let i = 0; i < QUESTIONS; i++) {
        const field = page.getByTestId("fathom-input");
        await field.waitFor();
        await field.focus();
        await field.fill("42");
        const ok = await page.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          return ['[data-testid="fathom-question"] h1', '[data-testid="fathom-input"]', '[data-testid="fathom-lock"]'].every((s) => r(s).top >= 0 && r(s).bottom <= innerHeight + 0.5);
        });
        if (!ok) fails.push(await attr(page, "fathom-question", "data-question"));
        await page.getByTestId("fathom-lock").click();
        await page.getByTestId("fathom-reveal").waitFor();
        await next(page);
      }
      await ctx.close();
    }
    assert.deepEqual([...new Set(fails)], [], "questions whose LOCK IN goes under the keyboard at 375x400");
  });

  // Nov 5 review: the decimal keypad (iOS) has no Return key, and with it up LOCK IN was under the keyboard. A phone
  // with its keyboard up shows the question, the field and LOCK IN: the page shrinks (Android), or the keyboard covers
  // its lower part and only the visual viewport says so (iOS, faked here). The real bank's longest questions.
  test("with the keyboard up, the question, the field and LOCK IN stay in view (phones)", async () => {
    // The number questions (the name-it ones need their lists: fathom-name.e2e.cjs plays them with the keyboard up).
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "fathom", "questions.json"), "utf8")).questions.filter((q) => q.round !== "name");
    const words = (q) => q.question.length + (q.definition?.length ?? 0);
    const ids = [...real].sort((a, b) => words(b) - words(a)).slice(0, QUESTIONS).map((q) => q.id);
    for (const { width, height, visible } of [
      { width: 390, height: 450 },
      { width: 375, height: 400 },
      { width: 375, height: 667, visible: 400 },
    ]) {
      const vp = { viewport: { width, height }, isMobile: true, hasTouch: true };
      const where = `${width}x${height}${visible ? ` showing ${visible}` : ""}`;
      const { ctx, page } = await openFathom(vp, {
        serve: async () => {},
        save: { recent: [], game: { ids, guesses: [], at: 0 } },
        reducedMotion: "reduce",
        setup: visible ? (c) => c.addInitScript((h) => Object.defineProperty(visualViewport, "height", { get: () => h }), visible) : undefined,
      });
      for (let i = 0; i < QUESTIONS; i++) {
        const field = page.getByTestId("fathom-input");
        await field.waitFor();
        await field.focus();
        await field.fill("42");
        const seen = await page.evaluate((visible) => {
          const bottom = visible ?? innerHeight;
          const box = (el) => el.getBoundingClientRect();
          const inView = (el) => box(el).top >= 0 && box(el).bottom <= bottom + 0.5;
          return {
            question: inView(document.querySelector('[data-testid="fathom-question"] h1')),
            field: inView(document.querySelector('[data-testid="fathom-input"]')),
            lock: inView(document.querySelector('[data-testid="fathom-lock"]')),
            lockBottom: Math.round(box(document.querySelector('[data-testid="fathom-lock"]')).bottom),
          };
        }, visible);
        const id = await attr(page, "fathom-question", "data-question");
        assert.deepEqual({ ...seen, lockBottom: undefined }, { question: true, field: true, lock: true, lockBottom: undefined }, `${where}, ${id}: LOCK IN ends at ${seen.lockBottom}`);
        await page.getByTestId("fathom-lock").click();
        await page.getByTestId("fathom-reveal").waitFor();
        await next(page);
      }
      await ctx.close();
    }
  });

  // Nov 5 review: at 320px "No negatives. It's more than zero." took two lines and pushed the keys down.
  test("whatever the echo says, it takes one line, whole, and moves nothing (320px)", async () => {
    const vp = { viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true };
    // The longest unit in the fixture bank ("kilometres per second"), first.
    const ids = ["speed-of-light", "adult-bones", "octopus-hearts", "moon-distance", "everest-height"];
    const { ctx, page } = await openFathom(vp, { save: { recent: [], game: { ids, guesses: [], at: 0 } }, reducedMotion: "reduce" });
    const field = page.getByTestId("fathom-input");
    await field.waitFor();
    const keys = () => page.getByTestId("fathom-lock").boundingBox();
    await field.fill("42");
    const rest = await keys();
    // Refused (the unit: "In kilometres per second, please."), then the longest numbers the echo writes out.
    for (const [text, refused] of [["", true], ["0", true], ["-5", true], ["abc", true], ["5 kg", true], ["999.9b", false], ["999t", false]]) {
      await field.fill(text);
      if (refused && text) await page.getByTestId("fathom-lock").click();
      else if (refused) await field.press("Enter");
      const echo = await page.getByTestId("fathom-echo").evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const lines = new Set([...r.getClientRects()].map((b) => Math.round(b.top))).size;
        return { lines, cut: el.scrollWidth > el.clientWidth + 0.5, tone: el.dataset.tone, text: el.textContent, size: getComputedStyle(el).fontSize };
      });
      assert.ok(echo.lines <= 1 && !echo.cut, `"${text}": "${echo.text}" takes ${echo.lines} lines${echo.cut ? ", cut" : ""} at ${echo.size}`);
      assert.deepEqual(await keys(), rest, `"${text}": the keys moved`);
      assert.equal(echo.tone, refused ? "error" : "value", `"${text}"`);
    }
    await ctx.close();
  });

  test("an Enter held down from LOCK IN never skips the reveal (desktop)", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "desktop");
    const { ctx, page } = await openFathom(vp);
    await page.getByTestId("fathom-input").fill("42");
    // Down and held: it locks in, then keeps repeating once NEXT has focus.
    await page.keyboard.down("Enter");
    await page.getByTestId("fathom-reveal").waitFor();
    await page.waitForFunction(() => document.activeElement?.dataset.testid === "fathom-next");
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    assert.equal(await page.getByTestId("fathom-reveal").count(), 1, "still on the reveal");
    // A fresh press moves on.
    await page.keyboard.press("Enter");
    await page.getByTestId("fathom-input").waitFor();
    await ctx.close();
  });

  test("no horizontal scroll at 320px, and every control is 44px to the finger (phones)", async () => {
    // The longest unit and the biggest numbers in the bank, so the narrowest phone shows its worst.
    const ids = ["speed-of-light", "moon-distance", "everest-height", "un-members", "marathon-distance"];
    for (const width of [320, 390]) {
      const vp = { viewport: { width, height: 900 }, isMobile: true, hasTouch: true };
      const { ctx, page } = await openFathom(vp, { save: { recent: [], game: { ids, guesses: [], at: 0 } }, reducedMotion: "reduce" });
      await page.getByTestId("fathom-input").waitFor();
      const check = async (where) => {
        assert.equal(await noHScroll(page), true, `${where} at ${width}px scrolls sideways`);
        for (const y of [0, 99999]) {
          await page.evaluate((y) => scrollTo(0, y), y);
          await page.waitForTimeout(50);
          assert.deepEqual(await shortReach(page), [], `${where} at ${width}px`);
        }
        // The narrowest phone keeps every word of the keys whole (the header's icon keys reach past their edges).
        const clipped = await page.evaluate(() =>
          [...document.querySelectorAll("main [data-glass]:not(header) .key")]
            .filter((el) => {
              const text = document.createRange();
              text.selectNodeContents(el);
              const t = text.getBoundingClientRect();
              const r = el.getBoundingClientRect();
              return t.left < r.left - 0.5 || t.right > r.right + 0.5;
            })
            .map((el) => el.dataset.testid),
        );
        assert.deepEqual(clipped, [], `${where} at ${width}px: keys cut short`);
      };
      await page.getByTestId("fathom-input").fill("299792458");
      await check("the question");
      await page.getByTestId("fathom-lock").click();
      await page.getByTestId("fathom-reveal").waitFor();
      await check("the reveal");
      for (const text of ["400k", "9000", "150", "40"]) {
        await next(page);
        await lockIn(page, text);
      }
      await next(page);
      await page.getByTestId("fathom-results").waitFor();
      await check("the results");
      await ctx.close();
    }
  });

  test("a missing questions file says so plainly", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "phone");
    for (const serve of [
      bank({ status: 404, body: "" }),
      // What a static host's fallback serves for a file that isn't there.
      bank({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }),
      // A bank too small for a game.
      bank({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, questions: BANK.slice(0, 3) }) }),
    ]) {
      const { ctx, page } = await openFathom(vp, { serve });
      await page.getByTestId("fathom-missing").waitFor();
      assert.equal(await page.getByTestId("fathom-input").count(), 0);
      await ctx.close();
    }
  });
});

/** The pixels of an element's screenshot (or of a page's clip), as [r, g, b] each. */
async function pixels(target, clip) {
  const png = PNG.sync.read(clip ? await target.screenshot({ clip, animations: "disabled" }) : await target.screenshot({ animations: "disabled" }));
  const out = [];
  for (let i = 0; i < png.data.length; i += 4) out.push([png.data[i], png.data[i + 1], png.data[i + 2]]);
  return out;
}
/** The average colour of an element (or of a page's clip). */
async function meanColor(target, clip) {
  const px = await pixels(target, clip);
  return [0, 1, 2].map((c) => px.reduce((sum, p) => sum + p[c], 0) / px.length);
}
/** WCAG contrast between two colours. */
function contrast(a, b) {
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Whether a square's mark stands out from what it could be taken for: a fifth of its pixels at 3:1 or more. */
async function standsOut(page, square, against) {
  const px = await pixels(square);
  return px.filter((p) => contrast(p, against) >= 3).length >= px.length / 5;
}

