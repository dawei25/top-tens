import { describe, expect, it } from "vitest";
import type { BlitzState } from "../game/blitz";
import type { GameState } from "../game/state";
import { blitzPlay, clientId, invalidPlay, listPlay, playKey, rpcArgs, uuid, type Play } from "./plays";

const NOW = Date.UTC(2026, 10, 1, 12); // 2026-11-01 12:00 UTC
const ok: Play = { listId: "countries-population", mode: "list", score: 7, found: 7, startedAt: NOW - 60_000, daily: null };

describe("invalidPlay", () => {
  it("accepts a well-formed list game and Blitz round", () => {
    expect(invalidPlay(ok, NOW)).toBeNull();
    expect(invalidPlay({ ...ok, mode: "blitz", score: 742, found: 14 }, NOW)).toBeNull();
    expect(invalidPlay({ ...ok, score: 0, found: 0 }, NOW)).toBeNull();
    expect(invalidPlay({ ...ok, score: 10, found: 10 }, NOW)).toBeNull();
    expect(invalidPlay({ ...ok, mode: "blitz", score: 5000, found: 1000 }, NOW)).toBeNull();
  });

  it("checks the list id's shape", () => {
    for (const listId of ["", "Countries", "with space", "a_b", "x".repeat(65), "dots.no", "ünï"]) {
      expect(invalidPlay({ ...ok, listId }, NOW)).toBe("list id");
    }
    expect(invalidPlay({ ...ok, listId: "x".repeat(64) }, NOW)).toBeNull();
    expect(invalidPlay({ ...ok, listId: "a-1-b" }, NOW)).toBeNull();
  });

  it("checks the mode", () => {
    expect(invalidPlay({ ...ok, mode: "classic" as Play["mode"] }, NOW)).toBe("mode");
  });

  it("keeps list scores to 0-10 and Blitz scores to 0-5000, whole numbers only", () => {
    expect(invalidPlay({ ...ok, score: 11, found: 10 }, NOW)).toBe("score");
    expect(invalidPlay({ ...ok, score: -1 }, NOW)).toBe("score");
    expect(invalidPlay({ ...ok, score: 6.5 }, NOW)).toBe("score");
    expect(invalidPlay({ ...ok, found: 11 }, NOW)).toBe("found");
    expect(invalidPlay({ ...ok, mode: "blitz", score: 5001 }, NOW)).toBe("score");
    expect(invalidPlay({ ...ok, mode: "blitz", score: 300, found: 1001 }, NOW)).toBe("found");
    expect(invalidPlay({ ...ok, score: Number.NaN }, NOW)).toBe("score");
  });

  it("only takes games started within the last day, and not in the future", () => {
    expect(invalidPlay({ ...ok, startedAt: NOW - 24 * 3600_000 + 1000 }, NOW)).toBeNull();
    expect(invalidPlay({ ...ok, startedAt: NOW - 24 * 3600_000 - 1000 }, NOW)).toBe("started at");
    expect(invalidPlay({ ...ok, startedAt: NOW + 60_000 }, NOW)).toBeNull(); // a fast clock
    expect(invalidPlay({ ...ok, startedAt: NOW + 10 * 60_000 }, NOW)).toBe("started at");
    // A margin shrinks the window, for plays that waited in the queue.
    expect(invalidPlay({ ...ok, startedAt: NOW - 24 * 3600_000 + 60_000 }, NOW, 5 * 60_000)).toBe("started at");
  });

  it("only takes a daily date within a day of now (any time zone's today)", () => {
    expect(invalidPlay({ ...ok, daily: "2026-11-01" }, NOW)).toBeNull();
    expect(invalidPlay({ ...ok, daily: "2026-10-31" }, NOW)).toBeNull();
    expect(invalidPlay({ ...ok, daily: "2026-11-02" }, NOW)).toBeNull();
    expect(invalidPlay({ ...ok, daily: "2026-10-30" }, NOW)).toBe("daily date");
    expect(invalidPlay({ ...ok, daily: "2026-11-03" }, NOW)).toBe("daily date");
    expect(invalidPlay({ ...ok, daily: "2026-02-31" }, NOW)).toBe("daily date");
    expect(invalidPlay({ ...ok, daily: "yesterday" }, NOW)).toBe("daily date");
  });
});

const game = (over: Partial<GameState> = {}): GameState => ({
  puzzleId: "mountains",
  found: [1, 2, 5],
  lives: 0,
  log: [],
  status: "lost",
  startedAt: NOW - 120_000,
  finishedAt: NOW - 1000,
  ...over,
});

describe("listPlay and blitzPlay", () => {
  it("turn a finished list game into a play", () => {
    expect(listPlay(game())).toEqual({ listId: "mountains", mode: "list", score: 3, found: 3, startedAt: NOW - 120_000, daily: null });
    expect(listPlay(game({ status: "gave-up" }), "2026-11-01")?.daily).toBe("2026-11-01");
  });

  it("skip games still going and games saved before start times existed", () => {
    expect(listPlay(game({ status: "playing" }))).toBeNull();
    expect(listPlay(game({ startedAt: undefined }))).toBeNull();
  });

  it("score a Blitz round by its points and count its answers", () => {
    const round: BlitzState = {
      puzzleId: "airports",
      startedAt: NOW - 95_000,
      endedAt: NOW - 5000,
      hits: [
        { name: "A", rank: 1, n: 100, points: 100 },
        { name: "B", rank: 14, n: 40, points: 37 },
      ],
    };
    expect(blitzPlay(round)).toEqual({ listId: "airports", mode: "blitz", score: 137, found: 2, startedAt: NOW - 95_000, daily: null });
    expect(blitzPlay({ ...round, endedAt: undefined })).toBeNull();
  });

  it("name a play by mode, list and start, and send it with the client id", () => {
    const p = listPlay(game())!;
    expect(playKey(p)).toBe(`list:mountains:${NOW - 120_000}`);
    expect(rpcArgs(p, "abc")).toEqual({
      p_list_id: "mountains",
      p_mode: "list",
      p_score: 3,
      p_found: 3,
      p_client_id: "abc",
      p_started_at: new Date(NOW - 120_000).toISOString(),
      p_daily_date: null,
    });
  });
});

describe("clientId", () => {
  it("is a random uuid kept under its own key", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const id = clientId(storage);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(clientId(storage)).toBe(id);
    expect([...store.keys()]).toEqual(["top-tens:client-id"]);
  });

  it("replaces a corrupt id and survives storage that throws", () => {
    const store = new Map([["top-tens:client-id", "not-a-uuid"]]);
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(clientId(storage)).not.toBe("not-a-uuid");
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    const a = clientId(broken);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(clientId(broken)).toBe(a);
  });

  it("makes version 4 uuids", () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
