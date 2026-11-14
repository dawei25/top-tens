import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blitzGuess, newBlitz, type BlitzResult } from "../game/blitz";
import type { Lexicon } from "../game/junk";
import { judgeGuess } from "../game/match";
import type { GuessResult, Puzzle } from "../game/types";
import { enqueue, Outbox, type OutboxData, type SendResult } from "./outbox";
import { cleanMiss, EMAIL, invalidMiss, LINK, looksPersonal, MAX_MISS, missArgs, missClientId, missKind, MISSES, PHONE, SPACES, type Miss } from "./misses";

const T = Date.UTC(2026, 10, 8, 12);
const miss = (over: Partial<Miss> = {}): Miss => ({ listId: "mountains", mode: "list", kind: "unknown", text: "mount fuji", at: T, ...over });
const puzzles = join(import.meta.dirname, "../../public/puzzles");
const read = <T>(f: string): T => JSON.parse(readFileSync(join(puzzles, f), "utf8"));
const lex = read<Lexicon>("lexicon.json");

describe("a missed guess", () => {
  it("is sent as short lowercase text: every run of spaces one space, trimmed, composed", () => {
    expect(cleanMiss("  Mount  EVEREST\t")).toBe("mount everest");
    expect(cleanMiss("Mont\u00a0Blanc")).toBe("mont blanc");
    expect(cleanMiss("a\u3000b\u2003c\r\nd\u0007e")).toBe("a b c d e");
    expect(cleanMiss("\u200a x \ufeff")).toBe("x");
    // Decomposed and composed accents are the same text.
    expect(cleanMiss("E\u0301cole")).toBe("école");
    expect(cleanMiss("ÉCOLE")).toBe("école");
    expect(cleanMiss(" \n\t ")).toBe("");
  });

  it("is checked as the database checks it", () => {
    expect(invalidMiss(miss())).toBeNull();
    expect(invalidMiss(miss({ mode: "blitz", kind: "junk", text: "asdfgh" }))).toBeNull();
    expect(invalidMiss(miss({ text: "é".repeat(MAX_MISS) }))).toBeNull();
    expect(invalidMiss(miss({ listId: "Bad Id" }))).toBe("list id");
    expect(invalidMiss(miss({ mode: "classic" as "list" }))).toBe("mode");
    // Fathom's ratings and notes go where a list's do, but nothing from Fathom is a miss (missed_guesses takes list or blitz).
    expect(invalidMiss(miss({ mode: "fathom" as "list" }))).toBe("mode");
    expect(invalidMiss(miss({ kind: "near" as "unknown" }))).toBe("kind");
    expect(invalidMiss(miss({ text: "" }))).toBe("length");
    expect(invalidMiss(miss({ text: "x".repeat(MAX_MISS + 1) }))).toBe("length");
    // Not cleaned first: refused rather than sent as something the server would store differently.
    expect(invalidMiss(miss({ text: "Mount Fuji" }))).toBe("text");
    expect(invalidMiss(miss({ text: " fuji" }))).toBe("text");
    expect(invalidMiss(miss({ text: 5 as unknown as string }))).toBe("text");
    expect(invalidMiss(miss({ text: "dana@example.com" }))).toBe("personal");
    expect(invalidMiss(miss({ at: NaN }))).toBe("at");
  });

  it("never looks like an email address, a phone number or a link", () => {
    for (const t of ["dana@example.com", "+1 (555) 123-4567", "555-1234", "07700 900123", "https://example.com", "www.example.com", "example.com/me", "t.me/dana"]) {
      expect(looksPersonal(cleanMiss(t)), t).toBe(true);
    }
    for (const t of ["mount everest", "1984", "432 park avenue", "google.com", "@cristiano", "st. louis", "ac/dc", "7-eleven", "covid-19"]) {
      expect(looksPersonal(cleanMiss(t)), t).toBe(false);
    }
  });

  it("goes to submit_miss with its own random id, never the one plays carry", () => {
    expect(missArgs(miss({ kind: "junk", text: "asdfgh" }), "m-1")).toEqual({
      p_list_id: "mountains",
      p_mode: "list",
      p_kind: "junk",
      p_text: "asdfgh",
      p_client_id: "m-1",
    });
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const id = missClientId(storage);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(missClientId(storage)).toBe(id);
    expect([...store.keys()]).toEqual(["top-tens:miss-id"]);
  });

  it("has the limits and patterns the database has (supabase/migrations, missed_guesses)", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261108120000_missed_guesses.sql", import.meta.url), "utf8");
    expect(sql).toContain(`check (char_length(text) between 1 and ${MAX_MISS})`);
    expect(sql).toContain(`char_length(body) > ${MAX_MISS}`);
    expect(sql).toContain("check (kind in ('unknown', 'junk'))");
    for (const pattern of [SPACES, EMAIL, PHONE, LINK]) expect(sql).toContain(`'${pattern}'`);
  });
});

