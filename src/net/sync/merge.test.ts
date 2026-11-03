import { describe, expect, it } from "vitest";
import { BLITZ_SECONDS, MAX_BLITZ_RUNS, type BlitzRun, type BlitzState } from "../../game/blitz";
import { MAX_LIST_RUNS, type ListRun } from "../../game/history";
import type { GameState } from "../../game/state";
import { stats, withFirstTries } from "../../game/storage";
import { mergeSaves, pickGame, pruneBefore, retireLive, sameSave, sanitize, stableJson, type SyncSave } from "./merge";

const T = Date.UTC(2026, 10, 1, 12); // 2026-11-01 12:00 UTC
const MIN = 60_000;
const NOW = T + 600 * MIN;

const game = (puzzleId: string, startedAt: number | undefined, status: GameState["status"] = "lost", extra: Partial<GameState> = {}): GameState => ({
  puzzleId,
  found: [1, 2],
  lives: status === "playing" ? 3 : 0,
  log: [],
  status,
  ...(startedAt !== undefined ? { startedAt } : {}),
  ...(status !== "playing" && startedAt !== undefined ? { finishedAt: startedAt + 5 * MIN } : {}),
  ...extra,
});
const listRun = (id: string, startedAt: number, found = 3, finishedAt = startedAt + 5 * MIN): ListRun => ({
  id,
  startedAt,
  finishedAt,
  status: "lost",
  found: Array.from({ length: found }, (_, i) => i + 1),
  lives: 0,
  hints: 0,
});
const hit = (name: string, points: number) => ({ name, rank: 1, n: 10, points });
const blitzRun = (startedAt: number, score: number, hits = 1): BlitzRun => ({
  startedAt,
  endedAt: startedAt + BLITZ_SECONDS * 1000,
  score,
  hits: Array.from({ length: hits }, (_, i) => hit(`h${i}`, i === 0 ? score - (hits - 1) * 10 : 10)),
});
const live = (puzzleId: string, startedAt: number, hits: number): BlitzState => ({
  puzzleId,
  startedAt,
  hits: Array.from({ length: hits }, (_, i) => hit(`h${i}`, 20)),
});
const empty = (): SyncSave => ({ games: {}, daily: {}, seenHelp: false });
const save = (s: Partial<SyncSave>): SyncSave => ({ ...empty(), ...s });
/** A save as the game loads it: first tries filled in from its history. */
const loaded = (s: Partial<SyncSave>): SyncSave => withFirstTries(save(s));

describe("mergeSaves: basics", () => {
  it("merges two empty saves into an empty save", () => {
    expect(mergeSaves(empty(), empty(), NOW)).toEqual(empty());
  });

  it("takes a side as it is when the other is empty", () => {
    const a = loaded({
      games: { mountains: game("mountains", T) },
      daily: { "2026-11-01": "mountains" },
      seenHelp: true,
      listRuns: [listRun("mountains", T)],
      blitzRuns: { airports: [blitzRun(T, 300)] },
      blitzBest: { airports: 300 },
    });
    expect(a.firstTries).toEqual({ list: { mountains: listRun("mountains", T) }, blitz: { airports: blitzRun(T, 300) } });
    expect(mergeSaves(a, empty(), NOW)).toEqual(a);
    expect(mergeSaves(empty(), a, NOW)).toEqual(a);
  });

  it("reads garbage from the server as nothing, and drops malformed entries", () => {
    const a = loaded({ listRuns: [listRun("mountains", T)] });
    for (const bad of [null, undefined, "x", 42, [], { games: "no", daily: 3, listRuns: {} }]) {
      expect(mergeSaves(a, bad, NOW)).toEqual(a);
    }
    const remote = {
      games: { ok: game("ok", T), broken: { puzzleId: 5 } },
      listRuns: [listRun("islands", T), { id: "x" }, null],
      blitzRuns: { airports: [blitzRun(T, 100), { score: "a lot" }], nope: "x" },
      daily: { "2026-11-01": "islands", junk: "x", "2026-10-31": 5 },
    };
    const m = mergeSaves(empty(), remote, NOW);
    expect(Object.keys(m.games)).toEqual(["ok"]);
    expect(m.listRuns).toEqual([listRun("islands", T)]);
    expect(m.blitzRuns).toEqual({ airports: [blitzRun(T, 100)] });
    expect(m.daily).toEqual({ "2026-11-01": "islands" });
  });

  it("keeps fields it doesn't know (from a newer game), the server's value where both have one", () => {
    // This version can't have changed a field it doesn't know, so the server's copy is the newer one.
    const m = mergeSaves({ ...empty(), future: 1, mine: "a" }, { ...empty(), future: 2, theirs: "b" }, NOW);
    expect(m).toMatchObject({ future: 2, mine: "a", theirs: "b" });
  });

  it("keeps seenHelp if either side has it", () => {
    expect(mergeSaves(save({ seenHelp: true }), empty(), NOW).seenHelp).toBe(true);
    expect(mergeSaves(empty(), save({ seenHelp: true }), NOW).seenHelp).toBe(true);
    expect(mergeSaves(empty(), empty(), NOW).seenHelp).toBe(false);
  });

  it("doesn't invent fields neither side has", () => {
    const m = mergeSaves(empty(), save({ seenHelp: true }), NOW);
    expect(Object.keys(m).sort()).toEqual(["daily", "games", "seenHelp"]);
  });
});

