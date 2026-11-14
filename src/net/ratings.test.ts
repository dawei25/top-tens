import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Saved } from "../game/storage";
import { Outbox, type OutboxData, type SendResult } from "./outbox";
import { invalidRating, isRatingMode, RATING_KEY, RATING_MODES, RATING_REASONS, RATINGS, rateArgs, ratingKey, ratingOf, withRating, type Rating } from "./ratings";

const T = Date.UTC(2026, 10, 3, 12);
/** The migration that lets a Fathom question be rated and noted as a list is. */
const FATHOM_SQL = "20261114130000_fathom_feedback.sql";
const rating = (over: Partial<Rating> = {}): Rating => ({ listId: "mountains", mode: "list", rating: 1, reason: null, at: T, ...over });

describe("a rating", () => {
  it("is checked as the database checks it", () => {
    expect(invalidRating(rating())).toBeNull();
    expect(invalidRating(rating({ rating: -1, reason: "wrong-data" }))).toBeNull();
    expect(invalidRating(rating({ rating: 0, mode: "blitz" }))).toBeNull();
    expect(invalidRating(rating({ listId: "Bad Id" }))).toBe("list id");
    expect(invalidRating(rating({ mode: "classic" as "list" }))).toBe("mode");
    expect(invalidRating(rating({ rating: 2 as 1 }))).toBe("rating");
    expect(invalidRating(rating({ rating: 1, reason: "boring" }))).toBe("reason");
    expect(invalidRating(rating({ rating: -1, reason: "meh" as "boring" }))).toBe("reason");
    expect(invalidRating(rating({ at: NaN }))).toBe("at");
  });

  it("goes to rate_list with this browser's id", () => {
    expect(rateArgs(rating({ rating: -1, reason: "too-easy" }), "c-1")).toEqual({
      p_list_id: "mountains",
      p_mode: "list",
      p_rating: -1,
      p_reason: "too-easy",
      p_client_id: "c-1",
    });
  });

  it("is kept in the save per list and mode; a rating taken back reads as none", () => {
    let s: Saved = { games: {}, daily: {}, seenHelp: true };
    s = withRating(s, rating());
    s = withRating(s, rating({ mode: "blitz", rating: -1, reason: "boring", at: T + 1 }));
    expect(s.ratings).toEqual({ "list:mountains": { rating: 1, at: T }, "blitz:mountains": { rating: -1, reason: "boring", at: T + 1 } });
    expect(ratingOf(s, "list", "mountains")).toEqual({ rating: 1, at: T });
    expect(ratingOf(s, "list", "islands")).toBeNull();
    s = withRating(s, rating({ rating: 0, at: T + 2 }));
    expect(s.ratings!["list:mountains"]).toEqual({ rating: 0, at: T + 2 });
    expect(ratingOf(s, "list", "mountains")).toBeNull();
  });

  it("has the reasons the database takes (supabase/migrations, ratings, and Fathom's)", () => {
    for (const file of ["20261103120000_ratings.sql", FATHOM_SQL]) {
      const sql = readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
      const sets = [...sql.matchAll(/reason (?:not )?in \(([^)]*)\)/g)].map((m) => m[1].split(",").map((s) => s.trim().replace(/'/g, "")));
      expect(sets.length, file).toBeGreaterThanOrEqual(file === FATHOM_SQL ? 1 : 2);
      for (const set of sets) expect(set, file).toEqual(RATING_REASONS);
    }
  });

  // The owner, Nov 14: "add the same feedback system for fathom that we currently have for lists/blitz".
  it("takes a Fathom question as a list in mode fathom: its id as the list id, the same reasons", () => {
    const q = rating({ listId: "first-homo-sapiens", mode: "fathom", rating: -1, reason: "unfair" });
    expect(invalidRating(q)).toBeNull();
    expect(invalidRating(rating({ mode: "fathom", rating: 0 }))).toBeNull();
    expect(invalidRating(rating({ mode: "Fathom" as "fathom" }))).toBe("mode");
    expect(invalidRating(rating({ mode: "estimate" as "fathom" }))).toBe("mode");
    expect(invalidRating(rating({ mode: "fathom", rating: 1, reason: "boring" }))).toBe("reason");
    expect(rateArgs(q, "c-1")).toEqual({ p_list_id: "first-homo-sapiens", p_mode: "fathom", p_rating: -1, p_reason: "unfair", p_client_id: "c-1" });
    expect(RATING_MODES).toEqual(["list", "blitz", "fathom"]);
    expect(["list", "blitz", "fathom", "classic", "", null].map(isRatingMode)).toEqual([true, true, true, false, false, false]);
    // In the save under its own key, apart from a list of the same id; the sync keeps it (RATING_KEY).
    let s: Saved = { games: {}, daily: {}, seenHelp: true };
    s = withRating(s, q);
    s = withRating(s, rating({ listId: "first-homo-sapiens", at: T + 1 }));
    expect(s.ratings).toEqual({
      "fathom:first-homo-sapiens": { rating: -1, reason: "unfair", at: T },
      "list:first-homo-sapiens": { rating: 1, at: T + 1 },
    });
    expect(ratingOf(s, "fathom", "first-homo-sapiens")).toEqual({ rating: -1, reason: "unfair", at: T });
    expect(ratingKey("fathom", "moon-visible-share")).toBe("fathom:moon-visible-share");
    for (const key of ["list:mountains", "blitz:airports", "fathom:first-homo-sapiens"]) expect(RATING_KEY.test(key), key).toBe(true);
    for (const key of ["classic:mountains", "fathom:Bad Id", "fathom:", "xfathom:a", "fathom:a:b"]) expect(RATING_KEY.test(key), key).toBe(false);
  });

  it("has the modes the database takes (supabase/migrations, Fathom's feedback)", () => {
    const sql = readFileSync(new URL(`../../supabase/migrations/${FATHOM_SQL}`, import.meta.url), "utf8");
    const sets = [...sql.matchAll(/mode (?:not )?in \(([^)]*)\)/g)].map((m) => m[1].split(",").map((s) => s.trim().replace(/'/g, "")));
    // The two tables' checks, rate_list's and submit_feedback's.
    expect(sets).toHaveLength(4);
    for (const set of sets) expect(set).toEqual(RATING_MODES);
  });
});

describe("the ratings outbox", () => {
  function memoryStore() {
    let data: OutboxData<Rating> = { pending: [], sent: [] };
    return { read: () => structuredClone(data), write: (d: OutboxData<Rating>) => void (data = structuredClone(d)), get data() { return data; } };
  }

  it("keeps only the latest rating of a list and mode waiting, and sends it", async () => {
    const store = memoryStore();
    const got: Rating[] = [];
    let answer: SendResult = "retry";
    const box = new Outbox<Rating>(store, async (r) => (got.push(r), answer), () => T, RATINGS);
    expect(box.add(rating())).toBe(true);
    expect(await box.flush()).toBe("retry");
    // Offline: changed twice more, and another list rated.
    expect(box.add(rating({ rating: -1, at: T + 1 }))).toBe(true);
    expect(box.add(rating({ listId: "islands", at: T + 2 }))).toBe(true);
    expect(box.add(rating({ rating: -1, reason: "boring", at: T + 3 }))).toBe(true);
    expect(store.data.pending.map((r) => [r.listId, r.rating, r.reason])).toEqual([
      ["islands", 1, null],
      ["mountains", -1, "boring"],
    ]);
    // Malformed: never queued.
    expect(box.add(rating({ rating: 1, reason: "boring" }))).toBe(false);
    answer = "ok";
    expect(await box.flush()).toBe("done");
    expect(got.slice(1).map((r) => [r.listId, r.rating, r.reason])).toEqual([
      ["islands", 1, null],
      ["mountains", -1, "boring"],
    ]);
    expect(store.data.pending).toEqual([]);
    // Taken back later: a new rating of the same list goes out too.
    expect(box.add(rating({ rating: 0, at: T + 4 }))).toBe(true);
    await box.flush();
    expect(got.at(-1)).toMatchObject({ listId: "mountains", rating: 0 });
  });

  it("keeps a Fathom question's latest rating waiting apart from a list's of the same id", async () => {
    const store = memoryStore();
    const box = new Outbox<Rating>(store, async () => "retry", () => T, RATINGS);
    expect(box.add(rating({ listId: "first-homo-sapiens", mode: "fathom", at: T }))).toBe(true);
    expect(box.add(rating({ listId: "first-homo-sapiens", mode: "list", at: T + 1 }))).toBe(true);
    expect(box.add(rating({ listId: "first-homo-sapiens", mode: "fathom", rating: -1, reason: "too-easy", at: T + 2 }))).toBe(true);
    expect(box.add(rating({ listId: "first-homo-sapiens", mode: "quiz" as "fathom", at: T + 3 }))).toBe(false);
    expect(store.data.pending.map((r) => [r.mode, r.rating, r.reason])).toEqual([
      ["list", 1, null],
      ["fathom", -1, "too-easy"],
    ]);
  });

  it("sends a rating given while the one before it is on its way, after it", async () => {
    const store = memoryStore();
    const got: Rating[] = [];
    let release!: () => void;
    const box = new Outbox<Rating>(
      store,
      async (r) => {
        got.push(r);
        if (got.length === 1) await new Promise<void>((done) => (release = done));
        return "ok";
      },
      () => T,
      RATINGS,
    );
    box.add(rating());
    const first = box.flush();
    await Promise.resolve();
    box.add(rating({ rating: -1, at: T + 1 }));
    const second = box.flush();
    release();
    await Promise.all([first, second]);
    expect(got.map((r) => r.rating)).toEqual([1, -1]);
    expect(store.data.pending).toEqual([]);
  });
});
