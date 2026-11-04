// Google sign-in from our own key: a copy built with a Google client ID (GOOGLE_ENV), Supabase mocked, and Google's
// authorization endpoint faked. The fake records each request and answers like Google's implicit flow does: a
// redirect to the redirect_uri with the ID token (carrying the nonce it was asked with) and the state in the fragment.
// Or it keeps its chooser up (the player closes the window), answers access_denied (Cancel at Google), sends a state
// the game didn't ask with, or a token Supabase refuses.
// Checks: nothing from Google before the press; the exact request (client, redirect URI on this site, id_token,
// scopes, hashed nonce, state, account chooser); the token and the raw nonce reaching signInWithIdToken; the state
// check; closing the window and Cancel saying nothing; a blocked popup taking the tab to Google and back; a popup
// with no way back to the game finishing on its own; the key's states never moving anything.
// (The build without a client ID is backend.e2e.cjs: the same key, through Supabase's redirect.)
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { VIEWPORTS, NOW, noHScroll } = require("./helpers.cjs");
const { GOOGLE_ENV, GOOGLE_CLIENT_ID } = require("./backend-env.cjs");
const { serveBuild, opener, openSignIn, homeSignedIn, FRESH, REFUSED_SUB, until, settle } = require("./backend-lib.cjs");
const { checkScreen, formatFailures } = require("./states-lib.cjs");

const desktop = VIEWPORTS.find((v) => v.name === "desktop");
const phone = VIEWPORTS.find((v) => v.name === "phone");
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";

let served;
const open = opener(() => served);

before(async () => {
  served = await serveBuild(GOOGLE_ENV, "E2E_GOOGLE_DIST");
});

after(async () => {
  await served?.close();
});

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const claimsOf = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

/**
 * Google's endpoint, faked for the whole context (popups included). `google.mode` says how the next request is
 * answered: "ok", "stay" (the chooser stays up), "denied", "forged" (another state), "refuse" (a token Supabase
 * refuses) or "sever" (ok, but the window loses its opener on the way). `asks` holds each request's parameters, `hits`
 * every request to Google's host.
 */
async function fakeGoogle(ctx) {
  const google = { mode: "ok", asks: [], hits: [], tokens: [] };
  await ctx.route(/^https:\/\/accounts\.google\.com\//, (route) => {
    const url = new URL(route.request().url());
    google.hits.push(url.href);
    if (`${url.origin}${url.pathname}` !== AUTH) return route.fulfill({ status: 404, body: "" });
    const q = Object.fromEntries(url.searchParams);
    google.asks.push(q);
    const mode = google.mode;
    if (mode === "stay") return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Sign in - Google Accounts</title><p>Choose an account</p>" });
    const iat = Math.floor(NOW.getTime() / 1000);
    const claims = { iss: "https://accounts.google.com", azp: q.client_id, aud: q.client_id, sub: mode === "refuse" ? REFUSED_SUB : "1234", email: "dana@example.com", email_verified: true, nonce: q.nonce, iat, exp: iat + 3600 };
    const token = [b64url({ alg: "RS256", kid: "k1", typ: "JWT" }), b64url(claims), "sig"].join(".");
    google.tokens.push(token);
    const state = mode === "forged" ? "0123456789abcdef0123456789abcdef" : q.state;
    const fragment = mode === "denied" ? `error=access_denied&state=${state}` : `state=${state}&id_token=${token}&authuser=0&prompt=consent`;
    const back = `${q.redirect_uri}#${fragment}`;
    // The window loses its link to the game on the way (as an in-app browser's popup, or a page that cuts it, would).
    if (mode === "sever") return route.fulfill({ status: 200, contentType: "text/html", body: `<script>window.opener = null; location.replace(${JSON.stringify(back)});</script>` });
    return route.fulfill({ status: 302, headers: { location: back } });
  });
  return google;
}

/** The context's setup: Google faked, plus `more(ctx)`. Hands the fake back through `into`. */
const withGoogle = (into, more) => async (ctx) => {
  into.google = await fakeGoogle(ctx);
  if (more) await more(ctx);
};

/** Presses the Google key and returns the popup it opens. */
async function pressForPopup(page) {
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("sign-in-google").click()]);
  return popup;
}

/** The try kept in localStorage while Google is open. */
const pendingOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("top-tens:google-pending") ?? "null"));

