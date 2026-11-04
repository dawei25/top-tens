import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { BlitzState } from "../game/blitz";
import type { GameState } from "../game/state";
import { load, save } from "../game/storage";
import { accountsOn, BACKEND } from "./config";
import { parseAverages, parseStats, type CrowdStats, type ListAverages } from "./crowd";
import { FEEDBACK, feedbackArgs, type Feedback } from "./feedback";
import { takeGoogleReturn, type GoogleOutcome } from "./google";
import { localOutboxStore, Outbox, retryDelay, type SendResult } from "./outbox";
import { blitzPlay, clientId, listPlay, rpcArgs, type Play } from "./plays";
import { RATINGS, rateArgs, ratingKey, type Rating } from "./ratings";
import { accountUser, bumpSaves, getAccount, KEYS, remember, setAccount, type AccountUser } from "./store";
import { syncSave, type SaveRemote } from "./sync/engine";
import { mergeSaves, type SyncSave } from "./sync/merge";

/**
 * Everything that talks to the backend: score stats, ratings, notes, sign-in and save sync. Loaded with a dynamic
 * import, and only in builds with a backend (see ./index.ts), so players of a build without one never download it or
 * Supabase's client. Nothing here may break the game: every call catches its own failures.
 */

let client: SupabaseClient | null = null;

