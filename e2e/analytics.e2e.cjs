// Visits and ?ref= links (marketing, Nov 17). Posts link https://toptentacle.io/?ref=<channel>, some with a screen
// (#daily-<date>). Both forms open their screen with the query still there once the game has settled (nothing strips
// or rewrites it before the pageview: old-link rewrites, sign-in clean-up, hash routing), and the share text the game
// builds carries no ref. Vercel Web Analytics (src/components/SiteAnalytics.tsx, analytics.ts) loads on the live site only:
// on localhost nothing is asked for; with toptentacle.io routed to this build, its script is asked for after the page
// has loaded and the game is on screen, async, its 404 (before Web Analytics is switched on) throws nothing and moves
// nothing, and the pageview it would send keeps the ref and drops the screen.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium, VIEWPORTS, NOW, TODAY, FRESH, open, offlineFonts, giveUp } = require("./helpers.cjs");

const LOCAL = process.env.E2E_URL || "http://localhost:5101/";
const LIVE = "https://toptentacle.io/";
/** Anything of Vercel Web Analytics: its script on the site, or the debug script the package uses in development. */
const ANALYTICS = /\/_vercel\/insights\/|va\.vercel-scripts\.com/;
const [desktop] = VIEWPORTS;

let browser;
before(async () => (browser = await chromium.launch()));
after(() => browser.close());

/** Each link form, the screen it opens (a test id on it) and the hash it settles on. */
const LINKS = [
  { path: "?ref=e2e", screen: "today-group", hash: "" },
  { path: `?ref=e2e#daily-${TODAY}`, screen: "lives", hash: `#daily-${TODAY}` },
  { path: "?ref=e2e#archive", screen: "archive-table", hash: "#archive" },
  { path: "?ref=e2e#fathom", screen: "fathom", hash: "#fathom" },
  // Old links the game rewrites on arrival (history.replaceState): the query stays.
  { path: "?ref=e2e#daily-countries-population", screen: "lives", hash: "#p-countries-population" },
  { path: "?ref=e2e#blitz-history", screen: "nav-back", hash: "#history" },
];

/** The page settled: its screen drawn, the network quiet, a beat for anything that runs after. */
async function settle(page, screen) {
  await page.getByTestId(screen).first().waitFor();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

for (const vp of VIEWPORTS) {
  test(`a ?ref= link opens its screen with the query intact, with or without a screen in it (${vp.name})`, async () => {
    const asked = [];
    const { ctx, page } = await open(browser, vp, LINKS[0].path, FRESH, {
      setup: (c) => c.on("request", (r) => ANALYTICS.test(r.url()) && asked.push(r.url())),
    });
    for (const [i, link] of LINKS.entries()) {
      if (i) await page.goto(LOCAL + link.path);
      await settle(page, link.screen);
      const at = await page.evaluate(() => ({ search: location.search, hash: location.hash }));
      assert.deepEqual(at, { search: "?ref=e2e", hash: link.hash }, link.path);
    }
    // Not on the live site: no analytics script, no queue.
    assert.deepEqual(asked, [], "nothing of Vercel Web Analytics is asked for on localhost");
    assert.equal(await page.evaluate(() => typeof window.va), "undefined");
    await page.goto(LOCAL + "?ref=e2e#privacy");
    await page.getByTestId("privacy").waitFor();
    assert.equal(await page.getByTestId("privacy-analytics").count(), 0, "the privacy page names no analytics this build doesn't run");
    await ctx.close();
  });
}

test("a share from a ?ref= link carries no ref (desktop)", async () => {
  const { ctx, page } = await open(browser, desktop, `?ref=e2e#daily-${TODAY}`);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await giveUp(page);
  await page.getByTestId("share").click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(text.includes(`${LOCAL}#daily-${TODAY}`), text);
  assert.doesNotMatch(text, /ref=|\?/, "no query in the shared link");
  assert.equal(await page.evaluate(() => location.search), "?ref=e2e", "the address keeps it");
  await ctx.close();
});

/**
 * The build served as https://toptentacle.io/: every request there is answered from the local build, except Web
 * Analytics' script, which waits for `release()` and then 404s (as it does until Web Analytics is switched on).
 */
async function openLive(vp, path) {
  const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, timezoneId: "America/New_York" });
  await offlineFonts(ctx);
  let release;
  const held = new Promise((r) => (release = r));
  const asked = [];
  await ctx.route(/^https:\/\/toptentacle\.io\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/_vercel/insights/")) {
      asked.push(url.pathname);
      await held;
      return route.fulfill({ status: 404, contentType: "text/plain", body: "The page could not be found" });
    }
    return route.fulfill({ response: await route.fetch({ url: new URL(url.pathname.slice(1) + url.search, LOCAL).href }) });
  });
  await ctx.addInitScript((s) => {
    if (!localStorage.getItem("e2e-seeded")) {
      localStorage.setItem("top-tens:v1", JSON.stringify(s));
      localStorage.setItem("e2e-seeded", "1");
    }
    // When the analytics script goes in: where the page was, and whether the game was on screen by then.
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.tagName !== "SCRIPT" || !/_vercel\/insights/.test(n.src)) continue;
          window.__analytics = {
            href: location.href,
            loaded: document.readyState === "complete",
            gameOnScreen: !!document.querySelector("#root main"),
            async: n.async,
            inHead: n.parentNode === document.head,
          };
        }
      }
    }).observe(document, { childList: true, subtree: true });
  }, FRESH);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.clock.install({ time: NOW });
  await page.goto(LIVE + path);
  return { ctx, page, asked, release, errors };
}

