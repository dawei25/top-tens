import type { AccountState } from "../../net/store";

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