describe("which guesses are misses", () => {
  const entry = { rank: 3, name: "Kangchenjunga", aliases: [] };

  it("a list guess the game didn't take: unknown, or junk (kept, to find false junk calls)", () => {
    expect(missKind({ kind: "unknown", junk: false })).toBe("unknown");
    expect(missKind({ kind: "unknown", junk: true })).toBe("junk");
    // Part of several names: not taken either ("More than one answer fits").
    expect(missKind({ kind: "unknown", junk: false, vague: 3 })).toBe("unknown");
    // Accepted answers, a near miss (a real answer outside the top 10), a "did you mean" choice: never.
    const never: GuessResult[] = [
      { kind: "empty" },
      { kind: "correct", entry, corrected: false },
      { kind: "correct", entry, corrected: true },
      { kind: "duplicate", entry },
      { kind: "near", entry, corrected: false },
      { kind: "typo", suggestions: ["Kangchenjunga", "Kamet"] },
    ];
    for (const r of never) expect(missKind(r), r.kind).toBeNull();
  });

  it("a Blitz guess that scored nothing because it isn't on the list; never one that is on it", () => {
    expect(missKind({ kind: "none", junk: false })).toBe("unknown");
    expect(missKind({ kind: "none", junk: true })).toBe("junk");
    expect(missKind({ kind: "none", junk: false, vague: 2 })).toBe("unknown");
    const never: BlitzResult[] = [
      { kind: "empty" },
      { kind: "over" },
      { kind: "scored", hit: { name: "K2", rank: 2, n: 8611, points: 90 }, corrected: false },
      { kind: "duplicate", name: "K2" },
      { kind: "choices", suggestions: ["Kangchenjunga", "Kamet"] },
      // On the list: outside the region ("Japan isn't in Europe."), or without a figure to score.
      { kind: "none", junk: false, elsewhere: "Japan" },
      { kind: "none", junk: false, unscored: "Confessions" },
    ];
    for (const r of never) expect(missKind(r), JSON.stringify(r)).toBeNull();
  });

  it("as the real matcher judges a list: only what isn't an answer", () => {
    const p = read<Puzzle>("mountains.json");
    const judged = (text: string) => judgeGuess(text, p, new Set(), lex);
    expect(judged("Everest").kind).toBe("correct");
    expect(missKind(judged("Everest"))).toBeNull();
    // Real answers outside the top 10 (the ranked table, and the mountains the page lists elsewhere): near misses.
    for (const t of ["Broad Peak", "Mount Fuji", "fuji"]) {
      expect(judged(t).kind, t).toBe("near");
      expect(missKind(judged(t)), t).toBeNull();
    }
    expect(missKind(judged("pizza"))).toBe("unknown");
    expect(missKind(judged("xqzzvkw"))).toBe("junk");
  });

  it("as the real Blitz judges a round: a place on the list outside its region is never a miss", () => {
    const p = read<Puzzle>("africa-population.json");
    const round = (text: string) => blitzGuess(newBlitz(p), p, text, lex).result;
    expect(round("Nigeria").kind).toBe("scored");
    expect(missKind(round("Nigeria"))).toBeNull();
    expect(round("Andorra")).toMatchObject({ kind: "none", elsewhere: "Andorra" });
    expect(missKind(round("Andorra"))).toBeNull();
    expect(missKind(round("pizza"))).toBe("unknown");
    expect(missKind(round("xqzzvkw"))).toBe("junk");
  });

  it("never come from Fathom: nothing there reports a guess", () => {
    const dir = join(import.meta.dirname, "../components/fathom");
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/reportGuess|submit_miss|missOutbox/);
  });
});

describe("the misses outbox", () => {
  function memoryStore() {
    let data: OutboxData<Miss> = { pending: [], sent: [] };
    return { read: () => structuredClone(data), write: (d: OutboxData<Miss>) => void (data = structuredClone(d)), get data() { return data; } };
  }

  it("queues a text once per list and mode: a browser counts once per text", () => {
    const store = memoryStore();
    expect(enqueue(store, MISSES, miss(), T)).toBe(true);
    // The same text later, or judged junk this time: already there.
    expect(enqueue(store, MISSES, miss({ at: T + 60_000 }), T)).toBe(false);
    expect(enqueue(store, MISSES, miss({ kind: "junk" }), T)).toBe(false);
    expect(enqueue(store, MISSES, miss({ mode: "blitz" }), T)).toBe(true);
    expect(enqueue(store, MISSES, miss({ listId: "islands" }), T)).toBe(true);
    expect(enqueue(store, MISSES, miss({ text: "fuji" }), T)).toBe(true);
    // Malformed or personal: never queued.
    expect(enqueue(store, MISSES, miss({ text: "Mount Fuji" }), T)).toBe(false);
    expect(enqueue(store, MISSES, miss({ text: "555-1234" }), T)).toBe(false);
    expect(store.data.pending.map((m) => `${m.mode}:${m.listId}:${m.text}`)).toEqual([
      "list:mountains:mount fuji",
      "blitz:mountains:mount fuji",
      "list:islands:mount fuji",
      "list:mountains:fuji",
    ]);
  });

  it("sends them oldest first, waits while offline, and remembers what went", async () => {
    const store = memoryStore();
    const got: string[] = [];
    let answer: SendResult = "retry";
    const box = new Outbox<Miss>(store, async (m) => (got.push(m.text), answer), () => T, MISSES);
    box.add(miss());
    box.add(miss({ text: "fuji", at: T + 1 }));
    expect(await box.flush()).toBe("retry");
    expect(store.data.pending).toHaveLength(2);
    answer = "ok";
    expect(await box.flush()).toBe("done");
    expect(got.slice(1)).toEqual(["mount fuji", "fuji"]);
    expect(store.data.pending).toEqual([]);
    // Sent: never queued again.
    expect(box.add(miss({ at: T + 5 }))).toBe(false);
  });
});
