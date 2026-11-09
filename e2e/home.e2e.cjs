// Home's free play: each key rolls at once; its "by category" strip opens that mode's categories (one picker at a
// time, both in one order), closes on Escape, an outside press or a pick, and a chip rolls a list (or a Blitz) in that
// category. How to play floats over the page as a dialog; Your record is always there. (Reset all progress lives in
// Settings now: menu.e2e.cjs.)
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, hash } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const focusedTestId = (page) => page.evaluate(() => document.activeElement?.dataset.testid ?? null);
/** Where an element sits in the page (not the viewport, which phone emulation can pan), and its size. */
const place = (loc) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  });
const focusedMode = (page) => page.evaluate(() => document.activeElement?.dataset.mode ?? null);

for (const vp of VIEWPORTS) {
  test(`free play by category (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const listStrip = page.getByTestId("random-list-categories");
    const blitzStrip = page.getByTestId("random-blitz-categories");
    const chips = page.getByTestId("category");
    await listStrip.waitFor();
    assert.equal(await chips.count(), 0, "closed until asked");
    assert.equal(await listStrip.getAttribute("aria-expanded"), "false");

    // Side by side (desktop), both free-play keys and both strips line up.
    const box = async (id) => page.getByTestId(id).boundingBox();
    if (vp.name === "desktop") {
      const [l, b] = [await box("random-list"), await box("random-blitz")];
      assert.equal(Math.round(l.y), Math.round(b.y));
      assert.equal(Math.round(l.height), Math.round(b.height));
      assert.equal(Math.round((await box("random-list-categories")).y), Math.round((await box("random-blitz-categories")).y));
    }

    // The list picker: classic chips only, focus on the first one. It floats: the Free play panel doesn't grow.
    const panelHeight = async () => (await box("free-play")).height;
    const closedHeight = await panelHeight();
    await listStrip.click();
    assert.equal(await panelHeight(), closedHeight);
    assert.equal(await listStrip.getAttribute("aria-expanded"), "true");
    assert.ok((await chips.count()) > 1);
    assert.equal(await page.locator('[data-testid="category"][data-mode="blitz"]').count(), 0);
    // A category with fewer than three lists sits out (a roll in it would soon widen to every list without a word).
    const all = await page.evaluate(async () => (await fetch("puzzles/index.json")).json());
    for (const c of await chips.evaluateAll((els) => els.map((e) => e.dataset.category))) {
      assert.ok(all.filter((m) => m.category === c).length >= 3, `${c} has three lists or more`);
    }
    assert.equal(await focusedTestId(page), "category");
    assert.equal(await focusedMode(page), "list");
    // Arrow keys move through the chips.
    await page.keyboard.press("ArrowDown");
    const second = await page.locator('[data-testid="category"][data-mode="list"]').nth(1).getAttribute("data-category");
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.category), second);

    // Opening the Blitz picker closes the list one.
    await blitzStrip.click();
    assert.equal(await panelHeight(), closedHeight);
    assert.equal(await listStrip.getAttribute("aria-expanded"), "false");
    assert.equal(await blitzStrip.getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator('[data-testid="category"][data-mode="list"]').count(), 0);
    assert.equal(await focusedMode(page), "blitz");

    // Escape closes it and gives focus back to its strip.
    await page.keyboard.press("Escape");
    assert.equal(await chips.count(), 0);
    assert.equal(await focusedTestId(page), "random-blitz-categories");

    // A press outside closes it too.
    await blitzStrip.click();
    await page.mouse.click(4, 200);
    assert.equal(await chips.count(), 0);
    assert.equal(await blitzStrip.getAttribute("aria-expanded"), "false");
    await page.goto(page.url().split("#")[0]);

    // Every Blitz chip's category has open Blitz lists; a pick lands on a fresh Blitz in that category.
    await blitzStrip.click();
    const index = await page.evaluate(async () => (await fetch("puzzles/index.json")).json());
    const blitzChips = page.locator('[data-testid="category"][data-mode="blitz"]');
    for (const c of await blitzChips.evaluateAll((els) => els.map((e) => e.dataset.category))) {
      assert.ok(index.some((m) => m.category === c && m.blitz), `${c} has Blitz lists`);
    }
    const pick = blitzChips.last();
    const category = await pick.getAttribute("data-category");
    await pick.click();
    await page.getByTestId("blitz-screen").waitFor();
    assert.match(await hash(page), /^#blitz-/);
    const id = await page.getByTestId("blitz-screen").getAttribute("data-list");
    assert.equal(index.find((m) => m.id === id).category, category);
    assert.equal(await page.getByTestId("blitz-clock").getAttribute("data-started"), "false", "a fresh round");

    // A list chip rolls a classic list in that category.
    await page.getByTestId("nav-home").click();
    await listStrip.click();
    const listPick = page.locator('[data-testid="category"][data-mode="list"]').first();
    const listCategory = await listPick.getAttribute("data-category");
    await listPick.click();
    await page.getByTestId("lives").waitFor();
    const listId = (await hash(page)).replace(/^#p-/, "");
    assert.equal(index.find((m) => m.id === listId).category, listCategory);
    await ctx.close();
  });

  test(`both pickers list categories in one order (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const order = async (kind) => {
      await page.getByTestId(`random-${kind}-categories`).click();
      const cats = await page.locator(`[data-testid="category"][data-mode="${kind}"]`).evaluateAll((els) => els.map((e) => e.dataset.category));
      await page.keyboard.press("Escape");
      return cats;
    };
    const list = await order("list");
    const blitz = await order("blitz");
    assert.deepEqual(blitz, list.filter((c) => blitz.includes(c)), "the Blitz picker follows the list picker's order");
    await ctx.close();
  });

  test(`How to play floats over Home (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, "", { games: {}, daily: {}, seenHelp: false });
    const key = page.getByTestId("howto-key");
    const dialog = page.getByTestId("howto");
    await key.waitFor();
    assert.equal(await dialog.count(), 0, "closed on a first visit");
    // Pressed by its spot on screen (scrolled there by the page, so phone emulation doesn't pan the viewport), the
    // same spot both times: the second press goes wherever the screen has it then. Phone emulation starts with a
    // taller layout viewport than the screen for a moment; measure once they agree.
    await page.waitForFunction(() => innerHeight === Math.round(visualViewport.height));
    await key.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const spot = await key.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    const pressKey = () => (vp.hasTouch ? page.touchscreen.tap(...spot) : page.mouse.click(...spot));
    const before = await place(key);
    const scrollBefore = await page.evaluate(() => scrollY);

    // It opens where it was asked for: nothing behind it moves, focus goes into it, and the rules include Blitz.
    await pressKey();
    await dialog.waitFor();
    assert.ok(await dialog.evaluate((d) => d.open && d.matches(":modal")));
    assert.deepEqual(await place(key), before);
    assert.equal(await page.evaluate(() => scrollY), scrollBefore);
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "howto");
    assert.ok(await page.getByTestId("howto-blitz").isVisible());

    // A double press lands on the rules: no game starts and they stay open. Enter presses nothing either.
    await pressKey();
    await page.keyboard.press("Enter");
    assert.equal(await hash(page), "");
    assert.ok(await dialog.isVisible());

    // Escape closes it, focus back on the key, and the rules count as seen.
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "howto-key");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("top-tens:v1")).seenHelp), true);

    // Got it closes it; so does a press outside, once it has been open a moment.
    await key.click();
    await page.getByTestId("howto-close").click();
    await dialog.waitFor({ state: "detached" });
    await key.click();
    await dialog.waitFor();
    await page.clock.runFor(1000);
    await (vp.hasTouch ? page.touchscreen.tap(4, 4) : page.mouse.click(4, 4));
    await dialog.waitFor({ state: "detached" });
    assert.equal(await hash(page), "");
    await ctx.close();
  });

  test(`Your record is always there, as wide as the other cards (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const record = page.getByTestId("home-record");
    await record.waitFor();
    assert.equal(await record.getAttribute("data-empty"), "true", "placeholders before the first game");
    const edges = async (id) => {
      const b = await page.getByTestId(id).boundingBox();
      return [Math.round(b.x), Math.round(b.x + b.width)];
    };
    assert.deepEqual(await edges("home-record"), await edges("today-group"));
    assert.deepEqual(await edges("home-foot"), await edges("today-group"));
    // A build without accounts has no account key (backend.e2e.cjs covers the key itself), and nothing comes between
    // Today and Free play (the account once took a row there).
    assert.equal(await page.getByTestId("account-key").count(), 0);
    assert.ok(
      await page.getByTestId("today-group").evaluate((el) => !!el.nextElementSibling?.contains(document.querySelector('[data-testid="free-play"]'))),
      "Free play right after Today",
    );
    await ctx.close();
  });
}

