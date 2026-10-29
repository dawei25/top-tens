/**
 * The sound on/off choice: off by default, kept in localStorage under its own key (not in the game's saved state).
 * Storage can be missing or throw (private mode, blocked site data); then the choice lasts for the page only.
 */

export const SOUND_KEY = "tentacle:sound";

/** The subset of Storage this needs, so tests can pass a fake. */
export type PrefStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): PrefStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** True only when "on" was stored; anything else (nothing, junk, an error) is off. */
export function readSoundPref(storage: PrefStorage | undefined = defaultStorage()): boolean {
  try {
    return storage?.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

export function writeSoundPref(on: boolean, storage: PrefStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Not persisted; the in-memory choice still holds for this page.
  }
}

/** A tiny store so every toggle on screen (and the player) agree; read once, then kept in memory. */
export function createSoundPref(storage?: PrefStorage) {
  const store = () => (storage === undefined ? defaultStorage() : storage);
  let on = readSoundPref(store());
  const listeners = new Set<() => void>();
  return {
    get: () => on,
    set(next: boolean) {
      if (next === on) return;
      on = next;
      writeSoundPref(next, store());
      for (const fn of listeners) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const soundPref = createSoundPref();
