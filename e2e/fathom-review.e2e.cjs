// The first-time-player review before launch (Nov 9), in the browser on the real bank:
// - The unit never squeezes the field: at 320 and 390, for every unit in the bank, the placeholder shows whole, the
//   unit takes one line, and the answer typed in full ("8,804,190" for a city in million people) shows whole.
// - Each scoring line once a game, on the first question that has it (the first estimate's covers the percent and
//   the year; the name-it round says its own).
// - Home's Fathom key and the menu's tile start new questions after a finished game (free play is new every time,
//   UX 14); a game under way resumes; a reload on the results keeps them.
// - SHARE as on lists and Blitz: the phone's share sheet, else a copy and "Copied".
// - Home's Fathom key at 320, 360 and 375 as tall as Random list, its line on one line (it shortens, UX 8); Your
//   record's first label ("lists played") on one line, the row as tall as it was with "played".
// - LOST AT SEA and its points on one row at 320 and 390.
// The copy findings (Play Fathom, Back to your game, lists played, the percent's miss, the share squares, the 3
// decimals, Try again. on every wrong-kind line, one format per column) are unit tests: src/game/fathom-review.test.ts,
// src/components/copy.test.ts.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, VIEWPORTS, open, go, hash } = require("./helpers.cjs");
const { textLines } = require("./fathom-lib.cjs");

const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "fathom", "questions.json"), "utf8")).questions;
const KEY = "tentacle:fathom";
const phone = VIEWPORTS.find((v) => v.name === "phone");
const desktop = VIEWPORTS.find((v) => v.name === "desktop");
const at = (width) => ({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true });

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

/** A game on these real questions, at the `n`th, the ones before it answered with their answers. */
const gameAt = (ids, n, extra = {}) => ({
  recent: [],
  game: { ids, guesses: ids.slice(0, n).map((id) => REAL.find((q) => q.id === id).answer ?? REAL.find((q) => q.id === id).target), at: n, startedAt: Date.UTC(2026, 9, 29), ...extra },
});
const seedFathom = (save) => (ctx) =>
  ctx.addInitScript(
    ([key, s]) => {
      if (localStorage.getItem("e2e-fathom-seeded")) return;
      localStorage.setItem(key, s);
      localStorage.setItem("e2e-fathom-seeded", "1");
    },
    [KEY, JSON.stringify(save)],
  );
/** Locks in a guess on the question on screen: a number, or on a name-it round a name its list has. */
async function lockAny(page) {
  const id = await page.getByTestId("fathom-question").getAttribute("data-question");
  const round = await page.getByTestId("fathom-question").getAttribute("data-round");
  await page.getByTestId("fathom-input").fill(round !== "name" ? "42" : id.startsWith("name-city") ? "Tokyo" : "Japan");
  await page.getByTestId("fathom-lock").click();
  await page.getByTestId("fathom-reveal").waitFor();
}

/** The answer as a player types the whole amount: "8,804,190" for 8.80419 million people. */
function typed(q) {
  const scale = { million: 1e6, billion: 1e9, trillion: 1e12 }[q.unit.split(" ")[0]] ?? 1;
  const n = q.answer * scale;
  return n >= 1000 ? Math.round(n).toLocaleString("en-US") : String(n);
}

