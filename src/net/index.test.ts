import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlitzState } from "../game/blitz";
import type { GameState } from "../game/state";
import { readBackend, readGoogleClientId } from "./config";

const game: GameState = { puzzleId: "mountains", found: [1, 2], lives: 0, log: [], status: "lost", startedAt: Date.now() - 60_000, finishedAt: Date.now() };
const round: BlitzState = { puzzleId: "airports", startedAt: Date.now() - 95_000, endedAt: Date.now() - 5000, hits: [] };

/** Just enough of a browser for the facade: storage, events, the address bar. */
function fakeBrowser() {
  const store = new Map<string, string>();
  const listeners: string[] = [];
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("addEventListener", (type: string) => listeners.push(type));
  vi.stubGlobal("document", { addEventListener: (type: string) => listeners.push(`document:${type}`), visibilityState: "visible" });
  vi.stubGlobal("location", { search: "", hash: "", origin: "http://localhost", pathname: "/" });
  return { store, listeners };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@supabase/supabase-js");
  vi.doUnmock("./service");
});

describe("readBackend", () => {
  it("needs both a URL and an anon key", () => {
    expect(readBackend()).toBeNull();
    expect(readBackend("", "")).toBeNull();
    expect(readBackend("https://x.supabase.co", "")).toBeNull();
    expect(readBackend("", "key")).toBeNull();
    expect(readBackend("not a url", "key")).toBeNull();
    expect(readBackend(" https://x.supabase.co/ ", " key ")).toEqual({ url: "https://x.supabase.co", anonKey: "key", signIn: ["google"] });
  });

  it("offers Google only by default (the launch: no email provider yet), blank or unset alike", () => {
    expect(readBackend("https://x.supabase.co", "k")?.signIn).toEqual(["google"]);
    expect(readBackend("https://x.supabase.co", "k", "")?.signIn).toEqual(["google"]);
    // Vercel keeps a pasted newline: still the default.
    expect(readBackend("https://x.supabase.co", "k", " \n")?.signIn).toEqual(["google"]);
  });

  it("offers the sign-in methods VITE_SIGN_IN names (email and password stay behind it; none switches accounts off)", () => {
    expect(readBackend("https://x.supabase.co", "k", "google,email")?.signIn).toEqual(["google", "email"]);
    expect(readBackend("https://x.supabase.co", "k", "email")?.signIn).toEqual(["email"]);
    expect(readBackend("https://x.supabase.co", "k", "Google , email")?.signIn).toEqual(["google", "email"]);
    expect(readBackend("https://x.supabase.co", "k", "none")?.signIn).toEqual([]);
    expect(readBackend("https://x.supabase.co", "k", "google,password")?.signIn).toEqual(["google", "password"]);
    expect(readBackend("https://x.supabase.co", "k", "password, email ,google")?.signIn).toEqual(["google", "email", "password"]);
  });

  it("ignores sign-in methods it doesn't know", () => {
    expect(readBackend("https://x.supabase.co", "k", "google,facebook,passwrd")?.signIn).toEqual(["google"]);
    expect(readBackend("https://x.supabase.co", "k", "sms")?.signIn).toEqual([]);
  });
});

describe("env values pasted with a trailing newline (Vercel keeps it)", () => {
  it("are trimmed: URL, key, sign-in methods, Google client ID", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co\n");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "\n");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "sb_publishable_key\n");
    vi.stubEnv("VITE_SIGN_IN", "google,password\n");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "1234-abc.apps.googleusercontent.com\n");
    const config = await import("./config");
    expect(config.BACKEND).toEqual({ url: "https://example.supabase.co", anonKey: "sb_publishable_key", signIn: ["google", "password"] });
    expect(config.GOOGLE_CLIENT_ID).toBe("1234-abc.apps.googleusercontent.com");
  });
});

describe("the launch build (no VITE_SIGN_IN)", () => {
  it("offers Google only, from this site with the client ID", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "sb_publishable_key");
    vi.stubEnv("VITE_SIGN_IN", "");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "1234-abc.apps.googleusercontent.com");
    const config = await import("./config");
    expect(config.BACKEND?.signIn).toEqual(["google"]);
    expect(config.accountsOn).toBe(true);
    expect(config.GOOGLE_CLIENT_ID).toBe("1234-abc.apps.googleusercontent.com");
  });
});

