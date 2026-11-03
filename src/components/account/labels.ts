import type { AccountState } from "../../net/store";

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
