// Fathom, the estimation beta (#fathom): five questions that ask for a number. The questions come from
// e2e/fixtures/fathom/questions.json (twelve real facts, one per kind), served in place of public/fathom/questions.json.
// - A full game on phone and desktop: the draw (five kinds, the first easy), the field (2.5m, the MILLION key, the
//   echo), invalid input, the reveal, the results (the total is the sum), COPY RESULT, PLAY AGAIN draws new questions,
//   and the game's own save is left alone.
// - A reload picks the game up where it was.
// - No horizontal scroll at 320px, and every control 44px to the finger.
// - A missing questions file says so.
// - Hidden: Home and the menu have no way to it.
// Its hover, focus and press states are in the states walk (states.e2e.cjs); its look in visual.e2e.cjs.
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, VIEWPORTS, open, go, store, noHScroll } = require("./helpers.cjs");

const FIXTURE = path.join(__dirname, "fixtures", "fathom", "questions.json");
const BANK = JSON.parse(fs.readFileSync(FIXTURE, "utf8")).questions;
const byId = new Map(BANK.map((q) => [q.id, q]));
const KEY = "tentacle:fathom";

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

/** Serves the fixture bank (or `fulfill`, for a broken one) as the questions file. */
const bank =
  (fulfill = { path: FIXTURE, contentType: "application/json" }) =>
  (ctx) =>
    ctx.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill(fulfill));

/** Opens #fathom with the fixture bank, and Fathom's own save seeded once (`save`), if given. */
function openFathom(vp, { save, serve = bank(), ...opts } = {}) {
  return open(browser, vp, "#fathom", undefined, {
    ...opts,
    setup: async (ctx) => {
      await serve(ctx);
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

/** The scoring rule (src/game/fathom.ts), to check the screen against. */
const points = (guess, answer, typical) =>
  Math.round(100 * (1 - (2 / Math.PI) * Math.atan(Math.abs(Math.log10(guess / answer)) / Math.log10(typical))));

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
    test(`a full game: the field, the reveal, the results, play again (${vp.name})`, async () => {
      const { ctx, page } = await openFathom(vp);
      if (vp.name === "desktop") await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
      const before = await store(page);
      await page.getByTestId("fathom-input").waitFor();

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

      // 2.5m is 2.5 million (or 2.5 metres on a question in metres).
      await field.fill("2.5m");
      assert.equal(await echoValue(page), first.unit === "metres" ? 2.5 : 2_500_000);
      assert.equal(await attr(page, "fathom-echo", "role"), "status", "the echo is read out politely");
      // The keys multiply what's typed, one at a time, and toggle off.
      await field.fill("2.5");
      assert.equal(await echoValue(page), 2.5);
      await page.getByTestId("fathom-million").click();
      assert.equal(await attr(page, "fathom-million", "aria-pressed"), "true");
      assert.equal(await echoValue(page), 2_500_000);
      await page.getByTestId("fathom-billion").click();
      assert.equal(await attr(page, "fathom-million", "aria-pressed"), "false");
      assert.equal(await echoValue(page), 2_500_000_000);
      await page.getByTestId("fathom-billion").click();
      assert.equal(await attr(page, "fathom-billion", "aria-pressed"), "false");
      assert.equal(await echoValue(page), 2.5);
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
        const q = await shownQuestion(page);
        played.push(q);
        const g = make(q);
        await page.getByTestId("fathom-input").fill(g.text);
        if (g.key) await page.getByTestId(g.key).click();
        await page.getByTestId("fathom-lock").click();
        await page.getByTestId("fathom-reveal").waitFor();
        assert.equal(Number(await attr(page, "fathom-guess", "data-value")), g.value);
        const want = points(g.value, q.answer, q.typical);
        expected.push(want);
        assert.equal(Number(await attr(page, "fathom-reveal", "data-points")), want, `${q.id}: ${g.value} vs ${q.answer}`);
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

      // COPY RESULT: "Fathom beta <total>/500" and five plain characters, no emoji.
      if (vp.name === "desktop") {
        await page.getByTestId("fathom-copy").click();
        const text = await page.evaluate(() => navigator.clipboard.readText());
        assert.match(text, new RegExp(`^Fathom beta ${total}/500\\n\\S( \\S){4}$`));
        assert.doesNotMatch(text, /\p{Extended_Pictographic}/u);
      }

      // PLAY AGAIN: a new draw, none of the five just played (the bank has room).
      const firstIds = played.map((q) => q.id);
      await page.getByTestId("fathom-again").click();
      await page.getByTestId("fathom-input").waitFor();
      const saved = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY));
      assert.equal(saved.game.ids.length, 5);
      assert.deepEqual(saved.game.ids.filter((id) => firstIds.includes(id)), [], "PLAY AGAIN holds back the last game's questions");
      assert.equal(saved.game.ids[0], (await shownQuestion(page)).id);
      assert.equal((await shownQuestion(page)).easy, true);
      assert.deepEqual(saved.recent[1], firstIds, "the last games are remembered, newest first");

      // Fathom keeps to its own key: the game's save is as it was.
      assert.deepEqual(await store(page), before);
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
