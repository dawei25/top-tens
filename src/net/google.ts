/**
 * Google sign-in from our own key: the standard OpenID Connect request (implicit flow, `response_type=id_token`) to
 * Google's endpoint, with our own page as the way back (`auth/google.html`, next to the game). Google's account
 * chooser names the site its answer goes to, so it says this site, not the Supabase project a redirect through
 * Supabase would name. Google hands back an ID token; Supabase trades it for a session (`signInWithGoogleToken` in
 * ./service).
 *
 * The press opens Google in a popup. Google sends the popup to our callback page with the token in the address's
 * fragment; that page (./google-callback.ts) posts it to the game window that opened it and closes. With no popup
 * (blocked), the game goes to Google in its own tab and comes back to the callback page, which hands the token on
 * through sessionStorage and returns to the game, which finishes the sign-in as it starts (`takeGoogleReturn`, from
 * ./service). A callback page that has no game window to post to (some in-app browsers open popups without one) does
 * the same.
 *
 * Nonce (Supabase's recipe): a random nonce per try; Google gets its SHA-256 (hex) and puts that in the ID token;
 * Supabase gets the nonce itself, hashes it and checks they match, so a token taken from elsewhere can't be replayed.
 * State: a random value per try that must come back with the token, so an answer this browser didn't ask for is
 * refused. Both are kept for the way back in localStorage (one try at a time, 15 minutes at most).
 */

/** Google's authorization endpoint (`authorization_endpoint` in https://accounts.google.com/.well-known/openid-configuration). */
export const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
/** The callback page, relative to the game's own page. Its full URL is an Authorized redirect URI of the client. */
export const CALLBACK_PATH = "auth/google.html";
/** The callback page's message to the game, and the game's answer that it has it. */
export const MESSAGE = "tentacle:google";
export const ACK = "tentacle:google-ack";
/** The popup window's name: a second press reuses the window. */
export const WINDOW_NAME = "tentacle-google";
/** How long a try may take, from the press to the token coming back. */
export const PENDING_TTL = 15 * 60_000;

/** localStorage: the try under way (state, raw nonce). sessionStorage: a token on its way back to the game tab. */
export const PENDING_KEY = "top-tens:google-pending";
export const RESULT_KEY = "top-tens:google-result";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const random = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));

/** A fresh nonce, and the SHA-256 (hex) of it that Google puts in the ID token. */
export async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = random(32);
  const hashed = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))));
  return { raw, hashed };
}

/** The game's page, without a screen (hash) or query: where the callback page sends the player back. */
export function gameUrl(href: string): string {
  const url = new URL(".", href);
  return url.origin + url.pathname;
}

/** The callback page's address for a game at `href` (the redirect URI Google must know). */
export const callbackUrl = (href: string): string => new URL(CALLBACK_PATH, gameUrl(href)).href;

/** Google's sign-in page for one try. */
export function authUrl(o: { clientId: string; redirectUri: string; state: string; hashedNonce: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "id_token",
    scope: "openid email profile",
    nonce: o.hashedNonce,
    state: o.state,
    // Always the account chooser, so a player with several accounts picks one (and sees which site asks).
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH}?${q}`;
}

/** One try, ready to go: Google's URL and what the way back must match. */
export interface GoogleRequest {
  url: string;
  state: string;
  /** The raw nonce, for Supabase. */
  nonce: string;
}

/** A new try (fresh state and nonce) for a game at `href`. */
export async function prepareGoogle(clientId: string, href: string): Promise<GoogleRequest> {
  const { raw, hashed } = await makeNonce();
  const state = random(16);
  return { url: authUrl({ clientId, redirectUri: callbackUrl(href), state, hashedNonce: hashed }), state, nonce: raw };
}

/** What came back to the callback page: a token, or Google's error code. */
export type GoogleCallback = { state: string; token: string } | { state: string | null; error: string };

/** Reads the callback page's fragment (`#id_token=...&state=...`, or `#error=...`); null if it holds neither. */
export function parseCallback(hash: string): GoogleCallback | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const state = q.get("state");
  const token = q.get("id_token");
  const error = q.get("error");
  if (token && state) return { state, token };
  if (error) return { state, error: error.slice(0, 64) };
  if (token) return { state: null, error: "no_state" };
  return null;
}

/** A message from the callback page, if `data` is one. */
export function readMessage(data: unknown): GoogleCallback | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.type !== MESSAGE) return null;
  const state = typeof d.state === "string" ? d.state : null;
  if (typeof d.token === "string" && state) return { state, token: d.token };
  if (typeof d.error === "string") return { state, error: d.error.slice(0, 64) };
  return null;
}

