/**
 * How the roaming squid swims, after the squid's jet cycle: the mantle hyperinflates (radial muscles draw water in;
 * the mantle swells and the arms open), then contracts hard (circular muscles) and the jet shoots it mantle-first in
 * a front-loaded burst; it glides on under drag while the mantle refills more slowly (elastic recoil) and the arms
 * relax and spread again.
 *
 * Head-first, always. The mantle tip (with the eyes, this sprite's head) is the only way it travels: `tilt` is its
 * heading, every push is along it, and the water does the rest like a keel: sideways and backward motion is damped
 * away in a few frames, so momentum only carries forward. To go somewhere else it turns first: it slows, rotates on
 * its fins (in place or in a tight arc; slower the faster it is still going, so the keel keeps up), and only jets
 * once it faces the way it will go. A dart or a flee turns faster and brakes harder, but turns all the same.
 *
 * Reactions are behaviours on top: a dart (to a point, braking into it), a flee (away from its own ink, preferring
 * the way it already faces), loops (a circle that starts along its heading), dozing (it swims down head-first, rights
 * itself above the seabed and settles slowly) and hovering near something the player points at.
 *
 * Confined (wide screens, with a Room): the whole squid, limbs included, stays in open water. Every turn is checked
 * against the glass before it starts (the way round that fits), every glide against the room ahead of it (a heading
 * near the one it wants, as far as fits), a glide that would run out of room brakes in time, and as a last resort a
 * step that would touch the glass is not taken (it stops dead, never slides). Dozing, it rights itself where it has
 * room to turn and sinks straight down to the seabed.
 *
 * Pure motion in CSS px and seconds, no DOM: each frame the engine reads x, y, tilt, sx, sy, and the jet state that
 * drives the limbs and fins (jetAge, inflating, hovering).
 */
import type { Room } from "./room";

export interface Pt {
  x: number;
  y: number;
}

export interface World {
  w: number;
  h: number;
  /** The squid's size in CSS px: mantle width, and the height it keeps clear of the seabed. */
  sw: number;
  sh: number;
  /** The seabed's top edge (CSS px) under a column. */
  floor: (x: number) => number;
  /** Asked for each new waypoint: a point where the squid will show (open water), or null for anywhere. */
  prefer?: (low: boolean) => Pt | null;
}

type Phase = "turn" | "inflate" | "glide" | "hover" | "settle" | "sink" | "pivot";
export type Behaviour = "roam" | "perk" | "doze" | "loop";

/** Glide drag, per second: a pulse's speed falls off as exp(-DRAG t). */
const DRAG = 1.4;
/** The keel: sideways (and backward) speed falls off as exp(-KEEL t). */
const KEEL = 18;
/** A jet's thrust is spent over this long, front-loaded (an eased-out burst). */
const THRUST = 0.14;
/** Turn rates, degrees a second: on the fins at rest, and on a dart or a flee. */
const TURN = 230;
const TURN_URGENT = 900;
/** Above this speed (px/s) the turn rate is capped, so the keel keeps the travel within a few degrees of the heading. */
const MOVING = 12;
const TURN_MOVING = 190;
const TURN_MOVING_URGENT = 230;
/** Steering while it glides (small corrections, a gentle arc). */
const STEER = 45;
/** It jets only once it faces within this many degrees of where it is going. */
const ALIGN = 8;
/** Turns smaller than this happen while the mantle fills; bigger ones stop to turn first. */
const SMALL_TURN = 35;
/** On the fins while turning: a tight arc, never more than this px/s. */
const FIN_SPEED = 8;
/** A dart brakes into its point: its speed is held to this many times the distance left (per second). */
const ARRIVE = 8;
/** Settling onto the seabed, px/s (slower than any swimming); confined, it sinks further, a little faster. */
const SINK = 9;
const SINK_ROOM = 13;
/** Confined, in a strip too thin to turn round in: it goes down by drifting, upright-ish, this many px/s. */
const DRIFT = 12;
/** Confined, hemmed in: a slow turn about the middle of its silhouette (which stays put, so it always fits), its
 *  head never moving faster than this (px/s), below what the heading check looks at. */
const PIVOT_SPEED = 12;
/** Confined: headings tried for that slow turn. */
const PIVOT_HEADINGS = [30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180];
/** Confined: a glide stops this far short of the room it has ahead (CSS px). */
const SHORT = 24;
/** Confined: headings tried around the one it wants, nearest first; for a hop, only near its own. */
const OFFSETS = [0, 12, -12, 25, -25, 40, -40, 60, -60, 90, -90, 120, -120, 150, -150, 180];
const HOP_OFFSETS = [0, 15, -15, 30, -30, 50, -50];

const RAD = Math.PI / 180;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (s: number) => (s < 0.5 ? 2 * s * s : 1 - (-2 * s + 2) ** 2 / 2);
const wrapDeg = (d: number) => d - 360 * Math.round(d / 360);
/** The heading (degrees, clockwise, 0 is up) of a direction. */
const headingOf = (x: number, y: number) => Math.atan2(x, -y) / RAD;

export class Swimmer {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  /** The heading: degrees, clockwise; 0 is upright (mantle up). It only ever travels this way. */
  tilt = 0;
  sx = 1;
  sy = 1;
  behaviour: Behaviour = "roam";
  /** Settled on the seabed, asleep. */
  asleep = false;
  /** Momentum (Blitz heat) and mood: how hard and how often it pulses. */
  speed = 1;
  cadence = 1;
  /** Out of lives: it keeps low. */
  low = false;
  /** Seconds since the last jet: the limbs bunch into a cone on the jet, then splay as it glides. */
  jetAge = 9;

