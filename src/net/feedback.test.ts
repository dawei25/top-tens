import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanNote, FEEDBACK, feedbackArgs, invalidFeedback, MAX_NOTE, noteLength, type Feedback } from "./feedback";
import { enqueue, Outbox, type OutboxData, type SendResult } from "./outbox";

const T = Date.UTC(2026, 10, 4, 12);
const note = (over: Partial<Feedback> = {}): Feedback => ({ listId: "national-parks", mode: "list", rating: null, text: "a note", at: T, ...over });

describe("a note", () => {
  it("is cleaned as it's sent: one kind of line break, no control characters, trimmed", () => {
    expect(cleanNote("  great list\r\nwhich state?\r\rok \n\n")).toBe("great list\nwhich state?\n\nok");
    expect(cleanNote("tab\tkept,\u0000 nul\u0007 and bell gone")).toBe("tab\tkept, nul and bell gone");
    expect(cleanNote(" \n\t ")).toBe("");
  });

  it("counts characters as the database does, not UTF-16 units", () => {
    expect(noteLength("abc")).toBe(3);
    expect(noteLength("🦑🦑")).toBe(2);
    expect(noteLength("é")).toBe(1);
  });

  it("is checked as the database checks it", () => {
    expect(invalidFeedback(note())).toBeNull();
    expect(invalidFeedback(note({ rating: 1, mode: "blitz" }))).toBeNull();
    expect(invalidFeedback(note({ rating: -1, text: "x".repeat(MAX_NOTE) }))).toBeNull();
    expect(invalidFeedback(note({ text: "🦑".repeat(MAX_NOTE) }))).toBeNull();
    expect(invalidFeedback(note({ listId: "Bad Id" }))).toBe("list id");
    expect(invalidFeedback(note({ mode: "classic" as "list" }))).toBe("mode");
    expect(invalidFeedback(note({ rating: 0 as 1 }))).toBe("rating");
    expect(invalidFeedback(note({ text: "" }))).toBe("length");
    expect(invalidFeedback(note({ text: "x".repeat(MAX_NOTE + 1) }))).toBe("length");
    // Not cleaned first: refused rather than sent with blanks the server would trim to something else.
    expect(invalidFeedback(note({ text: " padded " }))).toBe("text");
    expect(invalidFeedback(note({ text: 5 as unknown as string }))).toBe("text");
    expect(invalidFeedback(note({ at: NaN }))).toBe("at");
  });

  it("goes to submit_feedback with this browser's id", () => {
    expect(feedbackArgs(note({ rating: -1, text: "which state each park is in" }), "c-1")).toEqual({
      p_list_id: "national-parks",
      p_mode: "list",
      p_rating: -1,
      p_text: "which state each park is in",
      p_client_id: "c-1",
    });
  });

  it("has the length limit the database has (supabase/migrations, feedback)", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261104120000_feedback.sql", import.meta.url), "utf8");
    expect(sql).toContain(`char_length(text) between 1 and ${MAX_NOTE}`);
    expect(sql).toContain(`char_length(body) > ${MAX_NOTE}`);
  });
});

describe("the notes outbox", () => {
  function memoryStore() {
    let data: OutboxData<Feedback> = { pending: [], sent: [] };
    return { read: () => structuredClone(data), write: (d: OutboxData<Feedback>) => void (data = structuredClone(d)), get data() { return data; } };
  }

  it("keeps every note waiting (several on one list too), and sends them oldest first", async () => {
    const store = memoryStore();
    const got: Feedback[] = [];
    let answer: SendResult = "retry";
    const box = new Outbox<Feedback>(store, async (f) => (got.push(f), answer), () => T, FEEDBACK);
    expect(box.add(note({ text: "first" }))).toBe(true);
    expect(await box.flush()).toBe("retry");
    // Offline: two more, one on the same list and mode.
    expect(box.add(note({ text: "second", at: T + 1 }))).toBe(true);
    expect(box.add(note({ listId: "islands", mode: "blitz", text: "third", at: T + 2 }))).toBe(true);
    // The same note again (same list, mode and time): once.
    expect(box.add(note({ text: "first" }))).toBe(false);
    // Malformed: never queued.
    expect(box.add(note({ text: "", at: T + 3 }))).toBe(false);
    expect(store.data.pending.map((f) => f.text)).toEqual(["first", "second", "third"]);
    answer = "ok";
    expect(await box.flush()).toBe("done");
    expect(got.slice(1).map((f) => f.text)).toEqual(["first", "second", "third"]);
    expect(store.data.pending).toEqual([]);
    // Sent: never queued again.
    expect(box.add(note({ text: "first" }))).toBe(false);
  });

  it("can be queued before the code that sends it has loaded, and that code picks it up", async () => {
    const store = memoryStore();
    expect(enqueue(store, FEEDBACK, note(), T)).toBe(true);
    expect(enqueue(store, FEEDBACK, note(), T)).toBe(false);
    const got: string[] = [];
    const box = new Outbox<Feedback>(store, async (f) => (got.push(f.text), "ok"), () => T, FEEDBACK);
    expect(await box.flush()).toBe("done");
    expect(got).toEqual(["a note"]);
  });

  it("drops a note the server refuses for good, and keeps going", async () => {
    const store = memoryStore();
    const got: string[] = [];
    const box = new Outbox<Feedback>(store, async (f) => (got.push(f.text), f.text === "bad" ? "drop" : "ok"), () => T, FEEDBACK);
    box.add(note({ text: "bad" }));
    box.add(note({ text: "good", at: T + 1 }));
    expect(await box.flush()).toBe("done");
    expect(got).toEqual(["bad", "good"]);
    expect(store.data.pending).toEqual([]);
  });
});
