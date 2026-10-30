/**
 * How the roaming squid swims: pulse and glide. It squeezes its mantle (contract), jets, then glides on with drag,
 * steering a little between pulses toward a random waypoint. It leans mantle-first into sideways travel and floats
 * upright when slow. Reactions are behaviours on top: a dart (to a point), a flee (away from its own ink), loops,
 * dozing on the seabed, and hovering near something the player points at.
 *
 * Pure motion in CSS px and seconds, no DOM: the engine reads x, y, tilt, sx, sy each frame and writes one transform.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface World {
  w: number;
  h: number;
  /** The squid sprite's size in CSS px. */
  sw: number;
  sh: number;
  /** The seabed's top edge (CSS px) under a column. */
  floor: (x: number) => number;
}

type Phase = "glide" | "contract" | "hover";
export type Behaviour = "roam" | "perk" | "doze" | "loop";

/** Glide drag, per second: a pulse's speed falls off as exp(-DRAG t). */
const DRAG = 1.4;
/** Lean into sideways travel, at most this many degrees. */
const LEAN = 62;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const ease = (s: number) => (s < 0.5 ? 2 * s * s : 1 - (-2 * s + 2) ** 2 / 2);
const wrapDeg = (d: number) => d - 360 * Math.round(d / 360);

export class Swimmer {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  /** Degrees, clockwise; 0 is upright (mantle up). */
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

