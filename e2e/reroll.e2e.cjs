// Roll again before play: a rolled list (Random list, a category, Roll again) offers it until the first guess, a rolled
// Blitz (Random Blitz, a category, Roll again) until the clock starts. It is its own key right of GUESS, in the guess
// row, as tall as GUESS, with the box still wide enough to read a typed name. It lands on another list, keeps offering
// itself there, and goes once play starts (a losing game can't be dodged): it fades out of its slot, so the guess box
// and GUESS stay exactly where they were. Never on a daily, Today's Blitz or a list opened directly (no slot there).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, go, hash, puzzle, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const top = async (loc) => Math.round((await loc.boundingBox()).y);
/** The guess row's three parts, as laid out (untransformed boxes are what "nothing moves" means). */
const row = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const input = document.querySelector('input[aria-label="Your guess"]');
    const keys = input.parentElement;
    const cs = getComputedStyle(input);
    // The placeholder, in the box's own font, against the room inside its padding and border.
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return {
      input: box(input),
      guess: box(keys.querySelector('button[type="submit"]')),
      reroll: box(keys.querySelector('[data-testid="reroll"]')),
      placeholderFits: ctx.measureText(input.placeholder).width <= room,
      viewport: innerWidth,
    };
  });

/** Roll again sits right of GUESS on the same row, as tall, inside the screen; the box keeps room for a name. */
async function besideGuess(page) {
  const r = await row(page);
  const near = (a, b) => Math.abs(a - b) <= 0.5;
  assert.ok(r.reroll.x >= r.guess.x + r.guess.w, "Roll again is right of GUESS");
  assert.ok(near(r.reroll.y, r.guess.y) && near(r.reroll.h, r.guess.h), "Roll again is as tall as GUESS, on its row");
  assert.ok(near(r.input.y, r.guess.y), "the box is on the same row");
  assert.ok(r.reroll.x + r.reroll.w <= r.viewport, "Roll again fits on the screen");
  assert.ok(r.input.w >= 160, `the guess box keeps room for a typed name (${r.input.w}px)`);
  assert.ok(r.placeholderFits, "the placeholder fits the box");
  return r;
}

/** After play starts: Roll again is gone from sight, and the box and GUESS are exactly where they were. */
async function goneInPlace(page, was) {
  const reroll = page.getByTestId("reroll");
  await reroll.waitFor({ state: "hidden" });
  assert.equal(await reroll.isVisible(), false);
  const now = await row(page);
  assert.deepEqual(now.input, was.input, "the guess box stays put");
  assert.deepEqual(now.guess, was.guess, "GUESS stays put");
}

for (const vp of VIEWPORTS) {
  test(`Roll again before a rolled list's first guess (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const reroll = page.getByTestId("reroll");
    await page.getByTestId("random-list").click();
    await page.getByTestId("give-up").waitFor();
    const first = await hash(page);
    assert.ok(await reroll.isVisible());
    await besideGuess(page);

    // It rolls another list, a fresh game, which offers it too.
    await reroll.click();
    await page.waitForFunction((h) => location.hash !== h, first);
    await page.getByTestId("give-up").waitFor();
    const second = await hash(page);
    assert.match(second, /^#p-/);
    assert.notEqual(second, first);
    await reroll.waitFor();
    assert.equal(await page.getByTestId("lives").getAttribute("data-lives"), "5");

    // The first guess ends it, and nothing moved as it went.
    const was = await besideGuess(page);
    const board = page.getByTestId("slot").first();
    const boardTop = await top(board);
    const p = await puzzle(page, second.replace(/^#p-/, ""));
    await guess(page, p.answers[0].name);
    await goneInPlace(page, was);
    assert.equal(await top(board), boardTop, "the board stays put");

    // Not on today's list, nor on a list opened directly.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("today-list").click();
    await page.getByTestId("give-up").waitFor();
    assert.equal(await reroll.count(), 0);
    await go(page, "#p-mountains");
    await page.getByTestId("give-up").waitFor();
    assert.equal(await hash(page), "#p-mountains");
    assert.equal(await reroll.count(), 0);
    await ctx.close();
  });

  test(`Roll again before a rolled Blitz starts (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const reroll = page.getByTestId("reroll");
    const screen = page.getByTestId("blitz-screen");
    await page.getByTestId("random-blitz").click();
    await page.getByTestId("blitz-clock").waitFor();
    const first = await screen.getAttribute("data-list");
    assert.ok(await reroll.isVisible());
    await besideGuess(page);

    // Another list, a fresh round, still before its clock: it offers Roll again too.
    await reroll.click();
    await page.waitForFunction((id) => document.querySelector('[data-testid="blitz-screen"]')?.dataset.list !== id, first);
    const second = await screen.getAttribute("data-list");
    assert.notEqual(second, first);
    assert.equal(await hash(page), `#blitz-${second}`);
    await reroll.waitFor();
    assert.equal(await page.getByTestId("blitz-clock").getAttribute("data-started"), "false");

    // The first keystroke starts the clock and ends it; the box, GUESS, the clock and the score stay where they were.
    const was = await besideGuess(page);
    const clock = page.getByTestId("blitz-clock");
    const score = page.getByTestId("blitz-score");
    const [clockTop, scoreTop] = [await top(clock), await top(score)];
    await page.getByLabel("Your guess").pressSequentially("a");
    assert.equal(await clock.getAttribute("data-started"), "true");
    await goneInPlace(page, was);
    assert.equal(await top(clock), clockTop);
    assert.equal(await top(score), scoreTop);

    // Never on Today's Blitz.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("today-blitz").click();
    await page.getByTestId("blitz-clock").waitFor();
    assert.equal(await reroll.count(), 0);
    await ctx.close();
  });

  // The owner's report: a Random Blitz without Roll again. Reached through the Home key from another screen (a Blitz
  // opened by its link, which has none), Random Blitz and a category pick both offer it before the first keystroke.
  test(`Roll again on a Blitz rolled from Home, through the Home key (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "#blitz-airports");
    const reroll = page.getByTestId("reroll");
    const clock = page.getByTestId("blitz-clock");
    await clock.waitFor();
    assert.equal(await reroll.count(), 0, "not on a Blitz opened by its link");

    await page.getByTestId("nav-home").click();
    await page.getByTestId("random-blitz").click();
    await page.waitForFunction(() => /^#blitz-/.test(location.hash));
    await clock.waitFor();
    assert.equal(await clock.getAttribute("data-started"), "false");
    await reroll.waitFor();
    await besideGuess(page);

    await page.getByTestId("nav-home").click();
    await page.getByTestId("random-blitz-categories").click();
    const chip = page.locator('[data-testid="category"][data-mode="blitz"]').first();
    const category = await chip.getAttribute("data-category");
    await chip.click();
    await page.waitForFunction(() => /^#blitz-/.test(location.hash));
    await clock.waitFor();
    assert.equal(await clock.getAttribute("data-started"), "false");
    await reroll.waitFor();
    await besideGuess(page);
    // Rolled in that category (when it has another list open, Roll again stays in it too).
    const id = await page.getByTestId("blitz-screen").getAttribute("data-list");
    const index = await page.evaluate(async () => (await fetch("puzzles/index.json")).json());
    assert.equal(index.find((m) => m.id === id)?.category, category);
    await ctx.close();
  });
}
