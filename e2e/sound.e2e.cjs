// Sound: the speaker key starts off, turns on, stays on after a reload and on the game screens; with sound on a
// found answer plays notes; without Web Audio the key still toggles quietly.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, open, puzzle, noHScroll, guess } = require("./helpers.cjs");

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

const LIST = "airports";
const pressed = async (page) => (await page.getByTestId("sound-toggle").getAttribute("aria-pressed")) === "true";

/** Counts oscillators started, so a test can tell that a cue played. */
async function countNotes(ctx) {
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
}

for (const vp of VIEWPORTS) {
  test(`sound toggle (${vp.name})`, async () => {
    const { ctx, page } = await open(browser, vp);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByTestId("today-list").waitFor();

    // Off by default, then on, kept under its own key.
    assert.equal(await pressed(page), false);
    await page.getByTestId("sound-toggle").click();
    assert.equal(await pressed(page), true);
    assert.equal(await page.evaluate(() => localStorage.getItem("tentacle:sound")), "on");
    assert.ok(!(await page.evaluate(() => localStorage.getItem("top-tens:v1"))).includes("sound"));

    // Survives a reload, and the game screen's header shows the same state.
    await page.reload();
    await page.getByTestId("today-list").waitFor();
    assert.equal(await pressed(page), true);
    await page.goto(page.url().split("#")[0] + `#p-${LIST}`);
    await page.getByLabel("Your guess").waitFor();
    assert.equal(await pressed(page), true);
    assert.ok(await noHScroll(page));

    // Off again from the header.
    await page.getByTestId("sound-toggle").click();
    assert.equal(await pressed(page), false);
    assert.equal(await page.evaluate(() => localStorage.getItem("tentacle:sound")), "off");
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("sound plays a found answer only when on", async () => {
  const vp = VIEWPORTS[0];
  const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
  await countNotes(ctx);
  await page.reload();
  await page.getByLabel("Your guess").waitFor();
  const p = await puzzle(page, LIST);

  // Off: a find makes no sound.
  await guess(page, p.answers[0].name);
  assert.equal(await page.evaluate(() => window.__notes), 0);

  // On (the key plays a soft confirmation), then a find plays its note.
  await page.getByTestId("sound-toggle").click();
  const afterOn = await page.evaluate(() => window.__notes);
  assert.ok(afterOn > 0);
  await guess(page, p.answers[1].name);
  assert.ok((await page.evaluate(() => window.__notes)) > afterOn);
  await ctx.close();
});

test("no Web Audio: the key still toggles, nothing throws", async () => {
  const vp = VIEWPORTS[1];
  const { ctx, page } = await open(browser, vp, `#p-${LIST}`);
  await ctx.addInitScript(() => {
    delete window.AudioContext;
    delete window.webkitAudioContext;
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.reload();
  await page.getByLabel("Your guess").waitFor();
  await page.getByTestId("sound-toggle").click();
  assert.equal(await pressed(page), true);
  const p = await puzzle(page, LIST);
  await guess(page, p.answers[0].name);
  await page.getByTestId("sound-toggle").click();
  assert.equal(await pressed(page), false);
  assert.deepEqual(errors, []);
  await ctx.close();
});
