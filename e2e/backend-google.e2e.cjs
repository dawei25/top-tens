// Google sign-in with Google's own button (Google Identity Services): a copy built with a Google client ID
// (GOOGLE_ENV), Supabase mocked, and Google's script replaced by a fake `google.accounts.id` whose button "signs in"
// (hands back an ID token carrying the nonce it was given), is closed, is blocked, or gets a token Supabase refuses.
// Checks: Google's script loads only with the sheet; the token and the raw nonce reach signInWithIdToken (and the hash
// went to Google); closing the popup says nothing; a blocked popup gets a hint; a refusal an error; a script that
// can't load leaves the redirect key. (The build without a client ID is backend.e2e.cjs: no Google script at all.)
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { VIEWPORTS, NOW, noHScroll } = require("./helpers.cjs");
const { GOOGLE_ENV, GOOGLE_CLIENT_ID } = require("./backend-env.cjs");
const { serveBuild, opener, FRESH, REFUSED_SUB, until, settle } = require("./backend-lib.cjs");

const desktop = VIEWPORTS.find((v) => v.name === "desktop");
const phone = VIEWPORTS.find((v) => v.name === "phone");
const GIS_SRC = "https://accounts.google.com/gsi/client";

let served;
const open = opener(() => served);

before(async () => {
  served = await serveBuild(GOOGLE_ENV, "E2E_GOOGLE_DIST");
});

after(async () => {
  await served?.close();
});

/**
 * Google's script, faked. `window.__gis` records initialize and renderButton calls, and says what the next press does
 * (`mode`): "ok" (the popup takes the front, then hands back a token), "cancel" (it takes the front and is closed),
 * "blocked" (nothing opens, the page stays in front), "refuse" (a token Supabase refuses). `focus` stands in for
 * document.hasFocus(): false while the fake popup is up.
 */
const FAKE_GIS = `(() => {
  const gis = (window.__gis = { inits: [], renders: [], mode: "ok", focus: true, presses: 0 });
  document.hasFocus = () => gis.focus;
  const b64url = (o) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  let config;
  window.google = { accounts: { id: {
    initialize(c) {
      config = c;
      const { callback, ...rest } = c;
      gis.inits.push(rest);
    },
    renderButton(parent, o) {
      const { click_listener, ...rest } = o;
      gis.renders.push(rest);
      const b = document.createElement("div");
      b.setAttribute("role", "button");
      b.tabIndex = 0;
      b.dataset.testid = "fake-gis-button";
      b.textContent = "Continue with Google";
      b.style.cssText = "box-sizing:border-box;width:" + o.width + "px;height:40px;display:grid;place-items:center;background:#202124;color:#fff;border-radius:4px;font:500 14px sans-serif;letter-spacing:0;text-transform:none";
      b.onclick = () => {
        gis.presses++;
        if (click_listener) click_listener();
        const mode = gis.mode;
        if (mode === "blocked") return;
        gis.focus = false;
        setTimeout(() => {
          gis.focus = true;
          if (mode === "cancel") return;
          const claims = { iss: "https://accounts.google.com", aud: config.client_id, sub: mode === "refuse" ? ${JSON.stringify(REFUSED_SUB)} : "1234", email: "dana@example.com", nonce: config.nonce };
          config.callback({ credential: [b64url({ alg: "RS256", typ: "JWT" }), b64url(claims), "sig"].join("."), select_by: "btn" });
        }, 300);
      };
      parent.append(b);
    },
  } } };
})();`;

const fakeGis = (ctx) => ctx.route(GIS_SRC, (route) => route.fulfill({ contentType: "text/javascript", body: FAKE_GIS }));
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const claimsOf = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
/** Requests to Google's sign-in host. */
function watchGoogle(page) {
  const urls = [];
  page.on("request", (r) => new URL(r.url()).hostname === "accounts.google.com" && urls.push(r.url()));
  return urls;
}