for (const vp of VIEWPORTS) {
  test(`on the live site: analytics loads after the game, keeps the ref, and its 404 changes nothing (${vp.name})`, async () => {
    for (const link of [LINKS[0], LINKS[1]]) {
      const { ctx, page, asked, release, errors } = await openLive(vp, link.path);
      await page.getByTestId(link.screen).first().waitFor();
      await page.waitForFunction(() => window.__analytics, null, { timeout: 10_000 }).catch(() => {
        throw new Error(`${link.path}: no Web Analytics script went in on the live site`);
      });
      const at = await page.evaluate(() => window.__analytics);
      assert.deepEqual(asked, ["/_vercel/insights/script.js"], `${link.path}: its script is asked for, once`);
      assert.equal(at.href, `${LIVE}${link.path}`, "the address is untouched when the script goes in");
      assert.ok(at.loaded && at.gameOnScreen, `after the page has loaded, with the game on screen: ${JSON.stringify(at)}`);
      assert.ok(at.async && at.inHead, "an async script in the head: nothing waits for it");
      // The pageview it sends: the page and its ref, not the screen.
      const sent = await page.evaluate(() => {
        const [, beforeSend] = window.vaq.find(([k]) => k === "beforeSend");
        return beforeSend({ type: "pageview", url: location.href }).url;
      });
      assert.equal(sent, `${LIVE}?ref=e2e`, link.path);

      // The 404: no error from the game, and nothing on the page moves.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const layout = () =>
        page.evaluate(() => {
          const r = document.querySelector("#root main").getBoundingClientRect();
          return { main: [r.x, r.y, r.width, r.height], height: document.documentElement.scrollHeight, body: document.body.children.length };
        });
      const was = await layout();
      const failed = page.waitForEvent("console", (m) => m.text().includes("[Vercel Web Analytics] Failed to load script"));
      release();
      await failed; // the package's note of the 404: a log, not an error
      await page.waitForTimeout(300);
      assert.deepEqual(await layout(), was, `${link.path}: nothing moved`);
      assert.deepEqual(
        errors.filter((e) => !/Failed to load resource: the server responded with a status of 404/.test(e)),
        [],
        "only the browser's own 404 line",
      );
      assert.equal(await page.evaluate(() => location.search), "?ref=e2e");
      await ctx.close();
    }
    // The privacy page says so there.
    const { ctx, page, release } = await openLive(vp, "#privacy");
    release();
    await page.getByTestId("privacy-analytics").waitFor();
    await ctx.close();
  });
}