test("the key opens Google in a popup with the exact request; the token and raw nonce reach Supabase; games go along (phone)", async () => {
  const mine = { id: "islands", startedAt: NOW.getTime() - 3_600_000, finishedAt: NOW.getTime() - 3_300_000, status: "lost", found: [1, 2, 3], lives: 0, hints: 0 };
  const fake = {};
  const { ctx, page, calls } = await open(phone, "", { "top-tens:v1": { ...FRESH["top-tens:v1"], listRuns: [mine] } }, undefined, withGoogle(fake));
  const { google } = fake;
  await page.getByTestId("today-list").waitFor();
  await settle();
  await openSignIn(page);
  const key = page.getByTestId("sign-in-google");
  await key.waitFor();
  // Nothing from Google until the key is pressed: no script, no frame, no request.
  assert.deepEqual(google.hits, []);
  assert.equal(await page.locator('script[src*="accounts.google.com"], iframe').count(), 0);
  assert.equal(await key.getAttribute("data-flow"), "google");

  // Our keycap, full width, Google's G on its tile at its own 40px (the asset loaded), focused first (no keyboard).
  const look = await key.evaluate((el) => {
    const g = el.querySelector("img");
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, alt: g.getAttribute("alt"), loaded: g.complete && g.naturalWidth === 160, gw: g.getBoundingClientRect().width, gh: g.getBoundingClientRect().height, focused: el === document.activeElement };
  });
  const { w, ...rest } = look;
  assert.deepEqual(rest, { h: 52, alt: "", loaded: true, gw: 40, gh: 40, focused: true });
  const sheet = page.getByTestId("sign-in-sheet");
  const box = await sheet.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= phone.viewport.width + 0.5);
  assert.ok(w > 300, "the key spans the sheet");
  assert.ok(await noHScroll(page));

  const popup = await pressForPopup(page);
  // The callback page hands the token over and closes; the sheet closes itself on signing in.
  await popup.waitForEvent("close");
  await sheet.waitFor({ state: "detached" });
  await homeSignedIn(page, "Dana Scully");

  // Exactly the request Google needs, coming back to this site.
  assert.equal(google.asks.length, 1);
  const ask = google.asks[0];
  assert.deepEqual(Object.keys(ask).sort(), ["client_id", "nonce", "prompt", "redirect_uri", "response_type", "scope", "state"]);
  // The client ID as pasted had a trailing newline: trimmed.
  assert.equal(ask.client_id, GOOGLE_CLIENT_ID);
  assert.equal(ask.redirect_uri, `${served.base}auth/google.html`);
  assert.equal(ask.response_type, "id_token");
  assert.equal(ask.scope, "openid email profile");
  assert.equal(ask.prompt, "select_account");
  assert.match(ask.nonce, /^[0-9a-f]{64}$/);
  assert.match(ask.state, /^[0-9a-f]{32}$/);

  // Supabase gets Google's token and the nonce itself, whose SHA-256 Google got (and put in the token).
  assert.equal(calls.idToken.length, 1);
  const sent = calls.idToken[0];
  assert.equal(sent.provider, "google");
  assert.equal(sent.id_token, google.tokens[0]);
  assert.equal(claimsOf(sent.id_token).nonce, ask.nonce);
  assert.equal(sha256(sent.nonce), ask.nonce);
  assert.notEqual(sent.nonce, ask.nonce);
  assert.equal(calls.authorize.length, 0, "no redirect through Supabase");
  // The try is used up; nothing left on its way back.
  assert.equal(await pendingOf(page), null);
  // First sign-in on this device: its games go to the account.
  await until(() => calls.saves.some((c) => c.method === "POST"));
  assert.deepEqual(calls.saves.find((c) => c.method === "POST").body.data.listRuns.map((r) => r.id), ["islands"]);
  await ctx.close();
});

test("closing Google's window or Cancel says nothing, a state the game didn't ask with and a refusal get a word, then a new try works (desktop)", async () => {
  const fake = {};
  const { ctx, page, calls } = await open(desktop, "", FRESH, undefined, withGoogle(fake));
  const { google } = fake;
  await openSignIn(page);
  const sheet = page.getByTestId("sign-in-sheet");
  const key = page.getByTestId("sign-in-google");
  const waiting = page.getByTestId("sign-in-google-waiting");
  const error = page.getByTestId("sign-in-error");
  /** Still signed out and usable: the sheet stays open (it closes itself on signing in), the key works. */
  const usable = async () => {
    assert.ok(await sheet.isVisible(), "still signed out");
    assert.ok(await key.isEnabled());
  };

  // The chooser stays up: the sheet says where to look. A message that isn't from that window is ignored, even with
  // the right state.
  google.mode = "stay";
  let popup = await pressForPopup(page);
  await waiting.waitFor();
  assert.equal(await waiting.getAttribute("role"), "status");
  const { state } = await pendingOf(page);
  await page.evaluate((s) => postMessage({ type: "tentacle:google", state: s, token: "x.y.z" }, location.origin), state);
  await settle();
  assert.equal(calls.idToken.length, 0);
  // The player closes it: nothing to say.
  await popup.close();
  await waiting.waitFor({ state: "detached" });
  assert.equal(await error.count(), 0);
  assert.equal(await page.getByRole("alert").count(), 0);
  await usable();

  // Cancel at Google (access_denied): the window closes, nothing to say.
  google.mode = "denied";
  popup = await pressForPopup(page);
  await popup.waitForEvent("close");
  await waiting.waitFor({ state: "detached" });
  assert.equal(await error.count(), 0);
  assert.equal(calls.idToken.length, 0);
  await usable();

  // An answer for a try this page didn't make: refused before Supabase hears of it.
  google.mode = "forged";
  popup = await pressForPopup(page);
  await popup.waitForEvent("close");
  await error.waitFor();
  assert.equal(await error.getAttribute("role"), "alert");
  assert.equal(calls.idToken.length, 0);
  await usable();

  // A token Supabase refuses: an error, still signed out.
  google.mode = "refuse";
  popup = await pressForPopup(page);
  await popup.waitForEvent("close");
  await until(() => calls.idToken.length === 1);
  await error.waitFor();
  await usable();

  // The next try works. Every try asked with its own state and nonce.
  google.mode = "ok";
  popup = await pressForPopup(page);
  await popup.waitForEvent("close");
  await sheet.waitFor({ state: "detached" });
  await homeSignedIn(page, "Dana Scully");
  assert.equal(calls.idToken.length, 2);
  const last = google.asks.at(-1);
  assert.equal(sha256(calls.idToken[1].nonce), last.nonce);
  assert.equal(new Set(google.asks.map((a) => a.state)).size, google.asks.length);
  assert.equal(new Set(google.asks.map((a) => a.nonce)).size, google.asks.length);
  assert.equal(calls.authorize.length, 0);
  await ctx.close();
});

