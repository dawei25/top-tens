// The ocean and its squid: a decorative layer behind every screen, with the one roaming squid in it. It lights one
// limb per answer found (classic) and per top-10 hit (Blitz), the same after a reload; a find shows at once (no
// word carried over the glass); it roams, and with reduced motion it is parked and still.
// The easter egg (the owner, Nov 8: "clicking on the squid does something ... a tiny bit more reactive when you get
// an answer"): a tap on the squid's own pixels makes it react, a tap on a control over it is the control's alone, a
// find makes it wiggle (bigger for a top 3, over in under a second), and with reduced motion a tap only recolours it.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, puzzle, noHScroll, guess, freeze } = require("./helpers.cjs");

const LIST = "countries-population";

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const litOf = (loc) =>
  loc.locator('[data-limb][data-on="true"]').evaluateAll((els) => els.map((e) => Number(e.dataset.limb)).sort((a, b) => a - b));
/** A fingerprint of the squid canvas (the squid and the effects in front of it): changes as it swims. */
const squidFrame = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="ocean"] .ocean-front');
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (Math.imul(h, 31) + d[i] + d[i + 1] * 3 + d[i + 3] * 7) | 0;
    return h;
  });

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

    // Loading the game in progress shows the same limbs lit. The ocean is there at once, before the saved game has
    // loaded: wait for its limbs, not just for the squid.
    await page.reload();
    await squid.locator('[data-limb][data-on="true"]').nth(2).waitFor({ state: "attached" });
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


test("the squid roams, finds show at once, and it parks with reduced motion", async () => {
  const { ctx, page } = await open(browser, VIEWPORTS[0], `#p-${LIST}`);
  const squid = page.getByTestId("ocean").getByTestId("squid");
  await squid.waitFor();
  const p = await puzzle(page, LIST);
  // Two quick finds: each word is in its row at once; the box is cleared; both limbs lit.
  for (const r of [2, 5]) await guess(page, p.answers.find((a) => a.rank === r).name);
  assert.equal(await page.getByLabel("Your guess").inputValue(), "");
  const row = page.locator('[data-testid="slot"][data-rank="5"]');
  assert.ok((await row.getAttribute("class")).includes("found"));
  assert.deepEqual(await litOf(squid), [2, 5]);

  // Moving: the squid canvas changes from frame to frame.
  const first = await squidFrame(page);
  await page.waitForFunction(
    (h) => {
      const c = document.querySelector('[data-testid="ocean"] .ocean-front');
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let x = 0;
      for (let i = 0; i < d.length; i += 4) x = (Math.imul(x, 31) + d[i] + d[i + 1] * 3 + d[i + 3] * 7) | 0;
      return x !== h;
    },
    first,
    { timeout: 3000 },
  );

  // Reduced motion: parked, and still, the lit limbs still lit.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(150);
  const parked = await squidFrame(page);
  await page.waitForTimeout(800);
  assert.equal(await squidFrame(page), parked);
  assert.deepEqual(await litOf(squid), [2, 5]);
  await ctx.close();
});

/* ---------------------------------------------------------------- the easter egg */

/** What counts as a control under a tap (the engine's own list is wider; these are the ones on the game screens). */
const CONTROL = 'a[href], button, input, textarea, summary, label, [role="button"], [role="switch"], .slot.has-fact, .slot.hintable';

/**
 * Where the squid is (viewport CSS px): the middle of its eyes on the squid canvas (they are on its mantle, and the
 * only pixels drawn in that colour), or null when they are not on screen. With the clock frozen, it stays there.
 */
const squidSpot = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="ocean"] .ocean-front');
    const k = c.getBoundingClientRect().width / c.width;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 255 && Math.abs(d[i] - 0xa6) <= 3 && Math.abs(d[i + 1] - 0xf1) <= 3 && Math.abs(d[i + 2] - 0xff) <= 3) {
        sx += (i / 4) % c.width;
        sy += Math.floor(i / 4 / c.width);
        n++;
      }
    }
    const p = n && { x: (sx / n + 0.5) * k, y: (sy / n + 0.5) * k };
    return p && p.y > 2 && p.y < innerHeight - 2 && p.x > 2 && p.x < innerWidth - 2 ? p : null;
  });