  private phase: Phase = "glide";
  private left = 0.6;
  private aim: Pt = { x: 0, y: -1 };
  private jet = 0;
  private contractFor = 0.22;
  private target: Pt;
  private perkAt: Pt | null = null;
  private loop: { c: Pt; r0: number; r: number; a0: number; dir: number; turns: number; t: number; dur: number } | null = null;
  private onLoopDone: (() => void) | null = null;

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
    this.y = clamp(this.y, b.y0, this.floorY(this.x));
    this.target = this.waypoint();
  }

  /** Base jet length in px: a calm pulse crosses about a third of the short side. */
  private get unit() {
    return clamp(Math.min(this.world.w, this.world.h) * 0.36, 90, 320);
  }

  private bounds() {
    const { w, h, sw, sh } = this.world;
    const mx = sw * 0.7;
    return { x0: mx, x1: Math.max(mx, w - mx), y0: sh * 0.6, y1: h };
  }

  /** Lowest the squid's centre goes at column x: arms resting on the seabed. */
  private floorY(x: number) {
    return this.world.floor(x) - this.world.sh * 0.5;
  }

  private waypoint(): Pt {
    const b = this.bounds();
    const x = b.x0 + this.rand() * (b.x1 - b.x0);
    const top = this.low ? this.world.h * 0.5 : this.world.h * 0.1 + b.y0;
    const bottom = Math.max(top, this.floorY(x) - this.world.sh * 0.4);
    return { x, y: top + this.rand() * (bottom - top) };
  }

  /** Squeeze, then jet toward `dir` at `v` px/s. */
  private pulse(dir: Pt, v: number, squeeze = 0.22) {
    const n = Math.hypot(dir.x, dir.y) || 1;
    this.aim = { x: dir.x / n, y: dir.y / n };
    this.jet = v;
    this.phase = "contract";
    this.contractFor = squeeze;
    this.left = squeeze;
  }

  /** Pulse toward a point, far enough to get about `share` of the way there. */
  private pulseTo(p: Pt, share = 1, squeeze = 0.22, max = 1) {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy);
    const travel = clamp(d * share, 24, this.unit * max * this.speed);
    // A slight wobble in the aim, so it never swims dead straight.
    const a = Math.atan2(dy, dx) + (this.rand() - 0.5) * 0.35;
    this.pulse({ x: Math.cos(a), y: Math.sin(a) }, travel * DRAG, squeeze);
  }

  /** A quick dart toward a point (a find). */
  dart(p: Pt) {
    if (this.behaviour === "loop") return;
    this.wakeUp();
    this.behaviour = "roam";
    this.target = this.clampPt(p);
    this.pulseTo(this.target, 0.9, 0.09, 2.6);
  }

  /** Jet hard away from where it is (it just inked): the direction with the most room. */
  flee() {
    if (this.behaviour === "loop") return;
    this.wakeUp();
    this.behaviour = "roam";
    const b = this.bounds();
    const L = this.unit * 1.1 * Math.max(1, this.speed);
    let best: Pt = { x: 0, y: -1 };
    let room = -1;
    for (let i = 0; i < 10; i++) {
      const a = this.rand() * Math.PI * 2;
      const p = { x: this.x + Math.cos(a) * L, y: this.y + Math.sin(a) * L };
      const r = Math.min(p.x - b.x0, b.x1 - p.x, p.y - b.y0, this.floorY(clamp(p.x, b.x0, b.x1)) - p.y);
      if (r > room) {
        room = r;
        best = { x: Math.cos(a), y: Math.sin(a) };
      }
    }
    this.target = this.clampPt({ x: this.x + best.x * L, y: this.y + best.y * L });
    this.pulse(best, L * DRAG, 0.07);
  }

  /** Swim `turns` loops, then call `done`. */
  loops(turns: number, done?: () => void) {
    this.wakeUp();
    const { w } = this.world;
    const r = clamp(Math.min(w, this.world.h) * 0.11, 36, 110);
    const b = this.bounds();
    const c = {
      x: clamp(this.x, b.x0 + r, b.x1 - r),
      y: clamp(this.y - r, b.y0 + r, this.floorY(this.x) - r),
    };
    const r0 = Math.hypot(this.x - c.x, this.y - c.y) || r;
    const a0 = Math.atan2(this.y - c.y, this.x - c.x);
    this.loop = { c, r0, r, a0, dir: this.x < w / 2 ? 1 : -1, turns, t: 0, dur: 0.5 + turns * 0.95 };
    this.behaviour = "loop";
    this.onLoopDone = done ?? null;
  }

  /** Sink to the seabed and sleep. */
  doze() {
    if (this.behaviour === "loop" || this.behaviour === "doze") return;
    this.behaviour = "doze";
    this.phase = "glide";
  }

  /** Wake (any input): a little hop up off the seabed. */
  wake() {
    if (this.behaviour !== "doze") return;
    this.wakeUp();
    this.behaviour = "roam";
    this.target = this.waypoint();
    this.pulse({ x: (this.rand() - 0.5) * 0.6, y: -1 }, this.unit * 0.5 * DRAG, 0.16);
  }

  private wakeUp() {
    this.asleep = false;
    if (this.behaviour === "doze") this.behaviour = "roam";
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
    return { x, y: clamp(p.y, b.y0, this.floorY(x)) };
  }

  step(dt: number, t: number) {
    if (this.behaviour === "loop" && this.loop) return this.stepLoop(dt);
    const relax = 1 - Math.exp(-7 * dt);
    let lean = 0;

    if (this.behaviour === "doze") {
      // Sink slowly, arms first, and settle on the seabed.
      const rest = this.floorY(this.x);
      this.vx *= Math.exp(-2 * dt);
      if (!this.asleep) {
        this.vy += (this.unit * 0.16 - this.vy) * (1 - Math.exp(-1.5 * dt));
        if (this.y >= rest - 1) {
          this.asleep = true;
          this.vy = 0;
        }
      } else {
        this.vy = 0;
        this.y = rest;
      }
      this.x += this.vx * dt;
      this.y = Math.min(rest, this.y + this.vy * dt);
      lean = this.asleep ? 14 : 0;
      // Breathing.
      this.sx += (1 - this.sx) * relax;
      this.sy += (1 + (this.asleep ? 0.03 * Math.sin(t * 1.6) : 0) - this.sy) * relax;
      this.tilt += (lean - this.tilt) * (1 - Math.exp(-2 * dt));
      return;
    }

    this.left -= dt;
    if (this.phase === "contract") {
      const p = 1 - Math.max(0, this.left) / this.contractFor;
      this.sx = 1 - 0.17 * p;
      this.sy = 1 + 0.1 * p;
      lean = LEAN * this.aim.x;
      if (this.left <= 0) {
        // Jet: the mantle snaps open.
        this.vx += this.aim.x * this.jet;
        this.vy += this.aim.y * this.jet;
        this.sx = 1.08;
        this.sy = 0.93;
        this.phase = "glide";
        this.left = (1.1 + this.rand() * 0.8) / this.cadence;
      }
    } else {
      this.sx += (1 - this.sx) * relax;
      this.sy += (1 - this.sy) * relax;
      const v = Math.hypot(this.vx, this.vy);
      lean = (LEAN * this.vx) / Math.max(v, this.unit * 0.45);
      if (this.phase === "hover") lean += Math.sin(t * 1.1) * 4;
      if (this.left <= 0) this.next();
    }

    const k = Math.exp(-DRAG * dt);
    this.vx *= k;
    this.vy *= k;
    // A whisper of drift while slow, so a hovering squid is never frozen.
    this.x += this.vx * dt + Math.sin(t * 0.5) * 2 * dt;
    this.y += this.vy * dt + Math.sin(t * 0.8 + 1) * 3 * dt;

    const b = this.bounds();
    if (this.x < b.x0 || this.x > b.x1) {
      this.x = clamp(this.x, b.x0, b.x1);
      this.vx *= -0.3;
    }
    const fy = this.floorY(this.x);
    if (this.y < b.y0 || this.y > fy) {
      this.y = clamp(this.y, b.y0, fy);
      this.vy *= -0.3;
    }
    this.tilt += (lean - this.tilt) * (1 - Math.exp(-6 * dt));
  }

  /** The glide has run out: pulse on toward the waypoint, pick a new one, or hover a moment. */
  private next() {
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
    const r = L.r0 + (L.r - L.r0) * Math.min(1, s * 4);
    const nx = L.c.x + Math.cos(a) * r;
    const ny = L.c.y + Math.sin(a) * r;
    const vx = (nx - this.x) / Math.max(dt, 1e-3);
    const vy = (ny - this.y) / Math.max(dt, 1e-3);
    if (Math.hypot(vx, vy) > 1) {
      // Mantle-first along the path, all the way round (unwrapped, so it never spins back).
      const heading = (Math.atan2(vx, -vy) * 180) / Math.PI;
      this.tilt += wrapDeg(heading - this.tilt);
    }
    this.x = nx;
    this.y = ny;
    this.vx = vx * 0.4;
    this.vy = vy * 0.4;
    this.sx = 1 - 0.08 * Math.sin(s * Math.PI * L.turns * 2) ** 2;
    this.sy = 2 - this.sx;
    if (s >= 1) {
      this.loop = null;
      this.behaviour = "roam";
      this.tilt = wrapDeg(this.tilt);
      this.phase = "glide";
      this.left = 0.4;
      this.target = this.waypoint();
      const done = this.onLoopDone;
      this.onLoopDone = null;
      done?.();
    }
  }
}
