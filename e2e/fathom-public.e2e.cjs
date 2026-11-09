// Fathom as a full game mode (owner, Nov 9: "ship it now"), on phone and desktop:
// - Home's Free play: a Fathom key beside Random list and Random Blitz, the same keycap, its one line where the others
//   count their lists; it opens Fathom. Phone: under the two, as wide. Desktop: the row under the pair, from the left
//   of Random list to the right of Random Blitz.
// - The menu's Play group: a Fathom tile that opens it, marked while Fathom is on show.
// - How to play: a Fathom rule, with the game's own scoring line.
// - Stats: a Fathom block before the first game (0 games, placeholders) and after one (games, average, best of 500).
// - Past runs: a finished game under today's header, with its total; the row opens that game's results (the same
//   total and rows, the date it was played); Back returns to Past runs, and a deep link's Back goes up to it.
// - The share text: "Fathom <total>/500", the squares and the link to #fathom, every line but the last ending in two
//   spaces so the lines keep in a Reddit comment.
// - Nothing says beta: Home, the menu, How to play, Fathom's question, reveal and results, the share text, Stats,
//   Past runs.
// The sync of Fathom's games with an account: backend.e2e.cjs. The name-it round's lines at 320px: fathom-name.e2e.cjs.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, VIEWPORTS, TODAY, open, openTab, go, hash, store, noHScroll } = require("./helpers.cjs");

const FIXTURE = path.join(__dirname, "fixtures", "fathom", "questions.json");
const BANK = new Map(JSON.parse(fs.readFileSync(FIXTURE, "utf8")).questions.map((q) => [q.id, q]));
const serveBank = (ctx) => ctx.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill({ path: FIXTURE, contentType: "application/json" }));

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const box = (page, id) => page.getByTestId(id).boundingBox();
const noBeta = async (page, where) => assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /\bbeta\b/i, `${where} says beta`);

/** Plays the five questions on screen (each answer a little high), and returns the results' total. */
async function playGame(page) {
  for (let i = 0; i < 5; i++) {
    const field = page.getByTestId("fathom-input");
    await field.waitFor();
    const q = BANK.get(await page.getByTestId("fathom-question").getAttribute("data-question"));
    await field.fill(String(q.answer * 1.2));
    await page.getByTestId("fathom-lock").click();
    await page.getByTestId("fathom-reveal").waitFor();
    if (i === 0) await noBeta(page, "the reveal");
    await page.getByTestId("fathom-next").click();
  }
  await page.getByTestId("fathom-results").waitFor();
  return Number(await page.getByTestId("fathom-total").getAttribute("data-total"));
}

