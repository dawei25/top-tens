// "add a note" under "Good list?", on a copy built with fake backend env vars against a mocked Supabase
// (backend-lib.cjs): open, type, send (the exact submit_feedback arguments), Enter as a new line and Escape as close
// (never the game's keys), the counter and the limit, offline waiting, Blitz results and Past runs, and nothing moving
// on hover, focus or press. The build without a backend shows no note option at all (rate.e2e.cjs, backend.e2e.cjs).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { VIEWPORTS, guess, giveUp, noHScroll } = require("./helpers.cjs");
const { BACKEND_ENV } = require("./backend-env.cjs");
const { SUPA, serveBuild, opener, FRESH, UUID, until, settle } = require("./backend-lib.cjs");

const desktop = VIEWPORTS.find((v) => v.name === "desktop");
const phone = VIEWPORTS.find((v) => v.name === "phone");
const RPC = `${SUPA}/rest/v1/rpc/submit_feedback`;
const OUTBOX = "top-tens:feedback-outbox";

let served;
let base;
const open = opener(() => served);

before(async () => {
  served = await serveBuild(BACKEND_ENV, "E2E_BACKEND_DIST");
  ({ base } = served);
});
after(async () => {
  await served?.close();
});

const focused = (page) => page.evaluate(() => document.activeElement?.dataset.testid ?? document.activeElement?.tagName);
const outbox = async (page) => (await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), OUTBOX))?.pending ?? [];
/** Whether the element is wholly on screen. */
const inView = (locator) =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  });
/**
 * The card's size and the boxes of everything in it, relative to the card (hovering scrolls the page), untransformed
 * (a press may sink a key: transform is allowed), leaving out decoration (the squid, aria-hidden, animates on its own).
 */