function sb(): SupabaseClient {
  if (!BACKEND) throw new Error("no backend configured");
  client ??= createClient(BACKEND.url, BACKEND.anonKey, {
    auth: accountsOn
      ? { flowType: "pkce", storageKey: KEYS.auth, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      : { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

/** Offline or the server's trouble: try again later. Anything else (a refused play) won't get better. */
export function sendResult(status: number, error: unknown): SendResult {
  if (!error) return "ok";
  if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) return "retry";
  return "drop";
}

// ---------- Plays ----------

const outbox = new Outbox(localOutboxStore(), async (play: Play) => {
  const { error, status } = await sb().rpc("submit_play", rpcArgs(play, clientId()));
  return sendResult(status, error);
});

let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** Send the plays waiting; on failure, try again later with backoff (and at once when the browser comes online). */
export async function flushPlays(): Promise<void> {
  clearTimeout(retryTimer);
  try {
    if ((await outbox.flush()) === "retry") {
      retries++;
      // Overlapping calls share one flush; only one retry may stay scheduled.
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void flushPlays(), retryDelay(retries));
    } else retries = 0;
  } catch {
    // Never let stats get in the way.
  }
}

function queue(play: Play | null): void {
  if (play && outbox.add(play)) {
    void flushPlays();
    // The results are about to show this list's numbers: fetch them now.
    void listStats(play.listId, play.mode);
  }
  // A finished game is a change worth syncing (after the game screen has saved it).
  if (getAccount().status === "in") syncSoon(1500);
}

export function reportList(game: GameState, daily?: string): void {
  queue(listPlay(game, daily));
}

export function reportBlitz(state: BlitzState, daily?: string): void {
  queue(blitzPlay(state, daily));
}

// ---------- Ratings ----------

/** "Good list?" answers waiting to be sent: the latest per list and mode, sent like plays (offline, they wait). */
const ratingBox = new Outbox<Rating>(
  localOutboxStore<Rating>(globalThis.localStorage, KEYS.ratingOutbox),
  async (r) => {
    // A newer rating of this list came from another device (a sync): that device sends its own.
    const latest = load().ratings?.[ratingKey(r.mode, r.listId)];
    if (latest && latest.at > r.at) return "drop";
    const { error, status } = await sb().rpc("rate_list", rateArgs(r, clientId()));
    return sendResult(status, error);
  },
  Date.now,
  RATINGS,
);

let ratingRetries = 0;
let ratingTimer: ReturnType<typeof setTimeout> | undefined;

/** Send the ratings waiting, with the same backoff as plays. */
export async function flushRatings(): Promise<void> {
  clearTimeout(ratingTimer);
  try {
    if ((await ratingBox.flush()) === "retry") {
      ratingRetries++;
      clearTimeout(ratingTimer);
      ratingTimer = setTimeout(() => void flushRatings(), retryDelay(ratingRetries));
    } else ratingRetries = 0;
  } catch {
    // Never let ratings get in the way.
  }
}

/** The player rated a list (0: took it back). It's in the save already: send it, and sync it to their devices. */
export function rateList(r: Rating): void {
  if (ratingBox.add(r)) void flushRatings();
  if (getAccount().status === "in") syncSoon(1500);
}

// ---------- Notes ----------

/**
 * Notes waiting to be sent, every one, oldest first, retried like plays. The facade (./index.ts) queues them in this
 * store before this code has even loaded; this only sends.
 */
const feedbackBox = new Outbox<Feedback>(
  localOutboxStore<Feedback>(globalThis.localStorage, KEYS.feedbackOutbox),
  async (f) => {
    const { error, status } = await sb().rpc("submit_feedback", feedbackArgs(f, clientId()));
    return sendResult(status, error);
  },
  Date.now,
  FEEDBACK,
);

let feedbackRetries = 0;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;

/** Send the notes waiting, with the same backoff as plays. */
export async function flushFeedback(): Promise<void> {
  clearTimeout(feedbackTimer);
  try {
    if ((await feedbackBox.flush()) === "retry") {
      feedbackRetries++;
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => void flushFeedback(), retryDelay(feedbackRetries));
    } else feedbackRetries = 0;
  } catch {
    // Never let notes get in the way.
  }
}

// ---------- Stats ----------

const STATS_TTL = 5 * 60_000;
const AVERAGES_TTL = 10 * 60_000;
const FAILED_TTL = 30_000;
const cache = new Map<string, { until: number; value: Promise<unknown> }>();

/**
 * One request per key at a time, kept for `ttl` (a failure only briefly, so it's tried again soon). Answers are also
 * remembered for screens that open later (see recall in ./store).
 */
function cached<T>(key: string, ttl: number, get: () => Promise<T | null>): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value as Promise<T | null>;
  const value = get().catch(() => null);
  cache.set(key, { until: Date.now() + ttl, value });
  void value.then((v) => {
    if (v !== null) remember(key, v);
    else if (cache.get(key)?.value === value) cache.set(key, { until: Date.now() + FAILED_TTL, value });
  });
  return value;
}

/** Real players' scores on a list (one per player), or null when the server can't say. */
export function listStats(id: string, mode: "list" | "blitz"): Promise<CrowdStats | null> {
  return cached(`stats:${mode}:${id}`, STATS_TTL, async () => {
    const { data, error } = await sb().rpc("list_stats", { p_list_id: id, p_mode: mode }, { get: true });
    return error ? null : parseStats(data, mode);
  });
}

/** Every list's real average (one score per player), for the knowledge page. */
export function listAverages(): Promise<ListAverages | null> {
  return cached("averages:list", AVERAGES_TTL, async () => {
    const { data, error } = await sb().rpc("list_averages", { p_mode: "list" }, { get: true });
    return error ? null : parseAverages(data);
  });
}

// ---------- Account ----------

const userOf = (session: Session): AccountUser => accountUser(session.user);

/** Where a sign-in comes back to: this page, without its screen (the session lands on Home). */
function returnTo(): string {
  return `${location.origin}${location.pathname}`;
}

const AUTH_PARAMS = ["code", "error", "error_code", "error_description", "sb_flow_id"];

/** Take the sign-in leftovers (a code, an error) out of the address bar, keeping the screen. */
function cleanUrl(): void {
  const url = new URL(location.href);
  let changed = false;
  for (const p of AUTH_PARAMS) {
    if (url.searchParams.has(p)) {
      url.searchParams.delete(p);
      changed = true;
    }
  }
  // An error can also come back in the fragment, where the game keeps its screens.
  if (/(^#|&)(error|error_description|access_token)=/.test(url.hash)) {
    url.hash = "";
    changed = true;
  }
  if (changed) history.replaceState(history.state, "", url.toString());
}

/** Whether this browser started a sign-in that's waiting for its code (Supabase keeps a PKCE verifier for it). */
function verifierWaiting(): boolean {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith(`${KEYS.auth}-`) && k.endsWith("code-verifier"));
  } catch {
    return false;
  }
}

