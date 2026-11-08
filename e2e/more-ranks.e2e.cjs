// Ranks 11 to 20 under a finished list's board (the owner, Nov 8: "after playing a list, show the top 11-20 in addition
// to the top 10 for curious individuals"): a quiet key, closed by default, that opens them below it in the board's
// row style (rank, name, figure), the ones the player guessed marked in the misses' pink; nothing above it moves.
// Also in the list's past run. Only where the list has ranks 11 to 20, and never on a Blitz.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, go, puzzle, guess, giveUp } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "airports"; // ranks 11 to 20 all there
const NONE = "dog-breeds"; // nothing ranked past 10

/** Page boxes (scroll included) of everything that sits above the key, or beside it on a wide screen. */
const around = (page) =>
  page.getByTestId("more-ranks-toggle").evaluate((key) => {
    const k = key.getBoundingClientRect();
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)].join(",");
    };
    const els = [...document.querySelectorAll('[data-testid="title-card"], [data-testid="slot"], [data-testid="results"], [data-testid="run-view"], .misses, .game-head')];
    return {
      key: box(key),
      // Above the key, or (wide screens) beside it in the other column.
      others: els.filter((el) => el.getBoundingClientRect().top < k.top || el.getBoundingClientRect().left > k.right).map(box),
    };
  });

/** What the open rows show: rank, name, figure, and whether each is marked as guessed (and drawn pink). */
const rows = (page) =>
  page.getByTestId("more-rank").evaluateAll((els) =>
    els.map((el) => ({
      rank: Number(el.dataset.rank),
      name: el.querySelector(".name").firstChild.textContent,
      value: el.querySelector(".value")?.textContent ?? null,
      guessed: el.dataset.guessed === "true",
      pink: getComputedStyle(el.querySelector(".name")).color === "rgb(255, 93, 143)",
    })),
  );

async function check(page, p, where, near) {
  const key = page.getByTestId("more-ranks-toggle");
  await key.scrollIntoViewIfNeeded();
  // Closed by default.
  assert.equal(await key.getAttribute("aria-expanded"), "false", where);
  assert.equal(await page.getByTestId("more-ranks").isVisible(), false, `${where}: open by default`);
  const shut = await around(page);
  await key.click();
  assert.equal(await key.getAttribute("aria-expanded"), "true", where);
  // Ranks 11 to 20 with their figures, in order; the near miss guessed is marked, in pink, and only it.
  const want = p.extras
    .filter((e) => e.rank >= 11 && e.rank <= 20)
    .sort((a, b) => a.rank - b.rank)
    .map((e) => ({ rank: e.rank, name: e.name, value: e.value, guessed: e.rank === near.rank, pink: e.rank === near.rank }));
  assert.equal(want.length, 10);
  assert.deepEqual(await rows(page), want, where);
  // It opened downward: the key and everything above or beside it stayed put.
  assert.deepEqual(await around(page), shut, `${where}: something above the rows moved`);
  await key.click();
  assert.equal(await page.getByTestId("more-ranks").isVisible(), false, `${where}: closes again`);
}

for (const vp of VIEWPORTS) {
  test(`a finished list shows ranks 11 to 20 behind a key, the guessed one marked (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`, undefined, { reducedMotion: "reduce" });
    await page.getByLabel("Your guess").waitFor();
    const p = await puzzle(page, LIST);
    // Not during play.
    assert.equal(await page.getByTestId("more-ranks-toggle").count(), 0, "the key during play");
    const near = p.extras.find((e) => e.rank === 13);
    await guess(page, p.answers[0].name);
    await guess(page, near.name);
    assert.equal(await page.getByTestId("lives").getAttribute("data-lives"), "4", "the near miss cost a life");
    await giveUp(page);
    await page.clock.runFor(3000);
    await check(page, p, "the results", near);

    // The same in its past run.
    await go(page, "#history");
    await page.locator('[data-testid="history-row"][data-kind="list"]').first().click();
    await page.getByTestId("run-view").waitFor();
    await check(page, p, "its past run", near);

    // A list with nothing ranked past 10 has no key; nor has a Blitz.
    await go(page, `#p-${NONE}`);
    await page.getByLabel("Your guess").waitFor();
    await giveUp(page);
    assert.equal(await page.getByTestId("more-ranks-toggle").count(), 0, "a key with no ranks past 10");
    await go(page, `#blitz-${LIST}`);
    await page.getByLabel("Your guess").waitFor();
    await guess(page, p.answers[1].name);
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();
    assert.equal(await page.getByTestId("more-ranks-toggle").count(), 0, "the key on a Blitz");
    await ctx.close();
  });
}

test("a list with only some of ranks 11 to 20 shows those, and says how far it goes", async () => {
  const { ctx, page } = await open(browser, VIEWPORTS[1], "#p-car-makers", undefined, { reducedMotion: "reduce" });
  await page.getByLabel("Your guess").waitFor();
  const p = await puzzle(page, "car-makers");
  const have = [...new Set(p.extras.filter((e) => e.rank >= 11 && e.rank <= 20).map((e) => e.rank))].sort((a, b) => a - b);
  assert.ok(have.length > 0 && have.length < 10, "car-makers has some of ranks 11 to 20");
  await giveUp(page);
  const key = page.getByTestId("more-ranks-toggle");
  assert.match(await key.getAttribute("aria-controls"), /.+/);
  await key.click();
  assert.deepEqual([...new Set((await rows(page)).map((r) => r.rank))], have);
  assert.equal(await page.getByTestId("more-ranks").getAttribute("aria-label"), `Ranks 11 to ${have[have.length - 1]}`);
  await ctx.close();
});