// "metres per second", "million people" wrapped to two lines in the box and cut the placeholder to "your gue"; typing
// 8,800,000 for New York City scrolled to ",800,000".
test("the unit never squeezes the field: placeholder whole, unit one line, the typed answer whole (320, 390)", async () => {
  const byUnit = new Map();
  for (const q of REAL) if (q.round !== "name" && !byUnit.has(q.unit)) byUnit.set(q.unit, q);
  const opener = REAL.find((q) => q.easy && q.round !== "name");
  const fails = [];
  for (const width of [320, 390]) {
    const first = [...byUnit.values()][0];
    const { ctx, page } = await open(browser, at(width), "#fathom", undefined, { reducedMotion: "reduce", setup: seedFathom(gameAt([opener.id, first.id, ...REAL.slice(0, 3).map((q) => q.id)], 1)) });
    for (const q of byUnit.values()) {
      const others = REAL.filter((x) => x.id !== q.id && x.id !== opener.id && x.round !== "name").slice(0, 3);
      await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(gameAt([opener.id, q.id, ...others.map((x) => x.id)], 1))]);
      await page.reload();
      const input = page.getByTestId("fathom-input");
      await input.waitFor();
      assert.equal(await page.getByTestId("fathom-question").getAttribute("data-question"), q.id);
      const where = `${width}px, ${q.unit}`;
      // The placeholder, measured in the field's own font, fits the field's room for text.
      const room = await input.evaluate((el) => {
        const s = getComputedStyle(el);
        const c = document.createElement("canvas").getContext("2d");
        c.font = `${s.fontSize} ${s.fontFamily}`;
        const text = c.measureText(el.placeholder).width + el.placeholder.length * parseFloat(s.letterSpacing || "0");
        return { text, box: el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) };
      });
      if (room.text > room.box + 0.5) fails.push(`${where}: placeholder ${Math.round(room.text)}px in ${Math.round(room.box)}px`);
      const unit = page.getByTestId("fathom-unit");
      if ((await unit.textContent()).trim()) {
        const seen = await textLines(unit);
        if (seen.lines !== 1 || seen.cut) fails.push(`${where}: the unit takes ${seen.lines} lines${seen.cut ? ", cut" : ""}`);
      }
      await input.fill(typed(q));
      const value = await input.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, v: el.value }));
      if (value.scroll > value.client + 1) fails.push(`${where}: "${value.v}" is ${value.scroll}px in ${value.client}px`);
    }
    await ctx.close();
  }
  assert.deepEqual(fails, []);
});

// The rule showed on Q1, Q2 and Q4 (the first estimate, percent and year: the same words) but not Q3, which read as a bug.
test("each scoring line once a game, on the first question that has it; the name-it round has its own", async () => {
  const est = REAL.filter((q) => !q.round && q.easy);
  const pct = REAL.find((q) => q.round === "percent");
  const year = REAL.find((q) => q.round === "year");
  const name = REAL.find((q) => q.round === "name");
  const ids = [est[0].id, pct.id, est[1].id, year.id, name.id];
  const { ctx, page } = await open(browser, phone, "#fathom", undefined, { reducedMotion: "reduce", setup: seedFathom(gameAt(ids, 0)) });
  const shown = [];
  for (let i = 0; i < 5; i++) {
    await page.getByTestId("fathom-input").waitFor();
    assert.equal(await page.getByTestId("fathom-question").getAttribute("data-question"), ids[i]);
    shown.push(await page.getByTestId("fathom-rule").count());
    if (i < 4) {
      const q = REAL.find((x) => x.id === ids[i]);
      await page.getByTestId("fathom-input").fill(String(q.answer));
      await page.getByTestId("fathom-lock").click();
      await page.getByTestId("fathom-reveal").waitFor();
      await page.getByTestId("fathom-next").click();
    }
  }
  assert.deepEqual(shown, [1, 0, 0, 0, 1]);
  await ctx.close();
});

// UX 14: Home's key reopened the last finished game's results.
for (const vp of VIEWPORTS) {
  test(`Home's key and the menu's tile start new questions after a finished game; a game under way resumes; a reload keeps the results (${vp.name})`, async () => {
    const ids = REAL.filter((q) => q.round !== "name").slice(0, 5).map((q) => q.id);
    const done = gameAt(ids, 5);
    done.game.at = 5;
    const { ctx, page } = await open(browser, vp, "#fathom", undefined, { reducedMotion: "reduce", setup: seedFathom(done) });
    await page.getByTestId("fathom-results").waitFor();
    // A reload on the results keeps them.
    await page.reload();
    await page.getByTestId("fathom-results").waitFor();
    // From Home: new questions.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("fathom-key").click();
    await page.getByTestId("fathom-input").waitFor();
    const drawn = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY)).game;
    assert.notDeepEqual(drawn.ids, ids, "a new draw");
    assert.equal(drawn.guesses.length, 0);
    // Under way: Home's key resumes it, where it was.
    await lockAny(page);
    await page.getByTestId("nav-home").click();
    await page.getByTestId("fathom-key").click();
    await page.getByTestId("fathom-reveal").waitFor();
    assert.deepEqual(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY)).game.ids, drawn.ids);
    // Finished, then the menu's tile from another screen: new questions again.
    for (let i = 0; i < 5; i++) {
      if (i > 0) {
        await page.getByTestId("fathom-input").waitFor();
        await lockAny(page);
      }
      await page.getByTestId("fathom-next").click();
    }
    await page.getByTestId("fathom-results").waitFor();
    await go(page, "#stats");
    await page.getByTestId("know-fathom").waitFor();
    await page.getByTestId("menu-key").click();
    await page.getByTestId("menu-fathom").click();
    await page.getByTestId("fathom-input").waitFor();
    assert.notDeepEqual(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), KEY)).game.ids, drawn.ids, "a new draw from the menu");
    assert.equal(await hash(page), "#fathom");
    await ctx.close();
  });
}

