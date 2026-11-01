import { describe, expect, it } from "vitest";
import { localOutboxStore, MAX_PENDING, MAX_SENT, Outbox, retryDelay, type OutboxData, type SendResult } from "./outbox";
import type { Play } from "./plays";

const NOW = Date.UTC(2026, 10, 1, 12);

function memoryStore(initial: OutboxData = { pending: [], sent: [] }) {
  let data = structuredClone(initial);
  return {
    read: () => structuredClone(data),
    write: (d: OutboxData) => void (data = structuredClone(d)),
    get data() {
      return data;
    },
  };
}

const play = (i: number, over: Partial<Play> = {}): Play => ({
  listId: "airports",
  mode: "list",
  score: 5,
  found: 5,
  startedAt: NOW - 60_000 * (i + 1),
  daily: null,
  ...over,
});

/** A server that answers from a script, recording what it got. */
function server(answers: SendResult[] = []) {
  const got: Play[] = [];
  return {
    got,
    send: async (p: Play): Promise<SendResult> => {
      got.push(p);
      return answers.shift() ?? "ok";
    },
  };
}

describe("Outbox", () => {
  it("sends a finished game once, then remembers it", async () => {
    const store = memoryStore();
    const srv = server();
    const box = new Outbox(store, srv.send, () => NOW);
    expect(box.add(play(0))).toBe(true);
    expect(await box.flush()).toBe("done");
    expect(srv.got).toHaveLength(1);
    expect(store.data.pending).toEqual([]);
    // The same game again (a reload of the results) is not queued or sent.
    expect(box.add(play(0))).toBe(false);
    await box.flush();
    expect(srv.got).toHaveLength(1);
  });

  it("refuses malformed and stale plays without storing them", () => {
    const store = memoryStore();
    const box = new Outbox(store, server().send, () => NOW);
    expect(box.add(play(0, { listId: "Bad Id" }))).toBe(false);
    expect(box.add(play(0, { score: 12 }))).toBe(false);
    expect(box.add(play(0, { startedAt: NOW - 25 * 3600_000 }))).toBe(false);
    expect(store.data.pending).toEqual([]);
  });

  it("keeps plays while offline and sends them, in order, once back", async () => {
    const store = memoryStore();
    const srv = server(["retry"]);
    let now = NOW;
    const box = new Outbox(store, srv.send, () => now);
    box.add(play(2));
    box.add(play(1));
    expect(await box.flush()).toBe("retry");
    expect(store.data.pending).toHaveLength(2);
    // A thrown error (fetch failed) is a retry too.
    const failing = new Outbox(store, async () => {
      throw new TypeError("Failed to fetch");
    }, () => now);
    expect(await failing.flush()).toBe("retry");
    expect(store.data.pending).toHaveLength(2);

    now += 60_000;
    expect(await box.flush()).toBe("done");
    expect(srv.got.map((p) => p.startedAt)).toEqual([play(2).startedAt, play(2).startedAt, play(1).startedAt]);
    expect(store.data.pending).toEqual([]);
    expect(store.data.sent).toHaveLength(2);
  });

  it("drops a play the server refuses for good, and moves on", async () => {
    const store = memoryStore();
    const srv = server(["drop", "ok"]);
    const box = new Outbox(store, srv.send, () => NOW);
    box.add(play(1));
    box.add(play(0));
    expect(await box.flush()).toBe("done");
    expect(srv.got).toHaveLength(2);
    expect(store.data.pending).toEqual([]);
    // Refused plays aren't queued again either.
    expect(box.add(play(1))).toBe(false);
  });

  it("drops plays that went stale while waiting instead of sending them", async () => {
    const store = memoryStore();
    const srv = server();
    let now = NOW;
    const box = new Outbox(store, srv.send, () => now);
    box.add(play(0));
    now += 24 * 3600_000;
    expect(await box.flush()).toBe("done");
    expect(srv.got).toEqual([]);
    expect(store.data.pending).toEqual([]);
  });

  it("shares one run between overlapping flushes, and picks up plays added mid-run", async () => {
    const store = memoryStore();
    const got: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const box = new Outbox(store, async (p) => {
      got.push(p.startedAt);
      await gate;
      return "ok";
    }, () => NOW);
    box.add(play(1));
    const a = box.flush();
    const b = box.flush();
    expect(a).toBe(b);
    box.add(play(0));
    release();
    await a;
    expect(got).toEqual([play(1).startedAt, play(0).startedAt]);
    expect(store.data.pending).toEqual([]);
  });

  it("caps the queue (oldest out) and the memory of sent plays", async () => {
    const store = memoryStore();
    const box = new Outbox(store, server().send, () => NOW);
    for (let i = MAX_PENDING + 5; i > 0; i--) box.add(play(i));
    expect(store.data.pending).toHaveLength(MAX_PENDING);
    expect(store.data.pending[0].startedAt).toBe(play(MAX_PENDING).startedAt);

    const sent = memoryStore({ pending: [], sent: Array.from({ length: MAX_SENT }, (_, i) => `x:${i}`) });
    const box2 = new Outbox(sent, server().send, () => NOW);
    box2.add(play(0));
    await box2.flush();
    expect(sent.data.sent).toHaveLength(MAX_SENT);
    expect(sent.data.sent.at(-1)).toBe(`list:airports:${play(0).startedAt}`);
  });

  it("backs off from 15 s to at most 10 minutes", () => {
    expect([1, 2, 3, 4, 7, 20].map(retryDelay)).toEqual([15_000, 30_000, 60_000, 120_000, 600_000, 600_000]);
  });
});

describe("localOutboxStore", () => {
  it("reads garbage as empty and survives storage that throws", () => {
    const map = new Map([["top-tens:outbox", "{not json"]]);
    const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
    expect(localOutboxStore(storage).read()).toEqual({ pending: [], sent: [] });
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    const store = localOutboxStore(throwing);
    expect(store.read()).toEqual({ pending: [], sent: [] });
    expect(() => store.write({ pending: [], sent: [] })).not.toThrow();
  });
});
