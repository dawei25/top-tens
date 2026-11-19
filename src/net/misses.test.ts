import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blitzGuess, newBlitz, type BlitzResult } from "../game/blitz";
import type { Lexicon } from "../game/junk";
import { nameListIds, readList, readName } from "../game/fathom-name";
import { judgeGuess } from "../game/match";
import type { GuessResult, Puzzle } from "../game/types";
import { enqueue, Outbox, type OutboxData, type SendResult } from "./outbox";
import {
  cleanMiss,
  EMAIL,
  invalidMiss,
  LINK,
  looksPersonal,
  MAX_MISS,
  missArgs,
  missClientId,
  missKind,
  MISS_MODES,
  MISSES,
  nameMissKind,
  PHONE,
  SPACES,
  type Miss,
} from "./misses";

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
    // A Fathom name-it round's miss: mode fathom, the question's id as the list's (20261117120000_fathom_misses.sql).
    expect(invalidMiss(miss({ mode: "fathom", listId: "name-city-10m-people" }))).toBeNull();
    for (const mode of ["estimate", "name", "Fathom"]) expect(invalidMiss(miss({ mode: mode as "list" })), mode).toBe("mode");
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
    // A Fathom name-it round's: the question's id where a list's id goes.
    expect(missArgs(miss({ mode: "fathom", listId: "name-city-10m-people", text: "rome" }), "m-1")).toMatchObject({ p_list_id: "name-city-10m-people", p_mode: "fathom", p_text: "rome" });
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
    // The Fathom migration replaces submit_miss: the same limits and patterns, and the game's modes.
    const fathom = readFileSync(new URL("../../supabase/migrations/20261117120000_fathom_misses.sql", import.meta.url), "utf8");
    expect(fathom).toContain(`char_length(body) > ${MAX_MISS}`);
    for (const pattern of [SPACES, EMAIL, PHONE, LINK]) expect(fathom).toContain(`'${pattern}'`);
    const modes = `(${MISS_MODES.map((m) => `'${m}'`).join(", ")})`;
    expect(fathom).toContain(`check (mode in ${modes})`);
    expect(fathom).toContain(`p_mode not in ${modes}`);
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

  // The owner, Nov 17: "are wrong guesses tracked for fathom? i guessed rome for a city based question but it wasnt
  // accepted". A name the name-it round doesn't take is a miss like a list's; a number round's guess never is.
  it("from Fathom, only a name its name-it round didn't take; never a number round's guess", () => {
    const dir = join(import.meta.dirname, "../components/fathom");
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/reportGuess|submit_miss|missOutbox/);
    const src = readFileSync(join(dir, "Fathom.tsx"), "utf8");
    const calls = [...src.matchAll(/reportNameMiss\(/g)].map((m) => m.index!);
    // Called once, inside the name-it field (AskName), after its read; never in Ask (the numbers).
    expect(calls).toHaveLength(1);
    const askName = src.indexOf("function AskName(");
    const end = src.indexOf("\n}\n", askName);
    expect(calls[0] > askName && calls[0] < end, "the call is in AskName").toBe(true);
    const ask = src.slice(src.indexOf("function Ask("), src.indexOf("\n}\n", src.indexOf("function Ask(")));
    expect(ask).not.toMatch(/reportNameMiss|reportGuess/);
  });
});

describe("which names on a Fathom name-it round are misses", { timeout: 30_000 }, () => {
  const fathom = join(import.meta.dirname, "../../public/fathom");
  const bank = JSON.parse(readFileSync(join(fathom, "questions.json"), "utf8"));
  const lists = new Map(nameListIds(bank).map((id) => [id, readList(JSON.parse(readFileSync(join(fathom, "lists", `${id}.json`), "utf8")))!]));
  const all = [...lists.values()];
  const on = (listId: string, text: string, except?: string[]) => {
    const read = readName(text, lists.get(listId)!, all, { lex, except });
    return { read: read.kind, miss: nameMissKind(read, text, lex) };
  };

  it("a name the round doesn't take: unknown (not on its list, another kind, no figure, several), or junk", () => {
    expect(on("cities-population", "Atlantis")).toEqual({ read: "offList", miss: "unknown" });
    expect(on("countries-population", "Paris")).toEqual({ read: "other", miss: "unknown" });
    expect(on("countries-population", "Scotland")).toEqual({ read: "other", miss: "unknown" });
    expect(on("cities-population", "Florence")).toEqual({ read: "unmeasured", miss: "unknown" });
    expect(on("countries-population", "xqzzvkw")).toEqual({ read: "unknown", miss: "junk" });
    expect(nameMissKind({ kind: "vague" }, "new", lex)).toBe("unknown");
    expect(nameMissKind({ kind: "unknown" }, "pizza", lex)).toBe("unknown");
  });

  it("never a name it took or offered, the yardstick, an empty field or a way of giving up", () => {
    expect(on("countries-population", "Colombia")).toEqual({ read: "answer", miss: null });
    expect(on("cities-population", "Rome")).toEqual({ read: "answer", miss: null });
    expect(on("countries-population", "Frnace")).toEqual({ read: "confirm", miss: null });
    expect(on("countries-population", "Congo")).toEqual({ read: "choose", miss: null });
    expect(on("countries-area", "UK", ["United Kingdom"])).toEqual({ read: "except", miss: null });
    expect(on("countries-population", "")).toEqual({ read: "empty", miss: null });
    for (const t of ["pass", "idk", "no idea", "?"]) expect(on("countries-population", t).miss, t).toBeNull();
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
    // A Fathom name-it round's: once per question and text.
    expect(enqueue(store, MISSES, miss({ mode: "fathom", listId: "name-city-10m-people", text: "atlantis" }), T)).toBe(true);
    expect(enqueue(store, MISSES, miss({ mode: "fathom", listId: "name-city-10m-people", text: "atlantis", at: T + 1 }), T)).toBe(false);
    // Malformed or personal: never queued.
    expect(enqueue(store, MISSES, miss({ text: "Mount Fuji" }), T)).toBe(false);
    expect(enqueue(store, MISSES, miss({ text: "555-1234" }), T)).toBe(false);
    expect(store.data.pending.map((m) => `${m.mode}:${m.listId}:${m.text}`)).toEqual([
      "list:mountains:mount fuji",
      "blitz:mountains:mount fuji",
      "list:islands:mount fuji",
      "list:mountains:fuji",
      "fathom:name-city-10m-people:atlantis",
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
