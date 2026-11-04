// Phones: what only a touch screen shows. Each test is the guard for a mobile bug found in the Nov 4 audit (docs/IMPROVE.md).
// - A tap leaves no hover look behind (Chrome on Android and Safari keep :hover on whatever was last tapped).
// - Every control takes quick taps without zooming the page (touch-action), and every field is 16px or more (Safari
//   zooms into smaller ones).
// - Every control is at least 44px to the finger, its keycap's base included.
// - The clue's question shows its cost whole; the guess box shows its whole placeholder; long answers keep their
//   words whole and Blitz names get the row's width.
// - Nothing a player reads or taps sits under a notch or the home indicator (faked over CDP).
// - With the keyboard up on a small phone, the board still shows above the guess box.
// - Home's account key (a build with accounts, served here) takes quick taps, reaches 44px, keeps no hover look after
//   a tap, and stays clear of a notch, from 320px up.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, open, go, puzzle, guess, giveUp } = require("./helpers.cjs");
const { BACKEND_ENV } = require("./backend-env.cjs");
const { serveBuild, opener, FRESH: BACKEND_FRESH } = require("./backend-lib.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const phone = (width, height = 844) => ({ viewport: { width, height }, isMobile: true, hasTouch: true });
const WIDTHS = [320, 360, 375, 390];
const look = (loc) =>
  loc.evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, color: s.color, shadow: s.boxShadow };
  });

test("a tap leaves no hover look behind: the key looks as it did once its state is back (phone)", async () => {
  const { ctx, page } = await open(browser, phone(390));
  await page.getByTestId("today-list").waitFor();
  // Each control is tapped twice (on, then off again), so it's back in its first state: it must look it.
  const twice = async (testId, nth = 0) => {
    const el = page.getByTestId(testId).nth(nth);
    await el.scrollIntoViewIfNeeded();
    const rest = await look(el);
    await el.tap();
    await el.tap();
    // A tap holds :active a moment (Chrome keeps it at least 150 ms so it shows): past that, only hover could stay.
    await page.waitForTimeout(500);
    assert.deepEqual(await look(el), rest, `${testId} looks tapped after two taps`);
  };
  await twice("sound-toggle");
  await twice("random-list-categories");
  await twice("streak-tip");
  await go(page, "#p-mountains");
  await giveUp(page);
  await page.clock.runFor(3000);
  await twice("rate-up");
  await ctx.close();
});

test("every control takes quick taps without zooming, and every field is 16px or more (phone)", async () => {
  const { ctx, page } = await open(browser, phone(390));
  const check = async (where) => {
    const bad = await page.evaluate(() => {
      const out = [];
      if (getComputedStyle(document.documentElement).touchAction !== "manipulation") out.push(`html: ${getComputedStyle(document.documentElement).touchAction}`);
      for (const el of document.querySelectorAll('a[href], button, input, textarea, summary, [role="button"], .slot.has-fact, .slot.hintable')) {
        if (!el.getClientRects().length) continue;
        const s = getComputedStyle(el);
        const name = `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${el.dataset.testid ?? ""}`;
        if (!/manipulation|none/.test(s.touchAction)) out.push(`${name}: ${s.touchAction}`);
        if (/INPUT|TEXTAREA/.test(el.tagName) && parseFloat(s.fontSize) < 16) out.push(`${name}: font ${s.fontSize}`);
      }
      return out;
    });
    assert.deepEqual(bad, [], where);
  };
  await page.getByTestId("today-list").waitFor();
  await check("home");
  await go(page, "#p-mountains");
  const p = await puzzle(page, "mountains");
  await guess(page, p.answers[0].name);
  await check("a list game");
  await giveUp(page);
  await check("its results");
  await go(page, "#blitz-airports");
  await page.getByLabel("Your guess").waitFor();
  await check("Blitz");
  await go(page, "#archive");
  await page.getByTestId("archive-row").first().waitFor();
  await check("the archive");
  await go(page, "#history");
  await page.getByTestId("history-row").first().waitFor();
  await check("past runs");
  await ctx.close();
});

/**
 * Every visible control's reach on screen: the points 22px above and below its middle (and beside it, if it's narrower
 * than 44px) must press it, unless another control is there (a dense row of keys). Returns the ones that fall short.
 */