/**
 * The controls around a point: `under` (the one right under it, if any: its test id, or its tag and classes) and
 * whether it matches the selector `only`; `ring`, how many controls are within a fingertip (16px) of it.
 */
const controlsAt = (page, p, only = "*") =>
  page.evaluate(
    ({ p, CONTROL, only }) => {
      const name = (el) => el.dataset.testid || `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`;
      const at = (dx, dy) => document.elementFromPoint(p.x + dx, p.y + dy)?.closest(CONTROL);
      const el = at(0, 0);
      const offsets = [[16, 0], [-16, 0], [0, 16], [0, -16], [11, 11], [-11, 11], [11, -11], [-11, -11], [8, 0], [-8, 0], [0, 8], [0, -8]];
      const ring = offsets.map(([x, y]) => at(x, y)).filter(Boolean);
      return { under: el ? name(el) : null, only: !!el?.matches(only), ring: ring.length };
    },
    { p, CONTROL, only },
  );

/**
 * Moves the frozen clock on until the squid is on screen and "clear" of every control by a fingertip, or "under" a
 * control that matches `only`. Returns where it is. A key now and then keeps it awake: after 20 s without input it
 * dozes on the seabed, which on a phone is behind the guess row, and it would never come clear (Nov 9, under load).
 */
async function squidWhere(page, where, { only = "*", tries = 200 } = {}) {
  const fits = (c) => (where === "clear" ? !c.under && !c.ring : c.only);
  for (let i = 0; i < tries; i++) {
    const p = await squidSpot(page);
    if (p && fits(await controlsAt(page, p, only))) return p;
    if (i % 40 === 39) await page.keyboard.press("Shift");
    await page.clock.runFor(200);
  }
  throw new Error(`the squid never showed ${where} a control`);
}