for (const vp of VIEWPORTS) {
  test(`Home's Free play has a Fathom key beside the other two, and it opens Fathom (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "", undefined, { setup: serveBank, reducedMotion: "reduce" });
    const key = page.getByTestId("fathom-key");
    await key.waitFor();
    await noBeta(page, "Home");
    // In Free play, the same keycap as Random list, its line where the others count their lists.
    assert.ok(await page.getByTestId("free-play").evaluate((el) => !!el.querySelector('[data-testid="fathom-key"]')));
    const classes = (id) => page.getByTestId(id).evaluate((el) => [...el.classList].filter((c) => c === "key" || c === "mode-key"));
    assert.deepEqual(await classes("fathom-key"), await classes("random-list"));
    assert.ok((await page.getByTestId("fathom-key-status").textContent()).trim().length > 0, "its one line");
    const [list, blitz, fathom] = [await box(page, "random-list"), await box(page, "random-blitz"), await box(page, "fathom-key")];
    const strip = await box(page, "random-blitz-categories");
    if (vp.name === "phone") {
      // Under the two, as wide as they are.
      assert.ok(fathom.y >= strip.y + strip.height, "under Random Blitz's strip");
      assert.equal(Math.round(fathom.x), Math.round(list.x));
      assert.equal(Math.round(fathom.width), Math.round(list.width));
    } else {
      // The row under the pair, across both.
      assert.ok(fathom.y >= strip.y + strip.height, "under the pair");
      assert.equal(Math.round(fathom.x), Math.round(list.x));
      assert.equal(Math.round(fathom.x + fathom.width), Math.round(blitz.x + blitz.width));
      assert.ok(fathom.height <= list.height, "no taller than the keys beside it need");
    }
    assert.ok(fathom.height >= 44, "44px to the finger");
    assert.ok(await noHScroll(page));
    // Hover, focus and press move nothing (states.e2e.cjs walks every control; this one by name).
    const rest = await box(page, "fathom-key");
    if (vp.name === "desktop") await key.hover();
    await key.focus();
    assert.deepEqual(await box(page, "fathom-key"), rest);
    await key.click();
    await page.getByTestId("fathom-question").waitFor();
    assert.equal(await hash(page), "#fathom");
    await noBeta(page, "Fathom's question");
    await ctx.close();
  });

  test(`the menu's Fathom tile opens it and is marked there (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "", undefined, { setup: serveBank, reducedMotion: "reduce" });
    await page.getByTestId("today-list").waitFor();
    await page.getByTestId("menu-key").click();
    const tile = page.getByTestId("menu-fathom");
    await tile.waitFor();
    await noBeta(page, "the menu");
    // In the Play group, with an icon like every tile.
    assert.ok(await page.getByTestId("menu-play").evaluate((el) => !!el.querySelector('[data-testid="menu-fathom"]')));
    assert.equal(await tile.locator("svg.menu-tile-icon").count(), 1);
    await tile.click();
    await page.getByTestId("fathom-question").waitFor();
    assert.equal(await hash(page), "#fathom");
    await page.getByTestId("menu-key").click();
    assert.deepEqual(await page.locator('[data-testid="menu"] [aria-current="page"]').evaluateAll((els) => els.map((e) => e.dataset.testid)), ["menu-fathom"]);
    await page.getByTestId("menu-fathom").click();
    await page.getByTestId("menu").waitFor({ state: "detached" });
    assert.equal(await hash(page), "#fathom", "choosing it there only closes the menu");
    await ctx.close();
  });
}

