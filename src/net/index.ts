import { useEffect, useState, useSyncExternalStore } from "react";
import type { BlitzState } from "../game/blitz";
import type { GameState } from "../game/state";
import { load, save } from "../game/storage";
import { accountsOn, backendOn } from "./config";
import type { CrowdStats, ListAverages } from "./crowd";
import { compareKey, FATHOM_GUESSES, type CompareRound, type FathomCrowd, type FathomGuess } from "./fathom";
import { cleanNote, FEEDBACK, type Feedback } from "./feedback";
import { enqueue, localOutboxStore } from "./outbox";
import { invalidRating, ratingKey, withRating, type Rating, type RatingMode, type RatingReason } from "./ratings";
import type { SyncSave } from "./sync/merge";
import {
  accountUser,
  getAccount,
  getSaveVersion,
  KEYS,
  recall,
  setAccount,
  subscribeAccount,
  subscribeSaves,
  type AccountState,
  type AccountUser,
} from "./store";

/**
 * The backend as the screens use it: always loaded, and a no-op in a build without a backend (no env), where nothing
 * is sent, stored or downloaded. The real work is in ./service, imported on demand.
 */

export { accountsOn, backendOn } from "./config";
export { compareRound, type CompareRound } from "./fathom";
export type { AccountState } from "./store";

type Service = typeof import("./service");
let service: Promise<Service> | null = null;

/** The backend code, loaded on first use; null in a build without a backend. */
export function loadService(): Promise<Service> | null {
  if (!backendOn) return null;
  service ??= import("./service").catch((e) => {
    // A failed download (offline on first use) can be tried again later.
    service = null;
    throw e;
  });
  return service;
}

function withService(fn: (s: Service) => unknown): void {
  loadService()?.then(fn).catch(() => {});
}

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * A sign-in coming back to the page: a code to trade for a session, or an error; or Google's token, brought back to
 * this tab by the callback page (./google).
 */
