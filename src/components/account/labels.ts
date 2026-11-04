import type { AccountState, AccountUser } from "../../net/store";

/** A display name as typed, tidied: spaces collapsed, 1 to 24 characters, no control characters. Null if not. */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name || name.length > 24 || /\p{Cc}/u.test(name)) return null;
  return name;
}

/** "synced", "syncing", ...: the account's sync state in a few words. */
export function syncLabel(a: Pick<AccountState, "sync">): string {
  switch (a.sync) {
    case "syncing":
      return "syncing";
    case "synced":
      return "synced";
    case "offline":
      return "offline";
    case "error":
      return "sync failed";
    default:
      return "signed in";
  }
}

/** "just now", "4 min ago", "2 h ago", "Oct 29". */
export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The most of a name Home's account key says; longer ones end in "...". */
export const HOME_NAME_MAX = 24;

/**
 * The name Home's account key gives a signed-in player: their display name (the Google name, or one they chose), else
 * the part of the email before the @. Never a whole email address: Home is always on show (in screenshots, read out by
 * screen readers, in the key's tooltip), so anything with an @ in it is cut there.
 */
export function homeName(user: Pick<AccountUser, "name" | "email">): string {
  const local = (s: string) => s.split("@")[0].replace(/\s+/g, " ").trim();
  const name = local(user.name ?? "") || local(user.email ?? "") || "player";
  return name.length > HOME_NAME_MAX ? `${name.slice(0, HOME_NAME_MAX - 3).trimEnd()}...` : name;
}

/**
 * Whether Home's account key shows its pink dot: something the player should look at. Signed in, the games couldn't
 * sync (offline, or the server refused); signed out, a sign-in came back and didn't finish (the sign-in sheet says why).
 */
export function accountAlert(a: Pick<AccountState, "status" | "sync" | "notice">): boolean {
  if (a.status === "in") return a.sync === "offline" || a.sync === "error";
  return a.status === "out" && !!a.notice;
}

/**
 * Home's account key in words, its accessible name and its title: "Account: not signed in", "Account: signed in as
 * Dana", and what its pink dot means when it shows. Never an email address (homeName), and never the notice itself
 * (it can carry what a server said): the sheet the key opens says the rest.
 */
export function accountKeyLabel(a: Pick<AccountState, "status" | "user" | "sync" | "notice">): string {
  if (a.status === "loading") return "Account: signing in";
  if (a.status !== "in" || !a.user) return `Account: not signed in${a.notice ? ", sign-in didn't finish" : ""}`;
  const trouble = a.sync === "offline" ? ", offline" : a.sync === "error" ? ", couldn't sync" : "";
  return `Account: signed in as ${homeName(a.user)}${trouble}`;
}
