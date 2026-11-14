import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { cleanMiss, looksPersonal } from "../src/net/misses";

/**
 * The migrations, run in PGlite (Postgres in WebAssembly) against small stand-ins for what Supabase provides: the
 * anon, authenticated and service_role roles, auth.users and auth.uid(). Checks the contract the game relies on: who
 * can touch what, what submit_play, rate_list, submit_feedback (on lists, Blitz rounds and Fathom questions),
 * submit_fathom_guess, submit_fathom_play and submit_miss accept, what the stats, ratings, Fathom comparison and day
 * totals functions return (every player counted, the owners
 * and testers included), that
 * notes and missed guesses are read only with the reader key (list_feedback, list_misses), that a miss is normalized
 * as the game normalizes it and linked to nobody, the save's version check, and what account deletion
 * (api/delete-account.ts, as service_role) needs.
 *
 * Everything runs twice: once as older projects set up public (every new table and function handed to the API roles,
 * which the migrations must take back), once with "Automatically expose new tables" off (nothing handed out, as in
 * the owner's project), where the migrations must grant exactly what the game uses.
 */

const standins = (exposeNewTables: boolean) => `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  ${
    exposeNewTables
      ? `alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
         alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`
      : `alter default privileges in schema public revoke execute on functions from public;`
  }
`;

