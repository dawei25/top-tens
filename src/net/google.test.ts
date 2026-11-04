import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACK,
  authUrl,
  callbackUrl,
  CLOSED_POLL_MS,
  gameUrl,
  GOOGLE_AUTH,
  GOOGLE_FAILED,
  makeNonce,
  MESSAGE,
  NO_MATCH,
  outcomeOf,
  parseCallback,
  peekPending,
  PENDING_KEY,
  PENDING_TTL,
  prepareGoogle,
  readMessage,
  RESULT_KEY,
  saveResult,
  savePending,
  startGoogle,
  takeGoogleReturn,
  takePending,
  WINDOW_NAME,
  type GameWindow,
  type GoogleOutcome,
} from "./google";
import { KEYS } from "./store";

/**
 * Google sign-in from our own key (./google): the request Google gets, what comes back to the callback page, the try
 * kept for the way back, and the popup or full-page trip, against fake windows and storage.
 */

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const CLIENT = "1234-abc.apps.googleusercontent.com";
const NOW = Date.UTC(2026, 10, 4, 12);

/** Storage in memory (localStorage or sessionStorage). */
function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the request", () => {
  it("is Google's endpoint with exactly these parameters", () => {
    const url = new URL(authUrl({ clientId: CLIENT, redirectUri: "https://toptentacle.vercel.app/auth/google.html", state: "s1", hashedNonce: "h1" }));
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT,
      redirect_uri: "https://toptentacle.vercel.app/auth/google.html",
      response_type: "id_token",
      scope: "openid email profile",
      nonce: "h1",
      state: "s1",
      prompt: "select_account",
    });
  });

  it("comes back to auth/google.html next to the game, whatever screen it was asked from", () => {
    expect(callbackUrl("https://toptentacle.vercel.app/")).toBe("https://toptentacle.vercel.app/auth/google.html");
    expect(callbackUrl("https://toptentacle.vercel.app/#stats")).toBe("https://toptentacle.vercel.app/auth/google.html");
    expect(callbackUrl("https://toptentacle.vercel.app/index.html?x=1#p-mountains")).toBe("https://toptentacle.vercel.app/auth/google.html");
    expect(callbackUrl("http://localhost:5100/")).toBe("http://localhost:5100/auth/google.html");
    expect(gameUrl("https://toptentacle.vercel.app/index.html#stats")).toBe("https://toptentacle.vercel.app/");
  });

  it("has a random nonce whose SHA-256 (hex) Google gets, and a random state", async () => {
    const a = await makeNonce();
    const b = await makeNonce();
    expect(a.raw).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hashed).toBe(sha256(a.raw));
    expect(b.raw).not.toBe(a.raw);

    const one = await prepareGoogle(CLIENT, "https://toptentacle.vercel.app/#stats");
    const two = await prepareGoogle(CLIENT, "https://toptentacle.vercel.app/#stats");
    const q = new URL(one.url).searchParams;
    expect(one.state).toMatch(/^[0-9a-f]{32}$/);
    expect(q.get("state")).toBe(one.state);
    expect(q.get("nonce")).toBe(sha256(one.nonce));
    expect(q.get("redirect_uri")).toBe("https://toptentacle.vercel.app/auth/google.html");
    expect(two.state).not.toBe(one.state);
    expect(two.nonce).not.toBe(one.nonce);
  });
});

describe("what comes back", () => {
  it("reads Google's fragment: a token and its state, or an error", () => {
    expect(parseCallback("#state=s1&id_token=a.b.c&authuser=0&prompt=none")).toEqual({ state: "s1", token: "a.b.c" });
    expect(parseCallback("#error=access_denied&state=s1")).toEqual({ state: "s1", error: "access_denied" });
    expect(parseCallback("#error=interaction_required")).toEqual({ state: null, error: "interaction_required" });
    // A token without a state can't be matched with a try.
    expect(parseCallback("#id_token=a.b.c")).toEqual({ state: null, error: "no_state" });
    expect(parseCallback("")).toBeNull();
    expect(parseCallback("#stats")).toBeNull();
  });

  it("takes only the callback page's own messages", () => {
    expect(readMessage({ type: MESSAGE, state: "s1", token: "a.b.c" })).toEqual({ state: "s1", token: "a.b.c" });
    expect(readMessage({ type: MESSAGE, state: "s1", error: "access_denied" })).toEqual({ state: "s1", error: "access_denied" });
    expect(readMessage({ type: "other", state: "s1", token: "a.b.c" })).toBeNull();
    expect(readMessage({ type: MESSAGE, token: "a.b.c" })).toBeNull();
    expect(readMessage("tentacle:google")).toBeNull();
    expect(readMessage(null)).toBeNull();
  });

  it("is a token with the try's own nonce only when the state matches; backing out is silent", () => {
    const pending = { state: "s1", nonce: "raw1" };
    expect(outcomeOf({ state: "s1", token: "t" }, pending)).toEqual({ kind: "token", token: "t", nonce: "raw1" });
    expect(outcomeOf({ state: "forged", token: "t" }, pending)).toEqual({ kind: "error", message: NO_MATCH });
    expect(outcomeOf({ state: "s1", token: "t" }, null)).toEqual({ kind: "error", message: NO_MATCH });
    expect(outcomeOf({ state: "s1", error: "access_denied" }, pending)).toEqual({ kind: "cancel" });
    expect(outcomeOf({ state: "s1", error: "server_error" }, pending)).toEqual({ kind: "error", message: GOOGLE_FAILED });
  });
});

