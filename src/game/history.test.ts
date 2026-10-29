import { describe, expect, it } from "vitest";
import { freshList, recentPlays, recordListRun, MAX_LIST_RUNS } from "./history";
import type { GameState } from "./state";
import type { Saved } from "./storage";

const empty: Saved = { games: {}, daily: {}, seenHelp: true };
const game = (id: string, startedAt: number, finishedAt?: number): GameState => ({
  puzzleId: id, found: [1, 2], lives: 3, log: [], status: finishedAt ? "lost" : "playing", startedAt, finishedAt,
});

describe("play history", () => {
  it("records finished list games once, newest first, capped", () => {
    let s = recordListRun(empty, game("a", 1, 10), 4);
    s = recordListRun(s, game("a", 1, 10));
    s = recordListRun(s, game("b", 20, 30));
    s = recordListRun(s, game("c", 40));
    expect(s.listRuns?.map((r) => r.id)).toEqual(["b", "a"]);
    expect(s.listRuns?.[1]).toMatchObject({ daily: 4, found: [1, 2], lives: 3, status: "lost" });
    for (let i = 0; i < 150; i++) s = recordListRun(s, game("x", 100 + i, 200 + i));
    expect(s.listRuns).toHaveLength(MAX_LIST_RUNS);
  });
  it("merges list games and Blitz rounds by time", () => {
    let s = recordListRun(empty, game("a", 1, 10));
    s = recordListRun(s, game("b", 50, 60));
    s = {
      ...s,
      blitzRuns: { m: [{ startedAt: 20, endedAt: 30, score: 300, hits: [] }] },
      blitzDaily: { "2026-10-29": { id: "m", score: 300, answers: 0 } },
    };
    expect(recentPlays(s).map((p) => `${p.kind}:${p.id}`)).toEqual(["list:b", "blitz:m", "list:a"]);
    expect(recentPlays(s)[1]).toMatchObject({ today: true });
  });
});

describe("fresh start", () => {
  it("clears only that list's saved game and keeps its history", () => {
    const done = game("a", 1, 2);
    const s = recordListRun({ ...empty, games: { a: done, b: game("b", 3) } }, done);
    const fresh = freshList(s, "a");
    expect(fresh.games).toEqual({ b: game("b", 3) });
    expect(fresh.listRuns?.map((r) => r.id)).toEqual(["a"]);
    expect(freshList(fresh, "a")).toBe(fresh);
  });
});
