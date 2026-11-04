// The menu: one key at the left end of every screen's header (on Home, the top left corner) opens a panel of tiles
// from the left over the dimmed page, a modal dialog. It opens without moving or scrolling the page; focus goes into it and stays
// there; Escape, the close key or a press on the dimmed page close it, and focus comes back to the key (or to the
// guess box while a game is under way). Every tile reaches its screen, the screen on show is marked, rolls never land
// on today's pair, and there's no account section (the account is a key in Home's header: backend.e2e.cjs) and,
// without a contact address, no Feedback. Home's header keys, the account key among them, clear the logo.
// Settings (#settings, from the menu): the sound switch and reset all progress (moved from Home's footer).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, TODAY, open, go, hash, puzzle, todaysDaily, guess, freeze, giveUp, noHScroll, store, logoClearance } = require("./helpers.cjs");
const { BACKEND_ENV } = require("./backend-env.cjs");
const { serveBuild, opener, FRESH: BACKEND_FRESH } = require("./backend-lib.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const focused = (page) => page.evaluate(() => document.activeElement?.dataset.testid ?? document.activeElement?.tagName ?? null);
const inMenu = (page) => page.evaluate(() => !!document.activeElement?.closest('[data-testid="menu"]'));
/** Where an element sits in the page (not the viewport), and its size. */
const place = (loc) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  });
const tap = (page, vp, x, y) => (vp.hasTouch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));

/** Opens the menu and waits for its slide in to end (a press during the slide could land beside a moving tile). */
async function openMenu(page) {
  await page.getByTestId("menu-key").click();
  const menu = page.getByTestId("menu");
  await menu.waitFor();
  await menu.evaluate((d) => Promise.all(d.getAnimations().map((a) => a.finished)));
  return menu;
}
/** Opens the menu and chooses a tile. */
async function choose(page, id) {
  await openMenu(page);
  await page.getByTestId(`menu-${id}`).click();
  await page.getByTestId("menu").waitFor({ state: "detached" });
}

