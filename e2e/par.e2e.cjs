// The players' average ("avg" on screen, par in the data): the game's header shows the score alone, a finished game
// shows the average with the players' curve (your marker on it, the average's caret), Past runs shows the distance from
// it, and the knowledge page (Home's Stats key, there from the start) lists the game's category. The golf word "par"
// never reaches the screen (players didn't know it).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, TODAY, open, hash, puzzle, guess, noHScroll } = require("./helpers.cjs");

/** The player's marker in column `col`, on the curve and inside it; the brighter area up to it. */
async function curveMarked(curve, col) {
  const got = await curve.evaluate((el) => {
    const area = el.querySelector(".curve-area").getBoundingClientRect();
    const you = el.querySelector('[data-testid="curve-you"]').getBoundingClientRect();
    const below = el.querySelector('[data-testid="curve-below"]').getBBox();
    return { w: area.width, h: area.height, x: you.x - area.x, y: you.y - area.y, size: you.width, below: below.x + below.width };
  });
  assert.ok(got.x >= 0 && got.x + got.size <= got.w && got.y >= 0 && got.y + got.size <= got.h, `the marker inside the curve: ${JSON.stringify(got)}`);
  assert.ok(Math.abs(got.x + got.size / 2 - (col * 3 + 1)) <= 3, `the marker at column ${col}: ${JSON.stringify(got)}`);
  assert.equal(got.below, (col + 1) * 3, "the brighter area ends at the player");
}

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "mountains";
const PAR = /\bpar\b/i;

