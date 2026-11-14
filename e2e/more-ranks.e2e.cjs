// Ranks 11 to 20 under a finished list's board, shown directly (the owner, Nov 14: "instead of having this as a button
// just show it directly. be sure to differentiate the top 10 from 11-20 tho"; from Nov 8 to 14 a "See 11 to 20" key
// opened them). A divider labelled "11 to 20" ("11 to 15" when the list stops sooner), then the rows with their
// figures, quieter than the top 10 (smaller, dimmer, no row lines); the ones the player guessed (a life each) in the
// misses' pink. On the results, the list's past run and an archive daily's results; never during play, never on a
// Blitz, and no key. Long names stay inside the board at 320, 390 and 1440, with no sideways scroll.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, TODAY, open, go, puzzle, guess, giveUp, noHScroll } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "airports"; // ranks 11 to 20 all there, long names
const SHORT = "car-makers"; // stops at 15
const NONE = "dog-breeds"; // nothing ranked past 10
const PINK = "rgb(255, 93, 143)";
/** The figure a row shows (src/game/state.ts shownValue): none when it only repeats the rank ("#12"). */
const shownValue = (e) => (!e.value || (e.value.trim().startsWith("#") && e.value.replace(/[#\s]/g, "") === String(e.rank)) ? null : e.value);
const WIDTHS = [...VIEWPORTS, { name: "phone 320", viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true }];

/** What the rows show: rank, name, figure, and whether each is marked as guessed (and drawn pink). */
const rows = (page) =>
  page.getByTestId("more-rank").evaluateAll((els, pink) =>
    els.map((el) => ({
      rank: Number(el.dataset.rank),
      name: el.querySelector(".name").firstChild.textContent,
      value: el.querySelector(".value")?.textContent ?? null,
      guessed: el.dataset.guessed === "true",
      pink: getComputedStyle(el.querySelector(".name")).color === pink,
    })),
  PINK);

/** How the rows sit and look next to the top 10: order, sizes, ink, row lines, and whether anything sticks out. */
const layout = (page) =>
  page.evaluate(() => {
    const css = (el, sel) => getComputedStyle(sel ? el.querySelector(sel) : el);
    const px = (el, sel, prop) => parseFloat(css(el, sel)[prop]);
    // Brightness of a text colour as drawn (its alpha counted), to compare ink.
    const ink = (el, sel) => {
      const [r, g, b, a = 1] = css(el, sel).color.match(/[\d.]+/g).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
    };
    const board = document.querySelector("section.board").getBoundingClientRect();
    const tenth = document.querySelector('[data-testid="slot"][data-rank="10"]');
    const label = document.querySelector('[data-testid="more-ranks-label"]');
    const next = [...document.querySelectorAll('[data-testid="more-rank"]')];
    const plain = next.filter((el) => !el.dataset.guessed);
    // Each part a row has, against the 10th row's (a missed one, drawn muted) where it has it too.
    const both = (el, c) => !!el.querySelector(`.${c}`) && !!tenth.querySelector(`.${c}`);
    const out = (el) => {
      const r = el.getBoundingClientRect();
      return r.left < board.left - 0.5 || r.right > board.right + 0.5 || el.scrollWidth > el.clientWidth + 1;
    };
    return {
      ordered: tenth.getBoundingClientRect().bottom <= label.getBoundingClientRect().top && label.getBoundingClientRect().bottom <= next[0].getBoundingClientRect().top,
      smaller: next.every((el) => ["rank", "name", "value"].every((c) => !both(el, c) || px(el, `.${c}`, "fontSize") < px(tenth, `.${c}`, "fontSize"))),
      dimmer: plain.every((el) => ink(el, ".rank") < ink(tenth, ".rank") && (!both(el, "value") || ink(el, ".value") < ink(tenth, ".value")) && ink(el, ".name") <= ink(tenth, ".name")),
      lines: next.some((el) => css(el).borderTopStyle !== "none" || css(el).borderBottomStyle !== "none"),
      slotStyled: next.some((el) => el.classList.contains("slot") || el.querySelector(".key, button")),
      sticksOut: next.flatMap((el) => [el, ...el.querySelectorAll(".name, .value")]).filter(out).map((el) => el.textContent),
    };
  });

/** The results' ranks 11 to 20: there without a click, in order with their figures, the guessed one pink, quieter than the top 10. */
async function shown(page, p, where, { near, label = "11 to 20" } = {}) {
  assert.equal(await page.getByTestId("more-ranks-toggle").count(), 0, `${where}: a key`);
  assert.ok(await page.getByTestId("more-ranks").isVisible(), `${where}: ranks 11+ not shown`);
  assert.equal((await page.getByTestId("more-ranks-label").textContent()).trim(), label, where);
  const want = p.extras
    .filter((e) => e.rank >= 11 && e.rank <= 20)
    .sort((a, b) => a.rank - b.rank)
    .map((e) => ({ rank: e.rank, name: e.name, value: shownValue(e), guessed: e.rank === near?.rank, pink: e.rank === near?.rank }));
  assert.deepEqual(await rows(page), want, where);
  const l = await layout(page);
  assert.ok(l.ordered, `${where}: the divider sits between the 10th row and the 11th`);
  assert.ok(l.smaller, `${where}: ranks 11+ as big as the top 10`);
  assert.ok(l.dimmer, `${where}: ranks 11+ as bright as the top 10`);
  assert.equal(l.lines, false, `${where}: ranks 11+ have row lines`);
  assert.equal(l.slotStyled, false, `${where}: ranks 11+ styled as slots or keys`);
  assert.deepEqual(l.sticksOut, [], `${where}: sticks out of the board`);
  assert.ok(await noHScroll(page), `${where}: sideways scroll`);
}

const none = async (page, where) => {
  for (const id of ["more-ranks", "more-rank", "more-ranks-label", "more-ranks-toggle"]) {
    assert.equal(await page.getByTestId(id).count(), 0, `${where}: ${id}`);
  }
};

for (const vp of WIDTHS) {
  test(`a finished list shows ranks 11 to 20 directly, the guessed one pink (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`, undefined, { reducedMotion: "reduce" });
    await page.getByLabel("Your guess").waitFor();
    const p = await puzzle(page, LIST);
    const near = p.extras.find((e) => e.rank === 13);
    await guess(page, p.answers[0].name);
    await guess(page, near.name);
    assert.equal(await page.getByTestId("lives").getAttribute("data-lives"), "4", "the near miss cost a life");
    // Never during play, a guessed one included.
    await none(page, "during play");
    await giveUp(page);
    await page.clock.runFor(3000);
    await shown(page, p, "the results", { near });

    // The same in its past run.
    await go(page, "#history");
    await page.locator('[data-testid="history-row"][data-kind="list"]').first().click();
    await page.getByTestId("run-view").waitFor();
    await shown(page, p, "its past run", { near });

    // An archive daily's results: an old day whose list has all of ranks 11 to 20.
    const days = await page.evaluate(async () => (await fetch("puzzles/daily.json")).json());
    let day;
    for (const d of days.filter((x) => x.date < TODAY && x.id !== LIST)) {
      const dp = await puzzle(page, d.id);
      if (new Set(dp.extras.filter((e) => e.rank >= 11 && e.rank <= 20).map((e) => e.rank)).size === 10) {
        day = { ...d, p: dp };
        break;
      }
    }
    assert.ok(day, "an old daily with ranks 11 to 20");
    await go(page, `#daily-${day.date}`);
    await page.getByLabel("Your guess").waitFor();
    const twelfth = day.p.extras.find((e) => e.rank === 12);
    await guess(page, twelfth.name);
    await none(page, "an archive daily during play");
    await giveUp(page);
    await page.clock.runFor(3000);
    await shown(page, day.p, "an archive daily's results", { near: twelfth });

    // A list with nothing ranked past 10 shows none; nor does a Blitz.
    await go(page, `#p-${NONE}`);
    await page.getByLabel("Your guess").waitFor();
    await giveUp(page);
    await none(page, "a list with no ranks past 10");
    await go(page, `#blitz-${LIST}`);
    await page.getByLabel("Your guess").waitFor();
    await guess(page, p.answers[1].name);
    await none(page, "a Blitz during play");
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();
    await none(page, "a Blitz's results");
    await ctx.close();
  });
}

test('a list that stops at 15 shows 11 to 15 under a divider that says so (phones 320 and 390)', async () => {
  for (const vp of [WIDTHS[2], VIEWPORTS[1]]) {
    const { ctx, page } = await open(browser, vp, `#p-${SHORT}`, undefined, { reducedMotion: "reduce" });
    await page.getByLabel("Your guess").waitFor();
    const p = await puzzle(page, SHORT);
    const have = p.extras.filter((e) => e.rank >= 11 && e.rank <= 20).map((e) => e.rank);
    assert.equal(Math.max(...have), 15, `${SHORT} stops at 15`);
    await giveUp(page);
    await page.clock.runFor(3000);
    await shown(page, p, `${SHORT} (${vp.name})`, { label: "11 to 15" });
    assert.equal(await page.getByTestId("more-ranks").getAttribute("aria-label"), "Ranks 11 to 15");
    await ctx.close();
  }
});
