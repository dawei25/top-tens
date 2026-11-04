import { ACK, gameUrl, MESSAGE, parseCallback, peekPending, saveResult, type GoogleCallback } from "./google";

/**
 * The callback page (auth/google.html): where Google sends the player back, with the ID token (or an error) in the
 * address's fragment. It takes the token out of the address at once, then:
 *
 * - In a popup the game opened: posts it to the game window (only to our own origin) and closes once the game says it
 *   has it. If the game doesn't answer (its tab was reloaded meanwhile), it finishes the sign-in itself, below.
 * - With no game window to post to (a blocked popup sent the whole tab to Google, or an in-app browser opened the
 *   popup without an opener): keeps the token in this tab's sessionStorage and goes back to the game, which finishes
 *   the sign-in as it starts (`takeGoogleReturn`).
 *
 * Nothing here talks to Google or Supabase.
 */

/** How long the game has to say it got the token before this page finishes the sign-in on its own. */
export const ACK_MS = 2500;

/** The parts of `window` the page uses (a fake in the unit tests). */
export interface CallbackWindow {
  location: { hash: string; href: string; origin: string; pathname: string; search: string; replace(url: string): void };
  history: { replaceState(data: unknown, unused: string, url: string): void };
  opener: unknown;
  sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  close(): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/** The game window that opened this one, only if it is on our own origin (reading another origin's location throws). */
export function sameOriginOpener(win: CallbackWindow): Window | null {
  try {
    const o = win.opener as Window | null;
    if (!o || o === (win as unknown) || o.closed) return null;
    return o.location.origin === win.location.origin ? o : null;
  } catch {
    return null;
  }
}

/** What the page did: posted to the game window, or went back to the game in this tab. */
export type CallbackStep = "posted" | "returned";

/** Back to the game, the token kept for it in this tab, on the screen the player left from. */
function returnToGame(win: CallbackWindow, result: GoogleCallback | null): void {
  if (result) saveResult(win.sessionStorage, result);
  const back = peekPending(win.localStorage, Date.now())?.back ?? "";
  // The game's page is one folder up: auth/google.html -> ./
  win.location.replace(gameUrl(new URL("..", win.location.href).href) + back);
}

export function handleCallback(win: CallbackWindow, say: (text: string) => void = () => {}): CallbackStep {
  const result = parseCallback(win.location.hash);
  // The token never stays in the address bar or the history.
  win.history.replaceState(null, "", win.location.pathname + win.location.search);
  const game = result ? sameOriginOpener(win) : null;
  if (!result || !game) {
    returnToGame(win, result);
    return "returned";
  }
  let waiting: unknown;
  const onMessage = (e: MessageEvent) => {
    const d = e.data as { type?: unknown; state?: unknown } | null;
    if (e.origin !== win.location.origin || e.source !== game || d?.type !== ACK || d.state !== result.state) return;
    win.clearTimeout(waiting);
    win.removeEventListener("message", onMessage);
    say("done. you can close this window.");
    win.close();
  };
  win.addEventListener("message", onMessage);
  waiting = win.setTimeout(() => {
    win.removeEventListener("message", onMessage);
    returnToGame(win, result);
  }, ACK_MS);
  game.postMessage({ type: MESSAGE, ...result }, win.location.origin);
  return "posted";
}

// The page itself (not when a unit test imports this module).
if (typeof document !== "undefined" && document.documentElement.dataset.page === "google-callback") {
  const text = document.getElementById("status");
  handleCallback(window, (t) => {
    if (text) text.textContent = t;
  });
}
