// A new screen opens at its top; Back returns to the screen where you left it. Launch audit, Nov 6: on a phone, Home
// scrolled down to Your games and ARCHIVE pressed, the archive opened at Home's offset (scrollY 524), partway down its
// list; any long screen inherited the scroll of the one before. Back keeps the place it left: from a long screen and
// from a short one (where the browser's own restore would stop at the short page's end), through the Back key and the
// browser's back, and two screens deep.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, hash, giveUp } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const phone = VIEWPORTS.find((v) => v.name === "phone");
const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
/** Scrolls the page by hand, to `y` (or as far as it goes). */
const scrollTo = (page, y) => page.evaluate((y) => window.scrollTo(0, y), y);
/** Waits for the frames after a hash change (React draws in the hashchange's task). */
const settled = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/** Scrolls until `loc` sits at the bottom of the screen (`block`), as a thumb does, then taps it; the scroll it left. */
async function tapAt(page, loc, block = "end") {
  await loc.evaluate((el, block) => el.scrollIntoView({ block }), block);
  const y = await scrollY(page);
  await loc.tap();
  return y;
}

test("phone: a screen opened from a scrolled Home starts at its top; Back returns to the same spot", async () => {
  // Nov 9: 21 days in the archive, a long list even at one short row a day (one daily since Nov 10).
  const { ctx, page } = await open(browser, phone, "", undefined, { now: new Date("2026-11-09T12:00:00-05:00") });
  await page.getByTestId("today-list").waitFor();

  // Home scrolled down past Your games (it sits near the top of the scroll, so the thumb brings it up to the top),
  // ARCHIVE pressed: the archive opens at its top. Browser back: Home where it was.
  const homeY = await tapAt(page, page.getByTestId("archive-key"), "start");
  assert.ok(homeY > 100, `Home scrolls on a phone (${homeY})`);
  await page.getByTestId("archive-row").first().waitFor();
  await settled(page);
  assert.equal(await hash(page), "#archive");
  assert.equal(await scrollY(page), 0, "the archive opens at its top");
  await page.goBack();
  await page.getByTestId("today-list").waitFor();
  await settled(page);
  assert.equal(await scrollY(page), homeY, "browser back: Home where it was");

  // Again, the archive scrolled a long way and an old daily opened (at its top), then Back, Back (the key): each
  // screen where it was.
  assert.equal(await tapAt(page, page.getByTestId("archive-key"), "start"), homeY);
  await page.getByTestId("archive-row").first().waitFor();
  await settled(page);
  assert.equal(await scrollY(page), 0);
  const archiveY = await tapAt(page, page.getByTestId("archive-row").nth(14), "center");
  assert.ok(archiveY > 300, `the archive scrolls (${archiveY})`);
  await page.getByTestId("slot").first().waitFor();
  await settled(page);
  assert.match(await hash(page), /^#daily-/);
  assert.equal(await scrollY(page), 0, "the old daily opens at its top");
  await page.getByTestId("nav-back").tap();
  await page.getByTestId("archive-row").first().waitFor();
  await settled(page);
  assert.equal(await scrollY(page), archiveY, "Back key: the archive where it was");
  await page.getByTestId("nav-back").tap();
  await page.getByTestId("today-list").waitFor();
  await settled(page);
  assert.equal(await scrollY(page), homeY, "Back key: Home where it was");

  // A short screen (Stats, about a screen tall) and back: Home's spot is still there.
  const statsY = await tapAt(page, page.getByTestId("stats-key"), "start");
  await page.getByTestId("knowledge").waitFor();
  await settled(page);
  assert.equal(await scrollY(page), 0, "Stats opens at its top");
  const statsMax = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  assert.ok(statsMax < statsY, `Stats is too short to hold Home's spot (${statsMax} < ${statsY})`);
  await page.goBack();
  await page.getByTestId("today-list").waitFor();
  await settled(page);
  assert.equal(await scrollY(page), statsY, "back from a short screen: Home where it was");
  await ctx.close();
});

test("phone: a menu tile from a scrolled game opens its screen at the top", async () => {
  const { ctx, page } = await open(browser, phone, "#p-mountains");
  await giveUp(page);
  await scrollTo(page, 600);
  assert.ok((await scrollY(page)) > 300, "the finished game scrolls");
  // The menu opened from the keyboard, so nothing scrolls the page back up to its key first.
  await page.getByTestId("menu-key").evaluate((el) => el.focus({ preventScroll: true }));
  await page.keyboard.press("Enter");
  await page.getByTestId("menu").waitFor();
  await page.getByTestId("menu-archive").tap();
  await page.getByTestId("archive-row").first().waitFor();
  await settled(page);
  assert.equal(await hash(page), "#archive");
  assert.equal(await scrollY(page), 0, "the archive opens at its top");
  await ctx.close();
});
