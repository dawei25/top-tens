import { describe, expect, it } from "vitest";
import { firstBlitzRuns, recordBlitz, type BlitzState } from "./blitz";
import { firstListRuns, freshList, lastPlayed, recentPlays, recordListRun, MAX_LIST_RUNS } from "./history";
import { pickRandom } from "./puzzles";
import type { GameState } from "./state";
import { stats, withFirstTries, type Saved } from "./storage";

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

describe("random rolls prefer unplayed lists", () => {
  const ids = Array.from({ length: 70 }, (_, i) => `l${i}`);
  it("never repeats a played list while unplayed ones remain", () => {
    const played = new Map<string, number>();
    for (let i = 0; i < 70; i++) {
      const id = pickRandom(ids, `test-${i % 3}`, Math.random, played)!;
      expect(played.has(id)).toBe(false);
      played.set(id, i);
    }
    // Everything played: the pick comes from the least recently played half.
    for (let i = 0; i < 20; i++) expect(played.get(pickRandom(ids, "test-all", Math.random, played)!)!).toBeLessThan(35);
  });
  it("reads last plays per mode from the save", () => {
    const saved: Saved = {
      games: {},
      daily: {},
      seenHelp: true,
      listRuns: [{ id: "a", startedAt: 1, finishedAt: 5, status: "lost", found: [], lives: 0, hints: 0 }],
      blitzRuns: { b: [{ startedAt: 1, endedAt: 9, score: 3, hits: [] }] },
    };
    expect([...lastPlayed(saved, "list")]).toEqual([["a", 5]]);
    expect([...lastPlayed(saved, "blitz")]).toEqual([["b", 9]]);
  });
});

describe("first tries", () => {
  const won = (id: string, startedAt: number, n: number): GameState => ({
    puzzleId: id, found: Array.from({ length: n }, (_, i) => i + 1), lives: 2, log: [], status: "lost", startedAt, finishedAt: startedAt + 5,
  });
  it("a list's first finished game stays its first try, and stats count only first tries", () => {
    let s = recordListRun(empty, won("a", 1, 3));
    s = recordListRun(s, won("a", 100, 10)); // a replay that aced it
    s = recordListRun(s, won("b", 50, 6));
    expect(firstListRuns(s).map((r) => [r.id, r.found.length])).toEqual([["a", 3], ["b", 6]]);
    expect(stats({ ...s, games: { a: won("a", 100, 10), b: won("b", 50, 6) } })).toMatchObject({ played: 2, perfect: 0, avgFound: 4.5 });
  });
  it("older saves get first tries from their oldest run, a locked daily or the list's own game", () => {
    const s: Saved = {
      ...empty,
      games: { c: won("c", 300, 9), d: { ...won("d", 0, 4), startedAt: undefined, finishedAt: undefined } },
      dailyGames: { "2026-10-20": won("c", 200, 2) },
      listRuns: [
        { id: "a", startedAt: 90, finishedAt: 95, status: "lost", found: [1], lives: 0, hints: 0 },
        { id: "a", startedAt: 10, finishedAt: 15, status: "lost", found: [1, 2], lives: 0, hints: 0 },
      ],
      blitzRuns: { m: [{ startedAt: 70, endedAt: 160, score: 900, hits: [] }, { startedAt: 30, endedAt: 120, score: 400, hits: [] }] },
    };
    const f = withFirstTries(s).firstTries!;
    expect(f.list?.a.startedAt).toBe(10);
    expect(f.list?.c.found).toHaveLength(2); // the daily came before the free replay
    expect(f.list?.d.found).toHaveLength(4); // an untimed old game still counts
    expect(f.blitz?.m.score).toBe(400);
    // Recorded first tries are never replaced.
    expect(withFirstTries({ ...s, firstTries: { list: { a: { ...s.listRuns![0] } } } }).firstTries?.list?.a.startedAt).toBe(90);
  });
  it("a Blitz list's first round stays its first try", () => {
    const state = (startedAt: number, points: number): BlitzState => ({
      puzzleId: "m",
      startedAt,
      endedAt: startedAt + 90_000,
      hits: [{ points } as BlitzState["hits"][number]],
    });
    let s = recordBlitz(empty, "m", state(1, 100)).saved;
    s = recordBlitz(s, "m", state(200_000, 900)).saved;
    expect(firstBlitzRuns(s)).toEqual([["m", expect.objectContaining({ startedAt: 1 })]]);
    expect(s.blitzBest?.m).toBeGreaterThan(s.firstTries!.blitz!.m.score);
  });
});
