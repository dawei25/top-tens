import { mergeSaves, sameSave, sanitize, type SyncSave } from "./merge";

/** The account's copy of the save on the server, with its version (bumped on every write). */
export interface RemoteSave {
  data: unknown;
  version: number;
}

export interface SaveRemote {
  /** The account's save, or null if it has none yet. */
  get(): Promise<RemoteSave | null>;
  /**
   * Write `data` if the server's copy is still at version `base` (0: there is no copy yet). Returns the new version,
   * or false if someone else wrote first (then the caller merges again).
   */
  put(data: SyncSave, base: number): Promise<number | false>;
}

export interface LocalSave {
  read(): SyncSave;
  write(save: SyncSave): void;
}

export interface SyncOutcome {
  /** This device's save took in something from the server (the screens should redraw). */
  changedLocal: boolean;
  /** The server's copy was updated. */
  pushed: boolean;
  version: number;
}

export class SyncConflict extends Error {
  constructor() {
    super("the save kept changing on the server");
  }
}

/**
 * One sync: fetch the account's save, merge it into this device's, and write the merge back to the server unless the
 * server already has exactly that. Conflicts (another device wrote in between) are settled by merging again, never by
 * overwriting. Between reading this device's save and writing the merge there is no await, so nothing the game saves
 * meanwhile can be lost.
 */
export async function syncSave(remote: SaveRemote, local: LocalSave, now: () => number = Date.now, tries = 4): Promise<SyncOutcome> {
  let changedLocal = false;
  for (let i = 0; i < tries; i++) {
    const server = await remote.get();
    const theirs = server ? sanitize(server.data) : null;
    const mine = local.read();
    const merged = theirs ? mergeSaves(mine, theirs, now()) : sanitize(mine);
    if (!sameSave(merged, mine)) {
      local.write(merged);
      changedLocal = true;
    }
    if (server && theirs && sameSave(merged, theirs)) return { changedLocal, pushed: false, version: server.version };
    const version = await remote.put(merged, server?.version ?? 0);
    if (version !== false) return { changedLocal, pushed: true, version };
  }
  throw new SyncConflict();
}