/** Every click that lands in a control, from now on: for each, the controls it is in, innermost first. */
const recordClicks = (page) =>
  page.evaluate((CONTROL) => {
    window.__controlClicks = [];
    if (window.__recording) return;
    window.__recording = true;
    document.addEventListener(
      "click",
      (e) => {
        const names = [];
        for (let el = e.target.closest?.(CONTROL); el; el = el.parentElement?.closest(CONTROL))
          names.push(el.dataset.testid || `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
        if (names.length) window.__controlClicks.push(names);
      },
      true,
    );
  }, CONTROL);
const controlClicks = (page) => page.evaluate(() => window.__controlClicks);

/** What a stray tap could change: the screen, the guess, an open fact, clue or dialog, the sound. */
const screenState = (page) =>
  page.evaluate(() => ({
    hash: location.hash,
    guess: document.querySelector('[aria-label="Your guess"]')?.value,
    open: document.querySelectorAll(".slot.fact-open, [data-testid='hint-ask'], dialog[open]").length,
    sound: document.querySelector('[data-testid="sound-toggle"]')?.getAttribute("aria-pressed"),
  }));

const tapAt = (page, vp, p) => (vp.hasTouch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
const reaction = (page) =>
  page
    .getByTestId("ocean")
    .getByTestId("squid")
    .evaluate((el) => ({ react: el.dataset.react ?? null, pokes: Number(el.dataset.pokes ?? 0), finds: Number(el.dataset.finds ?? 0) }));

/** A fingerprint of which squid-canvas pixels are drawn at all (its shape and place, not its colours). */
const squidMask = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="ocean"] .ocean-front');
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 3; i < d.length; i += 4) h = (Math.imul(h, 31) + (d[i] ? i : 0)) | 0;
    return h;
  });

for (const vp of VIEWPORTS) {
  test(`tapping the squid makes it react, and never presses a control (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    await page.getByLabel("Your guess").waitFor();
    await page.waitForTimeout(1600);
    await freeze(page);
    await recordClicks(page);

    // On a phone the squid swims behind the glass, under the board's rows and the guess box: a tap on a control over
    // it is that control's, and the squid takes none of it.
    if (vp.hasTouch) {
      const ROWS = '.slot.hintable, [aria-label="Your guess"], [data-testid="guess-submit"]';
      const p = await squidWhere(page, "under", { only: ROWS });
      const control = (await controlsAt(page, p)).under;
      await tapAt(page, vp, p);
      const clicks = await controlClicks(page);
      assert.ok(clicks.length === 1 && clicks[0].includes(control), `the control over the squid (${control}) got the tap: ${JSON.stringify(clicks)}`);
      assert.deepEqual(await reaction(page), { react: null, pokes: 0, finds: 0 }, "the squid took a control's tap");
      await page.keyboard.press("Escape");

      // Beside a control, a phone hands the tap's click to it (touch adjustment: in Chromium a touch 4px above row 1,
      // on the board's head, clicks row 1). The press and lift land on the squid, the click on the row: the row's
      // alone. Replayed as events (the squid can't be put there), with each click: on the row, on bare glass, none.
      let q = await squidWhere(page, "clear");
      const replay = (click) =>
        page.evaluate(
          ({ q, click }) => {
            const el = document.elementFromPoint(q.x, q.y);
            const at = { bubbles: true, clientX: q.x, clientY: q.y, pointerId: 7, isPrimary: true, pointerType: "touch" };
            el.dispatchEvent(new PointerEvent("pointerdown", at));
            el.dispatchEvent(new PointerEvent("pointerup", at));
            if (click === "row") document.querySelector('.slot.hintable[data-rank="10"]').click();
            if (click === "glass") el.click();
          },
          { q, click },
        );
      await replay("row");
      await page.clock.runFor(400);
      assert.equal((await reaction(page)).pokes, 0, "the squid took a tap the browser gave a row");
      await page.keyboard.press("Escape");
      q = await squidWhere(page, "clear");
      await replay("glass");
      assert.equal((await reaction(page)).pokes, 1, "a tap on the squid, clicked on bare glass, is the squid's");
      await page.clock.runFor(1500);
      // Where it is now: it roams on meanwhile (replayed where it was, the tap missed it 1 run in 2, Nov 9).
      q = await squidWhere(page, "clear");
      await replay(null);
      assert.equal((await reaction(page)).pokes, 1, "the squid didn't wait for the click");
      // A beat later (250 ms) the squid takes a tap no click followed. Stepped, not one jump: under load the frame
      // that reads the timer can land after a single runFor (flaked once, Nov 8).
      let pokes = 1;
      for (let i = 0; i < 20 && pokes < 2; i++) {
        await page.clock.runFor(100);
        pokes = (await reaction(page)).pokes;
      }
      assert.equal(pokes, 2, "no click at all (Safari on bare page): the squid takes it a beat later");
      await page.clock.runFor(1500);
      await recordClicks(page);
    }

    // Clear of the controls (open water on a wide screen; bare glass or page on a phone): its own reaction, and
    // nothing else happens.
    const p = await squidWhere(page, "clear");
    const before = await screenState(page);
    const base = (await reaction(page)).pokes;
    await tapAt(page, vp, p);
    assert.deepEqual(await reaction(page), { react: "boop", pokes: base + 1, finds: 0 });
    assert.deepEqual(await controlClicks(page), [], "a tap on the squid pressed a control");
    assert.deepEqual(await screenState(page), before, "a tap on the squid changed the screen");

    // Two more in a row: the trick, over in under a second and a half.
    await tapAt(page, vp, p);
    await tapAt(page, vp, p);
    assert.deepEqual(await reaction(page), { react: "trick", pokes: base + 3, finds: 0 });
    assert.deepEqual(await controlClicks(page), []);
    assert.deepEqual(await screenState(page), before);
    await page.clock.runFor(1500);
    assert.equal((await reaction(page)).react, null, "the trick is over");
    await ctx.close();
  });

  test(`a find makes the squid wiggle, a little more for a top 3, and a miss doesn't (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    await page.getByLabel("Your guess").waitFor();
    await freeze(page);
    const p = await puzzle(page, LIST);
    await guess(page, p.answers.find((a) => a.rank === 2).name);
    assert.deepEqual(await reaction(page), { react: "find-top3", pokes: 0, finds: 1 });
    // Quick: over well within a second, with the limb's flash.
    await page.clock.runFor(700);
    assert.equal((await reaction(page)).react, null);
    await guess(page, p.answers.find((a) => a.rank === 6).name);
    assert.deepEqual(await reaction(page), { react: "find", pokes: 0, finds: 2 });
    await page.clock.runFor(700);
    // A costly miss and a free one: no wiggle (the ink is all a miss does, as before).
    await guess(page, p.extras.find((e) => e.rank > 10).name);
    await guess(page, "qwxzzy");
    assert.deepEqual(await reaction(page), { react: null, pokes: 0, finds: 2 });

    // Blitz: a top-3 hit, then one outside the top 10 (a smaller wiggle).
    await page.evaluate((h) => (location.hash = h), `#blitz-${LIST}`);
    await page.getByLabel("Your guess").waitFor();
    await guess(page, p.answers.find((a) => a.rank === 1).name);
    assert.equal((await reaction(page)).react, "find-top3");
    await page.clock.runFor(700);
    await guess(page, p.extras.find((e) => e.rank > 10).name);
    assert.deepEqual(await reaction(page), { react: "hit", pokes: 0, finds: 4 });
    await ctx.close();
  });
}

/* ---------------------------------------------------------------- ink comes with a dart */

// The owner, Nov 9: "when you spam click the squid and it blows the ink, sometimes its stationary and the ink is just
// sitting on top of the squid- whenever u blow ink, squid should dart". Every puff of ink (the tap trick, a lost life)
// leaves with the squid: it is already darting as the ink appears, and soon well clear of the cloud, in the open and
// next to an edge (where it once faced the glass, could not turn, and inked in place over and over). Spam taps start
// no second trick while the first one's dart is on.

/** Frames are stepped one at a time on the frozen clock (the ocean runs at about 30 fps). */
const FRAME_MS = 33;

/**
 * One frame: where the squid's eyes are (viewport CSS px, null when hidden), its width (20 sprite px), how many ink
 * puffs so far (the stand-in's data-inks) and the last one's centre (data-ink-at), and whether ink is drawn there.
 */
const inkFrame = (page) =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="ocean"] .ocean-front');
    const k = c.getBoundingClientRect().width / c.width;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const near = (i, rgb) => Math.abs(d[i] - (rgb >> 16)) <= 2 && Math.abs(d[i + 1] - ((rgb >> 8) & 255)) <= 2 && Math.abs(d[i + 2] - (rgb & 255)) <= 2;
    const s = document.querySelector('[data-testid="ocean"] [data-testid="squid"]');
    const at = s.dataset.inkAt?.split(",").map(Number);
    let n = 0;
    let sx = 0;
    let sy = 0;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 255) continue;
      const x = (i / 4) % c.width;
      const y = Math.floor(i / 4 / c.width);
      if (near(i, 0xa6f1ff)) {
        sx += x;
        sy += y;
        n++;
      } else if (at && [0x1a0f36, 0x2a1650, 0x0d0720].some((rgb) => near(i, rgb)) && Math.hypot((x + 0.5) * k - at[0], (y + 0.5) * k - at[1]) < 20 * k) ink++;
    }
    return {
      eye: n ? { x: (sx / n + 0.5) * k, y: (sy / n + 0.5) * k } : null,
      w: 20 * k,
      inks: Number(s.dataset.inks ?? 0),
      at: at ? { x: at[0], y: at[1] } : null,
      ink,
    };
  });

