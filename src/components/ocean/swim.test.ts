// The squid's ink always comes with a dart (the owner, Nov 9: "whenever u blow ink, squid should dart"). The swim is
// pure motion, stepped here on its own clock with seeded randomness: in open water, nose up against the glass with no
// room to turn (where it once inked in place, over and over), against the viewport's edges and corners, and behind the
// glass on a phone. The browser suite (e2e/squid.e2e.cjs) checks the same on screen, with taps and lost lives.
import { describe, expect, it } from "vitest";
import { Room, type Box } from "./room";
import { Swimmer, type Pt, type World } from "./swim";

const DT = 1 / 30;

/** mulberry32: a small seeded generator, so every run swims the same way. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The list game at 1440 x 900 (as the browser suite measures it): head, prompt, board and the guess card. */
const DESKTOP_GLASS: Box[] = [
  { left: 80, top: 24, right: 1360, bottom: 101 },
  { left: 80, top: 117, right: 835, bottom: 287 },
  { left: 80, top: 303, right: 835, bottom: 831 },
  { left: 851, top: 117, right: 1231, bottom: 241 },
];
const desktop: World = { w: 1440, h: 900, sw: 80, sh: 120, floor: () => 880, prefer: () => null };
const phone: World = { w: 390, h: 844, sw: 60, sh: 90, floor: () => 830, prefer: () => null };

interface Run {
  /** Where it was as the ink came out, and when (s); null if no ink came. */
  ink: (Pt & { t: number }) | null;
  /** Its path, a point per frame (with the envelope's slack, confined, and whether the flee is still on). */
  path: (Pt & { t: number; slack: number; fleeing: boolean })[];
}

/** Put a squid at p, heading `tilt`, ask it to ink and flee (past `clear` px), and swim on for `secs`. */
function flee(world: World, room: Room | null, p: Pt, tilt: number, seed: number, clear = 0, secs = 3): Run {
  const s = new Swimmer(world, seeded(seed));
  s.setWorld(world);
  s.setRoom(room);
  s.place(p, tilt);
  let t = 0;
  const run: Run = { ink: null, path: [] };
  const ok = s.flee(() => {
    run.ink = { x: s.x, y: s.y, t };
  }, clear);
  expect(ok, "no way out").toBe(true);
  for (; t < secs; t += DT) {
    s.step(DT, t);
    run.path.push({ x: s.x, y: s.y, t: t + DT, slack: room ? room.fit(s.x, s.y, s.tilt) : 0, fleeing: s.fleeing });
  }
  return run;
}

/**
 * Every flee: the ink comes out within a second, as it moves off; it is clear of the cloud 0.7 s on (the browser suite
 * asks one width, eyes to the cloud's centre; here the head, a little nearer the eyes than the siphon is); and it ends
 * at least `far` px away (two widths). Confined, it never touches the glass.
 */
function expectDart(run: Run, world: World, label: string, far = 2 * world.sw) {
  const ink = run.ink;
  expect(ink, `${label}: no ink`).not.toBeNull();
  if (!ink) return;
  expect(ink.t, `${label}: the ink waited ${ink.t.toFixed(2)} s`).toBeLessThan(1.2);
  const at = (dt: number) => run.path.find((q) => q.t >= ink.t + dt - 1e-6) ?? run.path[run.path.length - 1];
  const from = (q: Pt) => Math.hypot(q.x - ink.x, q.y - ink.y);
  // Moving as the ink appears: a tenth of its width off within 0.1 s (the jet's first frames).
  expect(from(at(0.1)), `${label}: still as it inked`).toBeGreaterThan(0.1 * world.sw);
  expect(from(at(0.7)) / world.sw, `${label}: 0.7 s on`).toBeGreaterThan(1.2);
  // Where the dart ends, as it roams on (it brakes a little short of what it planned).
  const end = run.path.find((q) => q.t > ink.t && !q.fleeing);
  expect(end, `${label}: the dart never ended`).toBeDefined();
  expect(from(end!), `${label}: where the dart ended`).toBeGreaterThan(far * 0.85);
  // Never into the glass (a flip about its middle keeps the envelope where it was).
  expect(Math.min(...run.path.map((q) => q.slack)), `${label}: into the glass`).toBeGreaterThan(-1);
}

/** The highest spot (nearest the glass above) where it fits upright at column x. */
function noseUp(room: Room, x: number, below: number): Pt {
  let y = below;
  while (room.fit(x, y - 2, 0) >= 0) y -= 2;
  return { x, y };
}

