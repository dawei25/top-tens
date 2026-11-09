// Roll new list before play: a rolled list (Random list, a category, Roll new list) offers it until the first guess, a
// rolled Blitz (Random Blitz, a category, Roll new list) until the clock starts. It is its own box, outside the guess
// panel and right of it (owner, Nov 6), level with the guess row and no taller (owner, Nov 7: "desktop, the new button
// is too tall"): the pill on a phone, the input and GUESS from 700px (beside the floating guess box; from 1100px in the
// open water right of the control card). Its label takes two lines at most and isn't squeezed ("mobile, the words are
// too crammed"), and the guess box beside it still shows its placeholder and a typical answer whole. Under 320px it
// sits directly above the guess panel instead, full width. It lands on another list, keeps offering itself there, and
// goes once play starts (a losing game can't be dodged): the panel then takes the full width, its left edge where it
// was, and nothing else moves. Never on a daily, a daily's own Blitz or a list opened directly.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, go, hash, puzzle, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

/** A typical long answer (the narrow-phone CSS sizes the box for it). */
const TYPICAL = "Dhaulagiri I";
const top = async (loc) => Math.round((await loc.boundingBox()).y);

/**
 * The guess panel, the roll box and the guess box, as laid out (untransformed boxes are what "nothing moves" means).
 * `row` is what the roll box lines up with: the guess row, the input and GUESS (the pill, on a phone). `whole` is the
 * panel's outer frame: the form (phones and from 700px) or the control card (from 1100px). `label` is how the roll
 * box sets its words: their lines, size, letter-spacing and line height, and the extent of the lines.
 */
const layout = (page, typical = TYPICAL) =>
  page.evaluate((typical) => {
    const box = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom };
    };
    const input = document.querySelector('input[aria-label="Your guess"]');
    const form = input.closest("form");
    const vw = innerWidth;
    const cs = getComputedStyle(input);
    // The placeholder and a typical answer, in the box's own font, against the room inside its padding and border.
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const roll = document.querySelector('[data-testid="reroll"]');
    let label = null;
    if (roll) {
      const range = document.createRange();
      range.selectNodeContents(roll);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      const rs = getComputedStyle(roll);
      const size = parseFloat(rs.fontSize);
      label = {
        lines: new Set(rects.map((r) => Math.round(r.top))).size,
        size,
        spacing: parseFloat(rs.letterSpacing) / size,
        leading: parseFloat(rs.lineHeight) / size,
        x: Math.min(...rects.map((r) => r.left)),
        r: Math.max(...rects.map((r) => r.right)),
        y: Math.min(...rects.map((r) => r.top)),
        b: Math.max(...rects.map((r) => r.bottom)),
      };
    }
    return {
      input: box(input),
      guess: box(form.querySelector('button[type="submit"]')),
      row: box(input.closest(".guess-row")),
      whole: box(vw < 1100 ? form : form.closest(".control-card")),
      feedback: box(form.querySelector(".feedback-line")),
      roll: box(roll),
      label,
      header: box(document.querySelector(".game-head")),
      placeholderFits: ctx.measureText(input.placeholder).width <= room,
      typicalFits: ctx.measureText(typical).width <= room,
      viewport: vw,
    };
  }, typical);

const near = (a, b, by = 0.5) => Math.abs(a - b) <= by;

/**
 * Before play: the roll box is outside the guess panel and right of it, level with the guess row and no taller, on
 * screen, its label in two lines at most and not squeezed; the guess box keeps its room.
 */
