// Fathom, the estimation beta (#fathom): five questions that ask for a number. The questions come from
// e2e/fixtures/fathom/questions.json (twelve real facts, one per kind), served in place of public/fathom/questions.json.
// - A full game on phone and desktop: the draw (five kinds, the first easy), the scoring rule in view on the first
//   question before answering (and on the results), the field (2.5m, the MILLION key, the echo), invalid input, the
//   reveal (plain closeness, the same for every question; no "most people miss by" line), the running total from the
//   second question, the results (the total is the sum), COPY RESULT, NEW QUESTIONS draws new questions, the game's
//   own save is left alone, and a build without a backend sends and queues nothing.
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
// - Hidden: Home and the menu have no way to it.
// Its hover, focus and press states are in the states walk (states.e2e.cjs); its look in visual.e2e.cjs.
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, VIEWPORTS, open, go, store, noHScroll } = require("./helpers.cjs");

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
const points = (guess, answer) =>
  Math.abs(guess - answer) <= answer * 0.01 ? 100 : Math.min(99, Math.round(100 * Math.max(0, 1 - Math.abs(Math.log10(guess / answer))) ** 2));

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
      // The scoring rule, one plain line, in view where the player looks before the first answer (owner, after playing
      // the beta: one rule for every question, said on screen).
      const rule = await page.getByTestId("fathom-rule").boundingBox();
      assert.ok(rule && rule.y >= 0 && rule.y + rule.height <= vp.viewport.height, "the rule is in view on the first question");
      assert.ok(rule.y < (await page.getByTestId("fathom-input").boundingBox()).y, "the rule comes before the field");

      // 2.5m is 2.5 million, unless "m" is a unit of the question's kind: 2.5 metres (in kilometres too), 2.5 minutes.
      await field.fill("2.5m");
      const m = { metres: 2.5, kilometres: 0.0025, seconds: 150, minutes: 2.5 }[first.unit] ?? 2_500_000;
      assert.equal(await echoValue(page), m);
      assert.equal(await attr(page, "fathom-echo", "role"), "status", "the echo is read out politely");
      // The keys multiply what's typed, one at a time, and toggle off.
      await field.fill("2.5");
      assert.equal(await echoValue(page), 2.5);
      await page.getByTestId("fathom-million").click();
      assert.equal(await attr(page, "fathom-million", "aria-pressed"), "true");
      assert.equal(await echoValue(page), 2_500_000);
      // The field reads "2.5 million": the lit key's word right after the number, whole.
      const scale = await page.getByTestId("fathom-scale").evaluate((el) => {
        const word = el.lastChild.textContent.trim();
        const typed = el.querySelector(".fathom-scale-typed").getBoundingClientRect();
        const box = el.getBoundingClientRect();
        return { word, shown: getComputedStyle(el).visibility === "visible", whole: el.scrollWidth <= el.clientWidth + 1, after: typed.right <= box.right };
      });
      assert.deepEqual(scale, { word: "million", shown: true, whole: true, after: true });
      await page.getByTestId("fathom-billion").click();
      assert.equal(await attr(page, "fathom-million", "aria-pressed"), "false");
      assert.equal(await echoValue(page), 2_500_000_000);
      await page.getByTestId("fathom-billion").click();
      assert.equal(await attr(page, "fathom-billion", "aria-pressed"), "false");
      assert.equal(await echoValue(page), 2.5);
      assert.equal(await page.getByTestId("fathom-scale").count(), 0, "no word with no key lit");
      if (vp.name === "desktop") assert.equal(await field.evaluate((el) => el === document.activeElement), true, "the keys leave focus in the field");

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
      assert.equal(await attr(page, "fathom-echo", "data-tone"), "value");

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
      // No made-up yardstick ("most people miss by about x feels made up"): one rule for every question, still on screen
      // with the first question's reveal. No running total yet: it would only repeat the points.
      assert.equal(await page.getByTestId("fathom-typical").count(), 0, "no typical-miss line");
      assert.equal(await page.getByTestId("fathom-rule").count(), 1, "the rule stays with the first reveal");
      assert.equal(await page.getByTestId("fathom-running").count(), 0, "no running total on the first question");
      assert.equal(await page.getByTestId("fathom-gauge").locator("svg").count(), 1, "the sonar is drawn");
      const source = page.getByTestId("fathom-source");
      assert.equal(await source.getAttribute("href"), first.source.url);
      assert.equal(await source.getAttribute("target"), "_blank");
      assert.equal(await noHScroll(page), true);
      // NEXT takes focus a beat after the reveal (so a held Enter presses nothing), then Enter moves on.
      await page.waitForFunction(() => document.activeElement?.dataset.testid === "fathom-next");

      // Four more: typed with separators, a short form, the THOUSAND key, and far off.
      const guesses = [
        (q) => ({ text: Math.round(q.answer * 2).toLocaleString("en-US"), value: Math.round(q.answer * 2) }),
        (q) => ({ text: `${q.answer / 3}`, value: q.answer / 3 }),
        () => ({ text: "4", key: "fathom-thousand", value: 4000 }),
        () => ({ text: "1.5bn", value: 1.5e9 }),
      ];
      for (const make of guesses) {
        await page.keyboard.press("Enter");
        await page.getByTestId("fathom-input").waitFor();
        assert.equal(await page.getByTestId("fathom-rule").count(), 0, "the rule is said on the first question only");
        const q = await shownQuestion(page);
        played.push(q);
        const g = make(q);
        await page.getByTestId("fathom-input").fill(g.text);
        if (g.key) await page.getByTestId(g.key).click();
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
      // The rule again, in place of "a typical guesser scores about 250".
      assert.equal(await page.getByTestId("fathom-rule").count(), 1, "the results say the rule");
      assert.equal(await page.getByTestId("fathom-typical-total").count(), 0, "no typical-guesser line");
      // The key that draws new questions says so: "Play again" read as the same five again (UX.md 1 and 14).
      assert.doesNotMatch(await page.getByTestId("fathom-again").innerText(), /again/i);

      // COPY RESULT: "Fathom beta <total>/500" and five plain characters, no emoji.
      if (vp.name === "desktop") {
        await page.getByTestId("fathom-copy").click();
        const text = await page.evaluate(() => navigator.clipboard.readText());
        assert.match(text, new RegExp(`^Fathom beta ${total}/500\\n\\S( \\S){4}$`));
        assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
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

      // Fathom keeps to its own key: the game's save is as it was.
      assert.deepEqual(await store(page), before);
      // Without a backend, no guess was sent or queued.
      assert.deepEqual(away, [], "requests off the site");
      assert.equal(await page.evaluate(() => localStorage.getItem("top-tens:fathom-outbox")), null, "no guesses queued");
      await ctx.close();
    });
  }

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

  // Nov 5 review: the decimal keypad (iOS) has no Return key, and with it up LOCK IN was under the keyboard. A phone
  // with its keyboard up shows the question, the field and LOCK IN: the page shrinks (Android), or the keyboard covers
  // its lower part and only the visual viewport says so (iOS, faked here). The real bank's longest questions.
  test("with the keyboard up, the question, the field and LOCK IN stay in view (phones)", async () => {
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "fathom", "questions.json"), "utf8")).questions;
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
        // The first question's scoring rule is still there, under LOCK IN, out of their way.
        if (i === 0) assert.equal(await page.getByTestId("fathom-ask").getByTestId("fathom-rule").count(), 1, `${where}: the rule under LOCK IN`);
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
      await page.getByTestId("fathom-input").fill("299792");
      await page.getByTestId("fathom-thousand").click();
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

  test("hidden: Home and the menu have no way to Fathom", async () => {
    const vp = VIEWPORTS.find((v) => v.name === "desktop");
    const { ctx, page } = await open(browser, vp);
    await page.getByTestId("today-list").waitFor();
    const traces = (scope) =>
      page.evaluate((scope) => {
        const root = document.querySelector(scope);
        return {
          links: [...root.querySelectorAll("a[href]")].filter((a) => /fathom/i.test(a.getAttribute("href"))).length,
          ids: [...root.querySelectorAll("[data-testid]")].filter((el) => /fathom/i.test(el.dataset.testid)).length,
          words: /fathom/i.test(root.innerText),
        };
      }, scope);
    assert.deepEqual(await traces("body"), { links: 0, ids: 0, words: false }, "Home");
    await page.getByTestId("menu-key").click();
    await page.getByTestId("menu").waitFor();
    assert.deepEqual(await traces('[data-testid="menu"]'), { links: 0, ids: 0, words: false }, "the menu");
    await page.keyboard.press("Escape");
    // Only the link opens it.
    await go(page, "#fathom");
    await page.getByTestId("fathom").waitFor();
    await ctx.close();
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

/**
 * Every visible control's reach (e2e/touch.e2e.cjs has the same check for the other screens): the points 22px above
 * and below its middle (and beside it, if it's narrower than 44px) must press it, unless another control is there.
 */
const shortReach = (page) =>
  page.evaluate(() => {
    const CONTROL = 'a[href], button, input, [role="button"], [role="switch"]';
    const out = [];
    for (const el of document.querySelectorAll(`main ${CONTROL.split(", ").join(", main ")}`)) {
      if (el.disabled || !el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true, opacityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.top < 30 || r.bottom > innerHeight - 30 || r.left < 0 || r.right > innerWidth) continue;
      // A link inside a sentence is as tall as its line (WCAG 2.5.8 leaves those out).
      if (el.matches("a") && getComputedStyle(el).display === "inline") continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const sideways = r.width < 44 && !(innerWidth < 360 && el.closest(".game-head"));
      const spots = [[cx, cy - 21.5], [cx, cy + 21.5], ...(sideways ? [[cx - 21.5, cy], [cx + 21.5, cy]] : [])];
      for (const [x, y] of spots) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || el.contains(hit) || hit.closest(CONTROL)) continue;
        // The field's box is the input's own reach (a tap on it focuses the input).
        if (el.matches("input") && hit.closest("label")?.contains(el)) continue;
        out.push(`${el.tagName.toLowerCase()} ${el.dataset.testid ?? el.getAttribute("aria-label") ?? ""} ${Math.round(r.width)}x${Math.round(r.height)}: misses ${Math.round(x - cx)},${Math.round(y - cy)}`);
        break;
      }
    }
    return out;
  });