/** What to tell the player about a sign-in that came back to the page and didn't work. */
function urlNotice(hadVerifier: boolean): string | undefined {
  const url = new URL(location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const err = url.searchParams.get("error_description") ?? hash.get("error_description");
  if (err) return `sign-in failed: ${err.replace(/\+/g, " ").toLowerCase()}.`;
  // Still a code in the address: Supabase couldn't use it. Without a verifier, the link was opened in a different
  // browser from the one that asked for it.
  if (url.searchParams.has("code")) {
    return hadVerifier
      ? "sign-in didn't finish. try again."
      : "that link belongs to the browser you asked for it in. open it there, or use the code from the email.";
  }
  return undefined;
}

let started = false;

/** Start the backend side: send waiting plays, restore or finish a sign-in, and sync. Safe to call twice. */
export async function start(): Promise<void> {
  if (started) return;
  started = true;
  void flushPlays();
  void flushRatings();
  void flushFeedback();
  if (!accountsOn) return;
  try {
    const hadVerifier = verifierWaiting();
    const auth = sb().auth;
    auth.onAuthStateChange((event, session) => {
      // Supabase asks for no awaited calls inside this callback, so react on the next tick.
      setTimeout(() => {
        if (!session) {
          setAccount({ status: "out", user: undefined, sync: "idle", syncedAt: undefined });
          return;
        }
        setAccount({ status: "in", user: userOf(session) });
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION") syncSoon(0);
      }, 0);
    });
    // Waits for Supabase to finish starting up, which includes trading a sign-in code in the URL for a session.
    let { data } = await auth.getSession();
    let notice = urlNotice(hadVerifier);
    cleanUrl();
    // Back from Google in this tab (the popup was blocked, or had no way back to this window): finish that sign-in.
    const google = googleReturn();
    if (google && google.kind !== "cancel") {
      const err = google.kind === "token" ? await signInWithGoogleToken(google.token, google.nonce) : google.message;
      if (err) notice = err;
      else ({ data } = await auth.getSession());
    }
    // A stored session that no longer works (its refresh was refused) ends up signed out here.
    setAccount({ status: data.session ? "in" : "out", user: data.session ? userOf(data.session) : undefined, notice });
  } catch {
    setAccount({ status: "out", user: undefined });
  }
}

export async function signInWithGoogle(): Promise<string | null> {
  try {
    const { error } = await sb().auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnTo() } });
    return error ? "google sign-in isn't working right now. try the email link." : null;
  } catch {
    return "couldn't reach the server. check your connection.";
  }
}

/** A Google sign-in the callback page brought back to this tab (./google), matched with its try; null if none. */
function googleReturn(): GoogleOutcome | null {
  try {
    return takeGoogleReturn(sessionStorage, localStorage, Date.now());
  } catch {
    return null;
  }
}

/**
 * Finish a Google sign-in (./google): Google's ID token, and the nonce it was asked with (unhashed; Supabase hashes
 * it and compares with the token's). The session arrives through onAuthStateChange.
 */
export async function signInWithGoogleToken(token: string, nonce: string): Promise<string | null> {
  try {
    const { error } = await sb().auth.signInWithIdToken({ provider: "google", token, nonce });
    if (!error) return null;
    if (!error.status) return "couldn't reach the server. check your connection.";
    if (error.status === 429) return "too many tries. wait a minute and try again.";
    return "google sign-in didn't work. try again.";
  } catch {
    return "couldn't reach the server. check your connection.";
  }
}

export async function sendEmailLink(email: string): Promise<string | null> {
  try {
    const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: returnTo(), shouldCreateUser: true } });
    if (!error) return null;
    if (error.status === 429) return "too many emails. wait a minute and try again.";
    return "couldn't send the email. check the address.";
  } catch {
    return "couldn't reach the server. check your connection.";
  }
}

