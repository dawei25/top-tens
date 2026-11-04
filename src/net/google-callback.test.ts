import { afterEach, describe, expect, it, vi } from "vitest";
import { ACK_MS, handleCallback, sameOriginOpener, type CallbackWindow } from "./google-callback";
import { MESSAGE, ACK, PENDING_KEY, RESULT_KEY, savePending } from "./google";

/**
 * The callback page (auth/google.html) against fake windows: it clears the token from the address, posts it to the
 * game window only on our origin and closes once the game has it, and otherwise brings it back to the game in its own
 * tab.
 */

const ORIGIN = "https://toptentacle.vercel.app";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
}

/** A callback page at `hash`, opened by `opener` (or not). */
function fakePage(hash: string, opener: unknown = null) {
  const listeners = new Set<(e: MessageEvent) => void>();
  const replaced: string[] = [];
  const history: string[] = [];
  const timers: (() => void)[] = [];
  const win: CallbackWindow & { closed: boolean } = {
    closed: false,
    location: {
      hash,
      href: `${ORIGIN}/auth/google.html${hash}`,
      origin: ORIGIN,
      pathname: "/auth/google.html",
      search: "",
      replace: (u) => void replaced.push(u),
    },
    history: {
      replaceState: (_d, _u, url) => {
        history.push(url);
        win.location.hash = "";
        win.location.href = `${ORIGIN}${url}`;
      },
    },
    opener,
    sessionStorage: memory(),
    localStorage: memory(),
    addEventListener: (_t, fn) => void listeners.add(fn),
    removeEventListener: (_t, fn) => void listeners.delete(fn),
    close: () => void (win.closed = true),
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => void timers.splice(0),
  };
  const deliver = (data: unknown, source: unknown, origin = ORIGIN) => {
    for (const fn of [...listeners]) fn({ data, source, origin } as MessageEvent);
  };
  return { win, replaced, history, timers, listeners, deliver };
}

/** The game window that opened the popup, on our origin (or `origin`). */
function fakeGame(origin = ORIGIN) {
  return {
    closed: false,
    postMessage: vi.fn(),
    get location() {
      if (origin !== ORIGIN) throw new DOMException("Blocked a frame with origin", "SecurityError");
      return { origin };
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the callback page", () => {
  it("in a popup: posts the token to the game window (our origin only) and closes once the game has it", () => {
    const game = fakeGame();
    const page = fakePage("#state=s1&id_token=a.b.c&authuser=0&prompt=none", game);
    const said: string[] = [];
    expect(handleCallback(page.win, (t) => said.push(t))).toBe("posted");
    // The token is gone from the address bar and the history at once.
    expect(page.history).toEqual(["/auth/google.html"]);
    expect(game.postMessage).toHaveBeenCalledExactlyOnceWith({ type: MESSAGE, state: "s1", token: "a.b.c" }, ORIGIN);
    expect(page.win.closed).toBe(false);

    // Answers that aren't the game's acknowledgement of this token: ignored.
    page.deliver({ type: ACK, state: "s1" }, {});
    page.deliver({ type: ACK, state: "s1" }, game, "https://evil.example");
    page.deliver({ type: ACK, state: "other" }, game);
    expect(page.win.closed).toBe(false);

    page.deliver({ type: ACK, state: "s1" }, game);
    expect(page.win.closed).toBe(true);
    expect(said).toEqual(["done. you can close this window."]);
    expect(page.timers).toEqual([]);
    expect(page.replaced).toEqual([]);
    expect(page.win.sessionStorage.data.size).toBe(0);
  });

  it("passes Google's error on too (the game decides what to say)", () => {
    const game = fakeGame();
    const page = fakePage("#error=access_denied&state=s1", game);
    handleCallback(page.win);
    expect(game.postMessage).toHaveBeenCalledWith({ type: MESSAGE, state: "s1", error: "access_denied" }, ORIGIN);
  });

  it("with no game window to post to: keeps the token in this tab and goes back to the game's screen", () => {
    const page = fakePage("#state=s1&id_token=a.b.c");
    savePending(page.win.localStorage, { state: "s1", nonce: "raw1", at: Date.now(), back: "#stats" });
    expect(handleCallback(page.win)).toBe("returned");
    expect(page.history).toEqual(["/auth/google.html"]);
    expect(JSON.parse(page.win.sessionStorage.data.get(RESULT_KEY)!)).toEqual({ state: "s1", token: "a.b.c" });
    expect(page.replaced).toEqual([`${ORIGIN}/#stats`]);
    // The try stays for the game to use up (with the nonce Supabase needs).
    expect(page.win.localStorage.data.has(PENDING_KEY)).toBe(true);
  });

  it("never posts to a window on another origin", () => {
    const stranger = fakeGame("https://evil.example");
    const page = fakePage("#state=s1&id_token=a.b.c", stranger);
    expect(sameOriginOpener(page.win)).toBeNull();
    expect(handleCallback(page.win)).toBe("returned");
    expect(stranger.postMessage).not.toHaveBeenCalled();
    expect(page.replaced).toEqual([`${ORIGIN}/`]);
  });

  it("when the game window doesn't answer (reloaded meanwhile), finishes the sign-in in this window", () => {
    const game = fakeGame();
    const page = fakePage("#state=s1&id_token=a.b.c", game);
    handleCallback(page.win);
    expect(page.timers).toHaveLength(1);
    expect(ACK_MS).toBeGreaterThanOrEqual(1000);
    page.timers[0]();
    expect(page.listeners.size).toBe(0);
    expect(page.win.closed).toBe(false);
    expect(page.win.sessionStorage.data.has(RESULT_KEY)).toBe(true);
    expect(page.replaced).toEqual([`${ORIGIN}/`]);
  });

  it("opened with nothing from Google: just goes to the game", () => {
    const page = fakePage("", fakeGame());
    expect(handleCallback(page.win)).toBe("returned");
    expect(page.win.sessionStorage.data.size).toBe(0);
    expect(page.replaced).toEqual([`${ORIGIN}/`]);
  });

  it("ignores a closed opener", () => {
    const game = { ...fakeGame(), closed: true };
    expect(sameOriginOpener(fakePage("#state=s1&id_token=a.b.c", game).win)).toBeNull();
  });
});
