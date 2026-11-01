/**
 * The account's state as the screens see it, and a counter that ticks whenever a sync changed this device's save (so
 * screens that read the save on render can draw again). Tiny and always loaded; the backend code that fills it in is
 * loaded only when needed (see ./index.ts).
 */
export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error";

export interface AccountUser {
  id: string;
  name: string;
  email?: string;
  /** Signed in with Google (else an email link or code). */
  google?: boolean;
}

export interface AccountState {
  /** off: no accounts in this build. loading: finding out. out / in: signed out / in. */
  status: "off" | "loading" | "out" | "in";
  user?: AccountUser;
  sync: SyncStatus;
  /** Epoch ms of the last sync that reached the server. */
  syncedAt?: number;
  /** Something to tell the player about signing in (a failed or misplaced sign-in link). */
  notice?: string;
}

let state: AccountState = { status: "off", sync: "idle" };
const listeners = new Set<() => void>();

export const getAccount = (): AccountState => state;

export function setAccount(patch: Partial<AccountState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export function subscribeAccount(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let saves = 0;
const saveListeners = new Set<() => void>();

export const getSaveVersion = (): number => saves;

/** This device's save changed under the screens (a sync merged something in): redraw. */
export function bumpSaves(): void {
  saves++;
  for (const fn of saveListeners) fn();
}

export function subscribeSaves(fn: () => void): () => void {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

/**
 * Stats already fetched (by key), so a screen that opens after its numbers arrived (a game's results, fetched as the
 * game ended) draws them at once instead of flashing the estimate first.
 */
const known = new Map<string, unknown>();

export function remember(key: string, value: unknown): void {
  known.set(key, value);
}

export function recall<T>(key: string): { value: T | null } | undefined {
  return known.has(key) ? { value: known.get(key) as T | null } : undefined;
}

/** localStorage keys the backend code uses, each separate from the game's own save. */
export const KEYS = {
  /** Supabase's session (only when signed in). */
  auth: "top-tens:auth",
  /** Finished games waiting to be sent. */
  outbox: "top-tens:outbox",
} as const;