for (const vp of VIEWPORTS) {
  test(`the players' average on the results, Past runs and the knowledge page (${vp.name})`, async () => {
    // Before any game, Home's Stats key is there already; the knowledge page shows its sections with placeholders.
    const { ctx, page } = await open(browser, vp);
    await page.getByTestId("stats-key").click();
    await page.getByTestId("knowledge").waitFor();
    assert.equal(await hash(page), "#stats");
    await page.getByTestId("knowledge-empty").waitFor();
    assert.equal(await page.getByTestId("know-category-empty").count(), 1);
    assert.equal(await page.getByTestId("know-tag-empty").count(), 1);
    assert.equal(await page.getByTestId("know-category").count(), 0);
    assert.doesNotMatch(await page.getByTestId("knowledge").innerText(), PAR);
    assert.ok(await noHScroll(page));

    await page.goto(page.url().replace(/#.*$/, `#p-${LIST}`));
    const pars = await page.evaluate(async () => (await fetch("puzzles/par.json")).json());
    const index = await page.evaluate(async () => (await fetch("puzzles/index.json")).json());
    const par = pars[LIST].par;

    const p = await puzzle(page, LIST);
    for (const r of [1, 3]) await guess(page, p.answers.find((a) => a.rank === r).name);
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();

    // The results: the average, and the players' curve (owner, Nov 14: "instead of a bar chart style can you do a
    // actual curve?"): the player's marker at their score (2) on it, the brighter area up to it, the average's caret.
    const block = page.getByTestId("results").getByTestId("par");
    await block.waitFor();
    assert.equal(Number(await block.getAttribute("data-par")), par);
    const curve = block.getByTestId("crowd-curve");
    const col = (score) => Math.floor(((score + 0.5) / 11) * 50);
    assert.equal(await curve.getByTestId("curve-you").getAttribute("data-col"), String(col(2)));
    assert.equal(await curve.getByTestId("curve-avg").getAttribute("data-col"), String(col(par)));
    await curveMarked(curve, col(2));
    assert.equal(await curve.locator(".histo-axis").textContent(), "010");
    assert.equal(await curve.getAttribute("aria-label"), `You did ${(await block.getByTestId("par-line").textContent()).trim()}: you got 2 of 10, players average ${par}.`);
    // The same place and size as the 11 bars it replaced: 150 x 42 on the baseline, beside the average.
    const plot = await curve.locator(".curve-plot").boundingBox();
    assert.deepEqual([Math.round(plot.width), Math.round(plot.height)], [150, 42]);
    assert.doesNotMatch(await page.getByTestId("results").innerText(), PAR);
    // The header shows the score alone: the average is the results' news (par.json has loaded by now).
    assert.equal(await page.getByTestId("title-par").count(), 0);
    assert.doesNotMatch(await page.getByTestId("title-card").innerText(), /\b(par|avg|average)\b/i);
    assert.ok(await noHScroll(page));

    // Past runs: the classic row says how far from the average.
    await page.goto(page.url().replace(/#.*$/, "#history"));
    const diff = 2 - par;
    assert.equal(
      await page.getByTestId("history-vs-par").first().textContent(),
      diff === 0 ? "same as avg" : `${diff > 0 ? "+" : ""}${diff} vs avg`,
    );
    assert.doesNotMatch(await page.locator("main").innerText(), PAR);

    // The knowledge page now lists the game's category, with no placeholder left there.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("stats-key").click();
    await page.getByTestId("knowledge").waitFor();
    const category = index.find((m) => m.id === LIST).category;
    const row = page.locator(`[data-testid="know-category"][data-name="${category}"]`);
    await row.waitFor();
    assert.equal(Number(await row.getAttribute("data-vs-par")), 2 - par);
    assert.equal(await page.getByTestId("knowledge-empty").count(), 0);
    assert.equal(await page.getByTestId("know-category-empty").count(), 0);
    assert.doesNotMatch(await page.getByTestId("knowledge").innerText(), PAR);
    assert.ok(await noHScroll(page));
    await ctx.close();
  });
}

// The owner, Nov 14: "dont specify estimated just say you did better than xx% of players today with a histogram".
// "today" only on Today's list on its own day: a random list, and an earlier day's list from the archive, say "players".
test("where a list's score stands: better than X% of players, today on Today's list, never estimated (phone)", async () => {
  const vp = VIEWPORTS.find((v) => v.name === "phone");
  const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
  const yesterday = (await page.evaluate(async () => (await fetch("puzzles/daily.json")).json())).find((e) => e.date === "2026-10-28");
  const lineOf = async () => {
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();
    const block = page.getByTestId("results").getByTestId("par");
    await block.waitFor();
    const line = (await block.getByTestId("par-line").textContent()).trim();
    assert.doesNotMatch(await page.getByTestId("results").innerText(), /estimat/i);
    return { line, p: await block.getAttribute("data-p") };
  };
  const random = await lineOf();
  assert.equal(random.line, `better than ${random.p}% of players`);
  await page.goto(page.url().replace(/#.*$/, `#daily-${TODAY}`));
  const today = await lineOf();
  assert.equal(today.line, `better than ${today.p}% of players today`);
  if (yesterday) {
    await page.goto(page.url().replace(/#.*$/, `#daily-${yesterday.date}`));
    const past = await lineOf();
    assert.equal(past.line, `better than ${past.p}% of players`);
  }
  await ctx.close();
});

// Launch audit, Nov 6: before the first game, Stats' top row read "-- vs avg", "0 games", "-- your avg / 10", and the
// first sat about 25 px lower than the other two (a 60px dash beside 36px numbers; UX 8). The row's figures share one
// line and one height, and so do their labels.
for (const vp of VIEWPORTS) {
  test(`Stats before the first game: one row, its figures and labels in line (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "#stats");
    const empty = page.getByTestId("knowledge-empty");
    await empty.waitFor();
    const boxes = async (id) =>
      empty.getByTestId(id).evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), size: getComputedStyle(el).fontSize };
        }),
      );
    const figures = await boxes("know-figure");
    const labels = await boxes("know-figure-label");
    assert.equal(figures.length, 3);
    assert.equal(labels.length, 3);
    for (const [name, row] of [["figures", figures], ["labels", labels]]) {
      for (const b of row.slice(1)) {
        assert.deepEqual(b, row[0], `the ${name} share one line and one size: ${JSON.stringify(row)}`);
      }
    }
    assert.ok(labels[0].top >= figures[0].bottom - 1, "labels under the figures");
    await ctx.close();
  });
}
