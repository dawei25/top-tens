import { describe, expect, it } from "vitest";
import type { ListRun } from "../../game/history";
import { SyncConflict, syncSave, type LocalSave, type RemoteSave, type SaveRemote } from "./engine";
import { sameSave, type SyncSave } from "./merge";

const T = Date.UTC(2026, 10, 1, 12);
const now = () => T + 3600_000;
const run = (id: string, startedAt: number): ListRun => ({
  id,
  startedAt,
  finishedAt: startedAt + 60_000,
  status: "lost",
  found: [1],
  lives: 0,
  hints: 0,
});
const withRuns = (...runs: ListRun[]): SyncSave => ({ games: {}, daily: {}, seenHelp: false, listRuns: runs });

/** A server holding one save with a version, compare-and-swap writes, and hooks to simulate other devices. */
class FakeServer implements SaveRemote {
  row: RemoteSave | null = null;
  puts = 0;
  gets = 0;
  /** Runs before a get answers / a put lands: another device writing in between. */
  beforeGet?: () => void;
  beforePut?: () => void;
  offline = false;

  async get() {
    this.gets++;
    if (this.offline) throw new TypeError("Failed to fetch");
    this.beforeGet?.();
    return this.row && { data: structuredClone(this.row.data), version: this.row.version };
  }

  async put(data: SyncSave, base: number) {
    this.puts++;
    if (this.offline) throw new TypeError("Failed to fetch");
    this.beforePut?.();
    if ((this.row?.version ?? 0) !== base) return false;
    this.row = { data: structuredClone(data), version: base + 1 };
    return this.row.version;
  }
}

function device(initial: SyncSave): LocalSave & { save: SyncSave } {
  const d = {
    save: structuredClone(initial),
    read: () => structuredClone(d.save),
    write: (s: SyncSave) => void (d.save = structuredClone(s)),
  };
  return d;
}

describe("syncSave", () => {
  it("uploads this device's save when the account has none", async () => {
    const server = new FakeServer();
    const phone = device(withRuns(run("a", T)));
    const out = await syncSave(server, phone, now);
    expect(out).toEqual({ changedLocal: false, pushed: true, version: 1 });
    expect(sameSave(server.row!.data, phone.save)).toBe(true);
  });

  it("brings the account's games to this device and sends back the union", async () => {
    const server = new FakeServer();
    server.row = { data: withRuns(run("b", T)), version: 3 };
    const laptop = device(withRuns(run("a", T + 1000)));
    const out = await syncSave(server, laptop, now);
    expect(out).toEqual({ changedLocal: true, pushed: true, version: 4 });
    expect(laptop.save.listRuns!.map((r) => r.id)).toEqual(["a", "b"]);
    expect(sameSave(server.row!.data, laptop.save)).toBe(true);
  });

  it("doesn't write anything when both sides already agree", async () => {
    const server = new FakeServer();
    const s = withRuns(run("a", T));
    server.row = { data: s, version: 2 };
    const phone = device(s);
    expect(await syncSave(server, phone, now)).toEqual({ changedLocal: false, pushed: false, version: 2 });
    expect(server.puts).toBe(0);
  });

  it("settles a conflict by merging again, never by overwriting", async () => {
    const server = new FakeServer();
    server.row = { data: withRuns(run("a", T)), version: 1 };
    const phone = device(withRuns(run("p", T + 5000)));
    // The laptop writes between the phone's read and its write.
    let once = true;
    server.beforePut = () => {
      if (!once) return;
      once = false;
      server.row = { data: withRuns(run("a", T), run("l", T + 9000)), version: 2 };
    };
    const out = await syncSave(server, phone, now);
    expect(out.pushed).toBe(true);
    expect(server.row!.version).toBe(3);
    expect((server.row!.data as SyncSave).listRuns!.map((r) => r.id).sort()).toEqual(["a", "l", "p"]);
    expect(phone.save.listRuns!.map((r) => r.id).sort()).toEqual(["a", "l", "p"]);
  });

  it("keeps a game saved on this device while the server was answering", async () => {
    const server = new FakeServer();
    server.row = { data: withRuns(run("a", T)), version: 1 };
    const phone = device(withRuns());
    // The game screen saves a finished game during the request.
    server.beforeGet = () => void (phone.save = withRuns(run("new", T + 7000)));
    await syncSave(server, phone, now);
    expect(phone.save.listRuns!.map((r) => r.id).sort()).toEqual(["a", "new"]);
    expect((server.row!.data as SyncSave).listRuns!.map((r) => r.id).sort()).toEqual(["a", "new"]);
  });

  it("never touches a game saved here while its upload was on the way (the next sync sends it)", async () => {
    const server = new FakeServer();
    const phone = device(withRuns(run("a", T)));
    server.beforePut = () => void (phone.save = withRuns(run("later", T + 8000), run("a", T)));
    await syncSave(server, phone, now);
    expect(phone.save.listRuns!.map((r) => r.id)).toEqual(["later", "a"]);
    await syncSave(server, phone, now);
    expect((server.row!.data as SyncSave).listRuns!.map((r) => r.id)).toEqual(["later", "a"]);
  });

  it("gives up after a few conflicts in a row, and fails when offline", async () => {
    const server = new FakeServer();
    server.row = { data: withRuns(), version: 1 };
    let v = 1;
    server.beforePut = () => void (server.row = { data: withRuns(run(`x${v}`, T + v)), version: ++v });
    await expect(syncSave(server, device(withRuns(run("a", T))), now, 3)).rejects.toBeInstanceOf(SyncConflict);

    const down = new FakeServer();
    down.offline = true;
    await expect(syncSave(down, device(withRuns()), now)).rejects.toThrow("Failed to fetch");
  });

  it("converges: two devices syncing in turns stop rewriting the server after one round each", async () => {
    const server = new FakeServer();
    const tie = (score: number): SyncSave => ({
      games: {},
      daily: {},
      seenHelp: false,
      // The same round recorded on both devices with the same answers but different points: a real tie.
      blitzRuns: { x: [{ startedAt: T, endedAt: T + 90_000, score, hits: [{ name: "n", rank: 1, n: 1, points: score }] }] },
    });
    const phone = device({ ...tie(50), listRuns: [run("p", T)] });
    const laptop = device({ ...tie(40), listRuns: [run("l", T)] });
    for (let i = 0; i < 3; i++) {
      await syncSave(server, phone, now);
      await syncSave(server, laptop, now);
    }
    const puts = server.puts;
    await syncSave(server, phone, now);
    await syncSave(server, laptop, now);
    expect(server.puts).toBe(puts);
    expect(sameSave(phone.save, laptop.save)).toBe(true);
  });
});