test("a blocked popup takes the tab to Google and back, and signs in on the screen it left (desktop)", async () => {
  const fake = {};
  const blockPopups = (ctx) => ctx.addInitScript(() => (window.open = () => null));
  // Coming Home from another screen, as a player does to sign in (the account lives on Home).
  const { ctx, page, calls } = await open(desktop, "#stats", FRESH, undefined, withGoogle(fake, blockPopups));
  const { google } = fake;
  await page.getByTestId("knowledge").waitFor();
  await page.getByTestId("nav-home").click();
  await openSignIn(page);
  const popups = [];
  ctx.on("page", (p) => popups.push(p));
  await page.getByTestId("sign-in-google").click();
  // To Google (the fake answers at once), to the callback page, and back to the game on the same screen: Home.
  await until(() => calls.idToken.length === 1, 10_000);
  await page.waitForURL(served.base);
  await page.getByTestId("today-list").waitFor();
  await homeSignedIn(page, "Dana Scully");
  assert.equal(popups.length, 0);
  assert.equal(google.asks.length, 1);
  assert.equal(google.asks[0].redirect_uri, `${served.base}auth/google.html`);
  assert.equal(sha256(calls.idToken[0].nonce), google.asks[0].nonce);
  assert.equal(calls.authorize.length, 0, "no supabase.co redirect");
  // The token never stays in the address or in storage.
  assert.ok(!page.url().includes("id_token"));
  const left = await page.evaluate(() => [sessionStorage.getItem("top-tens:google-result"), localStorage.getItem("top-tens:google-pending")]);
  assert.deepEqual(left, [null, null]);
  await ctx.close();
});

test("a popup with no way back to the game window signs in on its own, and the game tab follows (desktop)", async () => {
  const fake = {};
  const { ctx, page, calls } = await open(desktop, "", FRESH, undefined, withGoogle(fake));
  fake.google.mode = "sever";
  await openSignIn(page);
  const popup = await pressForPopup(page);
  // The popup becomes the game and finishes the sign-in itself.
  await popup.waitForURL(served.base);
  await until(() => calls.idToken.length === 1, 10_000);
  assert.equal(sha256(calls.idToken[0].nonce), fake.google.asks[0].nonce);
  // This tab hears of it (Supabase's client tells the site's other tabs) and closes its sheet.
  await page.getByTestId("sign-in-sheet").waitFor({ state: "detached" });
  await homeSignedIn(page, "Dana Scully");
  await ctx.close();
});

test("the Google key's hover, press and focus never move anything (desktop and phone)", async () => {
  for (const vp of [desktop, phone]) {
    const { ctx, page } = await open(vp, "", FRESH, undefined, withGoogle({}));
    await openSignIn(page);
    await page.getByTestId("sign-in-google").waitFor();
    const r = await checkScreen(page, { name: "sign-in sheet", scope: '[data-testid="sign-in-sheet"]' }, { hover: vp === desktop });
    assert.equal(r.failures.length, 0, formatFailures(vp.viewport.width, r.failures));
    assert.ok(r.counts.press >= 2, "the keys were pressed");
    await ctx.close();
  }
});

test("the privacy page says what Continue with Google does", async () => {
  const { ctx, page } = await open(desktop, "#privacy", FRESH);
  await page.getByTestId("privacy-google").waitFor();
  assert.ok(await noHScroll(page));
  await ctx.close();
});