async function besidePanel(page, where = "") {
  const l = await layout(page);
  const at = `${where} ${l.viewport}px`;
  // Outside the guess panel: its own box, clear of the panel's frame (it sits in the form's markup, not its look).
  if (l.viewport < 320) {
    // Stacked: directly above the guess panel (and its feedback line), full width.
    assert.ok(l.roll.b <= l.feedback.y && l.roll.b <= l.row.y, `${at}: the roll box is above the guess panel`);
    assert.ok(near(l.roll.x, l.whole.x) && near(l.roll.r, l.whole.r), `${at}: the roll box is as wide as the guess panel`);
  } else {
    assert.ok(l.roll.x >= l.whole.r + 4, `${at}: the roll box is right of the guess panel, apart from it`);
    // Owner, Nov 7: "desktop, the new button is too tall" (it was the whole control card, 261px beside Blitz's clock).
    assert.ok(l.roll.h <= l.row.h + 2, `${at}: the roll box is no taller than the guess row (${l.roll.h}px, the row ${l.row.h}px)`);
    assert.ok(near(l.roll.y, l.row.y, 2) && near(l.roll.b, l.row.b, 2), `${at}: the roll box is level with the guess row, top and bottom`);
  }
  assert.ok(l.roll.r <= l.viewport, `${at}: the roll box fits on the screen`);
  // From 1100px it sits in the frame, in the open water right of the control card.
  if (l.viewport >= 1100) assert.ok(near(l.roll.r, l.header.r), `${at}: the roll box ends at the frame's edge`);
  assert.ok(l.roll.w >= 44 && l.roll.h >= 44, `${at}: the roll box is at least 44px (${l.roll.w}x${l.roll.h})`);
  // Owner, Nov 7: "mobile, the words are too crammed" (three lines, at 0.05-0.08em and a line height of 1). A phone's
  // keys space their letters 0.15em (GUESS, the results keys at 320); wider, the box keeps its 0.1em.
  const t = l.label;
  const spacing = l.viewport < 700 ? 0.15 : 0.1;
  assert.ok(t.lines <= 2, `${at}: the roll box's label takes at most two lines (${t.lines})`);
  assert.ok(t.size >= 15, `${at}: the roll box's label is at least 15px (${t.size}px)`);
  assert.ok(t.spacing >= spacing - 1e-6, `${at}: the roll box's label keeps a key's letter-spacing (${t.spacing.toFixed(3)}em)`);
  assert.ok(t.leading >= 1.1 - 1e-6, `${at}: the roll box's lines aren't pressed together (line height ${t.leading.toFixed(2)})`);
  assert.ok(t.x >= l.roll.x && t.r <= l.roll.r && t.y >= l.roll.y && t.b <= l.roll.b, `${at}: the roll box's label stays inside it`);
  assert.ok(l.placeholderFits, `${at}: the placeholder fits the guess box`);
  assert.ok(l.typicalFits, `${at}: "${TYPICAL}" fits the guess box (${l.input.w}px)`);
  return l;
}

/**
 * Once play starts: the roll box is gone from sight, the panel takes the full width (its left edge where it was, out to
 * where the roll box ended; from 1100px the card was always full width and stays put).
 */
async function panelTakesRoom(page, was) {
  const roll = page.getByTestId("reroll");
  await roll.waitFor({ state: "hidden" });
  assert.equal(await roll.isVisible(), false);
  const target = was.viewport >= 1100 || was.viewport < 320 ? was.whole.r : was.roll.r;
  // The panel stretches into the room over a moment; wait for it to settle there.
  await page.waitForFunction((r) => Math.abs(document.querySelector("form.guess").closest(innerWidth < 1100 ? "form" : ".control-card").getBoundingClientRect().right - r) <= 0.5, target);
  const now = await layout(page);
  assert.ok(near(now.whole.x, was.whole.x), "the guess panel's left edge stays put");
  assert.ok(near(now.whole.r, target), `the guess panel takes the full width (to ${now.whole.r}, not ${target})`);
  assert.ok(near(now.input.x, was.input.x), "the guess box starts where it did");
  return now;
}