for (const vp of VIEWPORTS) {
  test(`the menu key: same keycap, the left end of the header (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    await page.getByTestId("today-list").waitFor();
    const key = page.getByTestId("menu-key");
    assert.equal(await key.count(), 1);
    assert.equal(await key.getAttribute("aria-label"), "Menu");
    assert.equal(await key.getAttribute("aria-haspopup"), "dialog");
    // Home: the top left corner (owner), level with the sound key at the top right.
    const sound = await place(page.getByTestId("sound-toggle"));
    const home = await place(key);
    assert.ok(home.x + home.w < vp.viewport.width / 2, "on the left");
    assert.ok(sound.x > vp.viewport.width / 2, "the sound key stays on the right");
    assert.equal(home.y, sound.y);
    assert.equal(home.h, sound.h, "the same keycap height");

    // Inner screens: the first key of the header, before BACK, at the same left edge as on Home.
    for (const h of ["#archive", "#stats", "#settings", "#p-mountains"]) {
      await go(page, h);
      await page.getByTestId("nav-home").waitFor();
      assert.equal(await key.count(), 1, h);
      assert.ok(
        await key.evaluate((el) => el.parentElement.firstElementChild === el && el.nextElementSibling?.dataset.testid === "nav-back"),
        `${h}: before BACK`,
      );
      const inner = await place(key);
      assert.equal(inner.h, home.h, `${h}: the same height`);
      if (h === "#archive" || vp.name === "phone") assert.ok(Math.abs(inner.x - home.x) <= 1, `${h}: the same left edge as on Home`);
      assert.ok(await noHScroll(page), h);
    }
    await ctx.close();
  });

  test(`the menu opens over the page and closes every way (${vp.name})`, async () => {
    // The archive: a page taller than the screen at both sizes, so a scroll behind the menu would show.
    const { ctx, page } = await open(browser, vp, "#archive", undefined, { reducedMotion: "reduce" });
    const card = page.getByTestId("archive-row").first();
    await card.waitFor();
    await freeze(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 50), "a page that scrolls");
    // The page scrolled a little (the key still in view): opening the menu must leave it exactly where it is.
    await page.evaluate(() => scrollTo(0, 12));
    const before = { scroll: await page.evaluate(() => scrollY), card: await place(card) };
    const key = page.getByTestId("menu-key");

    const menu = await openMenu(page);
    assert.ok(await menu.evaluate((d) => d.open && d.matches(":modal")));
    assert.equal(await key.getAttribute("aria-expanded"), "true");
    assert.ok(await inMenu(page), "focus moved into the menu");
    assert.equal(await page.evaluate(() => scrollY), before.scroll);
    assert.deepEqual(await place(card), before.card);
    // Full height at the left edge, the menu key's side: 420px on desktop, all but a 44px strip of the page on a phone.
    const box = await menu.boundingBox();
    const { width, height } = vp.viewport;
    assert.equal(Math.round(box.x), 0);
    assert.equal(Math.round(box.y), 0);
    assert.equal(Math.round(box.height), height);
    assert.equal(Math.round(box.width), vp.name === "phone" ? width - 44 : 420);
    // Its close key is a full-size tap target.
    const close = await page.getByTestId("menu-close").boundingBox();
    assert.ok(close.width >= 44 && close.height >= 44, `close key ${close.width}x${close.height}`);
    // A wheel, a drag or a scroll key over the dimmed page or the menu scrolls nothing behind it.
    for (const x of [width - 10, 100]) {
      if (vp.hasTouch) {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: 600 }] });
        for (let y = 580; y >= 300; y -= 20) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.mouse.move(x, 400);
        await page.mouse.wheel(0, 400);
      }
    }
    for (const k of ["PageDown", "ArrowDown", "Space", "End"]) await page.keyboard.press(k);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => scrollY), before.scroll, "the page behind didn't scroll");
    assert.ok(await menu.isVisible());
    assert.ok(await noHScroll(page));

    // Escape closes it (and only it: still the archive, not Back), focus back on the key.
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.equal(await focused(page), "menu-key");
    assert.equal(await key.getAttribute("aria-expanded"), "false");
    assert.equal(await hash(page), "#archive");

    // A press right after opening (the second half of a double press, where the close key now sits) leaves it open.
    await openMenu(page);
    await page.getByTestId("menu-close").click();
    assert.ok(await menu.isVisible(), "a double press doesn't close it again");
    await page.clock.runFor(1000);
    // The close key.
    await page.getByTestId("menu-close").click();
    await menu.waitFor({ state: "detached" });
    assert.equal(await focused(page), "menu-key");

    // A press on the dimmed page.
    await openMenu(page);
    await page.clock.runFor(1000);
    await tap(page, vp, width - 10, Math.round(height / 2));
    await menu.waitFor({ state: "detached" });
    assert.equal(await focused(page), "menu-key");
    assert.equal(await page.evaluate(() => scrollY), before.scroll);
    assert.deepEqual(await place(card), before.card);
    assert.equal(await hash(page), "#archive");
    await ctx.close();
  });

  test(`every tile reaches its screen; the screen on show is marked (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    await page.getByTestId("today-list").waitFor();
    const daily = await todaysDaily(page);

    // A plain build: no account section, no Feedback.
    await openMenu(page);
    assert.equal(await page.getByTestId("menu-account").count(), 0);
    assert.equal(await page.getByTestId("menu-sign-in").count(), 0);
    assert.equal(await page.getByTestId("menu-feedback").count(), 0);
    // Today's statuses read as Home's keys do; nothing marked on Home.
    for (const id of ["today-list", "today-blitz"]) {
      assert.equal(await page.getByTestId(`menu-${id}-status`).textContent(), await page.getByTestId(`${id}-status`).textContent());
    }
    assert.equal(await page.locator('[data-testid="menu"] [aria-current]').count(), 0);
    await page.keyboard.press("Escape");

    const screens = [
      ["today-list", `#daily-${TODAY}`, "lives"],
      ["today-blitz", `#dailyblitz-${TODAY}`, "blitz-screen"],
      ["archive", "#archive", "archive-row"],
      ["history", "#history", "nav-back"],
      ["stats", "#stats", "knowledge"],
      ["settings", "#settings", "settings"],
      ["privacy", "#privacy", "privacy"],
    ];
    for (const [id, to, mark] of screens) {
      await choose(page, id);
      await page.getByTestId(mark).first().waitFor();
      assert.equal(await hash(page), to, id);
      // On its screen, its tile is the marked one, and choosing it only closes the menu.
      await openMenu(page);
      assert.deepEqual(
        await page.locator('[data-testid="menu"] [aria-current="page"]').evaluateAll((els) => els.map((e) => e.dataset.testid)),
        [`menu-${id}`],
      );
      await page.getByTestId(`menu-${id}`).click();
      await page.getByTestId("menu").waitFor({ state: "detached" });
      assert.equal(await hash(page), to, `${id}: still there`);
    }

    // How to play opens the rules over the screen; Escape closes them without leaving the screen.
    await choose(page, "howto");
    const rules = page.getByTestId("howto");
    await rules.waitFor();
    await page.keyboard.press("Escape");
    await rules.waitFor({ state: "detached" });
    assert.equal(await hash(page), "#privacy", "Escape closed the rules, not the screen");
    assert.equal(await focused(page), "menu-key");

    // Rolls: a fresh list or Blitz, never today's.
    await choose(page, "random-list");
    await page.getByTestId("lives").waitFor();
    const listId = (await hash(page)).replace(/^#p-/, "");
    assert.match(await hash(page), /^#p-/);
    assert.notEqual(listId, daily.id);
    // Rolling from a random list lands on another one.
    await choose(page, "random-list");
    await page.waitForFunction((id) => location.hash.startsWith("#p-") && location.hash !== `#p-${id}`, listId);
    await choose(page, "random-blitz");
    const blitz = page.getByTestId("blitz-screen");
    await blitz.waitFor();
    assert.match(await hash(page), /^#blitz-/);
    assert.notEqual(await blitz.getAttribute("data-list"), daily.blitz);
    assert.equal(await page.getByTestId("blitz-clock").getAttribute("data-started"), "false", "a fresh round");
    assert.ok(await noHScroll(page));
    await ctx.close();
  });
}

test("Home: the header keys clear the logo at every width, the menu on the left and sound and the account key on the right", async () => {
  // Both builds: the plain one (menu, sound) and one with accounts (menu, then the account key left of sound). Every
  // key keeps 6px or more between its base and the ink of any letter under it (the menu key over the capital T, the
  // account key over the tall "l" on phones).
  const served = await serveBuild(BACKEND_ENV, "E2E_BACKEND_DIST");
  const openAccounts = opener(() => served);
  try {
    for (const width of [320, 360, 390, 414, 481, 560, 640, 641, 700, 1024, 1440]) {
      for (const accounts of [false, true]) {
        const vp = { viewport: { width, height: 800 }, reducedMotion: "reduce" };
        const { ctx, page } = accounts ? await openAccounts(vp, "", BACKEND_FRESH) : await open(browser, vp, "", undefined, { reducedMotion: "reduce" });
        const tag = `${width}px${accounts ? ", with accounts" : ""}`;
        await page.getByTestId(accounts ? "account-key" : "today-list").waitFor();
        const under = await logoClearance(page);
        for (const c of under) assert.ok(c.gap >= 6, `${tag}: ${c.key} over the logo's "${c.letter}" (${c.gap}px clear)`);
        // Not a test of nothing: on a phone the logo spans the width, under both groups.
        if (width === 390) {
          const keys = new Set(under.map((c) => c.key));
          for (const id of ["menu-key", "sound-toggle", ...(accounts ? ["account-key"] : [])]) assert.ok(keys.has(id), `${tag}: ${id} over the logo`);
        }
        if (accounts) {
          // The account key: left of sound, the same keycap, level with it.
          const [account, sound] = await Promise.all(["account-key", "sound-toggle"].map((id) => place(page.getByTestId(id))));
          assert.ok(await page.getByTestId("account-key").evaluate((el) => el.nextElementSibling?.dataset.testid === "sound-toggle"), `${tag}: right before sound`);
          assert.deepEqual([account.y, account.w, account.h], [sound.y, sound.w, sound.h], `${tag}: the sound key's size and line`);
          assert.ok(account.x + account.w <= sound.x, `${tag}: clear of sound`);
        }
        assert.ok(await noHScroll(page), tag);
        await ctx.close();
      }
    }
  } finally {
    await served.close();
  }
});

test("narrow phones: the five lives fit between the menu key and BACK and the sound and HOME keys; the menu key keeps Home's left edge", async () => {
  for (const width of [320, 360, 390]) {
    const { ctx, page } = await open(browser, { viewport: { width, height: 700 }, isMobile: true, hasTouch: true });
    await page.getByTestId("today-list").waitFor();
    const onHome = await place(page.getByTestId("menu-key"));
    await go(page, "#p-mountains");
    await page.getByTestId("lives").waitFor();
    const [back, lives, sound, menu] = await Promise.all(
      ["nav-back", "lives", "sound-toggle", "menu-key"].map((id) => page.getByTestId(id).boundingBox()),
    );
    assert.ok(lives.x >= back.x + back.width, `${width}: lives clear of BACK`);
    assert.ok(lives.x + lives.width <= sound.x, `${width}: lives clear of the sound key (${lives.x + lives.width} > ${sound.x})`);
    assert.ok(menu.x >= 0 && menu.x + menu.width <= back.x, `${width}: the menu key on screen, left of BACK`);
    assert.ok(Math.abs(menu.x - onHome.x) <= 1, `${width}: the menu key's left edge as on Home`);
    assert.ok(await noHScroll(page), `${width}`);
    await ctx.close();
  }
});

test("a short window: the menu scrolls inside itself, the page behind stays put", async () => {
  const { ctx, page } = await open(browser, { viewport: { width: 1000, height: 480 } }, "#archive");
  await page.getByTestId("archive-row").first().waitFor();
  const menu = await openMenu(page);
  const body = menu.locator(".menu-body");
  assert.ok(await body.evaluate((b) => b.scrollHeight > b.clientHeight), "taller than the window");
  await page.mouse.move(200, 300);
  await page.mouse.wheel(0, 2000);
  await page.waitForFunction(() => document.querySelector(".menu-body").scrollTop > 0);
  // At its end, a further wheel stops there.
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => scrollY), 0);
  // The last tile came into view.
  const last = await page.getByTestId("menu-privacy").boundingBox();
  assert.ok(last.y + last.height <= 480, "the last tile scrolled into view");
  await ctx.close();
});

test("keyboard: Enter opens the menu, Tab stays inside it, Escape gives focus back", async () => {
  const vp = VIEWPORTS.find((v) => v.name === "desktop");
  const { ctx, page } = await open(browser, vp, "#archive");
  await page.getByTestId("archive-row").first().waitFor();
  const key = page.getByTestId("menu-key");
  await key.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByTestId("menu");
  await menu.waitFor();
  // Focus is on the panel itself: a second Enter presses nothing.
  assert.equal(await focused(page), "menu");
  await page.keyboard.press("Enter");
  assert.equal(await hash(page), "#archive");
  assert.ok(await menu.isVisible());

  // Tab goes round the menu's keys and never leaves it.
  const keys = await menu.locator("button:not(:disabled), a[href]").evaluateAll((els) => els.map((e) => e.dataset.testid));
  const seen = [];
  for (let i = 0; i < keys.length + 3; i++) {
    await page.keyboard.press("Tab");
    assert.ok(await inMenu(page), `Tab ${i + 1} stayed in the menu`);
    seen.push(await focused(page));
  }
  assert.deepEqual(seen.slice(0, keys.length), keys, "every key in order");
  assert.equal(seen[keys.length], keys[0], "and round again");
  // Shift+Tab from the first key goes round to the last.
  await page.getByTestId(keys[0]).focus();
  await page.keyboard.press("Shift+Tab");
  assert.equal(await focused(page), keys.at(-1));

  // Escape: closed, still on the archive (not Back), focus on the key.
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  assert.equal(await hash(page), "#archive");
  assert.equal(await focused(page), "menu-key");
  await ctx.close();
});

test("a game under way: it resumes from the menu, the Blitz clock note, focus back to the guess box", async () => {
  const vp = VIEWPORTS.find((v) => v.name === "desktop");
  const { ctx, page } = await open(browser, vp);
  await page.getByTestId("today-list").click();
  await page.getByLabel("Your guess").waitFor();
  const daily = await todaysDaily(page);
  const p = await puzzle(page, daily.id);
  await guess(page, p.answers[0].name);
  await page.locator('[data-testid="slot"][data-state="found"]').first().waitFor();

  // Open and close: no clock note on a list; focus goes back to typing.
  await openMenu(page);
  assert.equal(await page.getByTestId("menu-clock-note").count(), 0);
  await page.keyboard.press("Escape");
  await page.getByTestId("menu").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Your guess");

  // Away to the archive and back by its tile: the same game, one answer found.
  await choose(page, "archive");
  await page.getByTestId("archive-row").first().waitFor();
  await openMenu(page);
  await page.getByTestId("menu-today-list").click();
  await page.getByLabel("Your guess").waitFor();
  assert.equal(await page.locator('[data-testid="slot"][data-state="found"]').count(), 1);

  // Today's Blitz under way: the menu says the clock keeps running.
  await choose(page, "today-blitz");
  const screen = page.getByTestId("blitz-screen");
  await screen.waitFor();
  await openMenu(page);
  assert.equal(await page.getByTestId("menu-clock-note").count(), 0, "not before the round starts");
  await page.keyboard.press("Escape");
  const b = await puzzle(page, await screen.getAttribute("data-list"));
  await guess(page, b.answers[0].name);
  await page.getByTestId("blitz-hit").first().waitFor();
  await openMenu(page);
  await page.getByTestId("menu-clock-note").waitFor();
  await page.keyboard.press("Escape");
  await page.getByTestId("menu").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Your guess");
  await ctx.close();
});

for (const vp of VIEWPORTS) {
  test(`Settings: the sound switch and reset all progress (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    await page.getByTestId("today-list").waitFor();
    // Reset left Home's footer for Settings.
    assert.equal(await page.getByTestId("reset-all").count(), 0);
    await choose(page, "settings");
    await page.getByTestId("settings").waitFor();
    assert.ok(await noHScroll(page));

    // The switch and the header's speaker key are one setting.
    const sw = page.getByTestId("settings-sound");
    const speaker = page.getByTestId("sound-toggle");
    assert.equal(await sw.getAttribute("role"), "switch");
    assert.equal(await sw.getAttribute("aria-checked"), "false");
    const swBox = await place(sw);
    await sw.click();
    assert.equal(await sw.getAttribute("aria-checked"), "true");
    assert.equal(await speaker.getAttribute("aria-pressed"), "true");
    assert.equal(await page.evaluate(() => localStorage.getItem("tentacle:sound")), "on");
    assert.deepEqual(await place(sw), swBox, "the switch keeps its size");
    await speaker.click();
    assert.equal(await sw.getAttribute("aria-checked"), "false");

    // Nothing to reset before the first game.
    const reset = page.getByTestId("reset-all");
    assert.ok(await reset.isDisabled());

    // After a game: the first press asks (and keeps the key's size), the second clears everything.
    await go(page, "#p-mountains");
    await giveUp(page);
    await go(page, "#settings");
    await reset.waitFor();
    assert.ok(await reset.isEnabled());
    const before = await place(reset);
    await reset.click();
    assert.equal(await reset.getAttribute("data-armed"), "true");
    assert.deepEqual(await place(reset), before);
    await reset.click();
    assert.equal(await reset.getAttribute("data-armed"), null);
    const saved = await store(page);
    assert.deepEqual(saved.games, {});
    assert.equal(saved.listRuns, undefined);
    assert.equal(saved.seenHelp, true, "the rules stay seen");
    assert.ok(await reset.isDisabled());
    await page.getByTestId("nav-home").click();
    assert.equal(await page.getByTestId("home-record").getAttribute("data-empty"), "true");
    await ctx.close();
  });
}
