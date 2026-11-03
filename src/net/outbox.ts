import { invalidPlay, playKey, type Play } from "./plays";
import { KEYS } from "./store";

/**
 * Things waiting to reach the server, kept in localStorage so something done offline (or a tab closed mid-request)
 * still arrives later: finished games for the stats, and list ratings. Each is sent once: the server ignores duplicate
 * plays anyway, and `sent` remembers the recent ones so a reload doesn't even ask.
 */
export interface OutboxData<T = Play> {
  pending: T[];
  /** Keys of recent items the server has (or refused for good). */
  sent: string[];
}

/** What became of one send: delivered, worth trying again later (offline, server busy), or never deliverable. */
export type SendResult = "ok" | "retry" | "drop";

export interface OutboxStore<T = Play> {
  read(): OutboxData<T>;
  write(data: OutboxData<T>): void;
}

/** What an outbox holds: how to name an item, why the server would refuse it, and which slot it fills, if any. */
export interface OutboxKind<T> {
  key(item: T): string;
  invalid(item: T, now: number): string | null;
  /** Items in the same slot replace each other: only the latest one waits (a list's rating). */
  slot?(item: T): string;
}

export const MAX_PENDING = 50;
export const MAX_SENT = 200;
/** Plays this close to the server's one-day limit are dropped rather than sent to be refused. */
export const AGE_MARGIN_MS = 5 * 60 * 1000;

/** Finished games: named by list, mode and start; refused when too old (see invalidPlay). */
export const PLAYS: OutboxKind<Play> = { key: playKey, invalid: (p, now) => invalidPlay(p, now, AGE_MARGIN_MS) };

/** The outbox in localStorage (plays by default); reads come back empty and writes do nothing without storage. */
export function localOutboxStore<T = Play>(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage,
  key: string = KEYS.outbox,
): OutboxStore<T> {
  return {
    read() {
      try {
        const d = JSON.parse(storage?.getItem(key) ?? "null");
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
        storage?.setItem(key, JSON.stringify(data));
      } catch {
        // Storage full or blocked: the item just won't survive a reload.
      }
    },
  };
}

/** Whether there is anything waiting (cheap enough to check on every page load). */
export function hasPending<T>(store: OutboxStore<T>): boolean {
  return store.read().pending.length > 0;
}

export class Outbox<T = Play> {
  private running: Promise<"done" | "retry"> | null = null;
  private again = false;
  private store: OutboxStore<T>;
  private send: (item: T) => Promise<SendResult>;
  private now: () => number;
  private kind: OutboxKind<T>;

  constructor(
    store: OutboxStore<T>,
    send: (item: T) => Promise<SendResult>,
    now: () => number = Date.now,
    kind: OutboxKind<T> = PLAYS as unknown as OutboxKind<T>,
  ) {
    this.store = store;
    this.send = send;
    this.now = now;
    this.kind = kind;
  }

  /**
   * Queue an item (a finished game). False (and nothing queued) if it's malformed, too old, or already queued or sent.
   * An item with a slot replaces whatever waits in that slot.
   */
  add(item: T): boolean {
    const { key, invalid, slot } = this.kind;
    if (invalid(item, this.now())) return false;
    const data = this.store.read();
    const k = key(item);
    if (data.sent.includes(k) || data.pending.some((p) => key(p) === k)) return false;
    const rest = slot ? data.pending.filter((p) => slot(p) !== slot(item)) : data.pending;
    // Over the cap, the oldest waiting item goes first.
    this.store.write({ ...data, pending: [...rest, item].slice(-MAX_PENDING) });
    return true;
  }

  /**
   * Send everything waiting, oldest first, one at a time. Stops at the first item that should be retried (offline or
   * a server error) and says so; drops items the server can never take. Concurrent calls share one run (and a call
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
    const { key, invalid } = this.kind;
    for (;;) {
      const data = this.store.read();
      // Plays that went stale while waiting (or anything broken in storage) would only be refused.
      const fresh = data.pending.filter((p) => !invalid(p, this.now()));
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
      const k = key(next);
      // Refused for good counts as sent too, so the same game is never queued again.
      this.store.write({
        pending: after.pending.filter((p) => key(p) !== k),
        sent: [...after.sent.filter((s) => s !== k), k].slice(-MAX_SENT),
      });
    }
  }
}

/** Seconds to wait before retry n (1, 2, ...): 15 s doubling to a 10 minute ceiling. */
export function retryDelay(attempt: number): number {
  return Math.min(600, 15 * 2 ** Math.max(0, attempt - 1)) * 1000;
}