// A 320px phone: the logo (and its power-on sweep) once ran 12px past each edge, so the phone widened the page to
// 326-359px and everything floating (sheets, the menu) came out too wide. The page must stay the screen's width the
// whole time, during the boot animation and after.
test("320px phone: Home never widens the page, during the logo's power-on or after", async () => {
  for (const width of [320, 340]) {
    const { ctx, page } = await open(browser, { viewport: { width, height: 640 }, isMobile: true, hasTouch: true });
    const widths = [];
    for (const wait of [0, 150, 350, 600, 1200]) {
      if (wait) await page.waitForTimeout(wait);
      widths.push(await page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]));
    }
    for (const [inner, scroll] of widths) {
      assert.equal(inner, width, `${width}: the page widened to ${inner}`);
      assert.ok(scroll <= width, `${width}: content ${scroll} wide`);
    }
    const logo = await page.locator(".logo").boundingBox();
    assert.ok(logo.x >= 0 && logo.x + logo.width <= width, `${width}: the logo spans ${Math.round(logo.x)} to ${Math.round(logo.x + logo.width)}`);
    await ctx.close();
  }
});

// Launch audit, Nov 6: "Tab reaches menu, account and sound only after the footer". The header keys come first in
// the page, as on screen; the audit's Tab started from Today's list, which Home focuses on arrival so Enter plays it.
// From there the header is one Shift+Tab away (sound, then the menu), and a full Tab round reaches it before Today.
test("keyboard: Home's tab order follows the screen, the header keys first", async () => {
  const { ctx, page } = await open(browser, VIEWPORTS.find((v) => v.name === "desktop"));
  await page.getByTestId("today-list").waitFor();
  const order = await page.evaluate(() =>
    [...document.querySelectorAll("main.home a[href], main.home button:not(:disabled)")]
      .filter((el) => el.tabIndex >= 0 && el.getClientRects().length)
      .map((el) => el.dataset.testid),
  );
  assert.deepEqual(order.slice(0, 3), ["menu-key", "sound-toggle", "today-list"], `the order: ${order.join(", ")}`);
  assert.equal(order.at(-1), "howto-key", "the footer last");
  assert.equal(await focusedTestId(page), "today-list", "Home focuses Today's list on arrival");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await focusedTestId(page), "sound-toggle");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await focusedTestId(page), "menu-key");
  await ctx.close();
});