test("SHARE: the phone's share sheet with the squares and the link; on a desktop a copy, and Copied", async () => {
  const ids = REAL.filter((q) => q.round !== "name").slice(0, 5).map((q) => q.id);
  const done = gameAt(ids, 5);
  done.game.at = 5;
  for (const vp of [phone, desktop]) {
    const { ctx, page } = await open(browser, vp, "#fathom", undefined, {
      reducedMotion: "reduce",
      setup: async (c) => {
        await seedFathom(done)(c);
        if (vp === phone) await c.addInitScript(() => (navigator.share = (data) => ((window.__shared = data), Promise.resolve())));
      },
    });
    if (vp === desktop) await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    const key = page.getByTestId("fathom-share");
    await key.waitFor();
    const total = await page.getByTestId("fathom-total").getAttribute("data-total");
    // The same key as a list's: the same label, swapped for its feedback.
    assert.equal(await key.locator(".swap").count(), 1);
    await key.click();
    const text = vp === phone ? await page.waitForFunction(() => window.__shared?.text).then((h) => h.jsonValue()) : await page.evaluate(() => navigator.clipboard.readText());
    const lines = text.split("\n");
    assert.equal(lines[0], `Fathom ${total}/500  `);
    assert.match(lines[1], /^(\p{Extended_Pictographic}️? ){4}\p{Extended_Pictographic}️? {2}$/u);
    assert.match(lines[2], /^https?:\/\/\S+\/#fathom$/);
    if (vp === desktop) await key.locator('.swap > [data-shown]:nth-child(2)').waitFor();
    await ctx.close();
  }
});

test("Home on narrow phones: the Fathom key as tall as Random list, its line on one line; lists played on one line", async () => {
  for (const width of [320, 360, 375]) {
    const { ctx, page } = await open(browser, at(width), "", undefined, { reducedMotion: "reduce" });
    await page.getByTestId("fathom-key").waitFor();
    const [list, fathom] = [await page.getByTestId("random-list").boundingBox(), await page.getByTestId("fathom-key").boundingBox()];
    assert.equal(Math.round(fathom.height), Math.round(list.height), `${width}px: as tall as its neighbour`);
    const line = await textLines(page.getByTestId("fathom-key-status"));
    assert.ok(line.lines === 1 && !line.cut, `${width}px: "${line.text}" on one line, whole`);
    // Your record: "lists played" on one line, and the row as tall as the next label's ("perfect", one word).
    const dts = page.locator('[data-testid="home-record"] dt');
    const first = await textLines(dts.first());
    assert.equal(first.lines, 1, `${width}px: "${first.text}" on one line`);
    const [a, b] = [await dts.nth(0).boundingBox(), await dts.nth(2).boundingBox()];
    assert.equal(Math.round(a.height), Math.round(b.height), `${width}px: the label is as tall as its row's others`);
    await ctx.close();
  }
});

// At 390, LOST AT SEA pushed its points to a second line.
test("LOST AT SEA and its points on one row (320, 390)", async () => {
  const q = REAL.find((x) => x.round !== "name" && x.answer >= 10);
  const ids = [q.id, ...REAL.filter((x) => x.round !== "name" && x.id !== q.id).slice(0, 4).map((x) => x.id)];
  for (const width of [320, 390]) {
    const save = gameAt(ids, 0);
    save.game.guesses = [q.answer * 1000];
    const { ctx, page } = await open(browser, at(width), "#fathom", undefined, { reducedMotion: "reduce", setup: seedFathom(save) });
    await page.getByTestId("fathom-reveal").waitFor();
    assert.equal(await page.getByTestId("fathom-band").getAttribute("data-band"), "lost");
    const [word, points] = [await page.getByTestId("fathom-band").boundingBox(), await page.getByTestId("fathom-points").boundingBox()];
    assert.ok(points.y < word.y + word.height && points.x >= word.x + word.width - 1, `${width}px: the points beside the word (${JSON.stringify({ word, points })})`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await ctx.close();
  }
});