describe("the try kept for the way back", () => {
  it("uses the same keys as the game's startup check", () => {
    expect(PENDING_KEY).toBe(KEYS.googlePending);
    expect(RESULT_KEY).toBe(KEYS.googleResult);
  });

  it("is used up once, by its own state, while it's fresh", () => {
    const store = memory();
    savePending(store, { state: "s1", nonce: "raw1", at: NOW, back: "#stats" });
    expect(peekPending(store, NOW + 1000)).toEqual({ state: "s1", nonce: "raw1", at: NOW, back: "#stats" });
    expect(takePending(store, "forged", NOW)).toBeNull();
    expect(takePending(store, null, NOW)).toBeNull();
    expect(takePending(store, "s1", NOW)).toMatchObject({ nonce: "raw1" });
    expect(takePending(store, "s1", NOW)).toBeNull();

    savePending(store, { state: "s2", nonce: "raw2", at: NOW, back: "" });
    expect(takePending(store, "s2", NOW + PENDING_TTL + 1)).toBeNull();
    store.setItem(PENDING_KEY, "{not json");
    expect(peekPending(store, NOW)).toBeNull();
  });

  it("only ever goes back to one of the game's screens", () => {
    const store = memory();
    for (const back of ["https://evil.example/", "#x?y=1", "javascript:alert(1)", "#a b"]) {
      savePending(store, { state: "s", nonce: "n", at: NOW, back });
      expect(peekPending(store, NOW)?.back).toBe("");
    }
    savePending(store, { state: "s", nonce: "n", at: NOW, back: "#blitz-airports/run-123" });
    expect(peekPending(store, NOW)?.back).toBe("#blitz-airports/run-123");
  });

  it("finishes a full-page trip on startup: the token with its nonce, once", () => {
    const local = memory();
    const session = memory();
    savePending(local, { state: "s1", nonce: "raw1", at: NOW, back: "" });
    saveResult(session, { state: "s1", token: "a.b.c" });
    expect(takeGoogleReturn(session, local, NOW)).toEqual({ kind: "token", token: "a.b.c", nonce: "raw1" });
    expect(takeGoogleReturn(session, local, NOW)).toBeNull();
    expect(local.data.size + session.data.size).toBe(0);

    // A token for a try this browser didn't make.
    saveResult(session, { state: "s9", token: "a.b.c" });
    expect(takeGoogleReturn(session, local, NOW)).toEqual({ kind: "error", message: NO_MATCH });
  });
});

/** A game window: `open` gives a fake popup (or null: blocked), messages can be delivered to it. */
function fakeGame({ blocked = false } = {}) {
  const listeners = new Set<(e: MessageEvent) => void>();
  const popup = { closed: false, focus: vi.fn(), postMessage: vi.fn() };
  const opened: { url: string; target: string; features: string }[] = [];
  const assigned: string[] = [];
  const win: GameWindow = {
    open: (url, target, features) => {
      opened.push({ url, target, features });
      return blocked ? null : (popup as unknown as Window);
    },
    location: { href: "https://toptentacle.vercel.app/#stats", hash: "#stats", origin: "https://toptentacle.vercel.app", assign: (u) => void assigned.push(u) },
    localStorage: memory(),
    addEventListener: (_t, fn) => void listeners.add(fn),
    removeEventListener: (_t, fn) => void listeners.delete(fn),
    screenX: 100,
    screenY: 50,
    outerWidth: 1400,
    outerHeight: 900,
  };
  const deliver = (data: unknown, { origin = win.location.origin, source = popup as unknown }: { origin?: string; source?: unknown } = {}) => {
    for (const fn of [...listeners]) fn({ data, origin, source } as MessageEvent);
  };
  return { win, popup, opened, assigned, listeners, deliver };
}