for (const vp of VIEWPORTS) {
  test(`Roll new list before a rolled list's first guess (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const roll = page.getByTestId("reroll");
    await page.getByTestId("random-list").click();
    await page.getByTestId("give-up").waitFor();
    const first = await hash(page);
    assert.ok(await roll.isVisible());
    await besidePanel(page, "a rolled list");

    // It rolls another list, a fresh game, which offers it too.
    await roll.click();
    await page.waitForFunction((h) => location.hash !== h, first);
    await page.getByTestId("give-up").waitFor();
    const second = await hash(page);
    assert.match(second, /^#p-/);
    assert.notEqual(second, first);
    await roll.waitFor();
    assert.equal(await page.getByTestId("lives").getAttribute("data-lives"), "5");

    // The first guess ends it: the guess panel takes its room, and the board doesn't move.
    const was = await besidePanel(page, "the next list");
    const board = page.getByTestId("slot").first();
    const boardTop = await top(board);
    const p = await puzzle(page, second.replace(/^#p-/, ""));
    await guess(page, p.answers[0].name);
    await panelTakesRoom(page, was);
    assert.equal(await top(board), boardTop, "the board stays put");

    // Not on today's list, nor on a list opened directly. Rolls are really random, and a list rolled in this tab
    // keeps its roll box, so open one that neither roll landed on (a fixed id failed whenever a roll hit it).
    await page.getByTestId("nav-home").click();
    await page.getByTestId("today-list").click();
    await page.getByTestId("give-up").waitFor();
    assert.equal(await roll.count(), 0);
    const direct = ["#p-mountains", "#p-capitals", "#p-dog-breeds"].find((h) => h !== first && h !== second);
    await go(page, direct);
    await page.getByTestId("give-up").waitFor();
    assert.equal(await hash(page), direct);
    assert.equal(await roll.count(), 0);
    await ctx.close();
  });

  test(`Roll new list before a rolled Blitz starts (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const roll = page.getByTestId("reroll");
    const screen = page.getByTestId("blitz-screen");
    await page.getByTestId("random-blitz").click();
    await page.getByTestId("blitz-clock").waitFor();
    const first = await screen.getAttribute("data-list");
    assert.ok(await roll.isVisible());
    await besidePanel(page, "a rolled Blitz");

    // Another list, a fresh round, still before its clock: it offers the roll box too.
    await roll.click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="blitz-screen"]')?.dataset.list !== id, first);
    const second = await screen.getAttribute("data-list");
    assert.notEqual(second, first);
    assert.equal(await hash(page), `#blitz-${second}`);
    await roll.waitFor();
    assert.equal(await page.getByTestId("blitz-clock").getAttribute("data-started"), "false");

    // The first keystroke starts the clock and ends it; the panel takes its room, the clock and the score stay put.
    const was = await besidePanel(page, "the next Blitz");
    const clock = page.getByTestId("blitz-clock");
    const score = page.getByTestId("blitz-score");
    const [clockTop, scoreTop] = [await top(clock), await top(score)];
    await page.getByLabel("Your guess").pressSequentially("a");
    assert.equal(await clock.getAttribute("data-started"), "true");
    await panelTakesRoom(page, was);
    assert.equal(await top(clock), clockTop);
    assert.equal(await top(score), scoreTop);

    // Never on a daily's own Blitz (Play Blitz on a finished daily's results): it wasn't rolled.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("today-list").click();
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();
    await page.getByTestId("blitz-key").click();
    await page.getByTestId("blitz-clock").waitFor();
    assert.equal(await roll.count(), 0);
    await ctx.close();
  });

  // The owner's report: a Random Blitz without its roll key. Reached through the Home key from another screen (a Blitz
  // opened by its link, which has none), Random Blitz and a category pick both offer it before the first keystroke.
  test(`Roll new list on a Blitz rolled from Home, through the Home key (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "#blitz-airports");
    const roll = page.getByTestId("reroll");
    const clock = page.getByTestId("blitz-clock");
    await clock.waitFor();
    assert.equal(await roll.count(), 0, "not on a Blitz opened by its link");

    await page.getByTestId("nav-home").click();
    await page.getByTestId("random-blitz").click();
    await page.waitForFunction(() => /^#blitz-/.test(location.hash));
    await clock.waitFor();
    assert.equal(await clock.getAttribute("data-started"), "false");
    await roll.waitFor();
    await besidePanel(page, "Random Blitz");

    await page.getByTestId("nav-home").click();
    await page.getByTestId("random-blitz-categories").click();
    const chip = page.locator('[data-testid="category"][data-mode="blitz"]').first();
    const category = await chip.getAttribute("data-category");
    await chip.click();
    await page.waitForFunction(() => /^#blitz-/.test(location.hash));
    await clock.waitFor();
    assert.equal(await clock.getAttribute("data-started"), "false");
    await roll.waitFor();
    await besidePanel(page, "a category's Blitz");
    // Rolled in that category (when it has another list open, Roll new list stays in it too).
    const id = await page.getByTestId("blitz-screen").getAttribute("data-list");
    const index = await page.evaluate(async () => (await fetch("puzzles/index.json")).json());
    assert.equal(index.find((m) => m.id === id)?.category, category);
    await ctx.close();
  });
}

// Every width the layout changes at: phones (the pill) down to 320, the stack under it, the floating box from 700px,
// the control card from 1100px; and the narrowest width of each step of the guess box's type beside it (340, 360, 380,
// 390: at 340 and 380 "Dhaulagiri I" lost its last letter before Nov 7). Each shows the box right of the panel (or
// above it), and the panel takes the room once play starts.
test("the roll box beside the guess panel, and the panel taking its room, at every layout", async () => {
  for (const width of [300, 320, 340, 360, 375, 380, 390, 430, 700, 768, 1024, 1100, 1280]) {
    for (const mode of ["list", "blitz"]) {
      const phone = width < 700;
      const vp = { viewport: { width, height: phone ? 844 : 900 }, isMobile: phone, hasTouch: phone };
      const { ctx, page } = await open(browser, vp, "", undefined, { reducedMotion: "reduce" });
      await page.getByTestId(mode === "list" ? "random-list" : "random-blitz").click();
      await page.getByTestId("reroll").waitFor();
      const was = await besidePanel(page, mode);
      const box = page.getByLabel("Your guess");
      if (mode === "list") {
        await box.fill("zzqx");
        await box.press("Enter");
      } else await box.pressSequentially("a");
      await panelTakesRoom(page, was);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px ${mode}: no sideways scroll`);
      await ctx.close();
    }
  }
});
