// Rating a Fathom question (owner, Nov 14: "add the same feedback system for fathom that we currently have for
// lists/blitz- ideally we keep the same mechanics and tables"; he wanted to flag one question too easy, another
// ambiguous). On the fixture bank and schedule, no backend (the requests: backend.e2e.cjs):
// - Each row of the day's results has a small key that opens the list results' "Good question?" under that row: the
//   same thumbs, the same reasons in a question's words (unclear for unfair, wrong answer for wrong data), one row
//   open at a time. The rating is kept in the save under the question's id (mode fathom), shown on its row's key, after
//   a reload and on the game's results from Past runs; endless Fathom's results have it too.
// - Nothing to rate during play: no key on a question or a reveal.
// - At 320 the keys don't crowd the rows: every row's words keep their room, the open rating fits on one line, no
//   sideways scroll, every control 44px to the finger.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium, VIEWPORTS, TODAY, open, go, store, noHScroll } = require("./helpers.cjs");
const { shortReach } = require("./fathom-lib.cjs");

const FIXTURES = path.join(__dirname, "fixtures", "fathom");
const BANK = new Map(JSON.parse(fs.readFileSync(path.join(FIXTURES, "questions.json"), "utf8")).questions.map((q) => [q.id, q]));
const DAY = JSON.parse(fs.readFileSync(path.join(FIXTURES, "daily.json"), "utf8")).find((e) => e.date === TODAY);
const serve = async (ctx) => {
  await ctx.route(/\/fathom\/questions\.json(\?.*)?$/, (route) => route.fulfill({ path: path.join(FIXTURES, "questions.json"), contentType: "application/json" }));
  await ctx.route(/\/fathom\/daily\.json(\?.*)?$/, (route) => route.fulfill({ path: path.join(FIXTURES, "daily.json"), contentType: "application/json" }));
};
/** The day's game on its last reveal (a guess a little high each), seeded once. */
const lastReveal = (ctx) =>
  ctx.addInitScript((game) => {
    if (localStorage.getItem("e2e-day-seeded")) return;
    localStorage.setItem("tentacle:fathom-daily", JSON.stringify(game));
    localStorage.setItem("e2e-day-seeded", "1");
  }, { day: { date: TODAY, n: DAY.n }, ids: DAY.ids, guesses: DAY.ids.map((id) => BANK.get(id).answer * 1.3), at: 9, startedAt: Date.parse(`${TODAY}T09:00:00-04:00`) });
const setup = async (ctx) => {
  await serve(ctx);
  await lastReveal(ctx);
};
const at = (width) => ({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true });

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const row = (page, i) => page.getByTestId("fathom-row").nth(i);
const saved = async (page, id) => (await store(page)).ratings?.[`fathom:${id}`];

for (const vp of VIEWPORTS) {
  test(`a question's rating from the day's results: the list's thumbs, reasons in a question's words, kept on its row (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "#fathom", undefined, { setup, reducedMotion: "reduce" });
    // Nothing to rate during play: the last reveal has no key.
    await page.getByTestId("fathom-reveal").waitFor();
    assert.equal(await page.getByTestId("fathom-rate").count(), 0, "no rating on a reveal");
    await page.getByTestId("fathom-next").click();
    await page.getByTestId("fathom-results").waitFor();

    // A key on every row, none open, none rated; no note without a backend.
    const keys = page.getByTestId("fathom-rate");
    assert.equal(await keys.count(), 10);
    assert.deepEqual(await keys.evaluateAll((els) => els.map((e) => [e.dataset.rating, e.getAttribute("aria-expanded")])), Array(10).fill(["0", "false"]));
    assert.deepEqual(await keys.evaluateAll((els) => els.map((e) => e.dataset.question)), DAY.ids);
    assert.equal(await page.getByTestId("fathom-rate-panel").count(), 0);

    // Row 2's key opens "Good question?" under that row.
    const id = DAY.ids[1];
    await keys.nth(1).click();
    const panel = row(page, 1).getByTestId("fathom-rate-panel");
    await panel.waitFor();
    assert.equal(await keys.nth(1).getAttribute("aria-expanded"), "true");
    assert.equal((await panel.locator(".rate-q").textContent()).trim(), "Good question?");
    assert.equal(await panel.getByTestId("rate-up").getAttribute("aria-label"), "good question");
    assert.equal(await page.getByTestId("note-open").count(), 0, "no note without a backend");

    // Up: kept in the save under the question's id, and shown on the row's key.
    await panel.getByTestId("rate-up").click();
    assert.equal(await keys.nth(1).getAttribute("data-rating"), "1");
    assert.equal((await saved(page, id)).rating, 1);
    // Down, with a reason in a question's words, stored by the list's code.
    await panel.getByTestId("rate-down").click();
    const reasons = page.getByTestId("rate-reason");
    await reasons.first().waitFor();
    assert.deepEqual(await reasons.evaluateAll((els) => els.map((e) => e.textContent.trim())), ["too hard", "too easy", "boring", "unclear", "wrong answer"]);
    await page.locator('[data-testid="rate-reason"][data-reason="unfair"]').click();
    assert.equal((await panel.getByTestId("rate-why").textContent()).trim(), "unclear");
    assert.deepEqual({ ...(await saved(page, id)), at: 0 }, { rating: -1, reason: "unfair", at: 0 });
    assert.equal(await keys.nth(1).getAttribute("data-rating"), "-1");
    assert.ok(await noHScroll(page));

    // One open at a time: another row's key closes this one.
    await keys.nth(4).click();
    await row(page, 4).getByTestId("fathom-rate-panel").waitFor();
    assert.equal(await page.getByTestId("fathom-rate-panel").count(), 1);
    await keys.nth(4).click();
    assert.equal(await page.getByTestId("fathom-rate-panel").count(), 0, "its key again closes it");

    // A reload, and the game from Past runs: the row still says so.
    await page.reload();
    await page.getByTestId("fathom-results").waitFor();
    assert.equal(await page.getByTestId("fathom-rate").nth(1).getAttribute("data-rating"), "-1");
    const run = (await store(page)).fathom.runs[0];
    await go(page, `#fathom/run-${run.startedAt}`);
    await page.locator('[data-testid="fathom"][data-phase="past"]').waitFor();
    assert.equal(await page.getByTestId("fathom-rate").nth(1).getAttribute("data-rating"), "-1");
    await page.getByTestId("fathom-rate").nth(1).click();
    const past = page.getByTestId("fathom-rate-panel").getByTestId("rate");
    assert.deepEqual([await past.getAttribute("data-rating"), await past.getAttribute("data-reason")], ["-1", "unfair"]);
    await ctx.close();
  });
}