export async function verifyEmailCode(email: string, code: string): Promise<string | null> {
  try {
    const { error } = await sb().auth.verifyOtp({ email, token: code, type: "email" });
    return error ? "that code didn't work. check it, or send a new link." : null;
  } catch {
    return "couldn't reach the server. check your connection.";
  }
}

/** The error message for a password sign-in or sign-up the server refused (by its error code). */
export function passwordError(error: { code?: string; status?: number; message?: string }, creating: boolean): string {
  switch (error.code) {
    case "invalid_credentials":
      return "wrong email or password.";
    case "email_not_confirmed":
      return "confirm your email first: the link is in your inbox.";
    case "user_already_exists":
    case "email_exists":
      return "that email already has an account. sign in instead.";
    case "weak_password": {
      // The server names its rule ("Password should be at least 6 characters.").
      const rule = error.message?.trim().replace(/\.?$/, ".").toLowerCase();
      return rule && rule.length < 120 ? rule : "pick a longer password.";
    }
    case "email_address_invalid":
    case "validation_failed":
      return "that doesn't look like an email address.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "new accounts are closed right now.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "too many tries. wait a minute and try again.";
  }
  if (error.status === 429) return "too many tries. wait a minute and try again.";
  return creating ? "couldn't create the account. try again." : "couldn't sign in. try again.";
}

/** Sign in with an email and password. Null when signed in (the session arrives through onAuthStateChange). */
export async function signInWithPassword(email: string, password: string): Promise<string | null> {
  try {
    const { error } = await sb().auth.signInWithPassword({ email, password });
    return error ? passwordError(error, false) : null;
  } catch {
    return "couldn't reach the server. check your connection.";
  }
}

/**
 * Create an account with an email and password. With "Confirm email" off (docs/BACKEND.md) the server signs the
 * player in at once; with it on, it emails a link first and `confirm` says so.
 */
export async function signUpWithPassword(email: string, password: string): Promise<{ error: string | null; confirm: boolean }> {
  try {
    const { data, error } = await sb().auth.signUp({ email, password, options: { emailRedirectTo: returnTo() } });
    if (error) return { error: passwordError(error, true), confirm: false };
    return { error: null, confirm: !data.session };
  } catch {
    return { error: "couldn't reach the server. check your connection.", confirm: false };
  }
}

export async function rename(name: string): Promise<string | null> {
  try {
    const { data, error } = await sb().auth.updateUser({ data: { display_name: name } });
    if (error || !data.user) return "couldn't save the name.";
    setAccount({ user: accountUser(data.user) });
    return null;
  } catch {
    return "couldn't reach the server. check your connection.";
  }
}

/**
 * Sign out of this device. The save is synced first; once the account has it, this device starts fresh, so the next
 * person to sign in here doesn't merge your games into theirs. If the sync can't finish, the games stay here.
 */
export async function signOut(): Promise<void> {
  let synced = false;
  try {
    synced = await Promise.race([syncNow().then(() => getAccount().sync === "synced"), wait(6000).then(() => false)]);
  } catch {
    // Keep the games on this device.
  }
  try {
    await sb().auth.signOut({ scope: "local" });
  } catch {
    // The local session is gone either way.
  }
  setAccount({ status: "out", user: undefined, sync: "idle", syncedAt: undefined });
  if (synced) {
    save({ games: {}, daily: {}, seenHelp: load().seenHelp });
    storage.remove(KEYS.owner);
    bumpSaves();
  }
}

/** The account deletion endpoint (a Vercel function: deleting a sign-in needs the server's secret key). */
const DELETE_URL = "/api/delete-account";