const shortReach = (page, scope) =>
  page.evaluate((scope) => {
    const CONTROL = 'a[href], button, input, textarea, summary, [role="button"], [role="switch"], .slot.has-fact, .slot.hintable';
    const root = scope ? document.querySelector(scope) : document.body;
    const out = [];
    for (const el of root.querySelectorAll(CONTROL)) {
      if (el.disabled || !el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true, opacityProperty: true })) continue;
      // A control inside a row that is itself the control (a name in a board row) is reached through the row.
      if (el.parentElement?.closest(".slot.has-fact, .slot.hintable")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.top < 30 || r.bottom > innerHeight - 30 || r.left < 0 || r.right > innerWidth) continue;
      // A link inside a sentence is as tall as its line (WCAG 2.5.8 leaves those out).
      if (el.matches("a") && getComputedStyle(el).display === "inline") continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // Sideways too when it's narrow, except in a game's header under 360px: four keys and five lives share 288px
      // there, so its keys reach halfway to each other and no further.
      const sideways = r.width < 44 && !(innerWidth < 360 && el.closest(".game-head"));
      const spots = [[cx, cy - 21.5], [cx, cy + 21.5], ...(sideways ? [[cx - 21.5, cy], [cx + 21.5, cy]] : [])];
      for (const [x, y] of spots) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || el.contains(hit)) continue;
        // Another control right there (a dense row), or the guess box floating over the page (scroll and it's clear).
        if (hit.closest(CONTROL) || hit.closest("[data-guess-dock]")) continue;
        out.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join(".")} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 20)}" ${Math.round(r.width)}x${Math.round(r.height)}: misses ${Math.round(x - cx)},${Math.round(y - cy)}`);
        break;
      }
    }
    return out;
  }, scope);

test("every control is at least 44px to the finger (phones)", async () => {
  for (const width of [320, 390]) {
    const { ctx, page } = await open(browser, phone(width, 900), "", undefined, { reducedMotion: "reduce" });
    const check = async (where, scope, scroll = [0]) => {
      for (const y of scroll) {
        await page.evaluate((y) => scrollTo(0, y), y);
        await page.waitForTimeout(50);
        assert.deepEqual(await shortReach(page, scope), [], `${where} at ${width}px`);
      }
    };
    await page.getByTestId("today-list").waitFor();
    await check("home", null, [0, 600, 99999]);
    await go(page, "#p-mountains");
    const p = await puzzle(page, "mountains");
    await guess(page, p.answers[0].name);
    await check("a list game", null, [0, 99999]);
    await page.locator('[data-testid="slot"][data-rank="6"]').getByTestId("hint-open").click();
    await page.getByTestId("hint-yes").waitFor();
    await check("the clue confirm", ".hint-ask");
    await page.keyboard.press("Escape");
    await giveUp(page);
    await page.clock.runFor(3000);
    await check("its results", ".results", [0, 99999]);
    await page.getByTestId("rate-down").click();
    await check("the rating's reasons", '[data-testid="rate-reasons"]', [99999]);
    await go(page, "#settings");
    await page.getByTestId("settings").waitFor();
    await check("settings");
    await ctx.close();
  }
});

test("the clue's question shows its cost whole, and the last life says why there's none (phones)", async () => {
  for (const width of WIDTHS) {
    const { ctx, page } = await open(browser, phone(width), "#p-mountains");
    await page.getByLabel("Your guess").waitFor();
    const whole = async (testId) => {
      const q = page.getByTestId(testId);
      await q.waitFor();
      const m = await q.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight, text: el.textContent }));
      assert.ok(m.sw <= m.cw + 1 && m.sh <= m.ch + 1, `${width}px: "${m.text}" is cut short (${m.sw}x${m.sh} in ${m.cw}x${m.ch})`);
      // And the confirm stays inside its row.
      const [row, ask] = await Promise.all([page.locator('[data-testid="slot"][data-rank="8"]').boundingBox(), page.getByTestId("hint-ask").boundingBox()]);
      assert.ok(ask.y >= row.y - 0.5 && ask.y + ask.height <= row.y + row.height + 0.5, `${width}px: the confirm overflows its row`);
    };
    const row8 = page.locator('[data-testid="slot"][data-rank="8"]');
    await row8.getByTestId("hint-open").click();
    await page.getByTestId("hint-yes").waitFor();
    await page.locator('[data-testid="hint-ask"] .hint-q').evaluate((el) => (el.dataset.testid ??= "hint-q"));
    await whole("hint-q");
    await page.keyboard.press("Escape");
    // Down to the last life: the row says there are no clues now.
    const p = await puzzle(page, "mountains");
    for (const e of p.extras.filter((x) => x.rank > 10).slice(0, 4)) await guess(page, e.name);
    await row8.getByTestId("hint-open").click();
    await whole("hint-refused");
    await ctx.close();
  }
});