/** How far a point is from the nearest edge: the viewport's, and on wide screens (open water) the glass panels'. */
const edgeDistance = (page, p) =>
  page.evaluate((p) => {
    let d = Math.min(p.x, innerWidth - p.x, p.y, innerHeight - p.y);
    if (innerWidth >= 700)
      for (const el of document.querySelectorAll("[data-glass]")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        d = Math.min(d, Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom)));
      }
    return d;
  }, p);

/**
 * Moves the frozen clock on until the squid is "open" (far from every edge: the viewport's, and on wide screens the
 * glass) or at an "edge". Left to roam, some runs it keeps off every edge for a minute and more, others it keeps near
 * one. So open is as far from every edge as it gets (2.2 of its widths, easing to 1.6 over the search), and an edge as
 * near one as it gets (1.2 widths, easing to 1.8); on wide screens panels come over it instead (panelOver), which is
 * sure to put it by one. The exact cases, in open water, hemmed in at the glass and in the corners, are pinned in
 * ocean/swim.test.ts.
 */
async function squidAtEdge(page, where) {
  const phone = (await page.evaluate(() => innerWidth)) < 700;
  if (where === "edge" && !phone) return panelOver(page);
  const seen = [];
  const TRIES = 400;
  for (let i = 0; i < TRIES; i++) {
    const p = await squidSpot(page);
    if (p) {
      const { w } = await inkFrame(page);
      const d = (await edgeDistance(page, p)) / w;
      const s = i / TRIES;
      if (where === "open" ? d > 2.2 - 0.6 * s : d < 1.2 + 0.6 * s) return p;
      seen.push(d);
    }
    // A key now and then, so it never dozes off on the seabed (after 20 s without input).
    if (i % 40 === 39) await page.keyboard.press("Shift");
    await page.clock.runFor(200);
  }
  const range = seen.length ? `${Math.min(...seen).toFixed(2)} to ${Math.max(...seen).toFixed(2)}` : "none";
  throw new Error(`the squid never showed ${where === "open" ? "in the open" : "next to an edge"} (in view ${seen.length} times, ${range} widths from an edge)`);
}