  private phase: Phase = "glide";
  private left = 0.6;
  /** Where the next jet goes: a heading in degrees. */
  private aim = 0;
  private jet = 0;
  private thrust = 0;
  private inflateFor = 0.22;
  /** A dart or a flee: turns fast and brakes hard. */
  private urgent = false;
  /** A dart's point: it brakes into it. */
  private arrive: Pt | null = null;
  private target: Pt;
  private perkAt: Pt | null = null;
  private dozeX: number | null = null;
  private loop: {
    c: Pt;
    r: number;
    a0: number;
    dir: number;
    turns: number;
    t: number;
    dur: number;
  } | null = null;
  private onLoopDone: (() => void) | null = null;
  /** Confined: open water, and the way round the current turn goes (1 clockwise, -1, 0 the short way). */
  private room: Room | null = null;
  private spin: 1 | -1 | 0 = 0;
  /** Confined: seconds a turn or a glide has been held up at the glass (then it plans again). */
  private stuck = 0;
  /** Confined: on its way out of glass that came over it (a panel appeared, the page scrolled). */
  escaping = false;
  /** The last thing the confinement did, and when (seconds of swim time): for the dev stats' off-heading log. */
  note = "";
  clock = 0;
  /** Confined dozing: the height where it rights itself before sinking. */
  private dozeTurnY: number | null = null;
  /** Confined, escaping: the heading that fits where it is going, to turn to once there. */
  private after: number | null = null;
  /** Confined, pivoting: the heading it turns to, slowly, about the middle of its silhouette; and whether it then
   *  settles (dozing, righting itself where there is no room to turn the usual way). */
  private pivotTo = 0;
  private settleAfter = false;

  private world: World;
  private rand: () => number;

  constructor(world: World, rand: () => number = Math.random) {
    this.world = world;
    this.rand = rand;
    this.x = world.w * 0.72;
    this.y = world.h * 0.6;
    this.target = this.waypoint();
  }

  setWorld(world: World) {
    this.world = world;
    const b = this.bounds();
    this.x = clamp(this.x, b.x0, b.x1);
    this.y = clamp(this.y, b.y0, this.maxY());
    this.target = this.waypoint();
    this.arrive = null;
  }

  /** Open water to stay in (wide screens), or null: anywhere, behind the glass. */
  setRoom(room: Room | null) {
    const was = this.room;
    this.room = room;
    if (!room) this.escaping = false;
    if (!!was !== !!room) {
      this.spin = 0;
      if (this.behaviour === "doze" && !this.asleep) this.dozeTurnY = null;
    }
  }

  get confined() {
    return this.room !== null;
  }

  /** The envelope's slack where it is now (confined), for the engine's checks. */
  fit() {
    return this.room ? this.room.fit(this.x, this.y, this.tilt, this.onSeabed) : Infinity;
  }

  /** Settling or asleep: its limbs may rest on the seabed, at the bottom edge. */
  private get onSeabed() {
    return this.asleep || this.phase === "settle";
  }

  /** Put it somewhere at once (a resize, the first frame), at rest. */
  place(p: Pt, tilt = this.tilt) {
    this.x = p.x;
    this.y = p.y;
    this.tilt = tilt;
    this.vx = this.vy = 0;
    this.thrust = 0;
    this.arrive = null;
    this.escaping = false;
    this.spin = 0;
    if (this.behaviour !== "doze") {
      this.phase = "glide";
      this.left = 0.4;
    }
    this.target = this.waypoint();
  }

  /** Inflating for a jet, 0-1: the arms open as the mantle fills. */
  get inflating() {
    return this.phase === "inflate" ? clamp(1 - Math.max(0, this.left) / this.inflateFor, 0, 1) : 0;
  }

  /** Hovering or barely moving (turning on its fins too): the fins flap. */
  get hovering() {
    return this.behaviour !== "loop" && Math.hypot(this.vx, this.vy) < this.unit * 0.3;
  }

  /** What it is doing, for the debug stats. */
  get state() {
    return `${this.behaviour}/${this.loop ? "loop" : this.phase}${this.urgent ? "!" : ""}`;
  }

  /** Base jet length in px: a calm pulse crosses about a third of the short side. */
  private get unit() {
    return clamp(Math.min(this.world.w, this.world.h) * 0.36, 90, 320);
  }

  private bounds() {
    const { w, sw, sh } = this.world;
    const mx = sw * 0.7;
    return { x0: mx, x1: Math.max(mx, w - mx), y0: sh * 0.45 };
  }

  private inBounds(x: number, y: number) {
    const b = this.bounds();
    return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= this.maxY();
  }

  /** Where a dozing squid's centre rests at column x: arms on the seabed. */
  private floorY(x: number) {
    return this.world.floor(x) - this.world.sh * 0.5;
  }

  /** Lowest it swims: in front of the near seabed, right down to the bottom of the screen (behind the input bar). */
  private maxY() {
    return this.world.h - this.world.sh * 0.3;
  }

  private waypoint(): Pt {
    if (this.room) return this.world.prefer?.(this.low) ?? { x: this.x, y: this.y };
    const pref = this.low ? null : this.world.prefer?.(false);
    if (pref) return this.clampPt(pref);
    const b = this.bounds();
    const x = b.x0 + this.rand() * (b.x1 - b.x0);
    const top = this.low ? this.world.h * 0.5 : this.world.h * 0.1 + b.y0;
    const bottom = Math.max(top, this.floorY(x) - this.world.sh * 0.4);
    return { x, y: top + this.rand() * (bottom - top) };
  }