test("the guess box shows its whole placeholder (phones: a list, a rolled list, a Blitz)", async () => {
  for (const width of WIDTHS) {
    const { ctx, page } = await open(browser, phone(width));
    const fits = async (where) => {
      const box = page.getByLabel("Your guess");
      await box.waitFor();
      const m = await box.evaluate((el) => {
        const s = getComputedStyle(el);
        const probe = document.createElement("span");
        probe.textContent = el.placeholder;
        Object.assign(probe.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre", font: s.font, letterSpacing: s.letterSpacing });
        document.body.append(probe);
        const text = probe.getBoundingClientRect().width;
        probe.remove();
        const room = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
        return { text: Math.ceil(text), room: Math.floor(room), placeholder: el.placeholder };
      });
      assert.ok(m.text <= m.room, `${width}px ${where}: "${m.placeholder}" needs ${m.text}px, the box has ${m.room}`);
    };
    await go(page, "#p-mountains");
    await fits("a list");
    await go(page, "");
    await page.getByTestId("random-list").click();
    await page.getByTestId("reroll").waitFor();
    await fits("a rolled list (Roll again beside GUESS)");
    await go(page, "#blitz-airports");
    await fits("a Blitz");
    await ctx.close();
  }
});

test("long answers keep their words whole, and a Blitz name gets its row's width (phones)", async () => {
  for (const width of [320, 360, 390, 430]) {
    const { ctx, page } = await open(browser, phone(width), "#blitz-airports");
    await page.getByLabel("Your guess").waitFor();
    const p = await puzzle(page, "airports");
    for (const a of p.answers.slice(0, 3)) await guess(page, a.name);
    await page.clock.fastForward(91_000);
    await page.getByTestId("blitz-results").waitFor();
    const names = await page.locator('[data-testid="blitz-results"] ~ * .blitz-name, .blitz-list .blitz-name').evaluateAll((els) =>
      els.map((el) => {
        // Each word (between spaces and hyphens) on one line.
        const node = el.firstChild;
        const broken = [];
        if (node?.nodeType === 3) {
          const re = /[^\s\-\u2013\u2014]+/g;
          for (let m; (m = re.exec(node.textContent)); ) {
            const range = document.createRange();
            range.setStart(node, m.index);
            range.setEnd(node, m.index + m[0].length);
            const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
            if (tops.size > 1) broken.push(m[0]);
          }
        }
        // How much of its row the name gets (a long one; a short one ends where its words do).
        const row = el.closest(".blitz-hit").getBoundingClientRect().width;
        return { name: el.textContent, broken, share: el.getBoundingClientRect().width / row };
      }),
    );
    assert.ok(names.length >= 10, "the results list the answers and the biggest missed");
    for (const n of names) {
      assert.deepEqual(n.broken, [], `${width}px: "${n.name}" breaks inside a word`);
      // A name that wraps had a third of the row beside its figure; it gets the row past the points now.
      if (n.name.length > 30) assert.ok(n.share >= 0.6, `${width}px: "${n.name}" gets ${Math.round(n.share * 100)}% of its row`);
    }
    await ctx.close();
  }
});

test("nothing a player reads or taps sits under a notch or the home indicator (faked)", async () => {
  const cases = [
    { name: "portrait", vp: phone(390), insets: { top: 47, left: 0, right: 0, bottom: 34 } },
    { name: "landscape", vp: phone(844, 390), insets: { top: 0, left: 47, right: 47, bottom: 21 } },
  ];
  for (const c of cases) {
    const { ctx, page } = await open(browser, c.vp, "", undefined, { reducedMotion: "reduce" });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: c.insets });
    const inside = async (where, testIds, { top = true, bottom = true } = {}) => {
      for (const id of testIds) {
        // Where it settles, once whatever slides it in has finished.
        const r = await page
          .locator(id.startsWith(".") ? id : `[data-testid="${id}"]`)
          .first()
          .evaluate(async (el) => {
            const moving = [el, ...(el.closest("dialog") ? [el.closest("dialog")] : [])].flatMap((e) => e.getAnimations());
            await Promise.all(moving.map((a) => a.finished));
            return el.getBoundingClientRect().toJSON();
          });
        const { width, height } = c.vp.viewport;
        const off = [];
        if (r.left < c.insets.left - 0.5) off.push("left");
        if (r.right > width - c.insets.right + 0.5) off.push("right");
        if (top && r.top < c.insets.top - 0.5) off.push("top");
        if (bottom && r.bottom > height - c.insets.bottom + 0.5) off.push("bottom");
        assert.deepEqual(off, [], `${c.name} ${where}: ${id} under the ${off.join(" and ")} inset`);
      }
    };
    await page.getByTestId("today-list").waitFor();
    await inside("home", ["menu-key", "sound-toggle", "today-group"], { bottom: false });
    await page.getByTestId("howto-key").click();
    await inside("how to play", ["howto"]);
    await page.keyboard.press("Escape");
    await page.getByTestId("menu-key").click();
    await page.getByTestId("menu").waitFor();
    await inside("the menu", ["menu-close", ".menu-title"], { bottom: false });
    await page.keyboard.press("Escape");
    await go(page, "#p-mountains");
    await page.getByLabel("Your guess").waitFor();
    await inside("a list game", ["nav-back", "nav-home", ".guess-row"], { top: false });
    await ctx.close();
  }
});

