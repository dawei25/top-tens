// Wide screens: one frame, the header across it, the title card and the control column side by side with their tops
// aligned; the control column stays in view as the page scrolls. No sideways scroll from 1100px up (and on a phone).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, open, noHScroll, puzzle, guess, giveUp } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const box = (loc) => loc.evaluate((el) => el.getBoundingClientRect().toJSON());

test("wide layout: aligned columns in one frame", async () => {
  for (const hash of ["#p-mountains", "#blitz-mountains"]) {
    const { ctx, page } = await open(browser, { viewport: { width: 1920, height: 1080 } }, hash);
    const title = page.getByTestId("title-card");
    const control = page.getByTestId("control-col");
    await title.waitFor();
    const head = await page.getByTestId("screen-title").evaluate((el) => el.closest("header").getBoundingClientRect().toJSON());
    const t = await box(title);
    const c = await box(control);
    assert.ok(head.width <= 1280 && head.width >= 1200, `${hash}: the header spans the frame (${head.width})`);
    assert.ok(Math.abs(head.left + head.width / 2 - 960) < 2, `${hash}: the frame is centred`);
    assert.equal(Math.round(c.top), Math.round(t.top), `${hash}: the control column's top meets the title card's`);
    assert.ok(c.left > t.right, `${hash}: the control column sits right of the board`);
    assert.ok(c.right < head.right, `${hash}: open water stays right of the control column`);
    // The guess box lives in the control column.
    assert.ok(await control.getByLabel("Your guess").isVisible());
    await ctx.close();
  }
});

test("no sideways scroll at any width", async () => {
  for (const width of [390, 1100, 1280, 1440, 1920, 2560]) {
    for (const hash of ["", "#p-mountains", "#blitz-mountains"]) {
      const vp = width < 500 ? { viewport: { width, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width, height: 900 } };
      const { ctx, page } = await open(browser, vp, hash);
      await page.getByTestId(hash ? "nav-home" : "today-list").waitFor();
      assert.ok(await noHScroll(page), `${width} ${hash || "home"}`);
      await ctx.close();
    }
  }
});

// Launch audit, Nov 6: at the end of a game on a phone the Misses band ran 6 to 384 px while every panel spans 16 to
// 374: it kept the dock's reach into the gutter after it left the dock (UX 8). At the end it lines up with the panels
// at every width under the wide layout.
test("a finished game: the Misses band lines up with the board and the results", async () => {
  for (const width of [320, 390, 800]) {
    const vp = width < 500 ? { viewport: { width, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width, height: 900 } };
    const { ctx, page } = await open(browser, vp, "#p-mountains");
    const p = await puzzle(page, "mountains");
    await guess(page, p.extras.find((e) => e.rank > 10).name);
    await giveUp(page);
    const misses = page.getByRole("region", { name: "Wrong guesses" });
    const [m, board, results] = [await box(misses), await box(page.getByRole("region", { name: "Top 10" })), await box(page.getByTestId("results"))];
    for (const [name, b] of [["board", board], ["results", results]]) {
      assert.equal(Math.round(m.left), Math.round(b.left), `${width}px: the Misses band's left edge meets the ${name}'s`);
      assert.equal(Math.round(m.right), Math.round(b.right), `${width}px: the Misses band's right edge meets the ${name}'s`);
    }
    await ctx.close();
  }
});
