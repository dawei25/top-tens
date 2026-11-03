import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The migrations, run in PGlite (Postgres in WebAssembly) against small stand-ins for what Supabase provides: the
 * anon, authenticated and service_role roles, auth.users and auth.uid(). Checks the contract the game relies on: who
 * can touch what, what submit_play accepts, what the stats functions return, the save's version check, and what
 * account deletion (api/delete-account.ts, as service_role) needs.
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

    it("lets account deletion (the server, as service_role) clear a player's games and save", async () => {
      await as("authenticated", B, () => db.query("insert into public.saves (user_id, data) values ($1, '{}')", [B]));
      const others = await db.query<{ n: number }>("select count(*)::int as n from public.plays where user_id is distinct from $1", [B]);
      await as("service_role", null, async () => {
        // What api/delete-account.ts sends through the API: a delete filtered on the user.
        expect((await db.query("delete from public.plays where user_id = $1", [B])).affectedRows).toBe(2);
        expect((await db.query("delete from public.saves where user_id = $1", [B])).affectedRows).toBe(1);
      });
      expect((await db.query<{ n: number }>("select count(*)::int as n from public.plays")).rows[0].n).toBe(others.rows[0].n);
    });

    it("goes, with the account's linked games, when the sign-in is deleted", async () => {
      const before = await db.query<{ n: number }>("select count(*)::int as n from public.plays where user_id is null");
      await db.query("delete from auth.users where id = $1", [A]);
      expect((await db.query("select * from public.saves where user_id = $1", [A])).rows).toEqual([]);
      expect((await db.query("select * from public.plays where user_id = $1", [A])).rows).toEqual([]);
      // Anonymous games stay in the totals.
      expect((await db.query<{ n: number }>("select count(*)::int as n from public.plays where user_id is null")).rows[0].n).toBe(before.rows[0].n);
    });
  });
}

describe("with new tables exposed to the API (older projects)", () => suite(true));
describe('with "Automatically expose new tables" off', () => suite(false));