  /**
   * Set up a jet along heading `aim` (degrees), enough to glide about `v / DRAG` px: turn first if it faces well
   * away, then inflate (finishing the turn), then jet.
   */
  private go(aim: number, v: number, inflate = 0.22, urgent = false, arrive: Pt | null = null, spin: 1 | -1 | 0 = 0) {
    this.aim = aim;
    this.jet = v;
    this.urgent = urgent;
    this.arrive = arrive;
    this.thrust = 0;
    this.inflateFor = inflate;
    this.left = inflate;
    this.spin = spin;
    this.stuck = 0;
    this.phase = Math.abs(wrapDeg(aim - this.tilt)) > SMALL_TURN ? "turn" : "inflate";
  }

  /**
   * Confined: the heading nearest `want` (degrees) that it can turn to here and glide along, and how far (at most
   * `travel`, at least `min`), scored by how far it gets against how far it turns away (`turnCost` per degree).
   * Null when nothing fits.
   */
  private plan(want: number, travel: number, min = 20, turnCost = 1 / 90, offs = OFFSETS): { aim: number; travel: number; spin: 1 | -1 | 0 } | null {
    const room = this.room!;
    let best: { aim: number; travel: number; spin: 1 | -1 | 0 } | null = null;
    let score = -Infinity;
    for (const off of offs) {
      const aim = wrapDeg(want + off);
      const spin = room.sweep(this.x, this.y, this.tilt, aim);
      if (spin === null) continue;
      let t = Math.min(travel, room.reach(this.x, this.y, aim, travel + SHORT) - SHORT);
      if (t < min) continue;
      // Better to end where it can turn round (or, upright, drift down): never boxed in, facing the glass.
      const ux = Math.sin(aim * RAD);
      const uy = -Math.cos(aim * RAD);
      const free = (d: number) => Math.abs(aim) <= 50 || room.free(this.x + ux * d, this.y + uy * d) >= 0;
      let boxed = 0;
      if (!free(t)) {
        let d = t - 10;
        while (d >= min && !free(d)) d -= 10;
        if (d >= min) t = d;
        else boxed = 0.6;
      }
      const k = t / travel - Math.abs(off) * turnCost - boxed;
      if (k > score) {
        score = k;
        best = { aim, travel: t, spin };
      }
    }
    return best;
  }

  /** Confined, with nowhere to go from here: hang a moment, then look again. */
  private hold(s = 0.6) {
    this.phase = "hover";
    this.left = s + this.rand() * 0.4;
    this.thrust = 0;
    this.arrive = null;
    this.urgent = false;
    this.spin = 0;
  }

