import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The migrations, run in PGlite (Postgres in WebAssembly) against small stand-ins for what Supabase provides: the
 * anon, authenticated and service_role roles, auth.users and auth.uid(). Checks the contract the game relies on: who
 * can touch what, what submit_play, rate_list and submit_feedback accept, what the stats and ratings functions return
 * (the owners and stats_excluded left out of the stats), that notes are read only with the reader key (list_feedback),
 * the save's version check, and what account deletion
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

  describe("testers out of the stats (owners and stats_excluded)", () => {
    // C is an owner, D a tester the owner excluded, E a player who signs in on D's browser.
    const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    type Stats = { n: number; counts: number[]; avg: number | null };
    const stats = async (mode = "list") =>
      (await as("anon", null, () => db.query<{ s: Stats }>("select public.list_stats('s-tests', $1) as s", [mode]))).rows[0].s;
    const average = async (mode = "list") =>
      (await as("anon", null, () => db.query<{ list_id: string; n: number; avg: string }>("select * from public.list_averages($1)", [mode]))).rows.find(
        (r) => r.list_id === "s-tests",
      );

    beforeAll(async () => {
      await db.query("insert into auth.users (id, email) values ($1, 'c@example.com'), ($2, 'd@example.com'), ($3, 'e@example.com')", [C, D, E]);
      await as("anon", null, async () => {
        // 30 players score 4, one scores 9.
        for (let i = 0; i < 30; i++) await submit({ list: "s-tests", client: client(700 + i), score: 4, started: ago(60) });
        await submit({ list: "s-tests", client: client(730), score: 9, started: ago(60) });
        await submit({ list: "s-tests", mode: "blitz", client: client(700), score: 120, found: 3, started: ago(60) });
        // Signed out on browsers C and D also use signed in (below): perfect scores.
        await submit({ list: "s-tests", client: client(741), score: 10, started: ago(55) });
        await submit({ list: "s-tests", client: client(751), score: 10, started: ago(55) });
        await submit({ list: "s-tests", client: client(752), score: 10, started: ago(55) });
      });
      // Signed in: C and D score 10 (D in Blitz too). C rates a list on browser 741, D sends a note from 751 and plays
      // another list on 752: those browsers are theirs.
      await as("authenticated", C, async () => {
        await submit({ list: "s-tests", client: client(740), score: 10, started: ago(50) });
        await rate({ list: "s-other", client: client(741) });
      });
      await as("authenticated", D, async () => {
        await submit({ list: "s-tests", client: client(750), score: 10, started: ago(50) });
        await submit({ list: "s-tests", mode: "blitz", client: client(750), score: 600, found: 12, started: ago(50) });
        await note({ list: "s-other", client: client(751), text: "from a tester" });
        await submit({ list: "s-other", client: client(752), score: 8, started: ago(45) });
      });
      // Someone else signed in on D's browser: a 7.
      await as("authenticated", E, () => submit({ list: "s-tests", client: client(751), score: 7, started: ago(40) }));
    });

    it("counts everyone until the owner adds them", async () => {
      // 31 players, the 3 browsers and C, D and E.
      expect((await stats()).n).toBe(37);
      expect((await average())?.n).toBe(37);
      expect((await stats("blitz")).n).toBe(2);
    });

    it("leaves out the owners and stats_excluded: their accounts' games, and their browsers' signed-out games", async () => {
      await db.query("insert into public.owners (user_id) values ($1)", [C]);
      // The owner's one-liner (docs/BACKEND.md, 2.7).
      await db.query("insert into public.stats_excluded (user_id) select id from auth.users where email = 'd@example.com'");
      // 30 at 4, one 9, and E's 7 (signed in on D's browser, still a player).
      expect(await stats()).toEqual({ n: 32, counts: [0, 0, 0, 0, 30, 0, 0, 1, 0, 1, 0], avg: 4.25 });
      const avg = await average();
      expect(avg?.n).toBe(32);
      expect(Number(avg?.avg)).toBe(4.25);
      expect(await stats("blitz")).toEqual({ n: 1, counts: [0, 0, 1], avg: 120 });
      // Taking a tester back out of the table counts them again.
      await db.query("delete from public.stats_excluded where user_id = $1", [D]);
      expect((await stats()).n).toBe(35);
      await db.query("insert into public.stats_excluded (user_id) values ($1)", [D]);
      expect((await stats()).n).toBe(32);
    });

    it("keeps the signatures and answers the game calls, for the public key", async () => {
      const sig = await db.query<{ name: string; args: string; result: string }>(
        `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('list_stats', 'list_averages') order by 1`,
      );
      expect(sig.rows).toEqual([
        { name: "list_averages", args: "p_mode text", result: "TABLE(list_id text, n integer, avg numeric)" },
        { name: "list_stats", args: "p_list_id text, p_mode text", result: "json" },
      ]);
      await as("authenticated", A, async () => {
        expect(Object.keys((await db.query<{ s: object }>("select public.list_stats('s-tests') as s")).rows[0].s)).toEqual(["n", "counts", "avg"]);
        expect((await db.query("select * from public.list_averages()")).rows.length).toBeGreaterThan(0);
      });
    });

    it("gives players no access to stats_excluded", async () => {
      for (const [role, user] of [["anon", null], ["authenticated", E]] as const) {
        await as(role, user, async () => {
          expect(await code(db.query("select * from public.stats_excluded"))).toBe("42501");
          expect(await code(db.query("insert into public.stats_excluded (user_id) values ($1)", [E]))).toBe("42501");
          expect(await code(db.query("delete from public.stats_excluded"))).toBe("42501");
        });
      }
    });

    it("drops an account's row when the account is deleted", async () => {
      await db.query("delete from auth.users where id = $1", [D]);
      expect((await db.query("select * from public.stats_excluded where user_id = $1", [D])).rows).toEqual([]);
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