const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

describe("ink comes with a dart, never in place", () => {
  const room = Room.build(DESKTOP_GLASS, desktop.w, desktop.h, 4)!;

  it("in open water", () => {
    for (const seed of SEEDS) expectDart(flee(desktop, room, { x: 1140, y: 560 }, (seed * 47) % 360, seed), desktop, `open, seed ${seed}`);
  });

  it("a lost life's bigger cloud: it gets out past it", () => {
    // The engine's reach for a lost life's cloud at 1440 x 900 (a fifth of the 225 canvas px short side, 4 px each).
    const clear = (0.7 * 45 + 10) * 4;
    for (const seed of SEEDS) {
      const p = { x: 1000 + ((seed * 37) % 300), y: 420 + ((seed * 53) % 300) };
      expectDart(flee(desktop, room, p, (seed * 47) % 360, seed, clear), desktop, `lost life at ${p.x},${p.y}, seed ${seed}`, clear);
    }
  });

  it("nose up against the glass, with no room to turn or go on: it flips round, then darts", () => {
    for (const x of [1000, 1100, 1180]) {
      const p = noseUp(room, x, 450);
      // The case that inked in place: no turn fits here, and there is no room ahead.
      expect(room.free(p.x, p.y), "it could turn round here").toBeLessThan(0);
      expect(room.reach(p.x, p.y, 0, 200), "room ahead").toBeLessThan(desktop.sw);
      for (const seed of SEEDS) expectDart(flee(desktop, room, p, 0, seed), desktop, `nose up at ${x}, seed ${seed}`);
    }
  });

  it("against the viewport's edges and in its corners", () => {
    const spots: [Pt, number][] = [
      [{ x: 1440 - 60, y: 560 }, 90],
      [{ x: 1440 - 60, y: 900 - 80 }, 135],
      [{ x: 1440 - 90, y: 330 }, 45],
      [{ x: 1000, y: 900 - 70 }, 180],
    ];
    for (const [p0, tilt] of spots) {
      // As near that edge as it fits, facing it.
      let p = p0;
      for (let k = 0; k < 200 && room.fit(p.x, p.y, tilt) < 0; k++) p = { x: p.x - Math.sin((tilt * Math.PI) / 180) * 2, y: p.y + Math.cos((tilt * Math.PI) / 180) * 2 };
      expect(room.fit(p.x, p.y, tilt), `no fit by ${p0.x},${p0.y}`).toBeGreaterThanOrEqual(0);
      for (const seed of SEEDS) expectDart(flee(desktop, room, p, tilt, seed), desktop, `edge ${p0.x},${p0.y}, seed ${seed}`);
    }
  });

  it("behind the glass on a phone: in the middle, at the edges, in the corners", () => {
    const spots: [Pt, number][] = [
      [{ x: 195, y: 500 }, 0],
      [{ x: 45, y: 500 }, -90],
      [{ x: 345, y: 740 }, 90],
      [{ x: 45, y: 60 }, -45],
      [{ x: 345, y: 800 }, 135],
    ];
    for (const [p, tilt] of spots)
      for (const seed of SEEDS) expectDart(flee(phone, null, p, tilt, seed), phone, `phone ${p.x},${p.y}, seed ${seed}`);
  });

  it("a find meanwhile doesn't cut the dart short", () => {
    const s = new Swimmer(desktop, seeded(7));
    s.setWorld(desktop);
    s.setRoom(room);
    s.place({ x: 1140, y: 560 }, 0);
    let inked: Pt | null = null;
    s.flee(() => (inked = { x: s.x, y: s.y }));
    let t = 0;
    for (; t < 0.05; t += DT) s.step(DT, t);
    s.hop(true);
    for (; t < 1; t += DT) s.step(DT, t);
    expect(inked).not.toBeNull();
    expect(Math.hypot(s.x - inked!.x, s.y - inked!.y) / desktop.sw).toBeGreaterThan(1.5);
  });

  it("another move before the jet drops the ink: none in place", () => {
    const s = new Swimmer(desktop, seeded(3));
    s.setWorld(desktop);
    s.setRoom(room);
    s.place({ x: 1140, y: 560 }, 0);
    let inks = 0;
    s.flee(() => inks++);
    s.pause(0.5);
    for (let t = 0; t < 2; t += DT) s.step(DT, t);
    expect(inks).toBe(0);
    expect(s.fleeing).toBe(false);
  });
});