describe("a try from the game", () => {
  it("opens Google in a named popup over the game, keeps the try, and takes the token from that popup only", async () => {
    const req = await prepareGoogle(CLIENT, "https://toptentacle.vercel.app/#stats");
    const g = fakeGame();
    const done = vi.fn<(o: GoogleOutcome) => void>();
    expect(startGoogle(req, done, g.win)).toBe("popup");
    expect(g.opened).toEqual([{ url: req.url, target: WINDOW_NAME, features: "popup,width=500,height=640,left=550,top=180" }]);
    expect(g.assigned).toEqual([]);
    expect(peekPending(g.win.localStorage, Date.now())).toMatchObject({ state: req.state, nonce: req.nonce, back: "#stats" });

    // Not from the popup, not from our origin, not ours: ignored.
    g.deliver({ type: MESSAGE, state: req.state, token: "x.y.z" }, { source: {} });
    g.deliver({ type: MESSAGE, state: req.state, token: "x.y.z" }, { origin: "https://evil.example" });
    g.deliver({ type: "something-else", state: req.state, token: "x.y.z" });
    expect(done).not.toHaveBeenCalled();

    g.deliver({ type: MESSAGE, state: req.state, token: "a.b.c" });
    expect(done).toHaveBeenCalledExactlyOnceWith({ kind: "token", token: "a.b.c", nonce: req.nonce });
    // The popup hears it was received (so it can close), only on our origin; the try is used up.
    expect(g.popup.postMessage).toHaveBeenCalledWith({ type: ACK, state: req.state }, "https://toptentacle.vercel.app");
    expect(peekPending(g.win.localStorage, Date.now())).toBeNull();
    expect(g.listeners.size).toBe(0);
  });

  it("refuses a token whose state isn't this try's", async () => {
    const req = await prepareGoogle(CLIENT, "https://toptentacle.vercel.app/");
    const g = fakeGame();
    const done = vi.fn();
    startGoogle(req, done, g.win);
    g.deliver({ type: MESSAGE, state: "forged", token: "a.b.c" });
    expect(done).toHaveBeenCalledExactlyOnceWith({ kind: "error", message: NO_MATCH });
  });

  it("closed without an answer is the player backing out", async () => {
    vi.useFakeTimers();
    const req = await prepareGoogle(CLIENT, "https://toptentacle.vercel.app/");
    const g = fakeGame();
    const done = vi.fn();
    startGoogle(req, done, g.win);
    vi.advanceTimersByTime(CLOSED_POLL_MS * 3);
    expect(done).not.toHaveBeenCalled();
    g.popup.closed = true;
    vi.advanceTimersByTime(CLOSED_POLL_MS);
    expect(done).toHaveBeenCalledExactlyOnceWith({ kind: "cancel" });
    // The stored try stays: a callback page cut off from the game window can still finish it.
    expect(peekPending(g.win.localStorage, Date.now())).toMatchObject({ state: req.state });
  });

  it("with the popup blocked, takes the whole tab to Google instead", async () => {
    const req = await prepareGoogle(CLIENT, "https://toptentacle.vercel.app/#stats");
    const g = fakeGame({ blocked: true });
    const done = vi.fn();
    expect(startGoogle(req, done, g.win)).toBe("redirect");
    expect(g.assigned).toEqual([req.url]);
    expect(peekPending(g.win.localStorage, Date.now())).toMatchObject({ state: req.state, nonce: req.nonce, back: "#stats" });
    expect(done).not.toHaveBeenCalled();
    expect(g.listeners.size).toBe(0);
  });

  it("a new try replaces one still open", async () => {
    const first = await prepareGoogle(CLIENT, "https://toptentacle.vercel.app/");
    const second = await prepareGoogle(CLIENT, "https://toptentacle.vercel.app/");
    const g = fakeGame();
    const done1 = vi.fn();
    const done2 = vi.fn();
    startGoogle(first, done1, g.win);
    startGoogle(second, done2, g.win);
    expect(g.listeners.size).toBe(1);
    g.deliver({ type: MESSAGE, state: first.state, token: "old" });
    expect(done1).not.toHaveBeenCalled();
    expect(done2).toHaveBeenCalledExactlyOnceWith({ kind: "error", message: NO_MATCH });
  });
});
