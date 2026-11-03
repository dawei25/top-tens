import { invalidPlay, playKey, type Play } from "./plays";
import { KEYS } from "./store";

/**
 * Finished games waiting to reach the stats server, kept in localStorage so a game played offline (or a tab closed
 * mid-request) still counts later. Each play is sent once: the server ignores duplicates anyway, and `sent` remembers
 * the recent ones so a reload doesn't even ask.
 */
export interface OutboxData {
  pending: Play[];
  /** playKey of recent plays the server has (or refused for good). */
  sent: string[];
}

/** What became of one send: delivered, worth trying again later (offline, server busy), or never deliverable. */
export type SendResult = "ok" | "retry" | "drop";

export interface OutboxStore {
  read(): OutboxData;
  write(data: OutboxData): void;
}

export const MAX_PENDING = 50;
export const MAX_SENT = 200;
/** Plays this close to the server's one-day limit are dropped rather than sent to be refused. */
export const AGE_MARGIN_MS = 5 * 60 * 1000;

const KEY = KEYS.outbox;

/** The outbox in localStorage; reads come back empty and writes do nothing when storage is unavailable. */
export function localOutboxStore(storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage): OutboxStore {
  return {
    read() {
      try {
        const d = JSON.parse(storage?.getItem(KEY) ?? "null");
        return {
          pending: Array.isArray(d?.pending) ? d.pending : [],
          sent: Array.isArray(d?.sent) ? d.sent.filter((k: unknown) => typeof k === "string") : [],
        };
      } catch {
        return { pending: [], sent: [] };
      }
    },
    write(data) {
      try {
        storage?.setItem(KEY, JSON.stringify(data));
      } catch {
        // Storage full or blocked: the play just won't survive a reload.
      }
    },
  };
}

/** Whether there is anything waiting (cheap enough to check on every page load). */
export function hasPending(store: OutboxStore): boolean {
  return store.read().pending.length > 0;
}

export class Outbox {
  private running: Promise<"done" | "retry"> | null = null;
  private again = false;
  private store: OutboxStore;
  private send: (play: Play) => Promise<SendResult>;
  private now: () => number;

  constructor(store: OutboxStore, send: (play: Play) => Promise<SendResult>, now: () => number = Date.now) {
    this.store = store;
    this.send = send;
    this.now = now;
  }

  /** Queue a finished game. False (and nothing queued) if it's malformed, too old, or already queued or sent. */
  add(play: Play): boolean {
    if (invalidPlay(play, this.now(), AGE_MARGIN_MS)) return false;
    const data = this.store.read();
    const key = playKey(play);
    if (data.sent.includes(key) || data.pending.some((p) => playKey(p) === key)) return false;
    // Over the cap, the oldest waiting play goes first.
    this.store.write({ ...data, pending: [...data.pending, play].slice(-MAX_PENDING) });
    return true;
  }

  /**
   * Send everything waiting, oldest first, one at a time. Stops at the first play that should be retried (offline or
   * a server error) and says so; drops plays the server can never take. Concurrent calls share one run (and a call
   * during a run makes it go round once more, for plays added meanwhile).
   */
  flush(): Promise<"done" | "retry"> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        let result: "done" | "retry";
        do {
          this.again = false;
          result = await this.drain();
        } while (this.again && result === "done");
        return result;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async drain(): Promise<"done" | "retry"> {
    for (;;) {
      const data = this.store.read();
      // Plays that went stale while waiting would only be refused.
      const fresh = data.pending.filter((p) => !invalidPlay(p, this.now(), AGE_MARGIN_MS));
      if (fresh.length !== data.pending.length) this.store.write({ ...data, pending: fresh });
      const next = fresh[0];
      if (!next) return "done";
      let result: SendResult;
      try {
        result = await this.send(next);
      } catch {
        result = "retry";
      }
      if (result === "retry") return "retry";
      // Read again: the page may have queued more while the request was out.
      const after = this.store.read();
      const key = playKey(next);
      // Refused for good counts as sent too, so the same game is never queued again.
      this.store.write({
        pending: after.pending.filter((p) => playKey(p) !== key),
        sent: [...after.sent.filter((k) => k !== key), key].slice(-MAX_SENT),
      });
    }
  }
}

/** Seconds to wait before retry n (1, 2, ...): 15 s doubling to a 10 minute ceiling. */
export function retryDelay(attempt: number): number {
  return Math.min(600, 15 * 2 ** Math.max(0, attempt - 1)) * 1000;
}
