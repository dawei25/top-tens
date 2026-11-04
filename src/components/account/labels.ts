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

/** The most of a name Home shows; longer ones end in "...". */
export const HOME_NAME_MAX = 24;

/**
 * The name Home shows for a signed-in player: their display name (the Google name, or one they chose), else the part
 * of the email before the @. Never a whole email address: Home is always on show (and in screenshots), so anything
 * with an @ in it is cut there.
 */
export function homeName(user: Pick<AccountUser, "name" | "email">): string {
  const local = (s: string) => s.split("@")[0].replace(/\s+/g, " ").trim();
  const name = local(user.name ?? "") || local(user.email ?? "") || "player";
  return name.length > HOME_NAME_MAX ? `${name.slice(0, HOME_NAME_MAX - 3).trimEnd()}...` : name;
}

/** The line under Home's account status: what being signed in or out means for the player's games right now. */
export function homeNote(a: Pick<AccountState, "status" | "sync" | "syncedAt" | "notice">, now = Date.now()): string {
  if (a.status === "loading") return "checking your sign-in.";
  if (a.status !== "in") return a.notice ?? "games are saved on this device only.";
  switch (a.sync) {
    case "syncing":
      return "syncing your games.";
    case "synced":
      return a.syncedAt ? `games synced ${ago(a.syncedAt, now)}.` : "games synced.";
    case "offline":
      return "offline. games sync when you're back online.";
    case "error":
      return "couldn't sync. it tries again after your next game.";
    default:
      return "your games sync to this account.";
  }
}