test("endless Fathom's results rate their questions too, by id; nothing to rate on a question", async () => {
  const vp = VIEWPORTS.find((v) => v.name === "phone");
  const { ctx, page } = await open(browser, vp, "#fathom-endless", undefined, { setup: serve, reducedMotion: "reduce" });
  await page.getByTestId("fathom-input").waitFor();
  assert.equal(await page.getByTestId("fathom-rate").count(), 0, "no rating on a question");
  for (let i = 0; i < 10; i++) {
    await page.getByTestId("fathom-input").waitFor();
    const q = BANK.get(await page.getByTestId("fathom-question").getAttribute("data-question"));
    await page.getByTestId("fathom-input").fill(String(q.answer));
    await page.getByTestId("fathom-lock").click();
    await page.getByTestId("fathom-reveal").waitFor();
    await page.getByTestId("fathom-next").click();
  }
  await page.getByTestId("fathom-results").waitFor();
  const key = page.getByTestId("fathom-rate").first();
  const id = await key.getAttribute("data-question");
  await key.click();
  await page.getByTestId("fathom-rate-panel").getByTestId("rate-up").click();
  assert.equal((await saved(page, id)).rating, 1);
  await ctx.close();
});

// The owner likes compact (UX 7): ten keys must not crowd ten rows on the narrowest phone.
test("at 320 the keys don't crowd the rows; the open rating fits; every control 44px to the finger", async () => {
  const { ctx, page } = await open(browser, at(320), "#fathom", undefined, { setup, reducedMotion: "reduce" });
  await page.getByTestId("fathom-next").click();
  await page.getByTestId("fathom-results").waitFor();
  const rows = await page.getByTestId("fathom-row").evaluateAll((els) =>
    els.map((el) => {
      const body = el.querySelector(".recap-body").getBoundingClientRect();
      const side = el.querySelector(".recap-side").getBoundingClientRect();
      const card = el.closest("section").getBoundingClientRect();
      return { body: Math.round(body.width), gap: Math.round(side.left - body.right), inside: side.right <= card.right + 0.5 };
    }),
  );
  for (const [i, r] of rows.entries()) {
    assert.ok(r.body >= 150, `row ${i + 1}: the words have ${r.body}px`);
    assert.ok(r.gap >= 8, `row ${i + 1}: the key ${r.gap}px from the words`);
    assert.ok(r.inside, `row ${i + 1}: the key inside the card`);
  }
  assert.deepEqual(await shortReach(page), [], "the results' controls at 320");
  await page.getByTestId("fathom-rate").nth(2).click();
  const rate = page.getByTestId("fathom-rate-panel").getByTestId("rate");
  await rate.waitFor();
  assert.ok(await rate.evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5), "Good question? and its thumbs on one row");
  assert.equal(await rate.evaluate((el) => Math.round(el.getBoundingClientRect().height)), 46, "one row, as the list's");
  assert.ok(await noHScroll(page));
  await ctx.close();
});