  /** Pulse toward a point, far enough to get about `share` of the way there. */
  private pulseTo(p: Pt, share = 1, inflate = 0.22, max = 1) {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy);
    const travel = clamp(d * share, 24, this.unit * max * this.speed);
    // A slight wobble in the aim, so it never swims dead straight.
    const aim = headingOf(dx, dy) + (this.rand() - 0.5) * 20;
    if (this.room) {
      const q = this.plan(aim, travel, Math.min(24, travel));
      if (q && Math.abs(wrapDeg(q.aim - aim)) <= 60) return this.go(q.aim, q.travel * DRAG, inflate, false, null, q.spin);
      // Below it, in a strip too thin to turn round in: it drifts down to it, upright.
      if (dy > 30 && this.drift(dy)) return;
      if (q) return this.go(q.aim, q.travel * DRAG, inflate, false, null, q.spin);
      if (this.pivot()) return;
      return this.hold();
    }
    this.go(aim, travel * DRAG, inflate);
  }

  /** A quick dart to a point (a find): turn fast, jet hard, brake into it. */
  dart(p: Pt) {
    if (this.behaviour === "loop") return;
    this.wakeUp();
    this.behaviour = "roam";
    this.target = this.clampPt(p);
    const dx = this.target.x - this.x;
    const dy = this.target.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 12) return;
    const boost = Math.max(1, this.speed * 0.9);
    if (this.room && !this.escaping) {
      // As straight there as the open water allows, braking where the glide must end.
      const q = this.plan(headingOf(dx, dy), d, Math.min(30, d), 1 / 60);
      if (!q) return this.hold(0.3);
      const end = {
        x: this.x + Math.sin(q.aim * RAD) * q.travel,
        y: this.y - Math.cos(q.aim * RAD) * q.travel,
      };
      return this.go(q.aim, clamp(q.travel * 5, 300, 3200) * boost, 0.05, true, end, q.spin);
    }
    this.go(headingOf(dx, dy), clamp(d * 5, 300, 3200) * boost, 0.05, true, this.target);
  }

  /**
   * Out of glass that came over it, to a spot in open water (confined): a dart that ignores the glass until it is
   * clear, then a turn to heading `h`, which fits there.
   */
  escape(p: Pt, h: number | null = null) {
    if (this.behaviour === "loop") return;
    this.escaping = true;
    this.after = h;
    // It stops dead as the glass lands on it (behind the glass, where it hardly shows), so it turns in place, never
    // swinging round mid-glide (a screen being drawn can make that frame long).
    this.vx = this.vy = 0;
    this.thrust = 0;
    this.dart(p);
  }

  /**
   * Confined and hemmed in (no turn here fits, nothing ahead): turn slowly about the middle of the silhouette, which
   * stays where it is, to the heading nearest its own with the most open water ahead. False if none has any.
   */
  private pivot() {
    const room = this.room;
    if (!room) return false;
    const b = room.back;
    const cx = this.x - Math.sin(this.tilt * RAD) * b;
    const cy = this.y + Math.cos(this.tilt * RAD) * b;
    let best: number | null = null;
    let score = -Infinity;
    for (const off of PIVOT_HEADINGS) {
      const h = wrapDeg(this.tilt + off);
      const x = cx + Math.sin(h * RAD) * b;
      const y = cy - Math.cos(h * RAD) * b;
      const ahead = room.reach(x, y, h, this.unit);
      const k = (Math.abs(h) <= 50 ? 60 : 0) + ahead - Math.abs(off) * 0.5;
      if ((ahead >= 40 || Math.abs(h) <= 50) && k > score) {
        score = k;
        best = h;
      }
    }
    if (best === null) return false;
    this.pivotTo = best;
    this.phase = "pivot";
    this.left = 0.2;
    this.thrust = 0;
    this.arrive = null;
    this.urgent = false;
    this.spin = 0;
    this.vx = this.vy = 0;
    return true;
  }

  /** The slow turn: the silhouette's middle stays put; the head swings round it, slower than the heading check. */
  private stepPivot(dt: number, refill: number) {
    const room = this.room;
    this.sx += (1 - this.sx) * refill;
    this.sy += (1 - this.sy) * refill;
    if (!room) {
      this.phase = "glide";
      this.left = 0;
      return;
    }
    const b = room.back;
    const rate = ((PIVOT_SPEED / b) * 180) / Math.PI;
    const diff = wrapDeg(this.pivotTo - this.tilt);
    const step = clamp(diff, -rate * dt, rate * dt);
    const cx = this.x - Math.sin(this.tilt * RAD) * b;
    const cy = this.y + Math.cos(this.tilt * RAD) * b;
    this.tilt += step;
    this.x = cx + Math.sin(this.tilt * RAD) * b;
    this.y = cy - Math.cos(this.tilt * RAD) * b;
    this.vx = this.vy = 0;
    // Clear enough to turn the usual way now: on with it.
    this.left -= dt;
    if (this.left <= 0 && !this.settleAfter) {
      this.left = 0.2;
      const q = this.plan(this.pivotTo, this.unit * 0.6, 30, 1 / 90, [0]);
      if (q) return this.go(q.aim, q.travel * DRAG, 0.18, false, null, q.spin);
    }
    if (Math.abs(diff - step) < 0.5) {
      if (this.settleAfter) {
        this.settleAfter = false;
        this.phase = "settle";
        return;
      }
      this.phase = "glide";
      this.left = 0;
      this.next();
    }
  }

  /** Confined, roughly upright: drift down (slowly, fins out) up to `max` px, as far as fits. False if it can't. */
  private drift(max: number) {
    if (!this.room || Math.abs(wrapDeg(this.tilt)) > 50) return false;
    const d = Math.min(this.room.drop(this.x, this.y, this.tilt, Math.min(max, 220)), max) - 8;
    if (d < 24) return false;
    this.phase = "sink";
    this.left = d / DRIFT;
    this.thrust = 0;
    this.arrive = null;
    this.urgent = false;
    this.spin = 0;
    return true;
  }

  /**
   * A find: a quick happy hop, head-first, a short way along (or near) its heading; bigger for the feeding
   * tentacles. With no room for one, a flourish in place: the mantle fills and snaps, the arms flare and close.
   */
  hop(big: boolean) {
    if (this.behaviour === "loop" || this.escaping) return;
    this.wakeUp();
    this.behaviour = "roam";
    const want = big ? 90 : 55;
    const q = this.room ? this.plan(this.tilt, want, 18, 1 / 45, HOP_OFFSETS) : { aim: this.tilt, travel: want, spin: 0 as const };
    if (q) this.go(q.aim, q.travel * DRAG, big ? 0.1 : 0.07, true, null, q.spin);
    else this.go(this.tilt, 0, big ? 0.12 : 0.09, true);
    this.target = this.waypoint();
  }

  /** Jet hard away from where it is (it just inked): the direction with the most room, nearest the way it faces. */
  flee() {
    if (this.behaviour === "loop") return;
    this.wakeUp();
    this.behaviour = "roam";
    const b = this.bounds();
    const L = this.unit * 1.1 * Math.max(1, this.speed);
    if (this.room && !this.escaping) {
      // The heading with the most room, nearest the way it faces.
      const q = this.plan(this.tilt, L, 30, 1 / 400);
      if (!q) return this.go(this.tilt, 0, 0.07, true);
      this.target = {
        x: this.x + Math.sin(q.aim * RAD) * q.travel,
        y: this.y - Math.cos(q.aim * RAD) * q.travel,
      };
      return this.go(q.aim, q.travel * DRAG, 0.07, true, null, q.spin);
    }
    let best = this.tilt;
    let score = -Infinity;
    for (let i = 0; i < 12; i++) {
      const h = this.tilt + (this.rand() - 0.5) * 360;
      const ux = Math.sin(h * RAD);
      const uy = -Math.cos(h * RAD);
      const p = { x: this.x + ux * L, y: this.y + uy * L };
      const room = Math.min(p.x - b.x0, b.x1 - p.x, p.y - b.y0, this.floorY(clamp(p.x, b.x0, b.x1)) - p.y);
      const s = Math.min(room, L * 0.3) + Math.cos((h - this.tilt) * RAD) * L * 0.25;
      if (s > score) {
        score = s;
        best = h;
      }
    }
    this.target = this.clampPt({
      x: this.x + Math.sin(best * RAD) * L,
      y: this.y - Math.cos(best * RAD) * L,
    });
    this.go(best, L * DRAG, 0.07, true);
  }

  /**
   * Swim `turns` loops, then call `done`. The circle starts along its heading, on the side with more room. Confined,
   * only a circle that fits all the way round; false (and no loops) when none does.
   */
  loops(turns: number, done?: () => void): boolean {
    if (this.behaviour === "loop") return false;
    if (this.room) {
      const pick = this.loopFit();
      if (!pick) return false;
      this.wakeUp();
      this.startLoop(pick, turns, done);
      return true;
    }
    this.wakeUp();
    const b = this.bounds();
    const hx = Math.sin(this.tilt * RAD);
    const hy = -Math.cos(this.tilt * RAD);
    const room = (c: Pt, r: number) => Math.min(c.x - r - b.x0, b.x1 - c.x - r, c.y - r - b.y0, this.maxY() - c.y - r);
    let pick: { c: Pt; r: number; dir: number } | null = null;
    let roomBest = -Infinity;
    const r0 = clamp(Math.min(this.world.w, this.world.h) * 0.11, 36, 110);
    for (const r of [r0, r0 * 0.75, r0 * 0.55]) {
      for (const dir of [1, -1]) {
        // dir 1 is clockwise on screen: the centre is to the right of the heading.
        const c = { x: this.x - dir * hy * r, y: this.y + dir * hx * r };
        const k = room(c, r);
        if (k > roomBest) {
          roomBest = k;
          pick = { c, r, dir };
        }
      }
      if (roomBest >= 0) break;
    }
    this.startLoop(pick!, turns, done);
    return true;
  }

  private startLoop({ c, r, dir }: { c: Pt; r: number; dir: number }, turns: number, done?: () => void) {
    const a0 = Math.atan2(this.y - c.y, this.x - c.x);
    this.loop = { c, r, a0, dir, turns, t: 0, dur: 0.5 + turns * 0.95 };
    this.behaviour = "loop";
    this.onLoopDone = done ?? null;
    this.arrive = null;
    this.thrust = 0;
    this.spin = 0;
  }

  /** Confined: the biggest loop from here (either way round) whose every pose on the circle fits. */
  private loopFit(): { c: Pt; r: number; dir: number } | null {
    const room = this.room!;
    const hx = Math.sin(this.tilt * RAD);
    const hy = -Math.cos(this.tilt * RAD);
    const r0 = clamp(Math.min(this.world.w, this.world.h) * 0.11, 36, 110);
    for (const r of [r0, r0 * 0.75, r0 * 0.55, 30]) {
      for (const dir of [1, -1]) {
        const c = { x: this.x - dir * hy * r, y: this.y + dir * hx * r };
        let ok = true;
        for (let k = 0; ok && k < 36; k++) {
          const a = (k / 36) * Math.PI * 2;
          ok = room.fit(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, headingOf(-Math.sin(a) * dir, Math.cos(a) * dir)) >= 0;
        }
        if (ok) return { c, r, dir };
      }
    }
    return null;
  }

  /**
   * Sink to the seabed and sleep; over toward column `x` on the way down, if given. Confined, `turnY` is where it
   * rights itself (room to turn round) before sinking straight down the column.
   */
  doze(x?: number, turnY?: number) {
    if (this.behaviour === "loop" || this.behaviour === "doze") return;
    this.behaviour = "doze";
    this.arrive = null;
    this.urgent = false;
    const b = this.bounds();
    this.dozeX = clamp(x ?? this.x, b.x0, b.x1);
    this.dozeTurnY = this.room && turnY !== undefined ? turnY : null;
    // Finish the glide it is in, then head down.
    if (this.phase !== "glide") {
      this.phase = "glide";
      this.thrust = 0;
    }
    this.left = Math.min(this.left, 0.5);
  }

  /** Wake (any input): a little hop up off the seabed. */
  wake() {
    if (this.behaviour !== "doze") return;
    this.wakeUp();
    this.behaviour = "roam";
    this.target = this.waypoint();
    const aim = (this.rand() - 0.5) * 30;
    if (this.room) {
      const q = this.plan(aim, this.unit * 0.5, 16, 1 / 45, HOP_OFFSETS);
      if (!q) return this.hold(0.4);
      return this.go(q.aim, q.travel * DRAG, 0.16, false, null, q.spin);
    }
    this.go(aim, this.unit * 0.5 * DRAG, 0.16);
  }

  private wakeUp() {
    this.asleep = false;
    this.settleAfter = false;
    if (this.behaviour === "doze") this.behaviour = "roam";
    if (this.phase === "settle") {
      this.phase = "glide";
      this.left = 0.3;
    }
  }

  /** Where a doze heads: just above its resting spot. */
  private dozeSpot(): Pt {
    const x = this.dozeX ?? this.x;
    if (this.dozeTurnY !== null) return { x, y: this.dozeTurnY };
    return { x, y: this.floorY(x) - this.world.sh * 0.35 };
  }

  /** Come and hover near a point (the player is pointing at something); null to go back to roaming. */
  perk(p: Pt | null) {
    if (this.behaviour === "loop") return;
    this.wakeUp();
    this.perkAt = p ? this.clampPt(p) : null;
    this.behaviour = p ? "perk" : "roam";
    if (p) this.pulseTo(this.perkAt!, 0.85, 0.12, 2);
    else this.target = this.waypoint();
  }

  private clampPt(p: Pt): Pt {
    const b = this.bounds();
    const x = clamp(p.x, b.x0, b.x1);
    return { x, y: clamp(p.y, b.y0, this.maxY()) };
  }

  /** Turn toward heading `to`, no faster than `rate` degrees a second; returns how far off it still is. */
  private turnTo(to: number, rate: number, dt: number) {
    let diff = wrapDeg(to - this.tilt);
    // The way round that fits (confined), until nearly there.
    if (this.spin && Math.abs(diff) > 3 && Math.sign(diff) !== this.spin) diff += 360 * this.spin;
    if (Math.abs(diff) <= 3) this.spin = 0;
    const step = clamp(diff, -rate * dt, rate * dt);
    this.tilt += step;
    return Math.abs(diff - step);
  }

  /** How fast it may turn now: quick on its fins at rest, capped while it still moves so the keel keeps up. */
  private turnRate() {
    const u = Math.hypot(this.vx, this.vy);
    const rest = this.urgent ? TURN_URGENT : TURN;
    if (u <= MOVING) return rest;
    if (this.urgent) return TURN_MOVING_URGENT;
    // Faster still, wider still: a calm squid barely steers mid-glide.
    return TURN_MOVING * clamp(1.2 - u / (this.unit * 1.5), 0.35, 1);
  }

  /** Advance by dt seconds (in steps of at most 1/30 s, so a slow frame turns no further per step). */
  step(dt: number, t: number) {
    const n = Math.max(1, Math.ceil(dt * 30 - 0.01));
    for (let i = 1; i <= n; i++) this.tick(dt / n, t - (dt * (n - i)) / n);
  }

  private tick(dt: number, t: number) {
    this.clock += dt;
    if (this.behaviour === "loop" && this.loop) return this.stepLoop(dt);
    this.jetAge += dt;
    this.tilt = wrapDeg(this.tilt);
    // Confined: where it was, to undo a step that would touch the glass.
    const room = this.room && !this.escaping && this.phase !== "settle" ? this.room : null;
    const x0 = this.x;
    const y0 = this.y;
    const tilt0 = this.tilt;
    const phase0 = this.phase;
    const slack0 = room ? room.fit(x0, y0, tilt0) : 0;
    /** Extra braking on the forward speed this frame (per second). */
    let brake = 0;
    let finTo = -1;
    const refill = 1 - Math.exp(-3.2 * dt);

    if (this.phase === "turn") {
      // Turn first: brake, and rotate on the fins (a tight arc) until it nearly faces the way it will go.
      brake = this.urgent ? 14 : 3;
      finTo = FIN_SPEED;
      const off = this.turnTo(this.aim, this.turnRate(), dt);
      this.sx += (1 - this.sx) * refill;
      this.sy += (1 - this.sy) * refill;
      if (off < SMALL_TURN) {
        this.phase = "inflate";
        this.left = this.inflateFor;
      }
    } else if (this.phase === "inflate") {
      // Hyperinflation: the mantle swells (wider, a touch shorter) as it finishes the turn.
      this.left -= dt;
      brake = this.urgent ? 6 : 1.5;
      const off = this.turnTo(this.aim, this.turnRate(), dt);
      const p = this.inflating;
      this.sx = 1 + 0.13 * p;
      this.sy = 1 - 0.06 * p;
      // It jets once it faces the way and any sideways drift from the turn has died (the keel), never across it.
      const side = Math.abs(-this.vx * Math.cos(this.tilt * RAD) - this.vy * Math.sin(this.tilt * RAD));
      const settled = side < Math.max(MOVING, 0.12 * Math.hypot(this.vx, this.vy));
      if (this.left <= 0 && ((off <= ALIGN && settled) || this.left < -0.5)) {
        // The jet: the mantle contracts hard (narrow and long) and the burst begins, along the heading.
        this.thrust = THRUST;
        this.jetAge = 0;
        this.sx = 0.8;
        this.sy = 1.14;
        this.phase = "glide";
        this.left = (1.1 + this.rand() * 0.8) / this.cadence;
      }
    } else if (this.phase === "settle") {
      return this.stepSettle(dt, t, refill);
    } else if (this.phase === "sink") {
      return this.stepDrift(dt, refill);
    } else if (this.phase === "pivot") {
      return this.stepPivot(dt, refill);
    } else {
      // Glide (or hover): the mantle refills more slowly than it contracted, and it steers a little.
      this.left -= dt;
      this.sx += (1 - this.sx) * refill;
      this.sy += (1 - this.sy) * refill;
      const goal =
        this.arrive ?? (this.phase !== "glide" ? null : this.behaviour === "doze" ? this.dozeSpot() : this.behaviour === "perk" ? this.perkAt : this.target);
      if (goal) {
        const want = headingOf(goal.x - this.x, goal.y - this.y);
        if (Math.abs(wrapDeg(want - this.tilt)) < 50) this.turnTo(want, Math.min(this.turnRate(), this.arrive ? 120 : STEER), dt);
      } else if (this.phase === "hover") {
        // Hanging in the water: a slow sway on the fins.
        this.tilt += Math.sin(t * 1.1) * 4 * dt;
      }
      if (this.arrive) {
        // Brake into the point (fins spread): never faster than it can stop.
        const d = Math.hypot(this.arrive.x - this.x, this.arrive.y - this.y);
        const u = Math.hypot(this.vx, this.vy);
        const cap = Math.max(0, d - 6) * ARRIVE;
        if (u > cap && this.thrust <= 0) brake += Math.min(30, Math.log(u / Math.max(cap, 1)) / dt);
        if (d < 14 || (this.thrust <= 0 && u < 6)) this.arrive = null;
      }
      if (this.left <= 0) this.next();
    }

    // The jet's burst, front-loaded (an ease-out), always along the heading.
    const hx = Math.sin(this.tilt * RAD);
    const hy = -Math.cos(this.tilt * RAD);
    if (this.thrust > 0) {
      const step = Math.min(dt, this.thrust);
      const w = (2 * (this.thrust - step / 2)) / (THRUST * THRUST);
      this.vx += hx * this.jet * w * step;
      this.vy += hy * this.jet * w * step;
      this.thrust -= step;
    }

    // The water: split the motion along the heading and across it. Across (and backward) dies fast, like a keel.
    let u = this.vx * hx + this.vy * hy;
    let s = -this.vx * hy + this.vy * hx;
    // Heading for a wall: brake so the glide ends inside.
    if (u > MOVING && !this.inBounds(this.x + (hx * u) / DRAG, this.y + (hy * u) / DRAG)) brake += 4;
    if (room && u > MOVING) {
      // Confined: brake so the glide (and what is left of the jet) ends short of the glass, never in it.
      const go = u + this.jet * (this.thrust / THRUST) ** 2;
      // A hard stop (a dart, a flee) further short: its limbs swing on past it.
      const stop = this.urgent ? 32 : 14;
      const free = room.reach(this.x, this.y, this.tilt, go / DRAG + stop + 8) - stop;
      if (go / (DRAG + brake) > free) brake = Math.max(brake, Math.min(40, go / Math.max(free, 1) - DRAG));
    }
    // Braking (fins spread) slows it every way at once; the keel always kills the sideways part faster.
    u *= Math.exp(-(DRAG + brake) * dt);
    if (u < 0) u *= Math.exp(-KEEL * dt);
    if (finTo >= 0 && u < finTo) u += (finTo - u) * (1 - Math.exp(-4 * dt));
    s *= Math.exp(-(KEEL + brake) * dt);
    this.vx = u * hx - s * hy;
    this.vy = u * hy + s * hx;

    // A whisper of drift and a slow surge with its breathing, along the heading (never across it), so a hovering
    // squid is never frozen. As a speed, not an offset: turning in place, it stays in place.
    const creep = (1.4 + 1.4 * Math.sin(t * 0.6) + 3 * Math.cos(t * 1.25)) * dt;
    this.x += this.vx * dt + hx * creep;
    this.y += this.vy * dt + hy * creep;

    // Out of bounds (rare: glides are aimed inside): it stops dead there, no bounce, no slide.
    const b = this.bounds();
    const fy = this.maxY();
    if (this.x < b.x0 || this.x > b.x1 || this.y < b.y0 || this.y > fy) {
      this.x = clamp(this.x, b.x0, b.x1);
      this.y = clamp(this.y, b.y0, fy);
      this.vx = this.vy = 0;
      this.thrust = 0;
      this.arrive = null;
    }

    if (this.escaping && this.room && this.room.fit(this.x, this.y, this.tilt) >= 0) this.escaping = false;
    if (room) this.guard(room, x0, y0, tilt0, phase0, slack0, dt);
  }

  /**
   * Confined, the last resort (turns and glides are planned to fit): a step that would bring the silhouette closer
   * to the glass than the margin is not taken. A turn that would is held; a glide stops dead. Held up for a moment,
   * it plans again from where it is.
   */
  private guard(room: Room, x0: number, y0: number, tilt0: number, phase0: Phase, slack0: number, dt: number) {
    const slack = room.fit(this.x, this.y, this.tilt);
    if (slack >= 0 || slack >= slack0 - 0.01) {
      this.stuck = Math.max(0, this.stuck - dt);
      return;
    }
    const floor = Math.min(0, slack0) - 0.01;
    let moved = true;
    if (room.fit(x0, y0, this.tilt) >= floor) {
      // The turn is fine; the step forward is not.
      this.x = x0;
      this.y = y0;
      this.note = `guard: step held at ${this.clock.toFixed(2)}`;
    } else if (room.fit(this.x, this.y, tilt0) >= floor) {
      // The step is fine; the turn is not.
      this.tilt = tilt0;
      moved = phase0 === "turn" || phase0 === "inflate";
      this.note = `guard: turn held at ${this.clock.toFixed(2)}`;
    } else {
      this.x = x0;
      this.y = y0;
      this.tilt = tilt0;
      this.note = `guard: both held at ${this.clock.toFixed(2)}`;
    }
    if (moved) {
      this.vx = this.vy = 0;
      this.thrust = 0;
      this.arrive = null;
      this.stuck += dt;
    }
    if (this.stuck > 0.25 && this.phase !== "settle") {
      this.stuck = 0;
      this.phase = "glide";
      this.left = 0;
      this.next();
    }
  }

  /** Dozing, over its resting spot: right itself on the fins, then settle slowly onto the seabed and sleep. */
  private stepSettle(dt: number, t: number, refill: number) {
    const rest = this.floorY(this.x);
    // Fins spread: whatever glide is left dies quickly (every way at once), before it turns.
    const k = Math.exp(-7 * dt);
    this.vx *= k;
    this.vy *= k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (!this.asleep) {
      const off = Math.hypot(this.vx, this.vy) <= MOVING / 2 ? this.turnTo(0, TURN * 0.6, dt) : 180;
      // Upright, it eases onto its spot: down, or up a touch if it came in low (never a jump). Confined, it sinks
      // from higher up, a little faster (still far below the speed it swims at).
      const gap = rest - this.y;
      const sink = this.dozeTurnY !== null ? SINK_ROOM : SINK;
      if (off < 6) {
        const y = this.y + clamp(gap * 1.5 + Math.sign(gap) * 2, -sink, sink) * dt;
        // Confined: glass below (it came over it), it dozes off where it is.
        if (this.room && this.room.fit(this.x, y, this.tilt, true) < 0) this.asleep = true;
        else this.y = y;
      }
      if (Math.abs(rest - this.y) < 0.25) this.asleep = true;
      if (this.asleep) this.vx = this.vy = 0;
    } else {
      // On the seabed as it drifts (in whole pixels): followed smoothly, never a hop.
      const y = this.y + clamp(rest - this.y, -SINK * dt, SINK * dt);
      if (!this.room || this.room.fit(this.x, y, this.tilt, true) >= 0) this.y = y;
      // Asleep: it lolls a little to one side (where that fits).
      if (!this.room || this.room.fit(this.x, this.y, 14, true) >= 0) this.turnTo(14, 6, dt);
    }
    // Breathing: the mantle swells and eases, slowly.
    this.sx += (1 + (this.asleep ? 0.035 * Math.sin(t * 1.4) : 0) - this.sx) * refill;
    this.sy += (1 - this.sy) * refill;
  }

  /**
   * Drifting down a strip (confined): straight down, slower than the heading check looks at, easing upright where
   * that fits; it stops short of anything below.
   */
  private stepDrift(dt: number, refill: number) {
    const room = this.room;
    this.left -= dt;
    this.sx += (1 - this.sx) * refill;
    this.sy += (1 - this.sy) * refill;
    const y = this.y + DRIFT * dt;
    const tilt = this.tilt + clamp(-wrapDeg(this.tilt), -20 * dt, 20 * dt);
    if (!room || room.fit(this.x, y, tilt) >= 0) {
      this.y = y;
      this.tilt = tilt;
    } else if (room.fit(this.x, y, this.tilt) >= 0) this.y = y;
    else this.left = 0;
    this.vx = 0;
    this.vy = DRIFT;
    if (this.left <= 0 || !room) {
      this.vy = 0;
      this.phase = "glide";
      this.left = 0;
      this.next();
    }
  }

  /** The glide has run out: pulse on toward the waypoint, pick a new one, or hover a moment. */
  private next() {
    this.urgent = false;
    this.arrive = null;
    if (this.after !== null) {
      // Out from under the glass: turn to a heading that fits here.
      const a = this.after;
      this.after = null;
      if (this.escaping) return this.go(a, 0, 0.08, true);
    }
    if (this.behaviour === "doze") {
      // Down head-first to just above the resting spot, then settle.
      const spot = this.dozeSpot();
      if (Math.hypot(spot.x - this.x, spot.y - this.y) < 40) {
        this.phase = "settle";
        // Confined: right itself the way round that fits; with no room for that, slowly about its middle.
        const spin = this.room ? this.room.sweep(this.x, this.y, this.tilt, 0) : 0;
        this.spin = spin ?? 0;
        if (spin === null) {
          this.pivotTo = 0;
          this.phase = "pivot";
          this.settleAfter = true;
          this.vx = this.vy = 0;
        }
        return;
      }
      this.pulseTo(spot, 0.95, 0.22, 1.2);
      return;
    }
    if (this.behaviour === "perk" && this.perkAt) {
      const d = Math.hypot(this.perkAt.x - this.x, this.perkAt.y - this.y);
      if (d > 40) this.pulseTo(this.perkAt, 0.9, 0.14, 1.5);
      else {
        this.phase = "hover";
        this.left = 0.9;
      }
      return;
    }
    const d = Math.hypot(this.target.x - this.x, this.target.y - this.y);
    if (d < 50) {
      this.target = this.waypoint();
      if (this.phase !== "hover" && this.rand() < 0.4) {
        this.phase = "hover";
        this.left = (0.8 + this.rand() * 2) / this.cadence;
        return;
      }
    }
    this.pulseTo(this.target, 0.5 + this.rand() * 0.4);
  }

  private stepLoop(dt: number) {
    const L = this.loop!;
    L.t += dt;
    const s = Math.min(1, L.t / L.dur);
    const a = L.a0 + L.dir * Math.PI * 2 * L.turns * ease(s);
    const nx = L.c.x + Math.cos(a) * L.r;
    const ny = L.c.y + Math.sin(a) * L.r;
    // Mantle-first along the circle (its tangent), all the way round: the circle starts along its heading.
    const heading = headingOf(-Math.sin(a) * L.dir, Math.cos(a) * L.dir);
    this.tilt += wrapDeg(heading - this.tilt);
    const vx = (nx - this.x) / Math.max(dt, 1e-3);
    const vy = (ny - this.y) / Math.max(dt, 1e-3);
    this.x = nx;
    this.y = ny;
    this.vx = vx;
    this.vy = vy;
    this.jetAge = 0.15;
    this.sx = 1 - 0.1 * Math.sin(s * Math.PI * L.turns * 2) ** 2;
    this.sy = 2 - this.sx;
    if (s >= 1) {
      this.loop = null;
      this.behaviour = "roam";
      this.tilt = wrapDeg(this.tilt);
      // Out of the loop with the circle's (eased-out) speed along the heading.
      this.vx *= 0.4;
      this.vy *= 0.4;
      this.phase = "glide";
      this.left = 0.4;
      this.target = this.waypoint();
      const done = this.onLoopDone;
      this.onLoopDone = null;
      done?.();
    }
  }
}