test("Home's account key on a phone (a build with accounts): quick taps, 44px to the finger, no hover left behind, clear of a notch", async () => {
  const served = await serveBuild(BACKEND_ENV, "E2E_BACKEND_DIST");
  const openAccounts = opener(() => served);
  try {
    for (const width of WIDTHS) {
      const { ctx, page } = await openAccounts({ ...phone(width), reducedMotion: "reduce" }, "", BACKEND_FRESH);
      const key = page.locator('[data-testid="account-key"][data-state="out"]');
      await key.waitFor();
      assert.equal(await key.evaluate((el) => getComputedStyle(el).touchAction), "manipulation", `${width}px: quick taps don't zoom`);
      // Its reach: the points 21.5px above, below and beside its middle press it, or the sound key next to it.
      const misses = await key.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
        return [[0, -21.5], [0, 21.5], [-21.5, 0], [21.5, 0]].flatMap(([dx, dy]) => {
          const hit = document.elementFromPoint(cx + dx, cy + dy);
          return hit && (el.contains(hit) || hit.closest('[data-testid="sound-toggle"]')) ? [] : [`${dx},${dy}`];
        });
      });
      assert.deepEqual(misses, [], `${width}px: the account key is under 44px to the finger`);
      // A tap opens the sign-in sheet; once it's closed, the key looks as it did (no hover look stuck on it).
      const rest = await look(key);
      await key.tap();
      await page.getByTestId("sign-in-sheet").waitFor();
      await page.keyboard.press("Escape");
      await page.getByTestId("sign-in-sheet").waitFor({ state: "detached" });
      await page.waitForTimeout(500);
      assert.deepEqual(await look(key), rest, `${width}px: the account key looks tapped`);
      await ctx.close();
    }
    // Clear of a notch and the home indicator, upright and on its side.
    for (const [vp, insets] of [
      [phone(390), { top: 47, left: 0, right: 0, bottom: 34 }],
      [phone(844, 390), { top: 0, left: 47, right: 47, bottom: 21 }],
    ]) {
      const { ctx, page } = await openAccounts({ ...vp, reducedMotion: "reduce" }, "", BACKEND_FRESH);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const r = await page.getByTestId("account-key").evaluate((el) => el.getBoundingClientRect().toJSON());
      const { width } = vp.viewport;
      assert.ok(r.left >= insets.left - 0.5 && r.right <= width - insets.right + 0.5 && r.top >= insets.top - 0.5, `${width}px: the account key under an inset`);
      await ctx.close();
    }
  } finally {
    await served.close();
  }
});

test("a phone on its side: Home's play keys keep their titles on one line", async () => {
  // 740 x 360 is a 360 x 740 Android phone turned; 700 is where free play and your games sit side by side.
  for (const [width, height] of [
    [700, 900],
    [740, 360],
    [844, 390],
    [1024, 768],
  ]) {
    const { ctx, page } = await open(browser, phone(width, height));
    await page.getByTestId("today-list").waitFor();
    const lines = await page.locator(".mode-key .key-label").evaluateAll((els) =>
      els.map((el) => ({ title: el.textContent, lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)) })),
    );
    for (const l of lines) assert.equal(l.lines, 1, `${width}x${height}: "${l.title}" takes ${l.lines} lines`);
    await ctx.close();
  }
});

test("with the keyboard up on a small phone, the board still shows above the guess box", async () => {
  // A 375 x 667 phone (and the smallest, 320 x 568) with its keyboard up: Android shrinks the page to what's left.
  for (const [width, height] of [
    [320, 318],
    [375, 387],
  ]) {
    const { ctx, page } = await open(browser, phone(width, height), "#p-mountains", undefined, { reducedMotion: "reduce" });
    const box = page.getByLabel("Your guess");
    await box.waitFor();
    await box.focus();
    const [first, dock] = await Promise.all([page.locator('[data-testid="slot"][data-rank="1"]').boundingBox(), page.locator(".guess").boundingBox()]);
    assert.ok(first.y + first.height <= dock.y + 1, `${width}x${height}: the board's first row (to ${Math.round(first.y + first.height)}) is under the guess box (from ${Math.round(dock.y)})`);
    await ctx.close();
  }
});