describe("mergeSaves: list runs", () => {
  it("unions runs by list and start, newest first", () => {
    const a = save({ listRuns: [listRun("b", T + 20 * MIN), listRun("a", T)] });
    const b = save({ listRuns: [listRun("c", T + 10 * MIN), listRun("a", T)] });
    const m = mergeSaves(a, b, NOW);
    expect(m.listRuns!.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps the first finish when the same game finished on both devices", () => {
    const early = listRun("a", T, 3, T + 5 * MIN);
    const late = listRun("a", T, 8, T + 30 * MIN);
    expect(mergeSaves(save({ listRuns: [late] }), save({ listRuns: [early] }), NOW).listRuns).toEqual([early]);
    expect(mergeSaves(save({ listRuns: [early] }), save({ listRuns: [late] }), NOW).listRuns).toEqual([early]);
  });

  it("caps the history like the game does, keeping the newest", () => {
    const a = save({ listRuns: Array.from({ length: MAX_LIST_RUNS }, (_, i) => listRun("a", T + (2 * i + 1) * MIN)).reverse() });
    const b = save({ listRuns: Array.from({ length: MAX_LIST_RUNS }, (_, i) => listRun("b", T + 2 * i * MIN)).reverse() });
    const m = mergeSaves(a, b, NOW);
    expect(m.listRuns).toHaveLength(MAX_LIST_RUNS);
    expect(m.listRuns![0].startedAt).toBe(T + (2 * MAX_LIST_RUNS - 1) * MIN);
    expect(m.listRuns!.at(-1)!.startedAt).toBe(T + MAX_LIST_RUNS * MIN);
  });
});

describe("mergeSaves: Blitz", () => {
  it("unions rounds per list by start, newest first, and keeps the best", () => {
    const a = save({ blitzRuns: { x: [blitzRun(T + 10 * MIN, 200), blitzRun(T, 100)] }, blitzBest: { x: 200 } });
    const b = save({ blitzRuns: { x: [blitzRun(T + 5 * MIN, 400), blitzRun(T, 100)], y: [blitzRun(T, 50)] }, blitzBest: { x: 400, y: 50 } });
    const m = mergeSaves(a, b, NOW);
    expect(m.blitzRuns!.x.map((r) => r.score)).toEqual([200, 400, 100]);
    expect(m.blitzRuns!.y).toHaveLength(1);
    expect(m.blitzBest).toEqual({ x: 400, y: 50 });
  });

  it("keeps the more complete copy of the same round", () => {
    const short = blitzRun(T, 120, 2);
    const full = blitzRun(T, 160, 4);
    expect(mergeSaves(save({ blitzRuns: { x: [short] } }), save({ blitzRuns: { x: [full] } }), NOW).blitzRuns!.x).toEqual([full]);
    expect(mergeSaves(save({ blitzRuns: { x: [full] } }), save({ blitzRuns: { x: [short] } }), NOW).blitzRuns!.x).toEqual([full]);
  });

  it("caps rounds per list like the game does", () => {
    const a = save({ blitzRuns: { x: Array.from({ length: MAX_BLITZ_RUNS }, (_, i) => blitzRun(T + 2 * i * MIN, i)).reverse() } });
    const b = save({ blitzRuns: { x: Array.from({ length: MAX_BLITZ_RUNS }, (_, i) => blitzRun(T + (2 * i + 1) * MIN, i)).reverse() } });
    const m = mergeSaves(a, b, NOW);
    expect(m.blitzRuns!.x).toHaveLength(MAX_BLITZ_RUNS);
    expect(m.blitzRuns!.x[0].startedAt).toBe(T + (2 * MAX_BLITZ_RUNS - 1) * MIN);
  });

  it("keeps the first round of a date's Blitz (one round per date)", () => {
    const first = { id: "x", score: 300, answers: 5, startedAt: T };
    const second = { id: "x", score: 900, answers: 12, startedAt: T + 60 * MIN };
    const late = { id: "x", score: 50, answers: 1, startedAt: T + 26 * 60 * MIN, late: true };
    expect(mergeSaves(save({ blitzDaily: { d: second } }), save({ blitzDaily: { d: first } }), NOW).blitzDaily).toEqual({ d: first });
    expect(mergeSaves(save({ blitzDaily: { d: first } }), save({ blitzDaily: { d: late } }), NOW).blitzDaily).toEqual({ d: first });
    // Old results have no start time: they're older than anything that has one.
    const old = { id: "x", score: 10, answers: 1 };
    expect(mergeSaves(save({ blitzDaily: { d: first } }), save({ blitzDaily: { d: old } }), NOW).blitzDaily).toEqual({ d: old });
    // Different dates simply add up.
    expect(Object.keys(mergeSaves(save({ blitzDaily: { a: first } }), save({ blitzDaily: { b: second } }), NOW).blitzDaily!)).toEqual(["b", "a"]);
  });

  describe("rounds in progress", () => {
    it("keeps the further-along copy of the same round", () => {
      const m = mergeSaves(save({ blitzLive: { x: live("x", NOW - 30_000, 2) } }), save({ blitzLive: { x: live("x", NOW - 30_000, 5) } }), NOW);
      expect(m.blitzLive!.x.hits).toHaveLength(5);
    });

    it("keeps the newer round and files the older one, whose time is up, as a run", () => {
      const old = live("x", NOW - 10 * MIN, 3);
      const fresh = live("x", NOW - 20_000, 1);
      const m = mergeSaves(save({ blitzLive: { x: fresh } }), save({ blitzLive: { x: old }, blitzBest: { x: 10 } }), NOW);
      expect(m.blitzLive).toEqual({ x: fresh });
      expect(m.blitzRuns!.x).toEqual([{ startedAt: old.startedAt, endedAt: old.startedAt! + BLITZ_SECONDS * 1000, score: 60, hits: old.hits }]);
      expect(m.blitzBest!.x).toBe(60);
    });

    it("drops an older round that may still be running elsewhere (its own device will file it)", () => {
      const older = live("x", NOW - 30_000, 3);
      const newer = live("x", NOW - 10_000, 1);
      const m = mergeSaves(save({ blitzLive: { x: older } }), save({ blitzLive: { x: newer } }), NOW);
      expect(m.blitzLive).toEqual({ x: newer });
      expect(m.blitzRuns).toBeUndefined();
    });

    it("forgets a round in progress once it's in the history", () => {
      const round = live("x", T, 2);
      const m = mergeSaves(save({ blitzLive: { x: round } }), save({ blitzRuns: { x: [blitzRun(T, 40, 2)] }, blitzLive: {} }), NOW);
      expect(m.blitzLive).toEqual({});
      expect(m.blitzRuns!.x).toHaveLength(1);
    });
  });

  it("files a retired round as a run even with no runs or bests on either side", () => {
    expect(retireLive(live("x", NOW - 10_000, 1), NOW)).toBeNull();
    const r = retireLive(live("x", NOW - 2 * MIN, 2), NOW);
    expect(r).toMatchObject({ score: 40, endedAt: NOW - 2 * MIN + BLITZ_SECONDS * 1000 });
  });
});

describe("mergeSaves: games and dailies", () => {
  it("prefers a finished game over the same game in progress, either way round", () => {
    const playing = game("m", T, "playing", { log: [{ text: "a", result: { kind: "unknown", junk: true } }] });
    const done = game("m", T, "won");
    expect(mergeSaves(save({ games: { m: playing } }), save({ games: { m: done } }), NOW).games.m).toEqual(done);
    expect(mergeSaves(save({ games: { m: done } }), save({ games: { m: playing } }), NOW).games.m).toEqual(done);
  });

  it("keeps the further-along copy of a game in progress", () => {
    const one = game("m", T, "playing", { log: [{ text: "a", result: { kind: "unknown", junk: true } }] });
    const two = game("m", T, "playing", { log: [...one.log, { text: "b", result: { kind: "unknown", junk: true } }] });
    expect(pickGame(one, two)).toBe(two);
    expect(pickGame(two, one)).toBe(two);
  });

  it("keeps the first finish of a game finished on both devices", () => {
    const early = game("m", T, "lost", { finishedAt: T + MIN });
    const late = game("m", T, "won", { finishedAt: T + 9 * MIN });
    expect(pickGame(late, early)).toBe(early);
    expect(pickGame(early, late)).toBe(early);
  });

  it("keeps the newer of two different games on a list (the older one's result is in the history)", () => {
    const older = game("m", T, "won");
    const newer = game("m", T + 60 * MIN, "playing");
    const a = save({ games: { m: older }, listRuns: [listRun("m", T)] });
    const b = save({ games: { m: newer } });
    const m = mergeSaves(a, b, NOW);
    expect(m.games.m).toEqual(newer);
    expect(m.listRuns).toEqual([listRun("m", T)]);
    // A game from before start times existed is older than any game with one.
    expect(pickGame(game("m", undefined, "won"), newer)).toBe(newer);
  });

  it("keeps a daily finished on either side finished (one try)", () => {
    const done = game("islands", T, "lost");
    const m = mergeSaves(save({ games: { islands: game("islands", T + MIN, "playing") } }), save({ dailyGames: { "2026-11-01": done } }), NOW);
    expect(m.dailyGames).toEqual({ "2026-11-01": done });
  });

  it("keeps the first finished daily when both devices played the same date", () => {
    const first = game("islands", T, "lost", { finishedAt: T + 4 * MIN, found: [1] });
    const second = game("islands", T + 30 * MIN, "won", { finishedAt: T + 40 * MIN, found: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    const m = mergeSaves(save({ dailyGames: { d: second } }), save({ dailyGames: { d: first } }), NOW);
    expect(m.dailyGames).toEqual({ d: first });
  });

  it("unions streak days", () => {
    const m = mergeSaves(save({ daily: { "2026-10-30": "a", "2026-10-31": "b" } }), save({ daily: { "2026-10-31": "b", "2026-11-01": "c" } }), NOW);
    expect(m.daily).toEqual({ "2026-10-30": "a", "2026-10-31": "b", "2026-11-01": "c" });
  });
});

describe("mergeSaves: first tries (what stats count)", () => {
  it("keeps each list's earliest first try, whichever device has it", () => {
    const first = listRun("x", T, 3);
    const later = listRun("x", T + 60 * MIN, 9);
    const a = loaded({ listRuns: [first] });
    const b = loaded({ listRuns: [later] });
    for (const m of [mergeSaves(a, b, NOW), mergeSaves(b, a, NOW)]) {
      expect(m.firstTries!.list).toEqual({ x: first });
      // Stats count the first try only: playing the list again on the other device didn't lift them.
      expect(stats(m)).toMatchObject({ played: 1, avgFound: 3 });
    }
  });

  it("never replaces a first try with a later one, even once the history has dropped the first", () => {
    // The history is capped; the first try outlives it.
    const first = listRun("x", T - 600 * MIN, 1);
    const a = save({ listRuns: [listRun("x", T + 5 * MIN, 10)], firstTries: { list: { x: first } } });
    const b = loaded({ listRuns: [listRun("x", T, 7)] });
    expect(mergeSaves(a, b, NOW).firstTries!.list).toEqual({ x: first });
    expect(mergeSaves(b, a, NOW).firstTries!.list).toEqual({ x: first });
  });

  it("counts the oldest game of a copy without first tries (an older build)", () => {
    const old = save({ listRuns: [listRun("x", T - 60 * MIN, 2), listRun("x", T - 30 * MIN, 8)], games: { y: game("y", T - 90 * MIN, "won") } });
    const mine = loaded({ listRuns: [listRun("x", T, 5)] });
    const m = mergeSaves(mine, old, NOW);
    expect(m.firstTries!.list!.x).toEqual(listRun("x", T - 60 * MIN, 2));
    expect(m.firstTries!.list!.y).toMatchObject({ id: "y", startedAt: T - 90 * MIN, status: "won" });
  });

  it("keeps each list's first Blitz round, the fuller copy of the same round", () => {
    const first = blitzRun(T, 100);
    const a = loaded({ blitzRuns: { x: [first] } });
    const b = loaded({ blitzRuns: { x: [blitzRun(T + 10 * MIN, 900)], y: [blitzRun(T, 50)] } });
    expect(mergeSaves(a, b, NOW).firstTries!.blitz).toEqual({ x: first, y: blitzRun(T, 50) });
    expect(mergeSaves(b, a, NOW).firstTries!.blitz).toEqual({ x: first, y: blitzRun(T, 50) });
    const short = blitzRun(T, 120, 2);
    const full = blitzRun(T, 160, 4);
    expect(mergeSaves(loaded({ blitzRuns: { x: [short] } }), loaded({ blitzRuns: { x: [full] } }), NOW).firstTries!.blitz).toEqual({ x: full });
  });

  it("keeps the first finish when the same first game finished on both devices, as the history does", () => {
    const early = listRun("x", T, 3, T + 5 * MIN);
    const late = listRun("x", T, 8, T + 30 * MIN);
    const m = mergeSaves(loaded({ listRuns: [late] }), loaded({ listRuns: [early] }), NOW);
    expect(m.firstTries!.list).toEqual({ x: early });
    expect(m.listRuns).toEqual([early]);
  });

  it("files a retired round as a list's first Blitz round when it has none", () => {
    const old = live("x", NOW - 10 * MIN, 3);
    const m = mergeSaves(save({ blitzLive: { x: live("x", NOW - 20_000, 1) } }), save({ blitzLive: { x: old } }), NOW);
    expect(m.firstTries!.blitz!.x.startedAt).toBe(old.startedAt);
    expect(sameSave(mergeSaves(m, m, NOW), m)).toBe(true);
  });

  it("drops malformed first tries and fills them in from the history", () => {
    const remote = {
      ...empty(),
      listRuns: [listRun("x", T)],
      firstTries: { list: { x: listRun("other", T - MIN), y: { id: "y" } }, blitz: { z: { score: "lots" } } },
    };
    const m = mergeSaves(empty(), remote, NOW);
    expect(m.firstTries).toEqual({ list: { x: listRun("x", T) }, blitz: {} });
  });
});

describe("mergeSaves: a reset made while signed in", () => {
  const before = T - 60 * MIN;
  const after = T + 60 * MIN;
  const stale = save({
    games: { a: game("a", before), b: game("b", after) },
    daily: { "2026-10-31": "a", "2026-11-01": "x" },
    seenHelp: true,
    listRuns: [listRun("b", after), listRun("a", before)],
    blitzRuns: { x: [blitzRun(after, 100), blitzRun(before, 900)], y: [blitzRun(before, 50)] },
    blitzBest: { x: 900, y: 50 },
    blitzDaily: { "2026-10-31": { id: "x", score: 900, answers: 9, startedAt: before }, old: { id: "y", score: 1, answers: 1 } },
    dailyGames: { "2026-10-31": game("a", before), "2026-11-02": game("q", after) },
    blitzLive: { z: live("z", before, 1) },
    firstTries: { list: { a: listRun("a", before) }, blitz: { x: blitzRun(before, 900), y: blitzRun(before, 50) } },
  });

  it("drops everything from before it, on whichever side", () => {
    const reset = save({ resetAt: T, seenHelp: true });
    for (const m of [mergeSaves(reset, stale, NOW), mergeSaves(stale, reset, NOW)]) {
      expect(m.resetAt).toBe(T);
      expect(Object.keys(m.games)).toEqual(["b"]);
      expect(m.listRuns!.map((r) => r.id)).toEqual(["b"]);
      expect(m.blitzRuns).toEqual({ x: [blitzRun(after, 100)] });
      expect(m.blitzBest).toEqual({ x: 100 });
      expect(m.blitzDaily).toEqual({});
      expect(m.dailyGames).toEqual({ "2026-11-02": game("q", after) });
      expect(m.blitzLive).toEqual({});
      expect(m.seenHelp).toBe(true);
      // First tries from before the reset go too; a list played after it starts counting again.
      expect(m.firstTries!.list!.b).toEqual(listRun("b", after));
      expect(Object.keys(m.firstTries!.list!).sort()).toEqual(["b", "q"]);
      expect(m.firstTries!.blitz).toEqual({ x: blitzRun(after, 100) });
    }
  });

  it("keeps a streak day only if its daily was finished after the reset, or it's after the reset's day", () => {
    const m = mergeSaves(save({ resetAt: T }), stale, NOW);
    // 2026-11-01 is the reset's own day and its daily wasn't finished after it; 2026-10-31 is before.
    expect(m.daily).toEqual({});
    const kept = pruneBefore(save({ daily: { "2026-11-01": "q", "2026-11-03": "r" }, dailyGames: { "2026-11-01": game("q", after) } }), T);
    expect(kept.daily).toEqual({ "2026-11-01": "q", "2026-11-03": "r" });
  });

  it("stays in force: an old device syncing much later can't bring the old games back", () => {
    const account = mergeSaves(save({ resetAt: T }), stale, NOW);
    const again = mergeSaves(stale, account, NOW + 1000 * MIN);
    expect(sameSave(again, account)).toBe(true);
  });

  it("the newer of two resets wins", () => {
    expect(mergeSaves(save({ resetAt: T }), save({ resetAt: T + 5 }), NOW).resetAt).toBe(T + 5);
  });
});

/** A small deterministic random generator, so the property tests are reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function randomSave(rand: () => number): SyncSave {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const ids = ["a", "b", "c", "d"];
  const s = save({ seenHelp: rand() < 0.5 });
  for (const id of ids) {
    if (rand() < 0.6) {
      const at = T + Math.floor(rand() * 50) * MIN;
      s.games[id] = game(id, at, pick(["playing", "won", "lost", "gave-up"]), {
        log: Array.from({ length: Math.floor(rand() * 4) }, () => ({ text: "x", result: { kind: "unknown" as const, junk: true } })),
      });
    }
  }
  s.listRuns = Array.from({ length: Math.floor(rand() * 8) }, () => listRun(pick(ids), T + Math.floor(rand() * 40) * MIN, Math.floor(rand() * 11)));
  // Same list and start twice in one save can't happen in the game.
  s.listRuns = [...new Map(s.listRuns.map((r) => [`${r.id}${r.startedAt}`, r])).values()];
  s.blitzRuns = {};
  s.blitzBest = {};
  for (const id of ids) {
    if (rand() < 0.5) {
      const runs = [...new Map(Array.from({ length: 1 + Math.floor(rand() * 4) }, () => {
        const r = blitzRun(T + Math.floor(rand() * 40) * MIN, 10 + Math.floor(rand() * 900));
        return [r.startedAt, r] as const;
      })).values()];
      s.blitzRuns[id] = runs;
      s.blitzBest[id] = Math.max(...runs.map((r) => r.score));
    }
  }
  s.dailyGames = {};
  for (const d of ["2026-11-01", "2026-11-02", "2026-11-03"]) {
    if (rand() < 0.5) {
      s.dailyGames[d] = game(pick(ids), T + Math.floor(rand() * 40) * MIN, "lost");
      s.daily[d] = s.dailyGames[d].puzzleId;
    }
  }
  // Some first tries older than anything left in the history (it's capped; they aren't).
  s.firstTries = { list: {}, blitz: {} };
  for (const id of ids) {
    if (rand() < 0.3) s.firstTries.list![id] = listRun(id, T - Math.floor(1 + rand() * 30) * MIN, Math.floor(rand() * 11));
    if (rand() < 0.3) s.firstTries.blitz![id] = blitzRun(T - Math.floor(1 + rand() * 30) * MIN, 10 + Math.floor(rand() * 900));
  }
  return mergeSaves(s, empty(), NOW); // normalized: sorted, capped, first tries filled in
}

describe("mergeSaves: properties", () => {
  const rand = rng(7);
  const pairs = Array.from({ length: 200 }, () => [randomSave(rand), randomSave(rand)] as const);

  it("loses nothing: every run, streak day and finished daily from either side is in the merge", () => {
    for (const [a, b] of pairs) {
      const m = mergeSaves(a, b, NOW);
      const runs = new Set(m.listRuns!.map((r) => `${r.id}${r.startedAt}`));
      for (const r of [...a.listRuns!, ...b.listRuns!]) expect(runs.has(`${r.id}${r.startedAt}`)).toBe(true);
      for (const [id, list] of Object.entries({ ...a.blitzRuns, ...b.blitzRuns })) {
        const kept = new Set(m.blitzRuns![id].map((r) => r.startedAt));
        for (const r of list) expect(kept.has(r.startedAt)).toBe(true);
      }
      for (const d of [...Object.keys(a.daily), ...Object.keys(b.daily)]) expect(m.daily[d]).toBeDefined();
      for (const d of [...Object.keys(a.dailyGames!), ...Object.keys(b.dailyGames!)]) expect(m.dailyGames![d].status).not.toBe("playing");
      for (const [id, best] of Object.entries({ ...a.blitzBest, ...b.blitzBest })) expect(m.blitzBest![id]).toBeGreaterThanOrEqual(best);
      for (const id of Object.keys({ ...a.games, ...b.games })) expect(m.games[id]).toBeDefined();
      expect(m.seenHelp).toBe(a.seenHelp || b.seenHelp);
    }
  });

  it("keeps each list's earliest first try, per mode, from either side", () => {
    for (const [a, b] of pairs) {
      const m = mergeSaves(a, b, NOW);
      for (const mode of ["list", "blitz"] as const) {
        const ids = new Set([...Object.keys(a.firstTries?.[mode] ?? {}), ...Object.keys(b.firstTries?.[mode] ?? {})]);
        expect(new Set(Object.keys(m.firstTries?.[mode] ?? {}))).toEqual(ids);
        for (const id of ids) {
          const starts = [a.firstTries?.[mode]?.[id]?.startedAt, b.firstTries?.[mode]?.[id]?.startedAt].filter((t) => t !== undefined);
          expect(m.firstTries![mode]![id].startedAt).toBe(Math.min(...starts));
        }
      }
    }
  });

  it("is idempotent: merging the result with either side again changes nothing", () => {
    for (const [a, b] of pairs) {
      const m = mergeSaves(a, b, NOW);
      expect(sameSave(mergeSaves(m, a, NOW), m)).toBe(true);
      expect(sameSave(mergeSaves(m, b, NOW), m)).toBe(true);
      expect(sameSave(mergeSaves(m, m, NOW), m)).toBe(true);
    }
  });

  it("gives both devices the same result, whichever merges first", () => {
    for (const [a, b] of pairs) expect(stableJson(mergeSaves(a, b, NOW))).toBe(stableJson(mergeSaves(b, a, NOW)));
  });
});

describe("sanitize and stableJson", () => {
  it("compares saves by content, not key order", () => {
    expect(sameSave({ a: 1, b: { c: [1, { d: 2, e: 3 }] } }, { b: { c: [1, { e: 3, d: 2 }] }, a: 1 })).toBe(true);
    expect(sameSave({ a: 1 }, { a: 2 })).toBe(false);
    expect(stableJson({ a: undefined, b: [undefined] })).toBe('{"b":[null]}');
  });

  it("gives an empty save for nothing", () => {
    expect(sanitize(undefined)).toEqual(empty());
  });
});
