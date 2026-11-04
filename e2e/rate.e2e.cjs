// "Good list?" on the results (no backend): a thumbs up or down per list and mode, kept in the save, shown as chosen
// again later (a reload, the run in Past runs), and the reasons after a thumbs down floating over the card so nothing
// moves. Sending ratings to the backend is checked in backend.e2e.cjs. This build has no backend, so no "add a note"
// under the row (note.e2e.cjs checks it with one).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, go, puzzle, guess, giveUp, store, noHScroll } = require("./helpers.cjs");

const desktop = VIEWPORTS.find((v) => v.name === "desktop");
const phone = VIEWPORTS.find((v) => v.name === "phone");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

/** Every element's box in the result card, except the floating reasons: what must stay put while they open. */
const layout = (page) =>
  page.evaluate(() => {
    const card = document.querySelector('[data-testid="results"], [data-testid="blitz-results"], [data-testid="run-view"]');
    const pop = document.querySelector('[data-testid="rate-reasons"]');
    const boxes = [...card.querySelectorAll("*")]
      .filter((el) => !pop?.contains(el) && el.getClientRects().length)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.tagName}.${el.className}:${Math.round(r.x)},${Math.round(r.y + scrollY)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      });
    return { boxes, page: `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}` };
  });

const row = (page) => page.getByTestId("rate");
const rating = async (page) => ({ rating: await row(page).getAttribute("data-rating"), reason: await row(page).getAttribute("data-reason") });
const pressed = async (page) => [await page.getByTestId("rate-up").getAttribute("aria-pressed"), await page.getByTestId("rate-down").getAttribute("aria-pressed")];

for (const vp of [phone, desktop]) {
  test(`rate a list up, switch to down with a reason, and find it kept (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "#p-mountains");
    await page.getByLabel("Your guess").waitFor();
    await giveUp(page);
    await page.clock.runFor(3000);
    assert.deepEqual(await rating(page), { rating: "0", reason: null });
    assert.deepEqual(await pressed(page), ["false", "false"]);
    // No backend, nowhere to send a note: no "add a note" (note.e2e.cjs has it with a backend).
    assert.equal(await page.getByTestId("note").count(), 0);

    // One tap: rated and marked.
    await page.getByTestId("rate-up").click();
    assert.deepEqual(await rating(page), { rating: "1", reason: null });
    assert.deepEqual(await pressed(page), ["true", "false"]);
    assert.equal(await page.getByTestId("rate-reasons").count(), 0);

    // The other key switches, and the reasons open over the card: nothing in it moves.
    const still = await layout(page);
    await page.getByTestId("rate-down").click();
    const reasons = page.getByTestId("rate-reasons");
    await reasons.waitFor();
    assert.deepEqual(await rating(page), { rating: "-1", reason: null });
    assert.deepEqual(await pressed(page), ["false", "true"]);
    assert.deepEqual(await layout(page), still, "opening the reasons moves nothing");
    assert.equal(await reasons.evaluate((el) => getComputedStyle(el).position), "absolute");
    assert.deepEqual(
      await page.getByTestId("rate-reason").evaluateAll((els) => els.map((e) => e.dataset.reason)),
      ["too-hard", "too-easy", "boring", "unfair", "wrong-data"],
    );
    // On screen and inside the page's width.
    const box = await reasons.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= vp.viewport.width, "the reasons fit the screen's width");
    assert.ok(await noHScroll(page));

    // One tap picks a reason and closes them; the row names it.
    await page.locator('[data-testid="rate-reason"][data-reason="unfair"]').click();
    await reasons.waitFor({ state: "detached" });
    assert.deepEqual(await rating(page), { rating: "-1", reason: "unfair" });
    await page.getByTestId("rate-why").waitFor();
    assert.deepEqual(await layout(page).then((l) => l.page), still.page);
    const saved = (await store(page)).ratings["list:mountains"];
    assert.equal(saved.rating, -1);
    assert.equal(saved.reason, "unfair");

    // Kept: a reload shows it chosen.
    await page.reload();
    await page.getByTestId("results").waitFor();
    assert.deepEqual(await rating(page), { rating: "-1", reason: "unfair" });
    assert.deepEqual(await pressed(page), ["false", "true"]);

    // "why?" brings the reasons back with the chosen one marked (and focused); Escape closes them, gives focus back
    // to the thumbs down, and stays on the screen.
    await page.getByTestId("rate-why").click();
    await reasons.waitFor();
    const chosen = page.locator('[data-testid="rate-reason"][aria-pressed="true"]');
    assert.equal(await chosen.getAttribute("data-reason"), "unfair");
    assert.ok(await chosen.evaluate((el) => el === document.activeElement));
    const at = await page.evaluate(() => location.hash);
    await page.keyboard.press("Escape");
    await reasons.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => location.hash), at);
    assert.ok(await page.getByTestId("rate-down").evaluate((el) => el === document.activeElement));

    // The chosen key again takes the rating back.
    await page.getByTestId("rate-down").click();
    assert.deepEqual(await rating(page), { rating: "0", reason: null });
    assert.deepEqual(await pressed(page), ["false", "false"]);
    assert.equal(await page.getByTestId("rate-reasons").count(), 0);
    assert.equal((await store(page)).ratings["list:mountains"].rating, 0);
    await ctx.close();
  });
}

test("a Blitz round is rated on its own, and Past runs show both ratings (desktop)", async () => {
  const { ctx, page } = await open(browser, desktop, "#blitz-airports");
  await page.getByLabel("Your guess").waitFor();
  const p = await puzzle(page, "airports");
  await guess(page, p.answers[0].name);
  await page.clock.fastForward(91_000);
  await page.getByTestId("blitz-results").waitFor();
  await page.getByTestId("rate-up").click();
  assert.deepEqual(await rating(page), { rating: "1", reason: null });
  assert.equal(await page.getByTestId("note").count(), 0);

  // The list game on the same list: its own rating.
  await go(page, "#p-airports");
  await page.getByLabel("Your guess").waitFor();
  await giveUp(page);
  assert.deepEqual(await rating(page), { rating: "0", reason: null });
  await page.getByTestId("rate-down").click();
  await page.locator('[data-testid="rate-reason"][data-reason="too-hard"]').click();
  const { ratings } = await store(page);
  assert.deepEqual(Object.keys(ratings).sort(), ["blitz:airports", "list:airports"]);
  assert.deepEqual([ratings["blitz:airports"].rating, ratings["blitz:airports"].reason], [1, undefined]);
  assert.deepEqual([ratings["list:airports"].rating, ratings["list:airports"].reason], [-1, "too-hard"]);

  // Past runs: each run's view shows its mode's rating.
  await go(page, "#history");
  await page.locator('[data-testid="history-row"][data-kind="list"]').first().click();
  await page.getByTestId("list-run").waitFor();
  assert.deepEqual(await rating(page), { rating: "-1", reason: "too-hard" });
  await go(page, "#history");
  await page.locator('[data-testid="history-row"][data-kind="blitz"]').first().click();
  await page.getByTestId("run-view").waitFor();
  assert.deepEqual(await rating(page), { rating: "1", reason: null });
  assert.equal(await page.getByTestId("note").count(), 0);
  // Changed from the run: the round's results say the same.
  await page.getByTestId("rate-down").click();
  await page.getByTestId("rate-skip").click();
  await page.getByTestId("rate-reasons").waitFor({ state: "detached" });
  assert.deepEqual(await rating(page), { rating: "-1", reason: null });
  await page.getByTestId("rate-why").waitFor();
  assert.equal((await store(page)).ratings["blitz:airports"].rating, -1);
  await ctx.close();
});