const dir = join(import.meta.dirname, "migrations");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const client = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const utcDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function suite(exposeNewTables: boolean) {
  let db: PGlite;

  /** Run `fn` as a Supabase role (anon, authenticated as `user`, or service_role), then go back to the superuser. */
  async function as<T>(role: "anon" | "authenticated" | "service_role", user: string | null, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }
  }

  const submit = (args: { list?: string; mode?: string; score?: number; found?: number | null; client?: string; started?: string; daily?: string | null }) =>
    db.query<{ ok: boolean }>("select public.submit_play($1, $2, $3, $4, $5, $6, $7) as ok", [
      args.list ?? "mountains",
      args.mode ?? "list",
      args.score ?? 5,
      args.found === undefined ? (args.score ?? 5) : args.found,
      args.client ?? client(1),
      args.started ?? ago(5),
      args.daily ?? null,
    ]);

  const rate = (args: { list?: string; mode?: string; rating?: number | null; reason?: string | null; client?: string | null }) =>
    db.query<{ ok: boolean }>("select public.rate_list($1, $2, $3, $4, $5) as ok", [
      args.list ?? "mountains",
      args.mode ?? "list",
      args.rating === undefined ? 1 : args.rating,
      args.reason ?? null,
      args.client === undefined ? client(1) : args.client,
    ]);

  const note = (args: { list?: string; mode?: string; rating?: number | null; text?: string | null; client?: string | null }) =>
    db.query<{ ok: boolean }>("select public.submit_feedback($1, $2, $3, $4, $5) as ok", [
      args.list ?? "mountains",
      args.mode ?? "list",
      args.rating === undefined ? null : args.rating,
      args.text === undefined ? "a note" : args.text,
      args.client === undefined ? client(1) : args.client,
    ]);

  const miss = (args: { list?: string | null; mode?: string | null; kind?: string | null; text?: string | null; client?: string | null }) =>
    db.query<{ ok: boolean }>("select public.submit_miss($1, $2, $3, $4, $5) as ok", [
      args.list === undefined ? "mountains" : args.list,
      args.mode === undefined ? "list" : args.mode,
      args.kind === undefined ? "unknown" : args.kind,
      args.text === undefined ? "mount fuji" : args.text,
      args.client === undefined ? client(1) : args.client,
    ]);

  const fathomGuess = (args: { question?: string | null; guess?: number | string | null; client?: string | null }) =>
    db.query<{ ok: boolean }>("select public.submit_fathom_guess($1, $2, $3) as ok", [
      args.question === undefined ? "eiffel-tower-height" : args.question,
      args.guess === undefined ? 300 : args.guess,
      args.client === undefined ? client(1) : args.client,
    ]);

  const fathomPlay = (args: { date?: string | null; total?: number | null; client?: string | null }) =>
    db.query<{ ok: boolean }>("select public.submit_fathom_play($1, $2, $3) as ok", [
      args.date === undefined ? utcDay() : args.date,
      args.total === undefined ? 312 : args.total,
      args.client === undefined ? client(1) : args.client,
    ]);

  async function code(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p;
      return undefined;
    } catch (e) {
      return (e as { code?: string }).code;
    }
  }

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(standins(exposeNewTables));
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
    await db.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  }, 60_000);

  describe("plays", () => {
    it("takes a finished game from an anonymous player once", async () => {
      const started = ago(3);
      await as("anon", null, async () => {
        expect((await submit({ client: client(1), started })).rows[0].ok).toBe(true);
        expect((await submit({ client: client(1), started })).rows[0].ok).toBe(false);
        expect((await submit({ client: client(1), started, mode: "blitz", score: 300, found: 6 })).rows[0].ok).toBe(true);
      });
      const rows = await db.query<{ user_id: string | null }>("select user_id from public.plays where client_id = $1", [client(1)]);
      expect(rows.rows).toEqual([{ user_id: null }, { user_id: null }]);
    });

    it("refuses malformed games with invalid_parameter_value (a 400 from the API)", async () => {
      await as("anon", null, async () => {
        const bad = [
          { list: "Bad Id" },
          { list: "x".repeat(65) },
          { mode: "classic" },
          { score: 11, found: 10 },
          { score: -1 },
          { mode: "blitz", score: 5001 },
          { found: 11, score: 5 },
          { mode: "blitz", score: 10, found: 1001 },
          { found: null },
          { started: ago(25 * 60) },
          { started: ago(-10) },
          { daily: utcDay(-3) },
          { daily: utcDay(2) },
        ];
        for (const args of bad) expect(await code(submit({ client: client(2), ...args })), JSON.stringify(args)).toBe("22023");
        // A daily date one day either side of the UTC date is fine (time zones).
        for (const d of [-1, 0, 1]) expect((await submit({ client: client(2), daily: utcDay(d), started: ago(10 + d) })).rows[0].ok).toBe(true);
      });
    });

    it("gives players no direct access to the table", async () => {
      await as("anon", null, async () => {
        expect(await code(db.query("select * from public.plays"))).toBe("42501");
        expect(await code(db.query("insert into public.plays (list_id, mode, score, client_id, started_at) values ('x', 'list', 1, $1, now())", [client(3)]))).toBe("42501");
        expect(await code(db.query("delete from public.plays"))).toBe("42501");
      });
      await as("authenticated", A, async () => {
        expect(await code(db.query("select * from public.plays"))).toBe("42501");
        expect(await code(db.query("update public.plays set score = 10"))).toBe("42501");
      });
    });

    it("links a signed-in player's games to the account", async () => {
      await as("authenticated", A, () => submit({ list: "islands", client: client(4), started: ago(2) }));
      const rows = await db.query<{ user_id: string }>("select user_id from public.plays where client_id = $1", [client(4)]);
      expect(rows.rows).toEqual([{ user_id: A }]);
    });

    it("ignores a browser past 120 games an hour", async () => {
      await as("anon", null, async () => {
        for (let i = 0; i < 120; i++) expect((await submit({ list: "spam", client: client(5), started: ago(i / 100) })).rows[0].ok).toBe(true);
        expect((await submit({ list: "spam", client: client(5), started: ago(30) })).rows[0].ok).toBe(false);
      });
    });
  });

  describe("list_stats and list_averages", () => {
    beforeAll(async () => {
      await as("anon", null, async () => {
        // 60 players on "airports": scores 0-10 spread out; then each replays and scores 10, which mustn't count.
        for (let i = 0; i < 60; i++) {
          await submit({ list: "airports", client: client(100 + i), score: i % 11, started: ago(60) });
          await submit({ list: "airports", client: client(100 + i), score: 10, started: ago(30) });
        }
        // Blitz scores 0, 60, 120, ...
        for (let i = 0; i < 12; i++) await submit({ list: "airports", mode: "blitz", client: client(200 + i), score: i * 60, found: i, started: ago(40) });
      });
      // One signed-in player on two devices is one player.
      await as("authenticated", B, async () => {
        await submit({ list: "airports", client: client(300), score: 3, started: ago(50) });
        await submit({ list: "airports", client: client(301), score: 9, started: ago(20) });
      });
    });

    it("counts each player's first game on a list: 11 buckets for lists", async () => {
      const stats = await as("anon", null, () => db.query<{ s: { n: number; counts: number[]; avg: number } }>("select public.list_stats('airports', 'list') as s"));
      const { n, counts, avg } = stats.rows[0].s;
      expect(n).toBe(61);
      expect(counts).toHaveLength(11);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(61);
      // 60 players at i % 11 (6 each at 0-4, 5 each at 5-10), plus B's first game, a 3.
      expect(counts).toEqual([6, 6, 6, 7, 6, 5, 5, 5, 5, 5, 5]);
      expect(avg).toBeCloseTo(([...Array(60).keys()].reduce((a, i) => a + (i % 11), 0) + 3) / 61, 2);
    });

    it("buckets Blitz scores by 50 points, up to the top one reached", async () => {
      const stats = await db.query<{ s: { n: number; counts: number[] } }>("select public.list_stats('airports', 'blitz') as s");
      const { n, counts } = stats.rows[0].s;
      expect(n).toBe(12);
      // 0, 60, 120, ..., 660: buckets 0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13.
      expect(counts).toHaveLength(14);
      expect(counts).toEqual([1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1]);
    });

    it("answers an unplayed list with zeros", async () => {
      expect((await db.query<{ s: unknown }>("select public.list_stats('nobody-played', 'list') as s")).rows[0].s).toEqual({ n: 0, counts: Array(11).fill(0), avg: null });
      expect((await db.query<{ s: unknown }>("select public.list_stats('nobody-played', 'blitz') as s")).rows[0].s).toEqual({ n: 0, counts: [], avg: null });
    });

    it("averages every list, one score per player", async () => {
      const rows = await as("anon", null, () => db.query<{ list_id: string; n: number; avg: string }>("select * from public.list_averages('list')"));
      const airports = rows.rows.find((r) => r.list_id === "airports")!;
      expect(airports.n).toBe(61);
      // 60 players scoring i % 11 (sum 285) and B's first game, a 3.
      expect(Number(airports.avg)).toBeCloseTo(288 / 61, 2);
    });
  });

  describe("everyone in the stats, the owners and testers included (owner, Nov 9)", () => {
    // C is an owner, D a tester: an account like any other.
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    it("counts the owner's and the testers' first games like anyone's, signed in or not", async () => {
      await db.query("insert into auth.users (id, email) values ($1, 'c@example.com'), ($2, 'd@example.com')", [C, D]);
      await db.query("insert into public.owners (user_id) values ($1)", [C]);
      // A player scores 4. The owner scores 10 signed in, and 10 signed out on a browser he rates with signed in; the
      // tester scores 10 signed in.
      await as("anon", null, async () => {
        await submit({ list: "s-tests", client: client(700), score: 4, started: ago(60) });
        await submit({ list: "s-tests", client: client(741), score: 10, started: ago(55) });
      });
      await as("authenticated", C, async () => {
        await submit({ list: "s-tests", client: client(740), score: 10, started: ago(50) });
        await rate({ list: "s-other", client: client(741) });
      });
      await as("authenticated", D, () => submit({ list: "s-tests", client: client(750), score: 10, started: ago(50) }));
      const stats = await as("anon", null, () => db.query<{ s: unknown }>("select public.list_stats('s-tests', 'list') as s"));
      expect(stats.rows[0].s).toEqual({ n: 4, counts: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 3], avg: 8.5 });
      const averages = await as("anon", null, () => db.query<{ list_id: string; n: number; avg: string }>("select * from public.list_averages('list')"));
      const row = averages.rows.find((r) => r.list_id === "s-tests");
      expect([row?.n, Number(row?.avg)]).toEqual([4, 8.5]);
    });
  });

  describe("ratings", () => {
    type Row = { list_id: string; mode: string; rating: number; reason: string | null; user_id: string | null; client_id: string };
    const rows = (list: string) =>
      db.query<Row>("select list_id, mode, rating, reason, user_id, client_id from public.ratings where list_id = $1 order by mode, client_id", [list]);
    type Totals = { list_id: string; mode: string; up: number; down: number; too_hard: number; too_easy: number; boring: number; unfair: number; wrong_data: number; last_rated: Date };
    const totals = async (list: string, since?: string) =>
      (
        await as("anon", null, () =>
          since ? db.query<Totals>("select * from public.list_ratings($1)", [since]) : db.query<Totals>("select * from public.list_ratings()"),
        )
      ).rows.filter((r) => r.list_id === list);

    it("takes a rating, and a player's latest replaces their earlier one; 0 takes it back", async () => {
      await as("anon", null, async () => {
        expect((await rate({ list: "r-mountains", client: client(500) })).rows[0].ok).toBe(true);
        expect((await rate({ list: "r-mountains", client: client(500), rating: -1, reason: "too-hard" })).rows[0].ok).toBe(true);
      });
      expect((await rows("r-mountains")).rows).toEqual([
        { list_id: "r-mountains", mode: "list", rating: -1, reason: "too-hard", user_id: null, client_id: client(500) },
      ]);
      const stamp = await db.query<{ later: boolean }>("select updated_at >= created_at as later from public.ratings where list_id = 'r-mountains'");
      expect(stamp.rows[0].later).toBe(true);
      await as("anon", null, async () => {
        // The reason goes when the next rating has none; Blitz is a rating of its own.
        await rate({ list: "r-mountains", client: client(500), rating: -1 });
        await rate({ list: "r-mountains", mode: "blitz", client: client(500) });
      });
      expect((await rows("r-mountains")).rows.map((r) => [r.mode, r.rating, r.reason])).toEqual([
        ["blitz", 1, null],
        ["list", -1, null],
      ]);
      await as("anon", null, () => rate({ list: "r-mountains", client: client(500), rating: 0 }));
      expect((await rows("r-mountains")).rows.map((r) => r.mode)).toEqual(["blitz"]);
    });

    it("refuses malformed ratings with invalid_parameter_value (a 400 from the API)", async () => {
      await as("anon", null, async () => {
        const bad = [
          { list: "Bad Id" },
          { list: "x".repeat(65) },
          { mode: "classic" },
          { rating: 2 },
          { rating: -2 },
          { rating: null },
          { rating: -1, reason: "meh" },
          { rating: 1, reason: "boring" },
          { rating: 0, reason: "boring" },
          { client: null },
        ];
        for (const args of bad) expect(await code(rate({ list: "r-bad", client: client(501), ...args })), JSON.stringify(args)).toBe("22023");
        for (const reason of ["too-hard", "too-easy", "boring", "unfair", "wrong-data"]) {
          expect((await rate({ list: "r-bad", client: client(501), rating: -1, reason })).rows[0].ok).toBe(true);
        }
      });
      expect((await rows("r-bad")).rows.map((r) => r.reason)).toEqual(["wrong-data"]);
    });

    it("gives players no direct access to the table", async () => {
      for (const [role, user] of [["anon", null], ["authenticated", A]] as const) {
        await as(role, user, async () => {
          expect(await code(db.query("select * from public.ratings"))).toBe("42501");
          expect(await code(db.query("insert into public.ratings (list_id, mode, rating, client_id) values ('x', 'list', 1, $1)", [client(502)]))).toBe("42501");
          expect(await code(db.query("update public.ratings set rating = 1"))).toBe("42501");
          expect(await code(db.query("delete from public.ratings"))).toBe("42501");
        });
      }
    });

    it("links a signed-in player's rating, one per list and mode across their devices", async () => {
      await as("authenticated", A, () => rate({ list: "r-islands", client: client(510) }));
      expect((await rows("r-islands")).rows.map((r) => [r.client_id, r.rating, r.user_id])).toEqual([[client(510), 1, A]]);
      // The same player on another device: that device's rating replaces the first one.
      await as("authenticated", A, () => rate({ list: "r-islands", client: client(511), rating: -1, reason: "boring" }));
      // Someone else's rating of the list stays.
      await as("anon", null, () => rate({ list: "r-islands", client: client(512) }));
      expect((await rows("r-islands")).rows.map((r) => [r.client_id, r.rating, r.user_id])).toEqual([
        [client(511), -1, A],
        [client(512), 1, null],
      ]);
      // Taken back from a third device: gone everywhere.
      await as("authenticated", A, () => rate({ list: "r-islands", client: client(513), rating: 0 }));
      expect((await rows("r-islands")).rows.map((r) => r.client_id)).toEqual([client(512)]);
    });

    it("ignores a browser past 120 ratings an hour", async () => {
      await as("anon", null, async () => {
        for (let i = 0; i < 120; i++) expect((await rate({ list: `r-spam-${i}`, client: client(520) })).rows[0].ok).toBe(true);
        expect((await rate({ list: "r-spam-x", client: client(520) })).rows[0].ok).toBe(false);
        // Another browser is fine.
        expect((await rate({ list: "r-spam-x", client: client(521) })).rows[0].ok).toBe(true);
      });
      expect((await rows("r-spam-x")).rows.map((r) => r.client_id)).toEqual([client(521)]);
    });

    it("totals each list per mode, one rating per player, with no ids, for the public key", async () => {
      await as("anon", null, async () => {
        for (let i = 0; i < 3; i++) await rate({ list: "r-airports", client: client(530 + i) });
        await rate({ list: "r-airports", client: client(533), rating: -1, reason: "too-hard" });
        await rate({ list: "r-airports", client: client(534), rating: -1, reason: "wrong-data" });
        await rate({ list: "r-airports", client: client(535), rating: -1 });
        await rate({ list: "r-airports", mode: "blitz", client: client(530) });
      });
      // B on two devices, and an older row of theirs from before one rating per player was kept: counted once (the latest).
      await as("authenticated", B, () => rate({ list: "r-airports", client: client(536), rating: -1, reason: "boring" }));
      await db.query("insert into public.ratings (list_id, mode, rating, client_id, user_id, updated_at) values ('r-airports', 'list', 1, $1, $2, now() - interval '1 day')", [client(537), B]);

      const all = await totals("r-airports");
      expect(all.map((t) => Object.keys(t))).toEqual(Array(2).fill(["list_id", "mode", "up", "down", "too_hard", "too_easy", "boring", "unfair", "wrong_data", "last_rated"]));
      expect(all.map(({ last_rated, ...t }) => (expect(last_rated).toBeInstanceOf(Date), t))).toEqual([
        { list_id: "r-airports", mode: "blitz", up: 1, down: 0, too_hard: 0, too_easy: 0, boring: 0, unfair: 0, wrong_data: 0 },
        { list_id: "r-airports", mode: "list", up: 3, down: 4, too_hard: 1, too_easy: 0, boring: 1, unfair: 0, wrong_data: 1 },
      ]);

      // Since a date: only ratings given or changed after it.
      await db.query("update public.ratings set updated_at = now() - interval '3 days' where list_id = 'r-airports' and client_id in ($1, $2)", [client(530), client(533)]);
      const recent = await totals("r-airports", new Date(Date.now() - 86_400_000).toISOString());
      expect(recent.map((t) => [t.mode, t.up, t.down, t.too_hard])).toEqual([["list", 2, 3, 0]]);
      // A list nobody rated isn't there.
      expect(await totals("nobody-rated")).toEqual([]);
    });
  });

  describe("feedback (notes)", () => {
    type Row = { list_id: string; mode: string; rating: number | null; text: string; user_id: string | null; client_id: string };
    const rows = (list: string) =>
      db.query<Row>("select list_id, mode, rating, text, user_id, client_id from public.feedback where list_id = $1 order by id", [list]);
    type Read = { list_id: string; mode: string; rating: number | null; text: string; from_owner: boolean; created_at: Date };
    const KEY = "a-long-random-reader-key-0123456789";
    /** list_feedback as the game's public key would call it (anon). */
    const read = (reader: string | null, since?: string) =>
      as("anon", null, () =>
        since === undefined
          ? db.query<Read>("select * from public.list_feedback($1)", [reader])
          : db.query<Read>("select * from public.list_feedback($1, $2)", [reader, since]),
      );

    it("takes notes from anyone, trimmed, with the rating at the time; a player may send more than one", async () => {
      await as("anon", null, async () => {
        expect((await note({ list: "f-parks", text: "  great list, could say which state\n\n", rating: 1, client: client(600) })).rows[0].ok).toBe(true);
        expect((await note({ list: "f-parks", text: "second thought", client: client(600) })).rows[0].ok).toBe(true);
        expect((await note({ list: "f-parks", mode: "blitz", text: "line one\nline two", rating: -1, client: client(600) })).rows[0].ok).toBe(true);
        // A retry whose answer got lost: the same note from the same browser is kept once.
        expect((await note({ list: "f-parks", text: "second thought", client: client(600) })).rows[0].ok).toBe(true);
      });
      // Signed in: linked to the account.
      await as("authenticated", B, () => note({ list: "f-parks", text: "from b", rating: -1, client: client(601) }));
      expect((await rows("f-parks")).rows).toEqual([
        { list_id: "f-parks", mode: "list", rating: 1, text: "great list, could say which state", user_id: null, client_id: client(600) },
        { list_id: "f-parks", mode: "list", rating: null, text: "second thought", user_id: null, client_id: client(600) },
        { list_id: "f-parks", mode: "blitz", rating: -1, text: "line one\nline two", user_id: null, client_id: client(600) },
        { list_id: "f-parks", mode: "list", rating: -1, text: "from b", user_id: B, client_id: client(601) },
      ]);
    });

    it("refuses malformed notes with invalid_parameter_value (a 400 from the API)", async () => {
      await as("anon", null, async () => {
        const bad = [
          { list: "Bad Id" },
          { list: "x".repeat(65) },
          { mode: "classic" },
          { rating: 0 },
          { rating: 2 },
          { text: null },
          { text: "" },
          { text: " \n\t " },
          { text: "x".repeat(501) },
          { client: null },
        ];
        for (const args of bad) expect(await code(note({ list: "f-bad", client: client(602), ...args })), JSON.stringify(args)).toBe("22023");
        // 500 characters is fine, counted after trimming (and in characters, not bytes).
        expect((await note({ list: "f-bad", client: client(602), text: ` ${"é".repeat(500)}\n` })).rows[0].ok).toBe(true);
      });
      expect((await rows("f-bad")).rows.map((r) => r.text.length)).toEqual([500]);
    });

    it("gives players no access to the notes, the owners or the reader key", async () => {
      for (const [role, user] of [["anon", null], ["authenticated", A]] as const) {
        await as(role, user, async () => {
          expect(await code(db.query("select * from public.feedback"))).toBe("42501");
          expect(await code(db.query("insert into public.feedback (list_id, mode, text, client_id) values ('x', 'list', 'hi', $1)", [client(603)]))).toBe("42501");
          expect(await code(db.query("update public.feedback set text = 'x'"))).toBe("42501");
          expect(await code(db.query("delete from public.feedback"))).toBe("42501");
          expect(await code(db.query("select * from public.owners"))).toBe("42501");
          expect(await code(db.query("insert into public.owners (user_id) values ($1)", [user ?? A]))).toBe("42501");
          expect(await code(db.query("select * from private.reader_keys"))).toBe("42501");
          // Only the SQL editor (or the secret key) sets the reader key.
          expect(await code(db.query("select public.set_feedback_reader($1)", ["a-key-anyone-would-like-to-set-1234"]))).toBe("42501");
        });
      }
    });

    it("keeps notes from the public key: list_feedback needs the reader key, stored only as its hash", async () => {
      // No key set yet: nobody reads.
      expect(await code(read("anything"))).toBe("42501");
      expect(await code(read(KEY))).toBe("42501");
      // The secret key (service_role) or the SQL editor sets it; a short one is refused.
      await as("service_role", null, async () => {
        expect(await code(db.query("select public.set_feedback_reader($1)", ["short"]))).toBe("22023");
        expect(await code(db.query("select public.set_feedback_reader($1)", [null]))).toBe("22023");
        await db.query("select public.set_feedback_reader($1)", ["an-older-key-replaced-below-0123456789"]);
      });
      await db.query("select public.set_feedback_reader($1)", [KEY]);
      const stored = await db.query<{ name: string; hex: string; is_hash: boolean }>(
        "select name, encode(key_hash, 'hex') as hex, key_hash = sha256(convert_to($1, 'UTF8')) as is_hash from private.reader_keys",
        [KEY],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]).toMatchObject({ name: "feedback", is_hash: true });
      expect(stored.rows[0].hex).not.toContain(Buffer.from(KEY).toString("hex"));

      // A wrong key, the replaced key, none at all: refused, for anon and signed-in players alike.
      for (const wrong of ["anything", "an-older-key-replaced-below-0123456789", KEY.toUpperCase(), `${KEY} `, "", null]) {
        expect(await code(read(wrong)), String(wrong)).toBe("42501");
      }
      await as("authenticated", A, async () => {
        expect(await code(db.query("select * from public.list_feedback($1)", ["anything"]))).toBe("42501");
      });
      // The right key reads them, with no ids.
      const got = await read(KEY);
      expect(got.rows.length).toBeGreaterThan(0);
      expect(Object.keys(got.rows[0])).toEqual(["list_id", "mode", "rating", "text", "from_owner", "created_at"]);
      expect(got.rows.some((r) => r.text === "great list, could say which state")).toBe(true);
    });

    it("takes the reader key from an X-Feedback-Reader header too (the cloud environment's proxy adds it, unseen)", async () => {
      // PostgREST hands the request's headers to the function as request.headers (names lowercased).
      const viaHeader = async (header: string | null, reader: string | null = null) => {
        await db.query("select set_config('request.headers', $1, false)", [header === null ? "" : JSON.stringify({ "x-feedback-reader": header })]);
        try {
          return await read(reader);
        } finally {
          await db.query("select set_config('request.headers', '', false)");
        }
      };
      // KEY is set by the test above.
      expect((await viaHeader(KEY)).rows.length).toBeGreaterThan(0);
      // An empty p_reader still falls back to the header.
      expect((await viaHeader(KEY, "")).rows.length).toBeGreaterThan(0);
      for (const wrong of ["anything", "", `${KEY} `]) expect(await code(viaHeader(wrong)), wrong).toBe("42501");
      // No header at all, or a wrong key in the body beside a right header: refused (the body wins when given).
      expect(await code(viaHeader(null))).toBe("42501");
      expect(await code(viaHeader(KEY, "anything"))).toBe("42501");
      // Malformed headers never get past the check.
      await db.query("select set_config('request.headers', 'not json', false)");
      try {
        expect(await code(read(null))).toBe("42501");
      } finally {
        await db.query("select set_config('request.headers', '', false)");
      }
    });

    it("lists the owner's notes first, then the newest first; p_since keeps only newer ones", async () => {
      await db.query("insert into public.owners (user_id) values ($1)", [A]);
      await as("anon", null, async () => {
        await note({ list: "f-order", text: "old anon", client: client(610) });
        await note({ list: "f-order", text: "new anon", client: client(611) });
      });
      await as("authenticated", A, async () => {
        await note({ list: "f-order", text: "owner old", client: client(612), rating: 1 });
        await note({ list: "f-order", text: "owner new", client: client(612) });
      });
      await as("authenticated", B, () => note({ list: "f-order", text: "b, signed in", client: client(613) }));
      const at = (text: string, hoursAgo: number) =>
        db.query("update public.feedback set created_at = now() - make_interval(hours => $2) where list_id = 'f-order' and text = $1", [text, hoursAgo]);
      await at("old anon", 50);
      await at("new anon", 1);
      await at("owner old", 30);
      await at("owner new", 2);
      await at("b, signed in", 3);

      const order = (r: Read[]) => r.filter((x) => x.list_id === "f-order").map((x) => [x.text, x.from_owner]);
      expect(order((await read(KEY)).rows)).toEqual([
        ["owner new", true],
        ["owner old", true],
        ["new anon", false],
        ["b, signed in", false],
        ["old anon", false],
      ]);
      // Across lists too: the owner's come before everyone else's.
      const all = (await read(KEY)).rows;
      expect(all.findIndex((r) => !r.from_owner)).toBe(all.filter((r) => r.from_owner).length);
      expect(order((await read(KEY, new Date(Date.now() - 24 * 3_600_000).toISOString())).rows)).toEqual([
        ["owner new", true],
        ["new anon", false],
        ["b, signed in", false],
      ]);
    });

    it("ignores a browser past 20 notes an hour", async () => {
      await as("anon", null, async () => {
        for (let i = 0; i < 20; i++) expect((await note({ list: `f-spam-${i}`, text: `spam ${i}`, client: client(620) })).rows[0].ok).toBe(true);
        expect((await note({ list: "f-spam-x", text: "one more", client: client(620) })).rows[0].ok).toBe(false);
        // Another browser is fine.
        expect((await note({ list: "f-spam-x", text: "someone else", client: client(621) })).rows[0].ok).toBe(true);
      });
      expect((await rows("f-spam-x")).rows.map((r) => r.client_id)).toEqual([client(621)]);
      // An hour on, the first browser may write again.
      await db.query("update public.feedback set created_at = now() - interval '61 minutes' where client_id = $1", [client(620)]);
      expect((await as("anon", null, () => note({ list: "f-spam-x", text: "later", client: client(620) }))).rows[0].ok).toBe(true);
    });
  });

  // The owner, Nov 14: "add the same feedback system for fathom that we currently have for lists/blitz- ideally we keep
  // the same mechanics and tables". Mode 'fathom', the question's id as list_id (20261114130000_fathom_feedback.sql).
  describe("Fathom ratings and notes", () => {
    // R rates on two browsers and deletes their account at the end; S is anyone signed in.
    const R = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
    const S = "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2";
    const Q = "first-homo-sapiens";
    const KEY = "a-long-random-reader-key-for-fathom-0123";
    type Row = { list_id: string; mode: string; rating: number; reason: string | null; user_id: string | null; client_id: string };
    const ratingRows = (list: string) =>
      db.query<Row>("select list_id, mode, rating, reason, user_id, client_id from public.ratings where list_id = $1 order by mode, client_id", [list]);
    type Totals = { list_id: string; mode: string; up: number; down: number; too_hard: number; too_easy: number; boring: number; unfair: number; wrong_data: number };
    const totals = async (list: string) =>
      (await as("anon", null, () => db.query<Totals & { last_rated: Date }>("select * from public.list_ratings()"))).rows
        .filter((r) => r.list_id === list)
        .map(({ last_rated, ...t }) => (expect(last_rated).toBeInstanceOf(Date), t));
    type Read = { list_id: string; mode: string; rating: number | null; text: string; from_owner: boolean };
    const readNotes = (reader: string | null) => as("anon", null, () => db.query<Read & { created_at: Date }>("select * from public.list_feedback($1)", [reader]));

    beforeAll(async () => {
      await db.query("insert into auth.users (id, email) values ($1, 'r@example.com'), ($2, 's@example.com')", [R, S]);
      await db.query("select public.set_feedback_reader($1)", [KEY]);
    });

    it("rates a Fathom question as a list is rated: the latest replaces the earlier, 0 takes it back, a list of the same id apart", async () => {
      await as("anon", null, async () => {
        expect((await rate({ list: Q, mode: "fathom", client: client(4000) })).rows[0].ok).toBe(true);
        expect((await rate({ list: Q, mode: "fathom", client: client(4000), rating: -1, reason: "unfair" })).rows[0].ok).toBe(true);
        expect((await rate({ list: Q, mode: "list", client: client(4000) })).rows[0].ok).toBe(true);
      });
      expect((await ratingRows(Q)).rows).toEqual([
        { list_id: Q, mode: "fathom", rating: -1, reason: "unfair", user_id: null, client_id: client(4000) },
        { list_id: Q, mode: "list", rating: 1, reason: null, user_id: null, client_id: client(4000) },
      ]);
      await as("anon", null, () => rate({ list: Q, mode: "fathom", client: client(4000), rating: 0 }));
      expect((await ratingRows(Q)).rows.map((r) => r.mode)).toEqual(["list"]);
    });

    it("takes the same reasons, and refuses what a list refuses (invalid_parameter_value)", async () => {
      await as("anon", null, async () => {
        for (const reason of ["too-hard", "too-easy", "boring", "unfair", "wrong-data"]) {
          expect((await rate({ list: "fr-reasons", mode: "fathom", client: client(4001), rating: -1, reason })).rows[0].ok).toBe(true);
        }
        const bad = [{ mode: "Fathom" }, { mode: "fathoms" }, { mode: "name" }, { mode: "" }, { list: "Bad Id" }, { rating: 1, reason: "boring" }, { rating: -1, reason: "meh" }];
        for (const args of bad) expect(await code(rate({ list: "fr-bad", mode: "fathom", client: client(4002), ...args })), JSON.stringify(args)).toBe("22023");
        for (const args of [{ mode: "Fathom" }, { mode: "estimate" }, { rating: 0 }, { text: " " }, { list: "x".repeat(65) }]) {
          expect(await code(note({ list: "fn-bad", mode: "fathom", client: client(4002), ...args })), JSON.stringify(args)).toBe("22023");
        }
      });
      expect((await ratingRows("fr-reasons")).rows.map((r) => [r.mode, r.reason])).toEqual([["fathom", "wrong-data"]]);
      expect((await ratingRows("fr-bad")).rows).toEqual([]);
    });

    it("keeps one rating per question across a signed-in player's devices, linked to the account", async () => {
      await as("authenticated", R, () => rate({ list: "fr-moon", mode: "fathom", client: client(4010) }));
      await as("authenticated", R, () => rate({ list: "fr-moon", mode: "fathom", client: client(4011), rating: -1, reason: "too-hard" }));
      await as("authenticated", S, () => rate({ list: "fr-moon", mode: "fathom", client: client(4012) }));
      expect((await ratingRows("fr-moon")).rows.map((r) => [r.client_id, r.rating, r.user_id])).toEqual([
        [client(4011), -1, R],
        [client(4012), 1, S],
      ]);
    });

    it("totals each question under mode fathom in list_ratings, with the public key", async () => {
      await as("anon", null, async () => {
        for (let i = 0; i < 3; i++) await rate({ list: "fr-totals", mode: "fathom", client: client(4020 + i) });
        await rate({ list: "fr-totals", mode: "fathom", client: client(4023), rating: -1, reason: "boring" });
        await rate({ list: "fr-totals", mode: "fathom", client: client(4024), rating: -1 });
        await rate({ list: "fr-totals", mode: "blitz", client: client(4020), rating: -1, reason: "too-easy" });
      });
      expect(await totals("fr-totals")).toEqual([
        { list_id: "fr-totals", mode: "blitz", up: 0, down: 1, too_hard: 0, too_easy: 1, boring: 0, unfair: 0, wrong_data: 0 },
        { list_id: "fr-totals", mode: "fathom", up: 3, down: 2, too_hard: 0, too_easy: 0, boring: 1, unfair: 0, wrong_data: 0 },
      ]);
    });

    it("takes notes on a question with the rating at the time, read only with the reader key, as a list's", async () => {
      await as("anon", null, async () => {
        expect((await note({ list: "fn-moon", mode: "fathom", text: "  the definition gave it away \n", rating: -1, client: client(4030) })).rows[0].ok).toBe(true);
        // A retry whose answer got lost: once.
        expect((await note({ list: "fn-moon", mode: "fathom", text: "the definition gave it away", rating: -1, client: client(4030) })).rows[0].ok).toBe(true);
        // The same text on a list of that id is its own note.
        expect((await note({ list: "fn-moon", mode: "list", text: "the definition gave it away", client: client(4030) })).rows[0].ok).toBe(true);
      });
      await as("authenticated", R, () => note({ list: "fn-moon", mode: "fathom", text: "fun one", rating: 1, client: client(4031) }));
      const stored = await db.query<Row & { text: string }>(
        "select list_id, mode, rating, text, user_id, client_id from public.feedback where list_id = 'fn-moon' order by id",
      );
      expect(stored.rows.map((r) => [r.mode, r.rating, r.text, r.user_id])).toEqual([
        ["fathom", -1, "the definition gave it away", null],
        ["list", null, "the definition gave it away", null],
        ["fathom", 1, "fun one", R],
      ]);
      // The public key alone, or a wrong key, reads nothing; the reader key reads them under mode fathom, with no ids.
      for (const wrong of [null, "", "anything", KEY.toUpperCase()]) expect(await code(readNotes(wrong)), String(wrong)).toBe("42501");
      const got = (await readNotes(KEY)).rows.filter((r) => r.list_id === "fn-moon");
      expect(got.map((r) => [r.mode, r.rating, r.text, r.from_owner])).toEqual([
        ["fathom", 1, "fun one", false],
        ["list", null, "the definition gave it away", false],
        ["fathom", -1, "the definition gave it away", false],
      ]);
      expect(Object.keys(got[0])).toEqual(["list_id", "mode", "rating", "text", "from_owner", "created_at"]);
    });

    it("holds the tables to list, blitz and fathom, and keeps one mode check on each", async () => {
      for (const table of ["ratings", "feedback"]) {
        const cols = table === "ratings" ? "(list_id, mode, rating, client_id) values ('fr-direct', $1, 1, $2)" : "(list_id, mode, text, client_id) values ('fr-direct', $1, 'hi', $2)";
        expect(await code(db.query(`insert into public.${table} ${cols}`, ["fathom", client(4040)])), table).toBeUndefined();
        expect(await code(db.query(`insert into public.${table} ${cols}`, ["quiz", client(4041)])), table).toBe("23514");
      }
      const checks = await db.query<{ tbl: string; name: string; def: string }>(
        `select rel.relname as tbl, con.conname as name, pg_get_constraintdef(con.oid) as def
         from pg_constraint con join pg_class rel on rel.oid = con.conrelid
         join pg_attribute att on att.attrelid = rel.oid and con.conkey = array[att.attnum]
         where rel.relnamespace = 'public'::regnamespace and rel.relname in ('ratings', 'feedback') and con.contype = 'c' and att.attname = 'mode'
         order by 1`,
      );
      expect(checks.rows.map((r) => [r.tbl, r.name])).toEqual([
        ["feedback", "feedback_mode_check"],
        ["ratings", "ratings_mode_check"],
      ]);
      for (const r of checks.rows) expect(r.def).toMatch(/'list'.*'blitz'.*'fathom'/);
      // Players still can't touch either table.
      await as("anon", null, async () => {
        expect(await code(db.query("select * from public.ratings"))).toBe("42501");
        expect(await code(db.query("insert into public.feedback (list_id, mode, text, client_id) values ('x', 'fathom', 'hi', $1)", [client(4042)]))).toBe("42501");
      });
    });

    it("keeps the functions' signatures, and is safe to run again", async () => {
      const sig = () =>
        db.query<{ name: string; args: string; result: string }>(
          `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('rate_list', 'submit_feedback', 'list_ratings', 'list_feedback') order by 1`,
        );
      const before = (await sig()).rows;
      expect(before.map((r) => [r.name, r.args])).toEqual([
        ["list_feedback", "p_reader text, p_since timestamp with time zone"],
        ["list_ratings", "p_since timestamp with time zone"],
        ["rate_list", "p_list_id text, p_mode text, p_rating integer, p_reason text, p_client_id uuid"],
        ["submit_feedback", "p_list_id text, p_mode text, p_rating integer, p_text text, p_client_id uuid"],
      ]);
      const kept = await totals("fr-totals");
      await db.exec(readFileSync(join(dir, "20261114130000_fathom_feedback.sql"), "utf8"));
      expect((await sig()).rows).toEqual(before);
      expect(await totals("fr-totals")).toEqual(kept);
      expect((await as("anon", null, () => rate({ list: "fr-again", mode: "fathom", client: client(4050) }))).rows[0].ok).toBe(true);
      expect(await code(as("anon", null, () => rate({ list: "fr-again", mode: "quiz", client: client(4050) })))).toBe("22023");
    });

    it("runs on the live project as it is (1 to 8 and fathom_guesses, not fathom_plays), keeping its ratings and notes", async () => {
      const live = new PGlite();
      try {
        await live.exec(standins(exposeNewTables));
        const sql = (f: string) => readFileSync(join(dir, f), "utf8");
        const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
        const later = ["20261114120000_fathom_plays.sql", "20261114130000_fathom_feedback.sql"];
        for (const f of files.filter((f) => !later.includes(f))) await live.exec(sql(f));
        // What players have sent so far.
        await live.exec(`
          select public.rate_list('mountains', 'list', -1, 'boring', '${client(4070)}');
          select public.rate_list('mountains', 'blitz', 1, null, '${client(4070)}');
          select public.submit_feedback('mountains', 'list', -1, 'too many volcanoes', '${client(4070)}');
        `);
        const snapshot = async () => ({
          ratings: (await live.query("select list_id, mode, rating, reason, client_id from public.ratings order by id")).rows,
          notes: (await live.query("select list_id, mode, rating, text, client_id from public.feedback order by id")).rows,
        });
        const before = await snapshot();
        expect(before.ratings).toHaveLength(2);
        expect(before.notes).toHaveLength(1);
        // Before it: Fathom is refused.
        expect(await code(live.query("select public.rate_list($1, 'fathom', 1, null, $2)", [Q, client(4071)]))).toBe("22023");
        await live.exec(sql("20261114130000_fathom_feedback.sql"));
        expect(await snapshot()).toEqual(before);
        expect((await live.query<{ ok: boolean }>("select public.rate_list($1, 'fathom', 1, null, $2) as ok", [Q, client(4071)])).rows[0].ok).toBe(true);
        expect((await live.query<{ ok: boolean }>("select public.submit_feedback($1, 'fathom', 1, 'nice', $2) as ok", [Q, client(4071)])).rows[0].ok).toBe(true);
        // fathom_plays after it, as the owner may run them in either order.
        await live.exec(sql("20261114120000_fathom_plays.sql"));
        expect((await live.query<{ n: number }>("select count(*)::int as n from public.ratings where mode = 'fathom'")).rows[0].n).toBe(1);
      } finally {
        await live.close();
      }
    }, 60_000);

    it("goes with the account, and account deletion (service_role) may clear it", async () => {
      await as("authenticated", S, () => note({ list: "fn-gone", mode: "fathom", text: "from s", client: client(4060) }));
      await as("service_role", null, async () => {
        expect((await db.query("delete from public.ratings where user_id = $1", [S])).affectedRows).toBe(1);
        expect((await db.query("delete from public.feedback where user_id = $1", [S])).affectedRows).toBe(1);
      });
      await db.query("delete from auth.users where id = $1", [R]);
      expect((await db.query("select * from public.ratings where user_id = $1", [R])).rows).toEqual([]);
      expect((await db.query("select * from public.feedback where user_id = $1", [R])).rows).toEqual([]);
    });
  });

  describe("Fathom guesses", () => {
    // F signs in on two browsers, G is an owner, H a tester (an account like any other).
    const F = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const G = "12121212-1212-4121-8121-121212121212";
    const H = "34343434-3434-4343-8343-343434343434";
    /** The browser asking, on the comparison question: its own guess is never part of the crowd. */
    const ASKER = client(1401);
    type Row = { question_id: string; guess: number; user_id: string | null; client_id: string };
    const rows = (question: string) =>
      db.query<Row>("select question_id, guess, user_id, client_id from public.fathom_guesses where question_id = $1 order by id", [question]);
    type Compare = { n: number; median: number | null; further_off: number | null };
    type Round = "estimate" | "percent" | "year" | "name-ratio" | "name-steps";
    /** fathom_compare as the game asks it: an estimate by default, from ASKER's browser, signed out. */
    const compare = async (
      question: string,
      guess: number,
      answer: number,
      { round = "estimate", asker = ASKER, user = null }: { round?: Round | string | null; asker?: string | null; user?: string | null } = {},
    ) =>
      (
        await as(user ? "authenticated" : "anon", user, () =>
          db.query<{ c: Compare }>("select public.fathom_compare($1, $2, $3, $4, $5) as c", [question, round, guess, answer, asker]),
        )
      ).rows[0].c;
    /** Players' first guesses on a question, [how many, their guess] each, from fresh browsers numbered from `from`. */
    const crowd = (question: string, from: number, groups: [count: number, guess: number][]) =>
      as("anon", null, async () => {
        let i = from;
        for (const [count, guess] of groups) for (let k = 0; k < count; k++) await fathomGuess({ question, guess, client: client(i++) });
      });

    beforeAll(async () => {
      await db.query("insert into auth.users (id, email) values ($1, 'f@example.com'), ($2, 'g@example.com'), ($3, 'h@example.com')", [F, G, H]);
      // "How much is 100?": 25 players, ten guess 50, ten 200 and five 1000; the asker guessed 100.
      await as("anon", null, async () => {
        for (let i = 0; i < 25; i++) await fathomGuess({ question: "fq-cmp", guess: i < 10 ? 50 : i < 20 ? 200 : 1000, client: client(1001 + i) });
        await fathomGuess({ question: "fq-cmp", guess: 100, client: ASKER });
      });
      // F: 1000 on one browser, then 50 on another, later. One player: the first guess counts.
      await as("authenticated", F, () => fathomGuess({ question: "fq-cmp", guess: 1000, client: client(1101) }));
      await db.query("update public.fathom_guesses set created_at = now() - interval '10 minutes' where client_id = $1", [client(1101)]);
      await as("authenticated", F, () => fathomGuess({ question: "fq-cmp", guess: 50, client: client(1102) }));
      // G (an owner, once added) spot on, signed in; and signed out on a browser G has used signed in (nothing joins the
      // two, so two players, as for anyone).
      await as("authenticated", G, async () => {
        await fathomGuess({ question: "fq-cmp", guess: 100, client: client(1201) });
        await fathomGuess({ question: "fq-other", guess: 7, client: client(1202) });
      });
      await as("anon", null, () => fathomGuess({ question: "fq-cmp", guess: 100, client: client(1202) }));
      // H (a tester) spot on too.
      await as("authenticated", H, () => fathomGuess({ question: "fq-cmp", guess: 100, client: client(1301) }));
    });

    it("keeps a browser's first guess on a question, linked to the account while signed in", async () => {
      await as("anon", null, async () => {
        expect((await fathomGuess({ question: "fq-once", guess: 300, client: client(1501) })).rows[0].ok).toBe(true);
        // The same question in a later game: the first guess stays.
        expect((await fathomGuess({ question: "fq-once", guess: 350, client: client(1501) })).rows[0].ok).toBe(false);
        expect((await fathomGuess({ question: "fq-once", guess: 0.0025, client: client(1502) })).rows[0].ok).toBe(true);
      });
      await as("authenticated", F, () => fathomGuess({ question: "fq-once", guess: 2.5e9, client: client(1503) }));
      expect((await rows("fq-once")).rows).toEqual([
        { question_id: "fq-once", guess: 300, user_id: null, client_id: client(1501) },
        { question_id: "fq-once", guess: 0.0025, user_id: null, client_id: client(1502) },
        { question_id: "fq-once", guess: 2.5e9, user_id: F, client_id: client(1503) },
      ]);
    });

    it("refuses malformed guesses with invalid_parameter_value (a 400 from the API)", async () => {
      await as("anon", null, async () => {
        const bad = [
          { question: "Bad Id" },
          { question: "x".repeat(65) },
          { question: null },
          { guess: -5 },
          { guess: -1e-9 },
          { guess: null },
          { guess: "NaN" },
          { guess: "Infinity" },
          { guess: "-Infinity" },
          { guess: 1e301 },
          { client: null },
        ];
        for (const args of bad) expect(await code(fathomGuess({ question: "fq-bad", client: client(1504), ...args })), JSON.stringify(args)).toBe("22023");
      });
      expect((await rows("fq-bad")).rows).toEqual([]);
    });

    it("takes 0 (0% is a fair percent, 0 land borders a fair name-it figure), never below it", async () => {
      await as("anon", null, async () => {
        expect((await fathomGuess({ question: "fq-zero", guess: 0, client: client(1506) })).rows[0].ok).toBe(true);
        // A -0 from a script is a 0.
        expect((await fathomGuess({ question: "fq-zero", guess: "-0", client: client(1507) })).rows[0].ok).toBe(true);
        expect(await code(fathomGuess({ question: "fq-zero", guess: -1e-300, client: client(1508) }))).toBe("22023");
      });
      const kept = (await rows("fq-zero")).rows;
      expect(kept.map((r) => [r.client_id, r.guess])).toEqual([
        [client(1506), 0],
        [client(1507), 0],
      ]);
      expect(Object.is(kept[1].guess, 0)).toBe(true);
      // The table holds the same line (23514: check_violation).
      const insert = (guess: number) => db.query("insert into public.fathom_guesses (question_id, guess, client_id) values ('fq-zero', $1, $2)", [guess, client(1509)]);
      expect(await code(insert(-1))).toBe("23514");
      expect(await code(insert(1e300))).toBe("23514");
      expect(await code(insert(0))).toBeUndefined();
    });

    it("gives players no direct access to the table", async () => {
      for (const [role, user] of [["anon", null], ["authenticated", F]] as const) {
        await as(role, user, async () => {
          expect(await code(db.query("select * from public.fathom_guesses"))).toBe("42501");
          expect(await code(db.query("insert into public.fathom_guesses (question_id, guess, client_id) values ('x', 1, $1)", [client(1505)]))).toBe("42501");
          expect(await code(db.query("update public.fathom_guesses set guess = 1"))).toBe("42501");
          expect(await code(db.query("delete from public.fathom_guesses"))).toBe("42501");
        });
      }
    });

    it("ignores a browser past 120 guesses an hour", async () => {
      await as("anon", null, async () => {
        for (let i = 0; i < 120; i++) expect((await fathomGuess({ question: `fq-spam-${i}`, client: client(1601) })).rows[0].ok).toBe(true);
        expect((await fathomGuess({ question: "fq-spam-x", client: client(1601) })).rows[0].ok).toBe(false);
        // Another browser is fine.
        expect((await fathomGuess({ question: "fq-spam-x", client: client(1602) })).rows[0].ok).toBe(true);
      });
      // An hour on, the first browser may guess again.
      await db.query("update public.fathom_guesses set created_at = now() - interval '61 minutes' where client_id = $1", [client(1601)]);
      expect((await as("anon", null, () => fathomGuess({ question: "fq-spam-x", client: client(1601) }))).rows[0].ok).toBe(true);
    });

    it("compares a guess with real players: how many, their median guess, and the share further off", async () => {
      // 25 players, F once (1000, the first), G twice (signed in, and signed out on a browser of theirs) and H; not the
      // asker.
      expect((await compare("fq-cmp", 120, 100)).n).toBe(29);
      // The owner and his testers count like anyone (owner, Nov 9: "keep me and testers in the averages").
      await db.query("insert into public.owners (user_id) values ($1)", [G]);
      // 10 at 50, three at 100 (G twice, H), 10 at 200, 6 at 1000: the middle guess is 200. 120 is closer than all but
      // the three spot on.
      expect(await compare("fq-cmp", 120, 100)).toEqual({ n: 29, median: 200, further_off: 0.8966 });
      // Half or double: as far off as 20 of them (not further), closer than the six at 1000.
      expect(await compare("fq-cmp", 200, 100)).toEqual({ n: 29, median: 200, further_off: 0.2069 });
      expect(await compare("fq-cmp", 50, 100)).toEqual({ n: 29, median: 200, further_off: 0.2069 });
      expect(await compare("fq-cmp", 1000, 100)).toEqual({ n: 29, median: 200, further_off: 0 });
      // Measured against the answer the game shows (a corrected answer applies to every guess at once): at 1000, the
      // six who said 1000 tie, the other 23 are further off.
      expect((await compare("fq-cmp", 1000, 1000)).further_off).toBe(0.7931);
    });

    it("leaves the player asking out: their browser, and their account on every device", async () => {
      // Without a browser to leave out, the asker's own 100 is in the crowd.
      expect((await compare("fq-cmp", 120, 100, { asker: null })).n).toBe(30);
      // F signed in on a third browser: neither of F's guesses counts (and the other asker's 100 does).
      expect((await compare("fq-cmp", 120, 100, { asker: client(1103), user: F })).n).toBe(29);
    });

    it("measures an estimate (and a name-it ratio list) in how many times off, with 0 the furthest of all", async () => {
      // "How much is 1000?": five say 0, ten 10 (100x low), ten 1990 (1.99x high).
      await crowd("fq-ratio", 1701, [
        [5, 0],
        [10, 10],
        [10, 1990],
      ]);
      // 500 is 2x low: closer than the 0s and the 10s, not the 1990s (1.99x high). By plain distance, 500 against their
      // 990, it would be closer than everyone.
      expect(await compare("fq-ratio", 500, 1000)).toEqual({ n: 25, median: 10, further_off: 0.6 });
      expect(await compare("fq-ratio", 500, 1000, { round: "name-ratio" })).toEqual({ n: 25, median: 10, further_off: 0.6 });
      // 0 is as far off as the other 0s (a tie is not further), and further than anyone else.
      expect((await compare("fq-ratio", 0, 1000)).further_off).toBe(0);
      expect((await compare("fq-ratio", 1, 1000)).further_off).toBe(0.2);
    });

    it("measures a percent in points off, not times off", async () => {
      // "What percent is 20?": ten say 10 (10 points off, 2x), ten 32 (12 off, 1.6x), five 0 (20 off).
      await crowd("fq-percent", 1731, [
        [10, 10],
        [10, 32],
        [5, 0],
      ]);
      // 31 is 11 points off: further are the 32s and the 0s (on a times-off scale it would be closer than everyone).
      expect(await compare("fq-percent", 31, 20, { round: "percent" })).toEqual({ n: 25, median: 10, further_off: 0.6 });
      expect((await compare("fq-percent", 31, 20)).further_off).toBe(1);
      // 30 is 10 points off, a tie with the 10s (not further): points high and low weigh the same.
      expect((await compare("fq-percent", 30, 20, { round: "percent" })).further_off).toBe(0.6);
      // A guess of 0% is 20 points off: as far as the other 0s, closer than nobody.
      expect((await compare("fq-percent", 0, 20, { round: "percent" })).further_off).toBe(0);
      // An answer of 0% works too: 10 and 0 points off for the 10s and the 0s, 32 for the 32s.
      expect((await compare("fq-percent", 12, 0, { round: "percent" })).further_off).toBe(0.4);
    });

    it("measures a year in years off, not times off", async () => {
      // "When was 1969?": ten say 1959 (10 years early), ten 1970, five 1900.
      await crowd("fq-year", 1761, [
        [10, 1959],
        [10, 1970],
        [5, 1900],
      ]);
      // 1979 is 10 years late: as far off as 1959, further only for the 1900s. (As a ratio 1959 is a hair further off
      // than 1979, so a times-off scale would count the ten 1959s too.)
      expect(await compare("fq-year", 1979, 1969, { round: "year" })).toEqual({ n: 25, median: 1959, further_off: 0.2 });
      expect((await compare("fq-year", 1979, 1969)).further_off).toBe(0.6);
      expect((await compare("fq-year", 1969, 1969, { round: "year" })).further_off).toBe(1);
    });

    it("measures a name-it steps list in steps off (0 land borders a fair figure), and its median can be 0", async () => {
      // "Name a country with 2 land borders": thirteen name an island (0), nine a country with 3, three one with 9.
      await crowd("fq-steps", 1791, [
        [13, 0],
        [9, 3],
        [3, 9],
      ]);
      // A country with 4 is 2 steps off: a tie with the islands, closer than the 9s. (As a ratio 4 is 2x off and an
      // island infinitely, so the islands would count as further too.)
      expect(await compare("fq-steps", 4, 2, { round: "name-steps" })).toEqual({ n: 25, median: 0, further_off: 0.12 });
      expect((await compare("fq-steps", 4, 2, { round: "name-ratio" })).further_off).toBe(0.64);
      // An island (0) on a list whose target is 0: spot on, closer than everyone but the other islands.
      expect((await compare("fq-steps", 0, 0, { round: "name-steps" })).further_off).toBe(0.48);
    });

    it("refuses a round it doesn't know (invalid_parameter_value), so a guess is never measured on the wrong scale", async () => {
      for (const round of [null, "", "name", "Percent", "steps", "estimate "]) {
        expect(await code(compare("fq-cmp", 120, 100, { round })), String(round)).toBe("22023");
      }
    });

    it("answers the public key, with nothing for a question nobody answered, and keeps its signature", async () => {
      expect(await compare("fq-none", 10, 100)).toEqual({ n: 0, median: null, further_off: null });
      expect(await compare("fq-none", 0, 0, { round: "percent" })).toEqual({ n: 0, median: null, further_off: null });
      // Without a guess or an answer on the scale, still how many and their median, but no share.
      expect(await compare("fq-cmp", -1, 100)).toEqual({ n: 29, median: 200, further_off: null });
      expect(await compare("fq-cmp", 120, -1)).toEqual({ n: 29, median: 200, further_off: null });
      const short = await as("anon", null, () => db.query<{ c: Compare }>("select public.fathom_compare('fq-cmp', 'estimate', 120, 100) as c"));
      expect(short.rows[0].c.n).toBe(30);
      const sig = await db.query<{ name: string; args: string; result: string }>(
        `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fathom_compare', 'submit_fathom_guess') order by 1`,
      );
      expect(sig.rows).toEqual([
        {
          name: "fathom_compare",
          args: "p_question_id text, p_round text, p_guess double precision, p_answer double precision, p_client_id uuid",
          result: "json",
        },
        { name: "submit_fathom_guess", args: "p_question_id text, p_guess double precision, p_client_id uuid", result: "boolean" },
      ]);
    });

    it("goes with the account when it is deleted, and account deletion (service_role) may clear it", async () => {
      await as("service_role", null, async () => {
        expect((await db.query("delete from public.fathom_guesses where user_id = $1", [H])).affectedRows).toBe(1);
      });
      const anonymous = await db.query<{ n: number }>("select count(*)::int as n from public.fathom_guesses where user_id is null");
      await db.query("delete from auth.users where id = $1", [F]);
      expect((await db.query("select * from public.fathom_guesses where user_id = $1", [F])).rows).toEqual([]);
      expect((await db.query<{ n: number }>("select count(*)::int as n from public.fathom_guesses where user_id is null")).rows[0].n).toBe(anonymous.rows[0].n);
    });
  });

  describe("Today's Fathom totals", () => {
    // P plays on two browsers; Q is anyone signed in.
    const P = "78787878-7878-4787-8787-787878787878";
    const Q = "9a9a9a9a-9a9a-49a9-89a9-9a9a9a9a9a9a";
    type Row = { daily_date: string; total: number; user_id: string | null; client_id: string };
    const rows = (from: number, to: number) =>
      db.query<Row>(
        "select to_char(daily_date, 'YYYY-MM-DD') as daily_date, total, user_id, client_id from public.fathom_plays where client_id between $1 and $2 order by id",
        [client(from), client(to)],
      );
    type Day = { n: number; counts: number[]; avg: number | null };
    /** fathom_day_stats as the game asks it: with the public key, signed out unless `user` is given. */
    const day = async (date: string | null, user: string | null = null) =>
      (await as(user ? "authenticated" : "anon", user, () => db.query<{ d: Day }>("select public.fathom_day_stats($1) as d", [date]))).rows[0].d;
    const bins = (pairs: [bin: number, players: number][]) => {
      const counts = Array<number>(100).fill(0);
      for (const [bin, players] of pairs) counts[bin] += players;
      return counts;
    };
    /** A date nobody else in these tests plays: tomorrow's, as a player ahead of UTC has it. */
    const D = utcDay(1);

    beforeAll(async () => {
      await db.query("insert into auth.users (id, email) values ($1, 'p@example.com'), ($2, 'q@example.com')", [P, Q]);
    });

    it("keeps a browser's first total on a date, linked to the account while signed in", async () => {
      await as("anon", null, async () => {
        expect((await fathomPlay({ total: 312, client: client(3001) })).rows[0].ok).toBe(true);
        // The same day again (another tab, a retry): the first total stays.
        expect((await fathomPlay({ total: 480, client: client(3001) })).rows[0].ok).toBe(false);
        // Yesterday's, as a player behind UTC has it: its own day.
        expect((await fathomPlay({ date: utcDay(-1), total: 0, client: client(3001) })).rows[0].ok).toBe(true);
      });
      await as("authenticated", Q, () => fathomPlay({ total: 1000, client: client(3002) }));
      expect((await rows(3001, 3002)).rows).toEqual([
        { daily_date: utcDay(), total: 312, user_id: null, client_id: client(3001) },
        { daily_date: utcDay(-1), total: 0, user_id: null, client_id: client(3001) },
        { daily_date: utcDay(), total: 1000, user_id: Q, client_id: client(3002) },
      ]);
    });

    it("refuses malformed totals with invalid_parameter_value (a 400 from the API)", async () => {
      await as("anon", null, async () => {
        const bad = [{ date: utcDay(-2) }, { date: utcDay(2) }, { date: null }, { total: -1 }, { total: 1001 }, { total: null }, { client: null }];
        for (const args of bad) expect(await code(fathomPlay({ client: client(3010), ...args })), JSON.stringify(args)).toBe("22023");
      });
      expect((await rows(3010, 3010)).rows).toEqual([]);
    });

    it("gives players no direct access to the table", async () => {
      for (const [role, user] of [["anon", null], ["authenticated", Q]] as const) {
        await as(role, user, async () => {
          expect(await code(db.query("select * from public.fathom_plays"))).toBe("42501");
          expect(await code(db.query("insert into public.fathom_plays (daily_date, total, client_id) values (current_date, 1, $1)", [client(3020)]))).toBe("42501");
          expect(await code(db.query("update public.fathom_plays set total = 500"))).toBe("42501");
          expect(await code(db.query("delete from public.fathom_plays"))).toBe("42501");
        });
      }
    });

    it("counts each player's first total on a date, in bins of 10 (1000 with 990-999), everyone included", async () => {
      await as("anon", null, async () => {
        for (const [i, total] of [0, 9, 10, 255, 259, 999, 1000].entries()) await fathomPlay({ date: D, total, client: client(3100 + i) });
        // Another date's total is another day.
        await fathomPlay({ date: utcDay(), total: 100, client: client(3100) });
      });
      // P: 300 on one browser, then 100 on another, later. One player: the first counts.
      await as("authenticated", P, () => fathomPlay({ date: D, total: 300, client: client(3110) }));
      await db.query("update public.fathom_plays set created_at = now() - interval '10 minutes' where client_id = $1", [client(3110)]);
      await as("authenticated", P, () => fathomPlay({ date: D, total: 100, client: client(3111) }));
      const expected = {
        n: 8,
        counts: bins([
          [0, 2],
          [1, 1],
          [25, 2],
          [30, 1],
          [99, 2],
        ]),
        avg: Math.round(((0 + 9 + 10 + 255 + 259 + 999 + 1000 + 300) / 8) * 100) / 100,
      };
      expect(await day(D)).toEqual(expected);
      // The same for whoever asks: anyone signed in, or P themselves.
      expect(await day(D, Q)).toEqual(expected);
      expect(await day(D, P)).toEqual(expected);
    });

    it("answers the public key, with zeros for a date nobody played, and keeps its signature", async () => {
      expect(await day("2026-01-01")).toEqual({ n: 0, counts: Array(100).fill(0), avg: null });
      expect(await day(null)).toEqual({ n: 0, counts: Array(100).fill(0), avg: null });
      const sig = await db.query<{ name: string; args: string; result: string }>(
        `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fathom_day_stats', 'submit_fathom_play') order by 1`,
      );
      expect(sig.rows).toEqual([
        { name: "fathom_day_stats", args: "p_date date", result: "json" },
        { name: "submit_fathom_play", args: "p_date date, p_total integer, p_client_id uuid", result: "boolean" },
      ]);
    });

    it("is safe to run again on a project that has it, and keeps what's there", async () => {
      const before = await day(D);
      await db.exec(readFileSync(join(dir, "20261114120000_fathom_plays.sql"), "utf8"));
      expect(await day(D)).toEqual(before);
      // And players still can't touch the table.
      await as("anon", null, async () => expect(await code(db.query("select * from public.fathom_plays"))).toBe("42501"));
    });

    it("goes with the account when it is deleted, and account deletion (service_role) may clear it", async () => {
      await as("service_role", null, async () => {
        expect((await db.query("delete from public.fathom_plays where user_id = $1", [Q])).affectedRows).toBe(1);
      });
      const anonymous = await db.query<{ n: number }>("select count(*)::int as n from public.fathom_plays where user_id is null");
      await db.query("delete from auth.users where id = $1", [P]);
      expect((await db.query("select * from public.fathom_plays where user_id = $1", [P])).rows).toEqual([]);
      expect((await db.query<{ n: number }>("select count(*)::int as n from public.fathom_plays where user_id is null")).rows[0].n).toBe(anonymous.rows[0].n);
    });
  });

  describe("missed guesses", () => {
    /** Someone who signs in, misses, and deletes their account. */
    const M = "56565656-5656-4565-8565-565656565656";
    type Row ={ list_id: string; mode: string; kind: string; text: string; client_id: string };
    const rows = (list: string) =>
      db.query<Row>("select list_id, mode, kind, text, client_id from public.missed_guesses where list_id = $1 order by id", [list]);
    type Read = { list_id: string; mode: string; kind: string; text: string; browsers: number; last_seen: Date };
    /** The reader key notes are read with (set_feedback_reader): misses are read with the same one. */
    const KEY = "a-long-random-reader-key-for-misses-0123";
    /** list_misses as the loop calls it with the public key (anon). */
    const read = (reader: string | null, since?: string) =>
      as("anon", null, () =>
        since === undefined
          ? db.query<Read>("select * from public.list_misses($1)", [reader])
          : db.query<Read>("select * from public.list_misses($1, $2)", [reader, since]),
      );

    beforeAll(async () => {
      await db.query("select public.set_feedback_reader($1)", [KEY]);
    });

    it("keeps a guess the game didn't take as its normalized text, linked to nobody: a browser counts once per text", async () => {
      await as("anon", null, async () => {
        expect((await miss({ list: "m-peaks", text: "  Mount  EVEREST\t", client: client(2000) })).rows[0].ok).toBe(true);
        // The same text from the same browser again (a retry, a later game, another kind): kept once.
        expect((await miss({ list: "m-peaks", text: "mount everest", client: client(2000) })).rows[0].ok).toBe(false);
        expect((await miss({ list: "m-peaks", kind: "junk", text: "MOUNT EVEREST", client: client(2000) })).rows[0].ok).toBe(false);
        // Blitz, another browser, another text: each its own.
        expect((await miss({ list: "m-peaks", mode: "blitz", text: "mount everest", client: client(2000) })).rows[0].ok).toBe(true);
        expect((await miss({ list: "m-peaks", text: "mount everest", client: client(2001) })).rows[0].ok).toBe(true);
        expect((await miss({ list: "m-peaks", kind: "junk", text: "asdfgh", client: client(2001) })).rows[0].ok).toBe(true);
      });
      // Signed in: still linked to nobody.
      await as("authenticated", A, () => miss({ list: "m-peaks", text: "k two", client: client(2002) }));
      expect((await rows("m-peaks")).rows).toEqual([
        { list_id: "m-peaks", mode: "list", kind: "unknown", text: "mount everest", client_id: client(2000) },
        { list_id: "m-peaks", mode: "blitz", kind: "unknown", text: "mount everest", client_id: client(2000) },
        { list_id: "m-peaks", mode: "list", kind: "unknown", text: "mount everest", client_id: client(2001) },
        { list_id: "m-peaks", mode: "list", kind: "junk", text: "asdfgh", client_id: client(2001) },
        { list_id: "m-peaks", mode: "list", kind: "unknown", text: "k two", client_id: client(2002) },
      ]);
      // No column could say whose a miss is.
      const cols = await db.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'missed_guesses' order by ordinal_position",
      );
      expect(cols.rows.map((c) => c.column_name)).toEqual(["id", "list_id", "mode", "kind", "text", "client_id", "created_at"]);
    });

    it("normalizes the text the way the game does (src/net/misses.ts), and keeps what the game sends as it is", async () => {
      const typed = ["  Mount  EVEREST\t", "Mont\u00a0Blanc", "e\u0301cole", "ÉCOLE", "K2\r\n", "a\u3000b\u2003c", "\u200a x \ufeff", "São  Paulo", "x".repeat(40)];
      for (const [i, text] of typed.entries()) await as("anon", null, () => miss({ list: "m-clean", text, client: client(2010 + i) }));
      expect((await rows("m-clean")).rows.map((r) => r.text)).toEqual(typed.map(cleanMiss));
      expect(typed.map(cleanMiss).slice(0, 4)).toEqual(["mount everest", "mont blanc", "école", "école"]);
      // The game's own lowercasing (final sigma, the dotted I) is kept as it came.
      const sent = ["ΣΑΣ", "İstanbul"].map(cleanMiss);
      for (const [i, text] of sent.entries()) await as("anon", null, () => miss({ list: "m-sent", text, client: client(2030 + i) }));
      expect((await rows("m-sent")).rows.map((r) => r.text)).toEqual(sent);
    });

    it("refuses malformed misses with invalid_parameter_value (a 400 from the API)", async () => {
      await as("anon", null, async () => {
        const bad = [
          { list: "Bad Id" },
          { list: "x".repeat(65) },
          { list: null },
          { mode: "classic" },
          { mode: null },
          // Only unknown and junk: never an accepted answer, a near miss or a choice.
          { kind: "near" },
          { kind: "correct" },
          { kind: "typo" },
          { kind: null },
          { text: null },
          { text: "" },
          { text: " \t\n\u00a0 " },
          { text: "x".repeat(41) },
          { text: `  ${"é".repeat(41)} ` },
          { client: null },
        ];
        for (const args of bad) expect(await code(miss({ list: "m-bad", client: client(2040), ...args })), JSON.stringify(args)).toBe("22023");
        // 40 characters is fine, counted after normalizing (and in characters, not bytes).
        expect((await miss({ list: "m-bad", client: client(2040), text: `  ${"É".repeat(40)}\n` })).rows[0].ok).toBe(true);
      });
      expect((await rows("m-bad")).rows.map((r) => r.text)).toEqual(["é".repeat(40)]);
    });

    it("refuses text that looks like an email address, a phone number or a link, as the game does", async () => {
      const personal = [
        "dana@example.com",
        " Dana.Scully@FBI.gov ",
        "write to me: x@y.co",
        "+1 (555) 123-4567",
        "555-1234",
        "07700 900123",
        "0044 20 7946 0958",
        "1400000000",
        "https://example.com",
        "HTTP://x.co",
        "ftp://files",
        "www.example.com",
        "see WWW.example.org",
        "example.com/me",
        "youtube.com/@dana",
        "t.me/dana",
      ];
      // Answers people really type, with digits, dots, slashes and at signs: kept.
      const fine = [
        "mount everest",
        "432 park avenue",
        "1984",
        "2001: a space odyssey",
        "google.com",
        "booking.com",
        "@cristiano",
        "st. louis",
        "ac/dc",
        "w.a.s.p.",
        "7-eleven",
        "1,000,000",
        "10 downing street",
        "covid-19",
        "route 66",
        "1 2 3 4 5 6",
      ];
      for (const text of personal) {
        expect(looksPersonal(cleanMiss(text)), text).toBe(true);
        expect(await code(as("anon", null, () => miss({ list: "m-private", text, client: client(2050) }))), text).toBe("22023");
      }
      for (const text of fine) {
        expect(looksPersonal(cleanMiss(text)), text).toBe(false);
        expect((await as("anon", null, () => miss({ list: "m-fine", text, client: client(2051) }))).rows[0].ok, text).toBe(true);
      }
      expect((await rows("m-private")).rows).toEqual([]);
      expect((await rows("m-fine")).rows).toHaveLength(fine.length);
    });

    it("ignores a browser past 60 misses an hour", async () => {
      await as("anon", null, async () => {
        for (let i = 0; i < 60; i++) expect((await miss({ list: `m-spam-${i % 3}`, text: `spam ${i}`, client: client(2060) })).rows[0].ok).toBe(true);
        expect((await miss({ list: "m-spam-x", text: "one more", client: client(2060) })).rows[0].ok).toBe(false);
        // Another browser is fine.
        expect((await miss({ list: "m-spam-x", text: "one more", client: client(2061) })).rows[0].ok).toBe(true);
      });
      expect((await rows("m-spam-x")).rows.map((r) => r.client_id)).toEqual([client(2061)]);
      // An hour on, the first browser counts again.
      await db.query("update public.missed_guesses set created_at = now() - interval '61 minutes' where client_id = $1", [client(2060)]);
      expect((await as("anon", null, () => miss({ list: "m-spam-x", text: "one more", client: client(2060) }))).rows[0].ok).toBe(true);
    });

    it("gives players no direct access to the table", async () => {
      for (const [role, user] of [["anon", null], ["authenticated", A]] as const) {
        await as(role, user, async () => {
          expect(await code(db.query("select * from public.missed_guesses"))).toBe("42501");
          expect(await code(db.query("insert into public.missed_guesses (list_id, mode, kind, text, client_id) values ('x', 'list', 'unknown', 'hi', $1)", [client(2070)]))).toBe("42501");
          expect(await code(db.query("update public.missed_guesses set text = 'x'"))).toBe("42501");
          expect(await code(db.query("delete from public.missed_guesses"))).toBe("42501");
        });
      }
    });

    it("lists the misses only with the reader key, as list_feedback (in the body or the X-Feedback-Reader header)", async () => {
      for (const wrong of ["anything", KEY.toUpperCase(), `${KEY} `, "", null]) expect(await code(read(wrong)), String(wrong)).toBe("42501");
      await as("authenticated", A, async () => {
        expect(await code(db.query("select * from public.list_misses($1)", ["anything"]))).toBe("42501");
      });
      expect((await read(KEY)).rows.length).toBeGreaterThan(0);
      // The same key still reads the notes.
      expect(await code(as("anon", null, () => db.query("select * from public.list_feedback($1)", [KEY])))).toBeUndefined();
      // The cloud environment's proxy adds the key as a header; the agent sends an empty p_reader.
      const viaHeader = async (header: string | null, reader: string | null = "") => {
        await db.query("select set_config('request.headers', $1, false)", [header === null ? "" : JSON.stringify({ "x-feedback-reader": header })]);
        try {
          return await read(reader);
        } finally {
          await db.query("select set_config('request.headers', '', false)");
        }
      };
      expect((await viaHeader(KEY)).rows.length).toBeGreaterThan(0);
      expect((await viaHeader(KEY, null)).rows.length).toBeGreaterThan(0);
      for (const wrong of ["anything", "", `${KEY} `]) expect(await code(viaHeader(wrong)), wrong).toBe("42501");
      expect(await code(viaHeader(null))).toBe("42501");
      // A wrong key in the body beside a right header: refused (the body wins when given).
      expect(await code(viaHeader(KEY, "anything"))).toBe("42501");
      await db.query("select set_config('request.headers', 'not json', false)");
      try {
        expect(await code(read(""))).toBe("42501");
      } finally {
        await db.query("select set_config('request.headers', '', false)");
      }
    });

    it("totals each text by the browsers that typed it, most first, never a client id; p_since keeps only newer ones", async () => {
      await as("anon", null, async () => {
        // "mt everest" from three browsers (one of them twice), "everest mountain" from two, junk from one; Blitz apart.
        for (const c of [2080, 2081, 2082]) await miss({ list: "m-agg", text: "Mt Everest", client: client(c) });
        await miss({ list: "m-agg", text: "mt everest", client: client(2080) });
        for (const c of [2083, 2084]) await miss({ list: "m-agg", text: "everest mountain", client: client(c) });
        await miss({ list: "m-agg", kind: "junk", text: "qwerty", client: client(2085) });
        await miss({ list: "m-agg", mode: "blitz", text: "mt everest", client: client(2086) });
      });
      const at = (c: number, hoursAgo: number) =>
        db.query("update public.missed_guesses set created_at = now() - make_interval(hours => $2) where list_id = 'm-agg' and client_id = $1", [client(c), hoursAgo]);
      await at(2083, 72);
      await at(2084, 5);
      await at(2085, 2);
      await at(2086, 1);

      const all = (await read(KEY)).rows;
      // Most browsers first, across every list.
      expect(all.map((r) => r.browsers)).toEqual(all.map((r) => r.browsers).sort((a, b) => b - a));
      const agg = all.filter((r) => r.list_id === "m-agg");
      expect(agg.map((r) => Object.keys(r))).toEqual(Array(4).fill(["list_id", "mode", "kind", "text", "browsers", "last_seen"]));
      expect(agg.map(({ last_seen, ...r }) => (expect(last_seen).toBeInstanceOf(Date), r))).toEqual([
        { list_id: "m-agg", mode: "list", kind: "unknown", text: "mt everest", browsers: 3 },
        { list_id: "m-agg", mode: "list", kind: "unknown", text: "everest mountain", browsers: 2 },
        // The same count: the latest first.
        { list_id: "m-agg", mode: "blitz", kind: "unknown", text: "mt everest", browsers: 1 },
        { list_id: "m-agg", mode: "list", kind: "junk", text: "qwerty", browsers: 1 },
      ]);
      // last_seen is the latest browser's.
      const mountain = agg.find((r) => r.text === "everest mountain")!;
      expect(Math.abs(mountain.last_seen.getTime() - (Date.now() - 5 * 3_600_000))).toBeLessThan(60_000);
      // Since yesterday: the browser from three days ago is left out.
      const recent = (await read(KEY, new Date(Date.now() - 86_400_000).toISOString())).rows.filter((r) => r.list_id === "m-agg");
      expect(recent.find((r) => r.text === "everest mountain")?.browsers).toBe(1);
      expect(recent).toHaveLength(4);
      // Nothing a client id could be read from.
      expect(JSON.stringify(all)).not.toContain(client(2080));
    });

    it("keeps its signatures", async () => {
      const sig = await db.query<{ name: string; args: string; result: string }>(
        `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('submit_miss', 'list_misses') order by 1`,
      );
      expect(sig.rows).toEqual([
        {
          name: "list_misses",
          args: "p_reader text, p_since timestamp with time zone",
          result: "TABLE(list_id text, mode text, kind text, text text, browsers integer, last_seen timestamp with time zone)",
        },
        { name: "submit_miss", args: "p_list_id text, p_mode text, p_kind text, p_text text, p_client_id uuid", result: "boolean" },
      ]);
    });

    it("stays when an account is deleted: nothing in it is anyone's", async () => {
      const before = (await db.query<{ n: number }>("select count(*)::int as n from public.missed_guesses")).rows[0].n;
      await db.query("insert into auth.users (id, email) values ($1, 'm@example.com')", [M]);
      await as("authenticated", M, () => miss({ list: "m-gone", text: "from m", client: client(2090) }));
      await db.query("delete from auth.users where id = $1", [M]);
      expect((await db.query<{ n: number }>("select count(*)::int as n from public.missed_guesses")).rows[0].n).toBe(before + 1);
    });
  });

  describe("saves", () => {
    const select = () => db.query<{ user_id: string; version: number; data: unknown }>("select user_id, version, data from public.saves order by user_id");

    it("lets a player create and read only their own save, numbered by the server", async () => {
      await as("authenticated", A, async () => {
        await db.query("insert into public.saves (user_id, data, version) values ($1, $2, 7)", [A, { games: {}, daily: {}, seenHelp: true }]);
        expect((await select()).rows).toEqual([{ user_id: A, version: 1, data: { games: {}, daily: {}, seenHelp: true } }]);
        expect(await code(db.query("insert into public.saves (user_id, data) values ($1, '{}')", [B]))).toBe("42501");
      });
      await as("authenticated", B, async () => {
        expect((await select()).rows).toEqual([]);
        expect((await db.query("update public.saves set data = '{}' where user_id = $1", [A])).affectedRows).toBe(0);
        expect((await db.query("delete from public.saves where user_id = $1", [A])).affectedRows).toBe(0);
      });
    });

    it("writes only over the version it read (and never changes owner)", async () => {
      await as("authenticated", A, async () => {
        const ok = await db.query<{ version: number }>("update public.saves set data = $1, version = 2 where user_id = $2 and version = 1 returning version", [{ v: 2 }, A]);
        expect(ok.rows).toEqual([{ version: 2 }]);
        const stale = await db.query("update public.saves set data = '{}', version = 2 where user_id = $1 and version = 1 returning version", [A]);
        expect(stale.rows).toEqual([]);
        // Handing the save to someone else quietly keeps it where it is.
        await db.query("update public.saves set user_id = $1 where user_id = $2", [B, A]);
        expect((await select()).rows.map((r) => [r.user_id, r.version])).toEqual([[A, 3]]);
      });
    });

    it("keeps anonymous players out, and refuses saves that aren't objects or are huge", async () => {
      await as("anon", null, async () => {
        expect(await code(db.query("select * from public.saves"))).toBe("42501");
      });
      await as("authenticated", B, async () => {
        expect(await code(db.query("insert into public.saves (user_id, data) values ($1, '[]')", [B]))).toBe("23514");
        expect(await code(db.query("insert into public.saves (user_id, data) values ($1, $2)", [B, { blob: "x".repeat(5_000_001) }]))).toBe("23514");
      });
    });

    it("lets account deletion (the server, as service_role) clear a player's notes, ratings, games and save", async () => {
      await as("authenticated", B, () => db.query("insert into public.saves (user_id, data) values ($1, '{}')", [B]));
      const others = await db.query<{ n: number }>("select count(*)::int as n from public.plays where user_id is distinct from $1", [B]);
      const otherRatings = await db.query<{ n: number }>("select count(*)::int as n from public.ratings where user_id is distinct from $1", [B]);
      const otherNotes = await db.query<{ n: number }>("select count(*)::int as n from public.feedback where user_id is distinct from $1", [B]);
      await as("service_role", null, async () => {
        // What api/delete-account.ts sends through the API: a delete filtered on the user.
        expect((await db.query("delete from public.feedback where user_id = $1", [B])).affectedRows).toBe(2);
        expect((await db.query("delete from public.ratings where user_id = $1", [B])).affectedRows).toBe(2);
        expect((await db.query("delete from public.plays where user_id = $1", [B])).affectedRows).toBe(2);
        expect((await db.query("delete from public.saves where user_id = $1", [B])).affectedRows).toBe(1);
      });
      expect((await db.query<{ n: number }>("select count(*)::int as n from public.plays")).rows[0].n).toBe(others.rows[0].n);
      expect((await db.query<{ n: number }>("select count(*)::int as n from public.ratings")).rows[0].n).toBe(otherRatings.rows[0].n);
      expect((await db.query<{ n: number }>("select count(*)::int as n from public.feedback")).rows[0].n).toBe(otherNotes.rows[0].n);
    });

    it("goes, with the account's linked games, ratings and notes (and its place among the owners), when the sign-in is deleted", async () => {
      await as("authenticated", A, () => rate({ list: "deleted-with-a", client: client(900) }));
      expect((await db.query("select * from public.ratings where user_id = $1", [A])).rows).toHaveLength(1);
      expect((await db.query("select * from public.feedback where user_id = $1", [A])).rows).toHaveLength(2);
      expect((await db.query("select * from public.owners where user_id = $1", [A])).rows).toHaveLength(1);
      const anonymousNotes = await db.query<{ n: number }>("select count(*)::int as n from public.feedback where user_id is null");
      const before = await db.query<{ n: number }>("select count(*)::int as n from public.plays where user_id is null");
      await db.query("delete from auth.users where id = $1", [A]);
      expect((await db.query("select * from public.saves where user_id = $1", [A])).rows).toEqual([]);
      expect((await db.query("select * from public.plays where user_id = $1", [A])).rows).toEqual([]);
      expect((await db.query("select * from public.ratings where user_id = $1", [A])).rows).toEqual([]);
      expect((await db.query("select * from public.feedback where user_id = $1", [A])).rows).toEqual([]);
      expect((await db.query("select * from public.owners where user_id = $1", [A])).rows).toEqual([]);
      // Anonymous games stay in the totals, and anonymous notes stay.
      expect((await db.query<{ n: number }>("select count(*)::int as n from public.plays where user_id is null")).rows[0].n).toBe(before.rows[0].n);
      expect((await db.query<{ n: number }>("select count(*)::int as n from public.feedback where user_id is null")).rows[0].n).toBe(anonymousNotes.rows[0].n);
    });
  });
}

describe("with new tables exposed to the API (older projects)", () => suite(true));
describe('with "Automatically expose new tables" off', () => suite(false));