test("How to play has a Fathom rule with the game's own scoring line", async () => {
  const vp = VIEWPORTS.find((v) => v.name === "phone");
  const { ctx, page } = await open(browser, vp, "#fathom", undefined, { setup: serveBank, reducedMotion: "reduce" });
  const rule = (await page.getByTestId("fathom-rule").textContent()).trim();
  await page.getByTestId("nav-home").click();
  await page.getByTestId("howto-key").click();
  const section = page.getByTestId("howto-fathom");
  await section.waitFor();
  const text = await section.textContent();
  assert.ok(text.includes(rule), `"${rule}" in "${text}"`);
  await noBeta(page, "How to play");
  // Whole on a phone: no sideways scroll in the rules.
  assert.ok(await page.getByTestId("howto").evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await ctx.close();
});

for (const vp of VIEWPORTS) {
  test(`Stats and Past runs: Fathom before and after a game, a row that opens its results, the share text (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "#stats", undefined, { setup: serveBank, reducedMotion: "reduce" });
    if (vp.name === "desktop") await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    // Before the first game: the block, with placeholders (UX 10).
    const block = page.getByTestId("know-fathom");
    await block.waitFor();
    assert.equal(await block.getAttribute("data-empty"), "");
    assert.equal(await page.getByTestId("know-fathom-games").textContent(), "0");
    for (const id of ["know-fathom-avg", "know-fathom-best"]) assert.match(await page.getByTestId(id).textContent(), /^--/);
    const before = await store(page);

    // A game.
    await page.getByTestId("know-fathom-play").click();
    const total = await playGame(page);
    await noBeta(page, "the results");
    if (vp.name === "desktop") {
      await page.getByTestId("fathom-copy").click();
      const shared = await page.evaluate(() => navigator.clipboard.readText());
      const lines = shared.split("\n");
      assert.equal(lines.length, 3);
      assert.equal(lines[0], `Fathom ${total}/500  `);
      assert.match(lines[1], /^\S( \S){4} {2}$/);
      assert.match(lines[2], /^https?:\/\/[^ ]+\/#fathom$/);
      assert.doesNotMatch(shared, /beta|\p{Extended_Pictographic}/iu);
    }
    // Kept in the player's save: the finished game, its total, its draw; the list games as they were.
    const saved = await store(page);
    assert.equal(saved.fathom.runs.length, 1);
    const run = saved.fathom.runs[0];
    assert.equal(run.points.reduce((a, b) => a + b, 0), total);
    assert.deepEqual(saved.fathom.totals, { [run.startedAt]: total });
    assert.deepEqual(saved.fathom.recent[0].ids, run.ids);
    assert.deepEqual({ ...saved, fathom: undefined }, { ...before, fathom: undefined });

    // Stats after it.
    await go(page, "#stats");
    await page.getByTestId("know-fathom-games").filter({ hasText: "1" }).waitFor();
    assert.equal(await block.getAttribute("data-empty"), null);
    assert.equal(await page.getByTestId("know-fathom-avg").textContent(), String(total));
    assert.equal(await page.getByTestId("know-fathom-best").textContent(), String(total));
    await noBeta(page, "Stats");

    // Past runs: the game, today, with its total and its five squares; the row opens its results.
    await go(page, "#history");
    const row = page.locator('[data-testid="history-row"][data-kind="fathom"]');
    await row.waitFor();
    assert.equal(await page.getByTestId("history-day").getAttribute("data-date"), TODAY);
    assert.match(await row.textContent(), new RegExp(`${total}/500`));
    assert.equal(await row.locator('[data-testid="history-bands"] [data-band]').count(), 5);
    assert.equal(await row.getByTestId("history-tag").evaluate((el) => el.getClientRects().length), 1, "the tag on one line");
    assert.ok(await noHScroll(page));
    await noBeta(page, "Past runs");
    await row.click();
    await page.getByTestId("fathom-results").waitFor();
    assert.equal(await hash(page), `#fathom/run-${run.startedAt}`);
    assert.equal(await page.getByTestId("fathom").getAttribute("data-phase"), "past");
    assert.equal(Number(await page.getByTestId("fathom-total").getAttribute("data-total")), total);
    assert.equal(await page.getByTestId("fathom-row").count(), 5);
    await page.getByTestId("fathom-when").waitFor();
    assert.ok(await noHScroll(page));
    await page.getByTestId("nav-back").click();
    await row.waitFor();
    assert.equal(await hash(page), "#history");

    // A deep link to it: Back goes up to Past runs. NEW QUESTIONS there starts a game.
    const deep = await openTab(ctx, `#fathom/run-${run.startedAt}`);
    await deep.getByTestId("fathom-results").waitFor();
    await deep.getByTestId("nav-back").click();
    await deep.locator('[data-testid="history-row"][data-kind="fathom"]').waitFor();
    assert.equal(await hash(deep), "#history");
    await deep.locator('[data-testid="history-row"][data-kind="fathom"]').click();
    await deep.getByTestId("fathom-again").click();
    await deep.getByTestId("fathom-question").waitFor();
    assert.equal(await hash(deep), "#fathom");
    assert.equal(await deep.getByTestId("fathom").getAttribute("data-phase"), "question");
    await ctx.close();
  });
}

// A game under way when a past one is opened: its key resumes that game, it doesn't draw over it.
test("a past game's key resumes a game under way", async () => {
  const vp = VIEWPORTS.find((v) => v.name === "phone");
  const { ctx, page } = await open(browser, vp, "#fathom", undefined, { setup: serveBank, reducedMotion: "reduce" });
  await playGame(page);
  const startedAt = (await store(page)).fathom.runs[0].startedAt;
  await page.getByTestId("fathom-again").click();
  await page.getByTestId("fathom-input").fill("42");
  await page.getByTestId("fathom-lock").click();
  await page.getByTestId("fathom-reveal").waitFor();
  const underWay = await page.evaluate(() => localStorage.getItem("tentacle:fathom"));
  await go(page, `#fathom/run-${startedAt}`);
  await page.getByTestId("fathom-results").waitFor();
  await page.getByTestId("fathom-again").click();
  await page.getByTestId("fathom-reveal").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("tentacle:fathom")), underWay, "the same game, where it was");
  // A game that isn't kept here says so.
  await go(page, "#fathom/run-123");
  await page.getByTestId("fathom-gone").waitFor();
  await ctx.close();
});