const boxes = (page) =>
  page.evaluate(() => {
    const card = document.querySelector('[data-testid="results"]');
    const style = document.createElement("style");
    // No transitions either: a key just released is still sinking back (transform, allowed) for 60 ms.
    style.textContent = "* { transform: none !important; translate: none !important; transition: none !important; }";
    document.head.append(style);
    const c = card.getBoundingClientRect();
    const out = [
      `card ${Math.round(c.width)}x${Math.round(c.height)}`,
      ...[...card.querySelectorAll("*")]
        .filter((el) => el.getClientRects().length && !el.closest('[aria-hidden="true"], svg'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${el.tagName}.${el.className}[${el.dataset.testid ?? ""}]:${Math.round(r.x - c.x)},${Math.round(r.y - c.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
        }),
    ];
    style.remove();
    return out;
  });

/**
 * The boxes (page coordinates) of everything on the page before the note, except what holds it, and what's pinned to
 * the screen rather than the page (fixed or sticky: opening the note scrolls the page).
 */
const aboveNote = (page) =>
  page.evaluate(() => {
    const note = document.querySelector('[data-testid="note"]');
    const pinned = (el) => {
      for (let e = el; e && e !== document.body; e = e.parentElement) if (["fixed", "sticky"].includes(getComputedStyle(e).position)) return true;
      return false;
    };
    return [...document.body.querySelectorAll("*")]
      .filter((el) => note.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING && !el.contains(note) && el.getClientRects().length)
      // Decoration (the squids, aria-hidden) animates on its own.
      .filter((el) => !pinned(el) && !el.closest('[aria-hidden="true"], svg'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.tagName}.${el.className}:${Math.round(r.x)},${Math.round(r.y + scrollY)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      });
  });

/** A list game given up, its results on screen, its play sent (for the browser's id). */
async function results(vp) {
  const opened = await open(vp, "#p-mountains", FRESH);
  await opened.page.getByLabel("Your guess").waitFor();
  await giveUp(opened.page);
  await opened.page.clock.runFor(3000);
  await until(() => opened.calls.submit.length === 1);
  return { ...opened, id: opened.calls.submit[0].p_client_id };
}

test("a note on a list's results: open, type, Enter is a new line, Escape closes, Ctrl+Enter sends (phone)", async () => {
  const { ctx, page, calls, id } = await results(phone);
  assert.match(id, UUID);
  const key = page.getByTestId("note-open");
  await key.waitFor();
  assert.equal(await page.getByTestId("note-form").count(), 0);
  // Before rating: the key is there.
  assert.equal(await page.getByTestId("rate").getAttribute("data-rating"), "0");

  // Rate it down with a reason first: the note carries the rating as it is.
  await page.getByTestId("rate-down").click();
  await page.locator('[data-testid="rate-reason"][data-reason="wrong-data"]').click();
  await page.getByTestId("rate-reasons").waitFor({ state: "detached" });

  // Opening it moves nothing above it (what's below may go down: a deliberate tap).
  const above = await aboveNote(page);
  const at = await page.evaluate(() => location.hash);
  await key.click();
  const text = page.getByTestId("note-text");
  await text.waitFor();
  assert.equal(await focused(page), "note-text");
  assert.deepEqual(await aboveNote(page), above, "opening the box moves nothing above it");
  // The whole box is on screen, SEND included, and nothing pokes out sideways.
  assert.ok(await inView(page.getByTestId("note-form")), "the box and SEND are on screen");
  assert.ok(await noHScroll(page));
  assert.equal(await text.getAttribute("maxlength"), "500");
  // SEND waits for words.
  assert.equal(await page.getByTestId("note-send").isDisabled(), true);

  // Enter adds a line (it's not a guess, nothing is sent); the screen stays.
  await page.keyboard.type("great list.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("say which state each park is in");
  assert.equal(await text.inputValue(), "great list.\nsay which state each park is in");
  await settle();
  assert.equal(calls.feedback.length, 0);
  assert.equal(await page.evaluate(() => location.hash), at);

  // Escape closes the box (not Back), throws the words away, and gives focus back to the key.
  await page.keyboard.press("Escape");
  await page.getByTestId("note-form").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => location.hash), at);
  assert.equal(await focused(page), "note-open");
  await key.click();
  assert.equal(await text.inputValue(), "");

  // Ctrl+Enter sends: the exact arguments, the rating at the time, this browser's id.
  await text.fill("  great list, could improve slightly more by including\nwhat state each national park was in  ");
  await page.keyboard.press("Control+Enter");
  const sent = page.getByTestId("note-sent");
  await sent.waitFor();
  assert.equal(await sent.getAttribute("data-state"), "sent");
  assert.equal(await focused(page), "note-sent");
  await until(() => calls.feedback.length === 1);
  assert.deepEqual(calls.feedback[0], {
    p_list_id: "mountains",
    p_mode: "list",
    p_rating: -1,
    p_text: "great list, could improve slightly more by including\nwhat state each national park was in",
    p_client_id: id,
  });
  assert.deepEqual(Object.keys(calls.feedback[0]).sort(), ["p_client_id", "p_list_id", "p_mode", "p_rating", "p_text"]);
  // The thanks takes the key's place; nothing is left waiting, and the note is in no save.
  assert.equal(await key.count(), 0);
  await settle();
  assert.deepEqual(await outbox(page), []);
  const saved = await page.evaluate(() => localStorage.getItem("top-tens:v1"));
  assert.ok(!saved.includes("national park"), "the note isn't kept in the save");
  await ctx.close();
});

test("SEND waits for words, the counter shows near the limit, 500 at most; a draft survives leaving (desktop)", async () => {
  const { ctx, page, calls } = await results(desktop);
  await page.getByTestId("note-open").click();
  const text = page.getByTestId("note-text");
  const send = page.getByTestId("note-send");
  const count = page.getByTestId("note-count");
  assert.equal(await send.isDisabled(), true);
  await text.fill(" \n  ");
  assert.equal(await send.isDisabled(), true);
  await text.fill("x");
  assert.equal(await send.isDisabled(), false);
  assert.equal(await count.isVisible(), false);
  await text.fill("x".repeat(450));
  assert.equal(await count.isVisible(), true);
  assert.equal(await count.textContent(), "450/500");
  // Typing past the limit stops at 500.
  await text.fill("x".repeat(499));
  await text.press("End");
  await page.keyboard.type("yz!");
  assert.equal((await text.inputValue()).length, 500);
  assert.equal(await count.textContent(), "500/500");
  assert.equal(await send.isDisabled(), false);

  // Leaving by accident (Back) and coming back: the note is still there, the box open.
  await text.fill("half a thought");
  await page.getByTestId("nav-back").click();
  await page.getByTestId("today-list").waitFor();
  await page.goto(base + "#p-mountains");
  await page.getByTestId("results").waitFor();
  assert.equal(await page.getByTestId("note-text").inputValue(), "half a thought");
  // cancel throws it away and closes the box.
  await page.getByTestId("note-cancel").click();
  await page.getByTestId("note-form").waitFor({ state: "detached" });
  assert.equal(await focused(page), "note-open");
  await page.getByTestId("note-open").click();
  assert.equal(await page.getByTestId("note-text").inputValue(), "");

  // SEND with the mouse, after a thumbs up.
  await page.getByTestId("rate-up").click();
  await page.getByTestId("note-text").fill("good one");
  await page.getByTestId("note-send").click();
  await page.getByTestId("note-sent").waitFor();
  await until(() => calls.feedback.length === 1);
  assert.equal(calls.feedback[0].p_rating, 1);
  assert.equal(calls.feedback[0].p_text, "good one");
  await ctx.close();
});

test("hover, focus and press on the note's key, box, SEND and cancel move nothing (desktop)", async () => {
  const { ctx, page } = await results(desktop);
  const still = async (what, act) => {
    const before = await boxes(page);
    await act();
    const now = await boxes(page);
    const changed = [...before.filter((b) => !now.includes(b)).map((b) => `- ${b}`), ...now.filter((b) => !before.includes(b)).map((b) => `+ ${b}`)];
    assert.deepEqual(changed, [], `${what} moved or resized:\n${changed.join("\n")}`);
  };
  const key = page.getByTestId("note-open");
  await key.scrollIntoViewIfNeeded();
  await still("hovering the key", () => key.hover());
  await still("focusing the key", () => key.focus());
  await page.mouse.move(1, 1);
  await key.click();
  await page.getByTestId("note-text").fill("which state is each park in?");
  await page.mouse.move(1, 1);
  for (const id of ["note-text", "note-send", "note-cancel"]) {
    const el = page.getByTestId(id);
    await still(`hovering ${id}`, () => el.hover());
    await page.mouse.move(1, 1);
    await still(`focusing ${id}`, () => el.focus());
    const box = await el.boundingBox();
    await still(`pressing ${id}`, async () => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
    });
    // Released away from it, so nothing fires.
    await page.mouse.move(1, 1);
    await page.mouse.up();
  }
  await page.getByTestId("note-form").waitFor();
  await ctx.close();
});