/** Delete the account on the server: its save, its scores and the sign-in itself. This device keeps its games. */
export async function deleteAccount(): Promise<string | null> {
  try {
    const { data } = await sb().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return "you're signed out. sign in again to delete the account.";
    const res = await fetch(new URL(DELETE_URL, location.origin), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return "couldn't delete the account. try again later.";
  } catch {
    return "couldn't reach the server. check your connection.";
  }
  try {
    await sb().auth.signOut({ scope: "local" });
  } catch {
    // Already gone on the server.
  }
  // The games here are this device's again: the next sign-in, whoever's, may take them along.
  const gone = getAccount().user?.id;
  if (gone) storage.remove(KEYS.stash + gone);
  storage.remove(KEYS.owner);
  setAccount({ status: "out", user: undefined, sync: "idle", syncedAt: undefined });
  return null;
}

// ---------- Sync ----------

class Offline extends Error {}

/** Status 0 is a request that never got an answer. */
function fail(status: number, message: string): Error {
  return status === 0 ? new Offline(message) : new Error(message);
}

function remoteFor(userId: string): SaveRemote {
  return {
    async get() {
      const { data, error, status } = await sb().from("saves").select("data, version").eq("user_id", userId).maybeSingle();
      if (error) throw fail(status, error.message);
      return data ? { data: data.data, version: Number(data.version) } : null;
    },
    async put(data, base) {
      if (base === 0) {
        const { data: row, error, status } = await sb().from("saves").insert({ user_id: userId, data, version: 1 }).select("version").single();
        // Another device created it first: merge with theirs.
        if (error?.code === "23505" || status === 409) return false;
        if (error) throw fail(status, error.message);
        return Number(row.version);
      }
      const { data: rows, error, status } = await sb()
        .from("saves")
        .update({ data, version: base + 1 })
        .eq("user_id", userId)
        .eq("version", base)
        .select("version");
      if (error) throw fail(status, error.message);
      return rows?.length ? Number(rows[0].version) : false;
    },
  };
}

const local = {
  read: (): SyncSave => load(),
  write: (s: SyncSave) => save(s),
};

/** localStorage that never throws (private mode, storage blocked). */
const storage = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Not kept.
    }
  },
  remove(k: string): void {
    try {
      localStorage.removeItem(k);
    } catch {
      // Already gone, or never there.
    }
  },
};

/**
 * Before syncing this device with `userId`'s account. If the save here last synced with another account (someone
 * signed out while offline, so their latest games never reached it), set it aside for that account and start this one
 * from its own save: one person's games never end up in another's account. Anything set aside earlier for this
 * account comes back. True if this device's save changed.
 */
export function claimDevice(userId: string, now = Date.now()): boolean {
  let changed = false;
  const owner = storage.get(KEYS.owner);
  if (owner && owner !== userId) {
    let aside: SyncSave = load();
    try {
      // Something already set aside for that account: keep both.
      const earlier = storage.get(KEYS.stash + owner);
      if (earlier) aside = mergeSaves(aside, JSON.parse(earlier), now);
    } catch {
      // A broken stash: keep the newer save alone.
    }
    storage.set(KEYS.stash + owner, JSON.stringify(aside));
    save({ games: {}, daily: {}, seenHelp: load().seenHelp });
    changed = true;
  }
  const stashed = storage.get(KEYS.stash + userId);
  if (stashed) {
    try {
      save(mergeSaves(load(), JSON.parse(stashed), now));
      changed = true;
    } catch {
      // A broken stash is dropped.
    }
    storage.remove(KEYS.stash + userId);
  }
  storage.set(KEYS.owner, userId);
  return changed;
}

let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Sync now (or right after the sync already running). Resolves when done; never rejects. */
export function syncNow(): Promise<void> {
  clearTimeout(timer);
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        const user = getAccount().user;
        if (getAccount().status !== "in" || !user) return;
        setAccount({ sync: "syncing" });
        const claimed = claimDevice(user.id);
        try {
          const out = await syncSave(remoteFor(user.id), local);
          setAccount({ sync: "synced", syncedAt: Date.now() });
          if (out.changedLocal || claimed) bumpSaves();
        } catch (e) {
          if (claimed) bumpSaves();
          setAccount({ sync: e instanceof Offline || !navigator.onLine ? "offline" : "error" });
        }
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Sync in `ms` (collapsing several requests into one). */
export function syncSoon(ms: number): void {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