describe("the Google client ID", () => {
  it("is a web client ID, trimmed; anything else keeps the redirect sign-in", () => {
    expect(readGoogleClientId("1234-abc_D.apps.googleusercontent.com")).toBe("1234-abc_D.apps.googleusercontent.com");
    expect(readGoogleClientId("  1234-abc.apps.googleusercontent.com\r\n")).toBe("1234-abc.apps.googleusercontent.com");
    expect(readGoogleClientId()).toBe("");
    expect(readGoogleClientId("\n")).toBe("");
    expect(readGoogleClientId("GOCSPX-secret")).toBe("");
    expect(readGoogleClientId("1234-abc.apps.googleusercontent.com 5678-def.apps.googleusercontent.com")).toBe("");
  });

  it("is used only when the build offers Google", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "k");
    vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "1234-abc.apps.googleusercontent.com");
    vi.stubEnv("VITE_SIGN_IN", "password");
    expect((await import("./config")).GOOGLE_CLIENT_ID).toBe("");
    vi.resetModules();
    vi.stubEnv("VITE_SIGN_IN", "google");
    expect((await import("./config")).GOOGLE_CLIENT_ID).toBe("1234-abc.apps.googleusercontent.com");
    // No backend, no Google.
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect((await import("./config")).GOOGLE_CLIENT_ID).toBe("");
  });
});

describe("the public key", () => {
  it("is read as VITE_SUPABASE_ANON_KEY, or VITE_SUPABASE_PUBLISHABLE_KEY (which wins)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "sb_publishable_old-name");
    expect((await import("./config")).BACKEND?.anonKey).toBe("sb_publishable_old-name");
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_new-name");
    expect((await import("./config")).BACKEND?.anonKey).toBe("sb_publishable_new-name");
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "");
    expect((await import("./config")).backendOn).toBe(true);
  });
});