test("offline, a note waits in its outbox, says so, and goes when the connection is back (phone)", async () => {
  const { ctx, page, calls, id } = await results(phone);
  // Offline: the browser says so, and the request fails (the mock would still answer it).
  await ctx.setOffline(true);
  await page.route(RPC, (route) => route.abort("internetdisconnected"));
  await page.getByTestId("note-open").click();
  await page.getByTestId("note-text").fill("sent from a tunnel");
  await page.getByTestId("note-send").click();
  const said = page.getByTestId("note-sent");
  await said.waitFor();
  assert.equal(await said.getAttribute("data-state"), "queued");
  await settle();
  assert.equal(calls.feedback.length, 0);
  assert.deepEqual((await outbox(page)).map((f) => [f.listId, f.mode, f.text]), [["mountains", "list", "sent from a tunnel"]]);
  // Back online: it goes by itself.
  await page.unroute(RPC);
  await ctx.setOffline(false);
  await until(() => calls.feedback.length === 1);
  assert.deepEqual(calls.feedback[0], { p_list_id: "mountains", p_mode: "list", p_rating: null, p_text: "sent from a tunnel", p_client_id: id });
  await settle();
  assert.deepEqual(await outbox(page), []);

  // The request never answered (the browser thinks it's online): the note waits through a reload and goes after it.
  await page.route(RPC, (route) => route.abort("internetdisconnected"));
  await page.reload();
  await page.getByTestId("results").waitFor();
  await page.getByTestId("note-open").click();
  await page.getByTestId("note-text").fill("second try");
  await page.getByTestId("note-send").click();
  await page.getByTestId("note-sent").waitFor();
  await settle();
  assert.equal(calls.feedback.length, 1);
  assert.deepEqual((await outbox(page)).map((f) => f.text), ["second try"]);
  await page.unroute(RPC);
  await page.reload();
  await until(() => calls.feedback.length === 2);
  assert.equal(calls.feedback[1].p_text, "second try");
  await ctx.close();
});

test("Blitz results and Past runs have it too: mode blitz, one note per opening (desktop)", async () => {
  const { ctx, page, calls } = await open(desktop, "#blitz-airports", FRESH);
  await page.getByTestId("blitz-clock").waitFor();
  await guess(page, "Dubai");
  await page.clock.fastForward(91_000);
  await page.getByTestId("blitz-results").waitFor();
  await page.getByTestId("note-open").click();
  await page.getByTestId("note-text").fill("more airports please");
  await page.keyboard.press("Control+Enter");
  await page.getByTestId("note-sent").waitFor();
  await until(() => calls.feedback.length === 1);
  assert.deepEqual(
    { ...calls.feedback[0], p_client_id: "id" },
    { p_list_id: "airports", p_mode: "blitz", p_rating: null, p_text: "more airports please", p_client_id: "id" },
  );

  // Past runs: the round's view offers a note again (a player may send more than one).
  await page.goto(base + "#history");
  await page.locator('[data-testid="history-row"][data-kind="blitz"]').first().click();
  await page.getByTestId("run-view").waitFor();
  await page.getByTestId("note-open").click();
  await page.getByTestId("note-text").fill("and their codes");
  await page.getByTestId("note-send").click();
  await until(() => calls.feedback.length === 2);
  assert.equal(calls.feedback[1].p_mode, "blitz");
  assert.equal(calls.feedback[1].p_text, "and their codes");
  assert.equal(calls.feedback[1].p_client_id, calls.feedback[0].p_client_id);
  await ctx.close();
});

test("the phone keyboard never hides the box: it stays in view as the screen shrinks (phone)", async () => {
  const { ctx, page } = await results(phone);
  await page.getByTestId("note-open").click();
  await page.getByTestId("note-text").fill("typing on a phone");
  // The keyboard comes up: the page is resized to what's left above it (interactive-widget=resizes-content).
  await page.setViewportSize({ width: phone.viewport.width, height: 420 });
  await page.waitForFunction(() => {
    const r = document.querySelector('[data-testid="note-form"]').getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight;
  });
  assert.equal(await focused(page), "note-text");
  assert.ok(await noHScroll(page));
  await ctx.close();
});