/**
 * A tap on the squid's own pixels at p, for the spam tests. Wide screens: a real click (it is in open water, where
 * there are no controls). Phones: the squid swims behind the glass, mostly under the board's rows and the guess box,
 * clear of every control only now and then; so the tap is replayed as events on bare page at p (press, lift, click),
 * which the squid reads on the window as ever. The rule that a control over it keeps the tap is the tap test's, above,
 * with real taps.
 */
async function tapSquid(page, vp, p) {
  if (!vp.hasTouch) return page.mouse.click(p.x, p.y);
  await page.evaluate((p) => {
    const at = { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 9, isPrimary: true, pointerType: "touch" };
    document.body.dispatchEvent(new PointerEvent("pointerdown", at));
    document.body.dispatchEvent(new PointerEvent("pointerup", at));
    document.body.click();
  }, p);
}

/**
 * Wide screens: panels come over the squid above and below (test-only [data-glass] bands, taking no pointer, as a
 * result card or a new screen would), leaving it a strip of open water 300 px (3.75 of its widths) tall: too thin to
 * turn round in anywhere (where it once inked in place), and its eyes never much more than 2 widths from an edge.
 * Returns where it is once inside the strip, a moment later. removePanels takes them away.
 */
async function panelOver(page) {
  const p = await squidWhere(page, "clear");
  await page.evaluate((p) => {
    // The open water's top at the squid's column: the lowest glass above it there.
    let top = 0;
    for (const el of document.querySelectorAll("[data-glass]")) {
      const r = el.getBoundingClientRect();
      if (r.left <= p.x && r.right >= p.x && r.bottom <= p.y) top = Math.max(top, r.bottom);
    }
    const H = 300;
    const y0 = Math.min(Math.max(top, p.y - H / 2), innerHeight - H);
    for (const [id, a, b] of [["e2e-panel-top", 0, y0], ["e2e-panel-bottom", y0 + H, innerHeight]]) {
      const d = document.createElement("div");
      d.id = id;
      d.className = "e2e-panel";
      d.dataset.glass = "";
      Object.assign(d.style, { position: "fixed", left: "0", width: "100%", top: `${a}px`, height: `${Math.max(0, b - a)}px`, pointerEvents: "none" });
      document.body.append(d);
    }
  }, p);
  const inStrip = (q) =>
    page.evaluate((q) => {
      const a = document.getElementById("e2e-panel-top").getBoundingClientRect().bottom;
      const b = document.getElementById("e2e-panel-bottom").getBoundingClientRect().top;
      return q.y > a && q.y < b;
    }, q);
  let settled = 0;
  for (let i = 0; i < 100; i++) {
    await page.clock.runFor(100);
    const q = await squidSpot(page);
    // Out from under the panels, and still there half a second on.
    settled = q && (await inStrip(q)) ? settled + 1 : 0;
    if (settled >= 5) return q;
  }
  throw new Error("the squid never swam out from under the panels");
}
const removePanels = (page) => page.evaluate(() => document.querySelectorAll(".e2e-panel").forEach((e) => e.remove()));