test("Google's button: the ID token and the raw nonce reach Supabase, the device's games go along (phone)", async () => {
  const mine = { id: "islands", startedAt: NOW.getTime() - 3_600_000, finishedAt: NOW.getTime() - 3_300_000, status: "lost", found: [1, 2, 3], lives: 0, hints: 0 };
  const { ctx, page, calls } = await open(phone, "", { "top-tens:v1": { ...FRESH["top-tens:v1"], listRuns: [mine] } }, undefined, fakeGis);
  const google = watchGoogle(page);
  const key = page.getByTestId("account-key");
  await key.waitFor();
  await settle();
  // Nothing from Google until the sheet opens.
  assert.deepEqual(google, []);
  assert.equal(await page.locator(`script[src="${GIS_SRC}"]`).count(), 0);

  await key.click();
  const slot = page.locator('[data-testid="sign-in-google-gis"][data-ready="true"]');
  await slot.waitFor();
  assert.deepEqual(google, [GIS_SRC]);
  const gis = await page.evaluate(() => window.__gis);
  assert.equal(gis.inits.length, 1);
  const init = gis.inits[0];
  // The client ID as pasted had a trailing newline: trimmed.
  assert.equal(init.client_id, GOOGLE_CLIENT_ID);
  assert.equal(init.ux_mode, "popup");
  assert.equal(init.auto_select, false);
  assert.match(init.nonce, /^[0-9a-f]{64}$/);
  assert.equal(gis.renders.length, 1);
  assert.equal(gis.renders[0].text, "continue_with");
  // Google's button fills the sheet's column, and the sheet fits the phone. The sheet has the focus (no keyboard).
  const column = await page.getByTestId("sign-in-google-gis").evaluate((el) => el.getBoundingClientRect().width);
  assert.equal(gis.renders[0].width, Math.floor(column));
  const sheet = page.getByTestId("sign-in-sheet");
  const box = await sheet.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= phone.viewport.width + 0.5);
  assert.ok(await noHScroll(page));
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.testid), "sign-in-sheet");

  await page.getByTestId("fake-gis-button").click();
  await page.locator('[data-testid="account-key"][data-signed-in="true"]').waitFor();
  await sheet.waitFor({ state: "detached" });
  assert.equal(calls.idToken.length, 1);
  const sent = calls.idToken[0];
  assert.equal(sent.provider, "google");
  // Google got the hash; Supabase gets the nonce itself, whose hash is the token's.
  assert.equal(claimsOf(sent.id_token).nonce, init.nonce);
  assert.equal(sha256(sent.nonce), init.nonce);
  assert.notEqual(sent.nonce, init.nonce);
  assert.equal(calls.authorize.length, 0, "no redirect through Supabase");
  // First sign-in on this device: its games go to the account.
  await until(() => calls.saves.some((c) => c.method === "POST"));
  assert.deepEqual(calls.saves.find((c) => c.method === "POST").body.data.listRuns.map((r) => r.id), ["islands"]);
  await ctx.close();
});

test("Google's button: closed says nothing, blocked gets a hint, refused an error, then a new nonce works (desktop)", async () => {
  const { ctx, page, calls } = await open(desktop, "", FRESH, undefined, fakeGis);
  const key = page.getByTestId("account-key");
  await key.click();
  await page.locator('[data-testid="sign-in-google-gis"][data-ready="true"]').waitFor();
  const button = page.getByTestId("fake-gis-button");
  const hint = page.getByTestId("sign-in-google-popup");
  const error = page.getByTestId("sign-in-error");
  const gis = () => page.evaluate(() => window.__gis);
  const mode = (m) => page.evaluate((x) => (window.__gis.mode = x), m);
  // The sheet's column is 400px on a wide screen, the widest Google draws its button.
  assert.equal((await gis()).renders[0].width, 400);

  // The player closes Google's popup: still signed out, nothing to clear up.
  await mode("cancel");
  await button.click();
  await page.clock.runFor(4000);
  assert.equal(await hint.count(), 0);
  assert.equal(await error.count(), 0);
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(calls.idToken.length, 0);
  assert.equal(await key.getAttribute("data-signed-in"), null);
  await page.getByTestId("sign-in-sheet").waitFor();

  // Nothing opened (blocked): after a few seconds, a hint about pop-ups. Not an error.
  await mode("blocked");
  await button.click();
  await page.clock.runFor(4000);
  await hint.waitFor();
  assert.equal(await hint.getAttribute("role"), "status");
  assert.equal(await error.count(), 0);

  // A token Supabase refuses: an error, still signed out.
  await mode("refuse");
  await button.click();
  assert.equal(await hint.count(), 0, "a new press clears the hint");
  await page.clock.runFor(400);
  await error.waitFor();
  assert.equal(calls.idToken.length, 1);
  assert.equal(await key.getAttribute("data-signed-in"), null);

  // The next try asks Google with a new nonce, and works.
  const { inits } = await gis();
  assert.equal(inits.length, 2);
  assert.notEqual(inits[1].nonce, inits[0].nonce);
  await mode("ok");
  await button.click();
  await page.clock.runFor(400);
  await page.locator('[data-testid="account-key"][data-signed-in="true"]').waitFor();
  assert.equal(calls.idToken.length, 2);
  assert.equal(sha256(calls.idToken[1].nonce), inits[1].nonce);
  assert.equal((await gis()).presses, 4);
  await ctx.close();
});

test("Google's script doesn't load: the sheet offers the redirect key instead (desktop)", async () => {
  const { ctx, page, calls } = await open(desktop, "", FRESH, undefined, (c) => c.route(GIS_SRC, (route) => route.abort()));
  await page.getByTestId("account-key").click();
  const fallback = page.getByTestId("sign-in-google");
  await fallback.waitFor();
  assert.equal(await page.getByTestId("sign-in-google-gis").count(), 0);
  assert.equal(await page.getByRole("alert").count(), 0);
  await fallback.click();
  await until(() => calls.authorize.length === 1);
  assert.equal(calls.authorize[0].searchParams.get("provider"), "google");
  await ctx.close();
});

test("the privacy page says the sign-in sheet loads Google's button from Google", async () => {
  const { ctx, page } = await open(desktop, "#privacy", FRESH, undefined, fakeGis);
  await page.getByTestId("privacy-google").waitFor();
  assert.ok(await noHScroll(page));
  await ctx.close();
});