describe("without a backend (no env)", () => {
  it("is off, imports no backend code, sends nothing and stores nothing", async () => {
    const imported = vi.fn();
    vi.doMock("@supabase/supabase-js", () => {
      imported("supabase");
      return {};
    });
    vi.doMock("./service", () => {
      imported("service");
      return {};
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { store, listeners } = fakeBrowser();

    const net = await import("./index");
    expect(net.backendOn).toBe(false);
    expect(net.accountsOn).toBe(false);
    net.startNet();
    net.reportList(game);
    net.reportBlitz(round, "2026-11-01");
    net.noteReset();
    expect(net.loadService()).toBeNull();
    await new Promise((r) => setTimeout(r, 10));

    expect(imported).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(store.size).toBe(0);

    // A rating is kept in the save (to show it as chosen later), and nothing else is stored or sent.
    net.rateList("mountains", "list", -1, "too-hard");
    net.rateList("airports", "blitz", 1, "boring");
    await new Promise((r) => setTimeout(r, 10));
    expect([...store.keys()]).toEqual(["top-tens:v1"]);
    const ratings = JSON.parse(store.get("top-tens:v1")!).ratings;
    expect(ratings["list:mountains"]).toMatchObject({ rating: -1, reason: "too-hard" });
    // A reason only goes with a thumbs down.
    expect(ratings["blitz:airports"]).toEqual({ rating: 1, at: expect.any(Number) });
    expect(imported).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(listeners).toEqual([]);
    const { getAccount } = await import("./store");
    expect(getAccount().status).toBe("off");

    // A note: nowhere to send it, so nothing is kept either (the build shows no note option).
    expect(net.submitFeedback("mountains", "list", "which state each park is in", -1)).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect([...store.keys()]).toEqual(["top-tens:v1"]);
    expect(JSON.parse(store.get("top-tens:v1")!)).not.toHaveProperty("feedback");
    expect(imported).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    // A Fathom guess: nothing sent, nothing queued.
    expect(net.submitFathomGuess("eiffel-tower-height", 300)).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect([...store.keys()]).toEqual(["top-tens:v1"]);
    expect(imported).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    // A guess the game didn't take, on a list or a Blitz round: nothing sent, nothing queued, no id made.
    expect(net.reportGuess("mountains", "list", "pizza", { kind: "unknown", junk: false })).toBe(false);
    expect(net.reportGuess("airports", "blitz", "xqzzvkw", { kind: "none", junk: true })).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect([...store.keys()]).toEqual(["top-tens:v1"]);
    expect(imported).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("with a backend", () => {
  function configure(signIn?: string) {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
    if (signIn !== undefined) vi.stubEnv("VITE_SIGN_IN", signIn);
  }

  it("hands finished games to the backend code, loaded on first use", async () => {
    configure();
    const svc = { start: vi.fn(), reportList: vi.fn(), reportBlitz: vi.fn() };
    vi.doMock("./service", () => svc);
    fakeBrowser();

    const net = await import("./index");
    expect(net.backendOn).toBe(true);
    expect(net.accountsOn).toBe(true);
    net.startNet();
    // Nothing waiting and nobody signed in: the backend code isn't loaded at startup.
    expect(svc.start).not.toHaveBeenCalled();
    net.reportList(game, "2026-11-01");
    net.reportBlitz(round);
    await vi.waitFor(() => expect(svc.reportBlitz).toHaveBeenCalled());
    expect(svc.reportList).toHaveBeenCalledWith(game, "2026-11-01");
    expect(svc.reportBlitz).toHaveBeenCalledWith(round, undefined);
  });

  it("keeps a rating in the save and hands it to the backend code, always after the one it replaces", async () => {
    configure();
    const svc = { start: vi.fn(), rateList: vi.fn() };
    vi.doMock("./service", () => svc);
    const { store } = fakeBrowser();
    const now = Date.UTC(2026, 10, 3, 12);
    vi.useFakeTimers({ now, toFake: ["Date"] });
    try {
      const net = await import("./index");
      net.rateList("mountains", "list", 1);
      net.rateList("mountains", "list", -1, "unfair");
      await vi.waitFor(() => expect(svc.rateList).toHaveBeenCalledTimes(2));
      const [first, second] = svc.rateList.mock.calls.map(([r]) => r);
      expect(first).toEqual({ listId: "mountains", mode: "list", rating: 1, reason: null, at: now });
      // The clock didn't move: the second still comes after the first.
      expect(second).toEqual({ listId: "mountains", mode: "list", rating: -1, reason: "unfair", at: now + 1 });
      expect(JSON.parse(store.get("top-tens:v1")!).ratings).toEqual({ "list:mountains": { rating: -1, reason: "unfair", at: now + 1 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads the backend code at startup when plays or ratings are waiting, or a session is stored", async () => {
    configure();
    const svc = { start: vi.fn() };
    vi.doMock("./service", () => svc);
    const { store } = fakeBrowser();
    store.set("top-tens:rating-outbox", JSON.stringify({ pending: [{ listId: "mountains" }], sent: [] }));
    const net = await import("./index");
    net.startNet();
    await vi.waitFor(() => expect(svc.start).toHaveBeenCalled());
  });

  it("queues a note in its own outbox before the backend code loads, then hands it over to send", async () => {
    configure();
    let release!: () => void;
    const loaded = new Promise<void>((r) => (release = r));
    const svc = { start: vi.fn(), flushFeedback: vi.fn() };
    vi.doMock("./service", async () => (await loaded, svc));
    const { store } = fakeBrowser();
    const now = Date.UTC(2026, 10, 4, 12);
    vi.useFakeTimers({ now, toFake: ["Date"] });
    try {
      const net = await import("./index");
      expect(net.submitFeedback("national-parks", "list", "  great list.\r\nsay which state each park is in \n", 1)).toBe(true);
      // The clock didn't move: a second note still gets a name of its own.
      expect(net.submitFeedback("national-parks", "list", "and the year it opened", null)).toBe(true);
      // Blank or too long: nothing to send.
      expect(net.submitFeedback("national-parks", "list", " \n ", null)).toBe(false);
      expect(net.submitFeedback("national-parks", "list", "x".repeat(501), null)).toBe(false);
      // Waiting already, though the backend code hasn't arrived (offline, it may never).
      const box = JSON.parse(store.get("top-tens:feedback-outbox")!);
      expect(box.pending).toEqual([
        { listId: "national-parks", mode: "list", rating: 1, text: "great list.\nsay which state each park is in", at: now },
        { listId: "national-parks", mode: "list", rating: null, text: "and the year it opened", at: now + 1 },
      ]);
      expect(svc.flushFeedback).not.toHaveBeenCalled();
      release();
      await vi.waitFor(() => expect(svc.flushFeedback).toHaveBeenCalledTimes(2));
      expect(svc.start).toHaveBeenCalled();
      // Never in the save.
      expect(store.get("top-tens:v1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("queues a Fathom guess in its own outbox before the backend code loads, once per question, then hands it over", async () => {
    configure();
    let release!: () => void;
    const loaded = new Promise<void>((r) => (release = r));
    const svc = { start: vi.fn(), flushFathom: vi.fn() };
    vi.doMock("./service", async () => (await loaded, svc));
    const { store } = fakeBrowser();
    const now = Date.UTC(2026, 10, 5, 12);
    vi.useFakeTimers({ now, toFake: ["Date"] });
    try {
      const net = await import("./index");
      expect(net.submitFathomGuess("eiffel-tower-height", 300)).toBe(true);
      expect(net.submitFathomGuess("moon-distance", 1.5e6)).toBe(true);
      // The same question again (a later game drew it): the first guess is the one that counts.
      expect(net.submitFathomGuess("eiffel-tower-height", 350)).toBe(false);
      expect(net.submitFathomGuess("Bad Id", 3)).toBe(false);
      // 0% is a fair percent; a name-it round sends the figure of the thing named (an island: 0 land borders).
      expect(net.submitFathomGuess("plastic-recycled", 0)).toBe(true);
      expect(net.submitFathomGuess("name-country-6-borders", 0)).toBe(true);
      expect(net.submitFathomGuess("name-country-50m-people", 52_890_000)).toBe(true);
      expect(net.submitFathomGuess("octopus-hearts", -1)).toBe(false);
      expect(JSON.parse(store.get("top-tens:fathom-outbox")!).pending).toEqual([
        { questionId: "eiffel-tower-height", guess: 300, at: now },
        { questionId: "moon-distance", guess: 1.5e6, at: now },
        { questionId: "plastic-recycled", guess: 0, at: now },
        { questionId: "name-country-6-borders", guess: 0, at: now },
        { questionId: "name-country-50m-people", guess: 52_890_000, at: now },
      ]);
      expect(svc.flushFathom).not.toHaveBeenCalled();
      release();
      await vi.waitFor(() => expect(svc.flushFathom).toHaveBeenCalledTimes(5));
      expect(svc.start).toHaveBeenCalled();
      // Not in the game's save, nor Fathom's.
      expect(store.get("top-tens:v1")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads the backend code at startup when Fathom guesses are waiting, and sends them when the browser comes online", async () => {
    configure();
    const svc = { start: vi.fn(), flushPlays: vi.fn(), flushRatings: vi.fn(), flushFeedback: vi.fn(), flushFathom: vi.fn() };
    vi.doMock("./service", () => svc);
    const { store } = fakeBrowser();
    const handlers = new Map<string, () => void>();
    vi.stubGlobal("addEventListener", (type: string, fn: () => void) => handlers.set(type, fn));
    store.set("top-tens:fathom-outbox", JSON.stringify({ pending: [{ questionId: "moon-distance", guess: 3, at: 1 }], sent: [] }));
    const net = await import("./index");
    net.startNet();
    await vi.waitFor(() => expect(svc.start).toHaveBeenCalled());
    handlers.get("online")!();
    await vi.waitFor(() => expect(svc.flushFathom).toHaveBeenCalled());
  });

  it("queues a guess the game didn't take in its own outbox before the backend code loads; never one it took or offered", async () => {
    configure();
    let release!: () => void;
    const loaded = new Promise<void>((r) => (release = r));
    const svc = { start: vi.fn(), flushMisses: vi.fn() };
    vi.doMock("./service", async () => (await loaded, svc));
    const { store } = fakeBrowser();
    const now = Date.UTC(2026, 10, 8, 12);
    vi.useFakeTimers({ now, toFake: ["Date"] });
    try {
      const net = await import("./index");
      const entry = { rank: 12, name: "Broad Peak", aliases: [] };
      // Taken or offered: an answer (corrected or not), a repeat, a near miss, a "did you mean", an empty box; on Blitz
      // a hit, a repeat, the choices, a place outside the region and an answer without a figure (both on the list).
      const taken: [string, Parameters<typeof net.reportGuess>[3]][] = [
        ["Broad Peak", { kind: "correct", entry, corrected: false }],
        ["brod peak", { kind: "correct", entry, corrected: true }],
        ["Broad Peak", { kind: "duplicate", entry }],
        ["Broad Peak", { kind: "near", entry, corrected: false }],
        ["brod", { kind: "typo", suggestions: ["Broad Peak", "Bride Peak"] }],
        ["", { kind: "empty" }],
        ["Broad Peak", { kind: "scored", hit: { name: "Broad Peak", rank: 12, n: 8051, points: 40 }, corrected: false }],
        ["Broad Peak", { kind: "duplicate", name: "Broad Peak" }],
        ["brod", { kind: "choices", suggestions: ["Broad Peak", "Bride Peak"] }],
        ["Japan", { kind: "none", junk: false, elsewhere: "Japan" }],
        ["Confessions", { kind: "none", junk: false, unscored: "Confessions" }],
        ["Broad Peak", { kind: "over" }],
      ];
      for (const [text, result] of taken) {
        expect(net.reportGuess("mountains", "list", text, result), result.kind).toBe(false);
        expect(net.reportGuess("mountains", "blitz", text, result), result.kind).toBe(false);
      }
      expect(store.get("top-tens:miss-outbox")).toBeUndefined();

      // Not taken: queued as short lowercase text, junk too (to find false junk calls), a vague guess too.
      expect(net.reportGuess("mountains", "list", "  Pizza   HUT ", { kind: "unknown", junk: false })).toBe(true);
      expect(net.reportGuess("mountains", "list", "xqzzvkw", { kind: "unknown", junk: true })).toBe(true);
      expect(net.reportGuess("mountains", "list", "Gasherbrum", { kind: "unknown", junk: false, vague: 4 })).toBe(true);
      expect(net.reportGuess("airports", "blitz", "Heathrow Express", { kind: "none", junk: false })).toBe(true);
      expect(net.reportGuess("airports", "blitz", "qqqq", { kind: "none", junk: true })).toBe(true);
      // The same text again on that list and mode: once.
      expect(net.reportGuess("mountains", "list", "pizza hut", { kind: "unknown", junk: false })).toBe(false);
      // Someone's details, or too long: never.
      expect(net.reportGuess("mountains", "list", "dana@example.com", { kind: "unknown", junk: true })).toBe(false);
      expect(net.reportGuess("mountains", "list", "call me 555 123 4567", { kind: "unknown", junk: false })).toBe(false);
      expect(net.reportGuess("mountains", "list", "https://example.com/dana", { kind: "unknown", junk: true })).toBe(false);
      expect(net.reportGuess("mountains", "list", "x".repeat(41), { kind: "unknown", junk: true })).toBe(false);
      expect(net.reportGuess("mountains", "list", " \t ", { kind: "unknown", junk: true })).toBe(false);
      // Waiting already, though the backend code hasn't arrived (offline, it may never).
      expect(JSON.parse(store.get("top-tens:miss-outbox")!).pending).toEqual([
        { listId: "mountains", mode: "list", kind: "unknown", text: "pizza hut", at: now },
        { listId: "mountains", mode: "list", kind: "junk", text: "xqzzvkw", at: now },
        { listId: "mountains", mode: "list", kind: "unknown", text: "gasherbrum", at: now },
        { listId: "airports", mode: "blitz", kind: "unknown", text: "heathrow express", at: now },
        { listId: "airports", mode: "blitz", kind: "junk", text: "qqqq", at: now },
      ]);
      expect(svc.flushMisses).not.toHaveBeenCalled();
      release();
      await vi.waitFor(() => expect(svc.flushMisses).toHaveBeenCalledTimes(5));
      expect(svc.start).toHaveBeenCalled();
      // Never in the save, and no id is made until one is sent.
      expect(store.get("top-tens:v1")).toBeUndefined();
      expect([...store.keys()]).toEqual(["top-tens:miss-outbox"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads the backend code at startup when misses are waiting, and sends them when the browser comes online", async () => {
    configure();
    const svc = { start: vi.fn(), flushPlays: vi.fn(), flushRatings: vi.fn(), flushFeedback: vi.fn(), flushFathom: vi.fn(), flushMisses: vi.fn() };
    vi.doMock("./service", () => svc);
    const { store } = fakeBrowser();
    const handlers = new Map<string, () => void>();
    vi.stubGlobal("addEventListener", (type: string, fn: () => void) => handlers.set(type, fn));
    store.set("top-tens:miss-outbox", JSON.stringify({ pending: [{ listId: "mountains", mode: "list", kind: "unknown", text: "pizza", at: 1 }], sent: [] }));
    const net = await import("./index");
    net.startNet();
    await vi.waitFor(() => expect(svc.start).toHaveBeenCalled());
    handlers.get("online")!();
    await vi.waitFor(() => expect(svc.flushMisses).toHaveBeenCalled());
  });

  it("loads the backend code at startup when notes are waiting, and sends them when the browser comes online", async () => {
    configure();
    const svc = { start: vi.fn(), flushPlays: vi.fn(), flushRatings: vi.fn(), flushFeedback: vi.fn() };
    vi.doMock("./service", () => svc);
    const { store } = fakeBrowser();
    const handlers = new Map<string, () => void>();
    vi.stubGlobal("addEventListener", (type: string, fn: () => void) => handlers.set(type, fn));
    store.set("top-tens:feedback-outbox", JSON.stringify({ pending: [{ listId: "mountains", text: "hi" }], sent: [] }));
    const net = await import("./index");
    net.startNet();
    await vi.waitFor(() => expect(svc.start).toHaveBeenCalled());
    handlers.get("online")!();
    await vi.waitFor(() => expect(svc.flushFeedback).toHaveBeenCalled());
  });

  it("loads the backend code at startup when plays are waiting or a session is stored", async () => {
    configure();
    const svc = { start: vi.fn() };
    vi.doMock("./service", () => svc);
    const { store } = fakeBrowser();
    store.set("top-tens:auth", "{}");
    const net = await import("./index");
    net.startNet();
    const { getAccount } = await import("./store");
    expect(getAccount().status).toBe("loading");
    await vi.waitFor(() => expect(svc.start).toHaveBeenCalled());
  });

  it("shows a stored session's player at once, before the backend code arrives", async () => {
    configure();
    vi.doMock("./service", () => ({ start: vi.fn() }));
    const { store } = fakeBrowser();
    store.set(
      "top-tens:auth",
      JSON.stringify({ access_token: "t", user: { id: "u-1", email: "dana@example.com", user_metadata: { full_name: "Dana Scully" }, app_metadata: { provider: "google" } } }),
    );
    const net = await import("./index");
    net.startNet();
    const { getAccount } = await import("./store");
    expect(getAccount()).toMatchObject({ status: "in", user: { id: "u-1", name: "Dana Scully", email: "dana@example.com", google: true } });
  });

  it("is signed out (not loading) at startup when there's no session, and off when accounts are switched off", async () => {
    configure();
    fakeBrowser();
    let net = await import("./index");
    net.startNet();
    expect((await import("./store")).getAccount().status).toBe("out");

    vi.resetModules();
    configure("none");
    fakeBrowser();
    net = await import("./index");
    expect(net.backendOn).toBe(true);
    expect(net.accountsOn).toBe(false);
    net.startNet();
    expect((await import("./store")).getAccount().status).toBe("off");
  });

  it("stamps a reset on the save only when signed in", async () => {
    configure();
    vi.doMock("./service", () => ({ syncSoon: vi.fn() }));
    const { store } = fakeBrowser();
    store.set("top-tens:v1", JSON.stringify({ games: {}, daily: {}, seenHelp: true }));
    const net = await import("./index");
    const { setAccount } = await import("./store");
    net.noteReset();
    expect(JSON.parse(store.get("top-tens:v1")!).resetAt).toBeUndefined();
    setAccount({ status: "in", user: { id: "u", name: "Dana" } });
    net.noteReset();
    expect(JSON.parse(store.get("top-tens:v1")!).resetAt).toBeGreaterThan(0);
  });
});