/**
 * Steps `frames` frames, calling `each(i, frame)` before each step (to tap or guess), and returns every frame read,
 * the one before the first step included.
 */
async function film(page, frames, each) {
  const out = [await inkFrame(page)];
  for (let i = 0; i < frames; i++) {
    if (each) await each(i, out[i]);
    await page.clock.runFor(FRAME_MS);
    out.push(await inkFrame(page));
  }
  return out;
}

/** Frames from a puff to the check that the squid is clear of it. */
const CLEAR_FRAMES = Math.round(700 / FRAME_MS);

/**
 * Every puff in a film: ink is drawn at its centre; the squid is already moving as it appears (its eyes a tenth of
 * its width on, ~100 ms after the frame before); and 700 ms on it is clear of the cloud (eyes in view, more than its
 * width from the centre). The film must run 700 ms past its last puff. Returns the frames the puffs appeared on.
 */
function assertDarts(frames, label) {
  const puffs = [];
  for (let k = 1; k < frames.length; k++) if (frames[k].inks > frames[k - 1].inks) puffs.push(k);
  for (const k of puffs) {
    const { at, w } = frames[k];
    const tag = `${label}: puff on frame ${k} at ${at.x},${at.y}`;
    assert.ok(k + CLEAR_FRAMES < frames.length, `${tag}: the film ends too soon to check it`);
    assert.ok(frames.slice(k, k + 3).some((f) => f.ink > 0), `${tag}: no ink drawn there`);
    const before = frames.slice(0, k).reverse().find((f) => f.eye)?.eye;
    const soon = frames[k + 3].eye;
    assert.ok(soon, `${tag}: 100 ms on the squid is hidden under the ink`);
    if (before) assert.ok(Math.hypot(soon.x - before.x, soon.y - before.y) >= 0.1 * w, `${tag}: the ink came out while the squid was still`);
    const later = frames[k + CLEAR_FRAMES];
    const d = later.eye && Math.hypot(later.eye.x - at.x, later.eye.y - at.y);
    assert.ok(d && d > w, `${tag}: 700 ms on the squid is ${later.eye ? `${(d / w).toFixed(2)} of its width from the cloud` : "hidden under it"}`);
  }
  return puffs;
}

for (const vp of VIEWPORTS) {
  test(`every ink puff comes with a dart: spam taps, in the open and next to an edge (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    await page.getByLabel("Your guess").waitFor();
    await page.waitForTimeout(1600);
    await freeze(page);
    await recordClicks(page);
    for (const where of ["open", "edge"]) {
      await squidAtEdge(page, where);
      // Spam: a tap on the squid every 100 ms for 5 s, chasing it (on its eyes, wherever they show); then 3 s more to
      // see the last trick through.
      let taps = 0;
      const pokes = (await reaction(page)).pokes;
      const frames = await film(page, Math.round(8000 / FRAME_MS), async (i, f) => {
        if (i % 3 || i * FRAME_MS > 5000 || !f.eye) return;
        await tapSquid(page, vp, f.eye);
        taps++;
      });
      const puffs = assertDarts(frames, where);
      const took = (await reaction(page)).pokes - pokes;
      assert.ok(puffs.length >= 1, `${where}: the taps never made the squid ink (${taps} taps, ${took} taken)`);
      // One trick at a time: taps during a trick and its dart start no second one.
      for (let j = 1; j < puffs.length; j++)
        assert.ok((puffs[j] - puffs[j - 1]) * FRAME_MS >= 1500, `${where}: a second trick ${(puffs[j] - puffs[j - 1]) * FRAME_MS} ms after the first`);
      await removePanels(page);
      await page.clock.runFor(3000);
    }
    assert.deepEqual(await controlClicks(page), [], "a tap on the squid pressed a control");
    await ctx.close();
  });

  test(`a lost life inks and darts, in the open and next to an edge, even two in a row (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
    await page.getByLabel("Your guess").waitFor();
    await page.waitForTimeout(1600);
    await freeze(page);
    const misses = (await puzzle(page, LIST)).extras.filter((e) => e.rank > 10).map((e) => e.name);
    for (const where of ["open", "edge"]) {
      await squidAtEdge(page, where);
      const frames = await film(page, 90, async (i) => {
        if (i === 0) await guess(page, misses.shift());
      });
      assert.equal(assertDarts(frames, `${where} miss`).length, 1, `${where}: a lost life inked ${frames.at(-1).inks - frames[0].inks} times`);
      await removePanels(page);
      await page.clock.runFor(2000);
    }
    // Two lives lost in quick succession: never a cloud on a squid that stays put (the second waits for the first's
    // dart to end, or joins its cloud if that one isn't out yet).
    const frames = await film(page, 150, async (i) => {
      if (i === 0 || i === 6) await guess(page, misses.shift());
    });
    const puffs = assertDarts(frames, "two misses").length;
    assert.ok(puffs === 1 || puffs === 2, `two lives lost inked ${puffs} times`);
    assert.equal(await page.getByTestId("lives").getAttribute("data-lives"), "1");
    await ctx.close();
  });
}