/** The try under way, as the way back needs it. */
export interface Pending {
  state: string;
  nonce: string;
  /** When it started (epoch ms). */
  at: number;
  /** The screen the player was on (the game's hash), to come back to after a full-page trip. */
  back: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function read<T>(store: Store, key: string): T | null {
  try {
    return JSON.parse(store.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}
function write(store: Store, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the popup still works (the game keeps the try in memory); only the full-page way back can't.
  }
}
function remove(store: Store, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // Nothing to clean.
  }
}

/** Only a screen (`#stats`), never something that would take the player elsewhere. */
const safeBack = (back: unknown): string => (typeof back === "string" && /^#[\w/-]*$/.test(back) ? back : "");

export function savePending(store: Store, p: Pending): void {
  write(store, PENDING_KEY, { ...p, back: safeBack(p.back) });
}

/** The try under way, if it's fresh and well formed (the callback page reads where to go back to from it). */
export function peekPending(store: Store, now: number): Pending | null {
  const p = read<Partial<Pending>>(store, PENDING_KEY);
  if (!p || typeof p.state !== "string" || typeof p.nonce !== "string" || typeof p.at !== "number") return null;
  if (now - p.at > PENDING_TTL || p.at > now + 60_000) return null;
  return { state: p.state, nonce: p.nonce, at: p.at, back: safeBack(p.back) };
}

/** Uses up the try under way if `state` is its state (each state signs in once). */
export function takePending(store: Store, state: string | null, now: number): Pending | null {
  const p = peekPending(store, now);
  if (!p || !state || p.state !== state) return null;
  remove(store, PENDING_KEY);
  return p;
}

/** The callback page hands a token to the game tab it's about to load (same tab: sessionStorage). */
export function saveResult(session: Store, c: GoogleCallback): void {
  write(session, RESULT_KEY, c);
}

export function takeResult(session: Store): GoogleCallback | null {
  const c = read<Record<string, unknown>>(session, RESULT_KEY);
  remove(session, RESULT_KEY);
  return c ? readMessage({ ...c, type: MESSAGE }) : null;
}

/** How a try ended, for the sign-in sheet. */
export type GoogleOutcome =
  | { kind: "token"; token: string; nonce: string }
  /** The player backed out (closed the window, or "Cancel" at Google): nothing to say. */
  | { kind: "cancel" }
  | { kind: "error"; message: string };

export const NO_MATCH = "that sign-in didn't match this page. try again.";
export const GOOGLE_FAILED = "google sign-in didn't work. try again.";

/** A token, or what to tell the player, given what came back and the try it should answer. */
export function outcomeOf(c: GoogleCallback, pending: Pick<Pending, "state" | "nonce"> | null): GoogleOutcome {
  if ("error" in c) return c.error === "access_denied" ? { kind: "cancel" } : { kind: "error", message: GOOGLE_FAILED };
  if (!pending || c.state !== pending.state) return { kind: "error", message: NO_MATCH };
  return { kind: "token", token: c.token, nonce: pending.nonce };
}

/**
 * The game tab, starting up: a token the callback page brought back (a full-page trip), matched with its try. Null
 * when nothing came back. Both records are used up.
 */
export function takeGoogleReturn(session: Store, local: Store, now: number): GoogleOutcome | null {
  const c = takeResult(session);
  if (!c) return null;
  const pending = takePending(local, c.state, now);
  return outcomeOf(c, pending);
}

/** The parts of `window` a try uses (a fake in the unit tests). */
export interface GameWindow {
  open(url: string, target: string, features: string): Window | null;
  location: { href: string; hash: string; origin: string; assign(url: string): void };
  localStorage: Store;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
}

/** A small window over the middle of the game's (phones open a tab instead). */
function features(win: GameWindow): string {
  const w = 500;
  const h = 640;
  const left = Math.max(0, Math.round(win.screenX + (win.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(win.screenY + (win.outerHeight - h) / 2));
  return `popup,width=${w},height=${h},left=${left},top=${top}`;
}

/** How often the game looks whether the popup was closed. */
export const CLOSED_POLL_MS = 400;

let active: (() => void) | null = null;

/**
 * Starts a try: Google in a popup (call it straight from the press, so the browser allows it). `done` hears how it
 * ended: a token (with its nonce) to hand to Supabase, the player backing out, or an error. Returns "popup", or
 * "redirect" when no popup could open and the tab itself is on its way to Google (`done` is then never called: the
 * game finishes the sign-in when it comes back). A new try replaces one still open.
 *
 * The try lives outside the sign-in sheet: closing the sheet while Google's window is open doesn't lose the sign-in.
 */
export function startGoogle(req: GoogleRequest, done: (o: GoogleOutcome) => void, win: GameWindow = window): "popup" | "redirect" {
  active?.();
  active = null;
  const pending: Pending = { state: req.state, nonce: req.nonce, at: Date.now(), back: win.location.hash };
  savePending(win.localStorage, pending);
  let popup: Window | null = null;
  try {
    popup = win.open(req.url, WINDOW_NAME, features(win));
  } catch {
    popup = null;
  }
  if (!popup || popup.closed) {
    win.location.assign(req.url);
    return "redirect";
  }
  const opened = popup;
  try {
    opened.focus();
  } catch {
    // Some browsers don't let a page focus another window: it's in front already.
  }

  let over = false;
  const finish = (o: GoogleOutcome | null) => {
    if (over) return;
    over = true;
    clearInterval(poll);
    win.removeEventListener("message", onMessage);
    if (active === stop) active = null;
    if (o) done(o);
  };
  const onMessage = (e: MessageEvent) => {
    // Only our own callback page, in the window this try opened.
    if (e.origin !== win.location.origin || e.source !== opened) return;
    const c = readMessage(e.data);
    if (!c) return;
    try {
      opened.postMessage({ type: ACK, state: c.state }, win.location.origin);
    } catch {
      // It closes itself anyway.
    }
    // The stored copy (for a full-page way back) is used up with it; the one in memory is the one checked.
    takePending(win.localStorage, c.state, Date.now());
    finish(outcomeOf(c, pending));
  };
  // Closed without an answer: the player backed out. The stored try stays (until replaced or stale): a callback page
  // cut off from this window (no opener) can still finish it.
  const poll = setInterval(() => {
    let closed = false;
    try {
      closed = opened.closed;
    } catch {
      closed = false;
    }
    if (closed) finish({ kind: "cancel" });
  }, CLOSED_POLL_MS);
  const stop = () => finish(null);
  active = stop;
  win.addEventListener("message", onMessage);
  return "popup";
}