function authCallback(): boolean {
  let google = false;
  try {
    google = !!sessionStorage.getItem(KEYS.googleResult);
  } catch {
    // No sessionStorage: nothing came back through it.
  }
  return google || /[?&](code|error_description)=/.test(location.search) || /(^#|&)(error_description|access_token)=/.test(location.hash);
}

let throttleUntil = 0;

/**
 * Called once at startup. Loads the backend code only when there's work for it: plays waiting to be sent, a session
 * to restore, or a sign-in to finish. Otherwise it waits for the first finished game, stats view or sign-in.
 */
export function startNet(): void {
  if (!backendOn) return;
  const pending = [KEYS.outbox, KEYS.ratingOutbox, KEYS.feedbackOutbox, KEYS.fathomOutbox].some((k) => /"pending":\[\{/.test(stored(k) ?? ""));
  const session = accountsOn && (!!stored(KEYS.auth) || authCallback());
  // A stored session names its player, so Home can show them at once; the backend code confirms it a moment later.
  let user: AccountUser | undefined;
  try {
    const u = accountsOn ? JSON.parse(stored(KEYS.auth) ?? "null")?.user : null;
    if (typeof u?.id === "string") user = accountUser(u);
  } catch {
    // Not a session we can read: wait for the backend code.
  }
  setAccount({ status: !accountsOn ? "off" : user ? "in" : session ? "loading" : "out", user });
  if (pending || session) {
    loadService()
      ?.then((s) => s.start())
      // The backend code didn't download (offline): play on; the next try comes with the next game.
      .catch(() => {
        if (getAccount().status === "loading") setAccount({ status: "out" });
        else if (getAccount().status === "in") setAccount({ sync: "offline" });
      });
  }
  addEventListener("online", () =>
    withService((s) => {
      void s.flushPlays();
      void s.flushRatings();
      void s.flushFeedback();
      void s.flushFathom();
    }),
  );
  // Coming back to the tab: catch up with other devices (at most every 30 s).
  const back = () => {
    if (document.visibilityState === "hidden" || getAccount().status !== "in" || Date.now() < throttleUntil) return;
    throttleUntil = Date.now() + 30_000;
    withService((s) => s.syncSoon(0));
  };
  addEventListener("focus", back);
  document.addEventListener("visibilitychange", back);
}

/** A list game just finished on this device (today's daily: pass its date). Sends its score; syncs if signed in. */
export function reportList(game: GameState, daily?: string): void {
  if (!backendOn) return;
  withService((s) => {
    s.start();
    s.reportList(game, daily);
  });
}

/** A Blitz round just finished on this device (a date's Blitz played on its date: pass the date). */
export function reportBlitz(state: BlitzState, daily?: string): void {
  if (!backendOn) return;
  withService((s) => {
    s.start();
    s.reportBlitz(state, daily);
  });
}

/**
 * "Good list?": the player rated a list in a mode (1 or -1, a reason only with -1), or took their rating back (0).
 * Kept in this device's save at once, so it shows as chosen later, offline and without a backend; with a backend it
 * is also sent (the latest per list and mode, retried while offline) and synced to the player's other devices.
 */
export function rateList(listId: string, mode: RatingMode, rating: -1 | 0 | 1, reason?: RatingReason): void {
  const saved = load();
  // Always after the rating it replaces, even within one millisecond (or a stopped clock): the latest must win.
  const at = Math.max(Date.now(), (saved.ratings?.[ratingKey(mode, listId)]?.at ?? 0) + 1);
  const r: Rating = { listId, mode, rating, reason: rating === -1 ? (reason ?? null) : null, at };
  if (invalidRating(r)) return;
  save(withRating(saved, r));
  if (!backendOn) return;
  withService((s) => {
    s.start();
    s.rateList(r);
  });
}

let lastNoteAt = 0;

/**
 * "add a note": a few words on a list in a mode, with the player's rating of it now (1, -1 or null). Only with a
 * backend: without one the note option isn't shown, and this sends and stores nothing. Queued in its own outbox at
 * once, before the backend code loads (so a note survives that download failing offline, or a reload), then sent and
 * retried while offline. Never kept in the save, never synced. False when there's nothing to send: no backend, or a
 * note that's blank or too long.
 */
export function submitFeedback(listId: string, mode: RatingMode, text: string, rating: -1 | 1 | null): boolean {
  if (!backendOn) return false;
  // Each note its own name in the outbox, even two within one millisecond.
  const at = (lastNoteAt = Math.max(Date.now(), lastNoteAt + 1));
  const note: Feedback = { listId, mode, rating, text: cleanNote(text), at };
  try {
    if (!enqueue(localOutboxStore<Feedback>(globalThis.localStorage, KEYS.feedbackOutbox), FEEDBACK, note, at)) return false;
  } catch {
    // No storage at all (blocked): nothing can wait to be sent, as for plays and ratings.
    return false;
  }
  withService((s) => {
    s.start();
    void s.flushFeedback();
  });
  return true;
}

/**
 * Fathom: a guess just locked in on a question, 0 or more; on a name-it round, the figure of the thing named (its
 * population, its land borders). Only with a backend: without one this sends and stores nothing. Queued in its own
 * outbox at once (like a note: it survives the backend code failing to download offline, or a reload), then sent and
 * retried while offline. One per question: once a question's guess is queued or sent, a later game's guess on it adds
 * nothing (the server keeps a browser's first). False when nothing was queued.
 */
export function submitFathomGuess(questionId: string, guess: number): boolean {
  if (!backendOn) return false;
  const item: FathomGuess = { questionId, guess, at: Date.now() };
  try {
    if (!enqueue(localOutboxStore<FathomGuess>(globalThis.localStorage, KEYS.fathomOutbox), FATHOM_GUESSES, item, item.at)) return false;
  } catch {
    // No storage at all (blocked): nothing can wait to be sent.
    return false;
  }
  withService((s) => {
    s.start();
    void s.flushFathom();
  });
  return true;
}

/**
 * Home's "reset all progress" just ran. Signed in, the reset is stamped on the save so it reaches the account and
 * every other device (instead of being merged back on the next sync). Signed out, it stays on this device.
 */
export function noteReset(): void {
  if (getAccount().status !== "in") return;
  const stamped: SyncSave = { ...load(), resetAt: Date.now() };
  save(stamped);
  withService((s) => s.syncSoon(0));
}

export function useAccount(): AccountState {
  return useSyncExternalStore(subscribeAccount, getAccount, getAccount);
}

/** Ticks when a sync changed this device's save, so a screen that reads the save on render draws again. */
export function useSaveVersion(): number {
  return useSyncExternalStore(subscribeSaves, getSaveVersion, getSaveVersion);
}

/** A value the service fetches (and caches), by key; null until it arrives, or without a backend. */
function useLoaded<T>(key: string | null, get: (s: Service) => Promise<T | null>): T | null {
  const [value, setValue] = useState<{ key: string; value: T | null } | null>(null);
  useEffect(() => {
    if (!key || !backendOn) return;
    let live = true;
    loadService()
      ?.then(get)
      .then(
        (v) => live && setValue({ key, value: v }),
        () => {},
      );
    return () => {
      live = false;
    };
    // `get` is rebuilt every render; the key says what it fetches.
  }, [key]);
  if (!key) return null;
  if (value?.key === key) return value.value;
  // Numbers fetched earlier (as the game ended) show from the first frame.
  return recall<T>(key)?.value ?? null;
}

/** Real players' scores on a list in a mode; null without a backend, while loading, or if the server can't say. */
export function useListStats(id: string | undefined, mode: "list" | "blitz"): CrowdStats | null {
  return useLoaded(id ? `stats:${mode}:${id}` : null, (s) => s.listStats(id!, mode));
}

/** Every list's real average; null without a backend or until loaded. */
export function useListAverages(): ListAverages | null {
  return useLoaded("averages:list", (s) => s.listAverages());
}

/**
 * How real players guessed on a Fathom question, against this guess and the answer shown, "further off" measured on
 * the scale of the question's round (`compareRound(q)`: points off for a percent, years for a year, steps on a steps
 * list, how many times off otherwise); null without a backend, while loading, or if the server can't say (playersLine
 * in src/game/fathom.ts decides whether there are enough of them to show).
 */
export function useFathomCrowd(questionId: string, guess: number, answer: number, round: CompareRound = "estimate"): FathomCrowd | null {
  return useLoaded(compareKey(questionId, round, guess, answer), (s) => s.fathomCompare(questionId, guess, answer, round));
}