test("reduced motion: a tap only recolours the squid for a moment, nothing moves, and a find adds nothing", async () => {
  const vp = VIEWPORTS[0];
  const { ctx, page } = await open(browser, vp, `#p-${LIST}`, undefined, { reducedMotion: "reduce" });
  await page.getByLabel("Your guess").waitFor();
  await page.waitForTimeout(300);
  await freeze(page);
  const p = await squidWhere(page, "clear", { tries: 1 });
  const [frame, mask] = [await squidFrame(page), await squidMask(page)];
  await page.mouse.click(p.x, p.y);
  assert.deepEqual(await reaction(page), { react: "blush", pokes: 1, finds: 0 });
  assert.notEqual(await squidFrame(page), frame, "the squid didn't blush");
  assert.equal(await squidMask(page), mask, "the squid moved");
  // A streak of taps is no trick here: still only the blush, still in place.
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  assert.deepEqual(await reaction(page), { react: "blush", pokes: 3, finds: 0 });
  assert.equal(await squidMask(page), mask);
  // A moment later it is back as it was, pixel for pixel.
  await page.clock.runFor(1000);
  assert.equal((await reaction(page)).react, null);
  assert.equal(await squidFrame(page), frame);
  // A find lights its limb, as ever, and nothing more.
  const list = await puzzle(page, LIST);
  await guess(page, list.answers[0].name);
  assert.equal((await reaction(page)).finds, 0);
  await ctx.close();
});

test("with sound on, a tap on the squid plays a note; with sound off, none", async () => {
  const { ctx, page } = await open(browser, VIEWPORTS[0], `#p-${LIST}`);
  await ctx.addInitScript(() => {
    window.__notes = 0;
    const C = window.AudioContext;
    if (!C) return;
    const create = C.prototype.createOscillator;
    C.prototype.createOscillator = function () {
      window.__notes += 1;
      return create.call(this);
    };
  });
  await page.reload();
  await page.getByLabel("Your guess").waitFor();
  await page.waitForTimeout(1600);
  await freeze(page);
  let p = await squidWhere(page, "clear");
  await page.mouse.click(p.x, p.y);
  assert.equal((await reaction(page)).pokes, 1);
  assert.equal(await page.evaluate(() => window.__notes), 0, "a sound with sound off");
  await page.getByTestId("sound-toggle").click();
  const on = await page.evaluate(() => window.__notes);
  await page.clock.runFor(1500);
  p = await squidWhere(page, "clear");
  await page.mouse.click(p.x, p.y);
  assert.equal((await reaction(page)).pokes, 2);
  assert.ok((await page.evaluate(() => window.__notes)) > on, "no sound for the tap with sound on");
  await ctx.close();
});
