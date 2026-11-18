// The lives: five of the logo's pixel hearts (owner, Nov 18: "change ink hearts back into regular hearts as shown in
// our logo"), each drawn with the favicon's own viewBox and path, at whole pixels per art pixel so the edges stay
// crisp. A life left is the favicon's solid pink; a life lost leaves the same heart, dark, in its place. Losing one
// (a costly miss, a clue) moves nothing in the header (docs/DESIGN.md 5a), and its break is short (under 400 ms) and
// only with motion on.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, puzzle, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "mountains";
const WIDTHS = [...VIEWPORTS, { name: "phone 320", viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true }];
/** Everything in the game header, and each heart. */
const HEAD = ["menu-key", "nav-back", "screen-title", "lives", "sound-toggle", "nav-home", "life"];

/** The tab icon in index.html: its viewBox, and its heart's fill (as a computed colour) and path. */
const favicon = (page) =>
  page.evaluate(() => {
    const href = document.querySelector('link[rel="icon"][type="image/svg+xml"]').getAttribute("href");
    const doc = new DOMParser().parseFromString(decodeURIComponent(href.replace(/^data:image\/svg\+xml,/, "")), "image/svg+xml");
    const path = doc.querySelector("path");
    const probe = document.createElement("i");
    probe.style.color = path.getAttribute("fill");
    document.body.append(probe);
    const fill = getComputedStyle(probe).color;
    probe.remove();
    return { viewBox: doc.documentElement.getAttribute("viewBox"), d: path.getAttribute("d"), fill };
  });

/** Each heart as drawn: element, viewBox, rendering, its heart path (the first) and fill, rendered size, full or not. */
const hearts = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="lives"] [data-testid="life"]')].map((el) => {
      const path = el.querySelector("path");
      const b = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        viewBox: el.getAttribute("viewBox"),
        rendering: getComputedStyle(el).shapeRendering,
        d: path.getAttribute("d"),
        fill: getComputedStyle(path).fill,
        width: b.width,
        height: b.height,
        full: el.getAttribute("data-full") === "true",
      };
    }),
  );

/** Every header box, by test id (all the hearts), to the hundredth of a pixel. */
const boxes = (page) =>
  page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      out[id] = [...document.querySelectorAll(`[data-testid="${id}"]`)]
        .filter((el) => el.closest(".game-head"))
        .map((el) => {
          const b = el.getBoundingClientRect();
          return [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 100) / 100).join(",");
        });
    }
    return out;
  }, HEAD);

/** The lives' running animations: how long each lasts. Then finishes them, so the hearts show where they rest. */
const settleLives = (page) =>
  page.evaluate(() => {
    const anims = document.getAnimations().filter((a) => a.effect?.target?.closest?.('[data-testid="lives"]'));
    const ends = anims.map((a) => a.effect.getComputedTiming().endTime);
    const onLost = anims.filter((a) => a.effect.target.closest('[data-testid="life"][data-full="false"]')).length;
    for (const a of anims) a.finish();
    return { ends, onLost };
  });

const rgb = (s) => s.match(/\d+/g).slice(0, 3).map(Number);

async function checkHearts(page, fav, left) {
  const hs = await hearts(page);
  assert.equal(hs.length, 5, "five hearts");
  assert.equal(await page.getByTestId("lives").getAttribute("data-lives"), String(left));
  assert.equal(await page.getByTestId("lives").getAttribute("aria-label"), `${left} of 5 lives left`);
  for (const [i, h] of hs.entries()) {
    assert.equal(h.tag, "svg");
    assert.equal(h.viewBox, fav.viewBox, "the favicon's viewBox");
    assert.equal(h.d, fav.d, "the favicon's heart path");
    assert.equal(h.rendering, "crispedges");
    // Whole pixels per art pixel, the same across and down (9 x 8), and never under 2.
    const unit = h.width / 9;
    assert.ok(Number.isInteger(unit) && unit >= 2 && h.height === unit * 8, `heart ${i + 1} is ${h.width} x ${h.height}: not a whole multiple of 9 x 8`);
    // The full ones first, then the spent ones; full is the favicon's pink, spent is the same heart, dark.
    assert.equal(h.full, i < left, `heart ${i + 1} ${i < left ? "full" : "spent"}`);
    if (h.full) assert.equal(h.fill, fav.fill, "a life left is the favicon's pink");
    else assert.ok(Math.max(...rgb(h.fill)) < 100, `a spent heart is dark (${h.fill})`);
  }
}

for (const vp of WIDTHS) {
  test(`the lives are the logo's hearts; losing one empties it in place and moves nothing (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    await page.getByTestId("lives").waitFor();
    await page.evaluate(() => document.fonts.ready);
    const fav = await favicon(page);
    assert.equal(fav.viewBox, "0 0 9 8");
    await checkHearts(page, fav, 5);
    const rest = await boxes(page);
    assert.equal(rest.life.length, 5);

    // A costly miss: the last full heart breaks, briefly, and is left spent where it was.
    const p = await puzzle(page, LIST);
    await guess(page, p.extras.find((e) => e.rank > 10).name);
    await page.locator('[data-testid="lives"][data-lives="4"]').waitFor();
    const miss = await settleLives(page);
    assert.ok(miss.onLost > 0, "the lost heart has its moment");
    assert.ok(miss.ends.every((ms) => ms <= 400), `the life-loss animation runs under 400 ms (${miss.ends.join(", ")})`);
    await checkHearts(page, fav, 4);
    assert.deepEqual(await boxes(page), rest, "a lost life moves nothing in the header");

    // A clue costs a life the same way.
    const empty = page.locator('[data-testid="slot"][data-rank="2"]').getByTestId("clue");
    await (vp.hasTouch ? empty.tap() : empty.click());
    await page.getByTestId("hint-yes").click();
    await page.locator('[data-testid="lives"][data-lives="3"]').waitFor();
    assert.ok((await settleLives(page)).ends.every((ms) => ms <= 400));
    await checkHearts(page, fav, 3);
    assert.deepEqual(await boxes(page), rest, "a clue's lost life moves nothing in the header");
    await ctx.close();
  });
}

test("with reduced motion a lost life is spent at once, no flash", async () => {
  const { ctx, page } = await open(browser, VIEWPORTS[1], `#p-${LIST}`, undefined, { reducedMotion: "reduce" });
  await page.getByTestId("lives").waitFor();
  const fav = await favicon(page);
  const p = await puzzle(page, LIST);
  await guess(page, p.extras.find((e) => e.rank > 10).name);
  await page.locator('[data-testid="lives"][data-lives="4"]').waitFor();
  const { ends, onLost } = await settleLives(page);
  assert.equal(onLost, 0, "no animation on the lost heart");
  assert.ok(ends.every((ms) => ms <= 1), `nothing on the lives runs (${ends.join(", ")})`);
  await checkHearts(page, fav, 4);
  await ctx.close();
});
