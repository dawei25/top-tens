// The ocean and its squid: a decorative layer behind every screen, with the one roaming squid in it. It lights one
// limb per answer found (classic) and per top-10 hit (Blitz), the same after a reload; it roams, and with reduced
// motion it is parked and still.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, puzzle, noHScroll, guess } = require("./helpers.cjs");

const LIST = "countries-population";

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const litOf = (loc) =>
  loc.locator('[data-limb][data-on="true"]').evaluateAll((els) => els.map((e) => Number(e.dataset.limb)).sort((a, b) => a - b));
const transformOf = (page) => page.getByTestId("ocean").locator(".ocean-squid").evaluate((el) => el.style.transform);

/** The ocean is behind everything, out of the way: hidden from readers, nothing focusable, never takes a pointer. */
async function assertOcean(page) {
  const ocean = page.getByTestId("ocean");
  await ocean.waitFor({ state: "attached" });
  assert.equal(await ocean.getAttribute("aria-hidden"), "true");
  const box = await ocean.evaluate((el) => {
    const cs = getComputedStyle(el);
    const canvases = [...el.querySelectorAll("canvas")].map((c) => c.width * c.height);
    const focusable = el.querySelectorAll("a, button, input, select, textarea, [tabindex]").length;
    return { position: cs.position, z: cs.zIndex, pointer: cs.pointerEvents, canvases, focusable };
  });
  assert.equal(box.position, "fixed");
  assert.equal(box.z, "-1");
  assert.equal(box.pointer, "none");
  assert.equal(box.focusable, 0);
  assert.equal(box.canvases.length, 2);
  assert.ok(box.canvases.every((n) => n > 0));
  // One squid, in the ocean, not in the header.
  assert.equal(await page.getByTestId("squid").count(), 1);
  assert.equal(await ocean.getByTestId("squid").count(), 1);
  assert.equal(await page.getByTestId("screen-title").getByTestId("squid").count(), 0);
}

for (const vp of VIEWPORTS) {
  test(`ocean squid lights a limb per find (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    await assertOcean(page);
    const squid = page.getByTestId("ocean").getByTestId("squid");
    await squid.waitFor();
    assert.equal(await squid.getAttribute("data-lit"), "0");
    assert.deepEqual(await litOf(squid), []);
    assert.equal(await squid.locator("[data-limb]").count(), 10);

    const p = await puzzle(page, LIST);
    for (const r of [1, 4, 7]) await guess(page, p.answers.find((a) => a.rank === r).name);
    assert.equal(await squid.getAttribute("data-lit"), "3");
    assert.deepEqual(await litOf(squid), [1, 4, 7]);

    // A costly miss empties an ink sac; the lives element reads the same as ever.
    await guess(page, p.extras.find((e) => e.rank > 10).name);
    assert.equal(await page.getByTestId("lives").getAttribute("data-lives"), "4");
    assert.equal(await squid.getAttribute("data-lit"), "3");

    // Loading the game in progress shows the same limbs lit.
    await page.reload();
    await squid.waitFor();
    assert.deepEqual(await litOf(squid), [1, 4, 7]);
    assert.equal(await squid.getAttribute("data-mood"), "play");
    assert.ok(await noHScroll(page));

    // Give up: the results panel has the big squid with the same limbs lit; the roaming one dims too.
    await page.getByTestId("give-up").click();
    await page.getByTestId("give-up").click();
    const hero = page.getByTestId("results").getByTestId("results-squid");
    await hero.waitFor();
    assert.deepEqual(await litOf(hero), [1, 4, 7]);
    assert.equal(await hero.getAttribute("data-mood"), "gave-up");
    assert.equal(await squid.getAttribute("data-mood"), "gave-up");
    assert.ok(await noHScroll(page));

    // Home: the same ocean, the squid just roaming, unlit.
    await page.getByTestId("nav-home").click();
    await page.getByTestId("today-list").waitFor();
    await assertOcean(page);
    assert.equal(await squid.getAttribute("data-lit"), "0");
    assert.equal(await squid.getAttribute("data-mood"), "play");
    await ctx.close();
  });

  test(`blitz squid lights a limb per top-10 hit (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#blitz-${LIST}`);
    await assertOcean(page);
    const squid = page.getByTestId("ocean").getByTestId("squid");
    await squid.waitFor();
    const p = await puzzle(page, LIST);
    await guess(page, p.answers.find((a) => a.rank === 2).name);
    await guess(page, p.extras.find((e) => e.rank > 10).name);
    await page.getByTestId("blitz-hit").nth(1).waitFor();
    assert.equal(await squid.getAttribute("data-lit"), "1");
    assert.equal(await squid.locator('[data-limb="2"]').getAttribute("data-on"), "true");
    assert.equal(await squid.getAttribute("data-mode"), "blitz");
    await ctx.close();
  });
}

test("the squid roams, and parks with reduced motion (lit limbs stay)", async () => {
  const { ctx, page } = await open(browser, VIEWPORTS[0], `#p-${LIST}`);
  const squid = page.getByTestId("ocean").getByTestId("squid");
  await squid.waitFor();
  const p = await puzzle(page, LIST);
  for (const r of [2, 5]) await guess(page, p.answers.find((a) => a.rank === r).name);

  // Moving: its transform changes from frame to frame.
  const first = await transformOf(page);
  await page.waitForFunction(
    (t) => document.querySelector('[data-testid="ocean"] .ocean-squid').style.transform !== t,
    first,
    { timeout: 3000 },
  );

  // Reduced motion: parked, and still.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(150);
  const parked = await transformOf(page);
  await page.waitForTimeout(800);
  assert.equal(await transformOf(page), parked);
  assert.deepEqual(await litOf(squid), [2, 5]);
  await ctx.close();
});
