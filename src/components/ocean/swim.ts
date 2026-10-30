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
 * Pure motion in CSS px and seconds, no DOM: each frame the engine reads x, y, tilt, sx, sy, and the jet state that
 * drives the limbs and fins (jetAge, inflating, hovering).
 */

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
  prefer?: () => Pt | null;
}

type Phase = "turn" | "inflate" | "glide" | "hover" | "settle";
export type Behaviour = "roam" | "perk" | "doze" | "loop";

/** Glide drag, per second: a pulse's speed falls off as exp(-DRAG t). */
const DRAG = 1.4;
/** The keel: sideways (and backward) speed falls off as exp(-KEEL t). */
const KEEL = 18;
/** A jet's thrust is spent over this long, front-loaded (an eased-out burst). */
const THRUST = 0.14;
/** Turn rates, degrees a second: on the fins at rest, and on a dart or a flee. */
const TURN = 230;
const TURN_URGENT = 620;
/** Above this speed (px/s) the turn rate is capped, so the keel keeps the travel within a few degrees of the heading. */
const MOVING = 12;
const TURN_MOVING = 190;
const TURN_MOVING_URGENT = 290;
/** Steering while it glides (small corrections, a gentle arc). */
const STEER = 45;
/** It jets only once it faces within this many degrees of where it is going. */
const ALIGN = 8;
/** Turns smaller than this happen while the mantle fills; bigger ones stop to turn first. */
const SMALL_TURN = 35;
/** On the fins while turning: a tight arc, never more than this px/s. */
const FIN_SPEED = 8;
/** A dart brakes into its point: its speed is held to this many times the distance left (per second). */
const ARRIVE = 5.5;
/** Settling onto the seabed, px/s (slower than any swimming). */
const SINK = 9;

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
  private loop: { c: Pt; r: number; a0: number; dir: number; turns: number; t: number; dur: number } | null = null;
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
    this.y = clamp(this.y, b.y0, this.maxY());
    this.target = this.waypoint();
    this.arrive = null;
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
    const pref = this.low ? null : this.world.prefer?.();
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
  private go(aim: number, v: number, inflate = 0.22, urgent = false, arrive: Pt | null = null) {
    this.aim = aim;
    this.jet = v;
    this.urgent = urgent;
    this.arrive = arrive;
    this.thrust = 0;
    this.inflateFor = inflate;
    this.left = inflate;
    this.phase = Math.abs(wrapDeg(aim - this.tilt)) > SMALL_TURN ? "turn" : "inflate";
  }

  /** Pulse toward a point, far enough to get about `share` of the way there. */
  private pulseTo(p: Pt, share = 1, inflate = 0.22, max = 1) {
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const d = Math.hypot(dx, dy);
    const travel = clamp(d * share, 24, this.unit * max * this.speed);
    // A slight wobble in the aim, so it never swims dead straight.
    this.go(headingOf(dx, dy) + (this.rand() - 0.5) * 20, travel * DRAG, inflate);
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
    this.go(headingOf(dx, dy), clamp(d * 4, 260, 2300) * Math.max(1, this.speed * 0.9), 0.06, true, this.target);
  }

  /** Jet hard away from where it is (it just inked): the direction with the most room, nearest the way it faces. */
  flee() {
    if (this.behaviour === "loop") return;
    this.wakeUp();
    this.behaviour = "roam";
    const b = this.bounds();
    const L = this.unit * 1.1 * Math.max(1, this.speed);
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
    this.target = this.clampPt({ x: this.x + Math.sin(best * RAD) * L, y: this.y - Math.cos(best * RAD) * L });
    this.go(best, L * DRAG, 0.07, true);
  }

  /** Swim `turns` loops, then call `done`. The circle starts along its heading, on the side with more room. */
  loops(turns: number, done?: () => void) {
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
    const { c, r, dir } = pick!;
    const a0 = Math.atan2(this.y - c.y, this.x - c.x);
    this.loop = { c, r, a0, dir, turns, t: 0, dur: 0.5 + turns * 0.95 };
    this.behaviour = "loop";
    this.onLoopDone = done ?? null;
    this.arrive = null;
    this.thrust = 0;
  }

  /** Sink to the seabed and sleep; over toward column `x` on the way down, if given. */
  doze(x?: number) {
    if (this.behaviour === "loop" || this.behaviour === "doze") return;
    this.behaviour = "doze";
    this.arrive = null;
    this.urgent = false;
    const b = this.bounds();
    this.dozeX = clamp(x ?? this.x, b.x0, b.x1);
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
    this.go((this.rand() - 0.5) * 30, this.unit * 0.5 * DRAG, 0.16);
  }

  private wakeUp() {
    this.asleep = false;
    if (this.behaviour === "doze") this.behaviour = "roam";
    if (this.phase === "settle") {
      this.phase = "glide";
      this.left = 0.3;
    }
  }

  /** Where a doze heads: just above its resting spot. */
  private dozeSpot(): Pt {
    const x = this.dozeX ?? this.x;
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
    const diff = wrapDeg(to - this.tilt);
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
    if (this.behaviour === "loop" && this.loop) return this.stepLoop(dt);
    this.jetAge += dt;
    this.tilt = wrapDeg(this.tilt);
    /** Extra braking on the forward speed this frame (per second). */
    let brake = 0;
    let finTo = -1;
    const refill = 1 - Math.exp(-3.2 * dt);

    if (this.phase === "turn") {
      // Turn first: brake, and rotate on the fins (a tight arc) until it nearly faces the way it will go.
      brake = this.urgent ? 9 : 3;
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
      if (this.left <= 0 && (off <= ALIGN || this.left < -0.5)) {
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
    } else {
      // Glide (or hover): the mantle refills more slowly than it contracted, and it steers a little.
      this.left -= dt;
      this.sx += (1 - this.sx) * refill;
      this.sy += (1 - this.sy) * refill;
      const goal =
        this.arrive ??
        (this.phase !== "glide" ? null : this.behaviour === "doze" ? this.dozeSpot() : this.behaviour === "perk" ? this.perkAt : this.target);
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
    // Braking (fins spread) slows it every way at once; the keel always kills the sideways part faster.
    u *= Math.exp(-(DRAG + brake) * dt);
    if (u < 0) u *= Math.exp(-KEEL * dt);
    if (finTo >= 0 && u < finTo) u += (finTo - u) * (1 - Math.exp(-4 * dt));
    s *= Math.exp(-(KEEL + brake) * dt);
    this.vx = u * hx - s * hy;
    this.vy = u * hy + s * hx;

    // A whisper of drift while slow, so a hovering squid is never frozen.
    this.x += this.vx * dt + Math.sin(t * 0.5) * 2 * dt;
    this.y += this.vy * dt + Math.sin(t * 0.8 + 1) * 3 * dt;

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
      // Upright, it eases onto its spot: down, or up a touch if it came in low (never a jump).
      const gap = rest - this.y;
      if (off < 6) this.y += clamp(gap * 1.5 + Math.sign(gap) * 2, -SINK, SINK) * dt;
      if (Math.abs(rest - this.y) < 0.25) {
        this.asleep = true;
        this.vx = this.vy = 0;
      }
    } else {
      this.y = rest;
      // Asleep: it lolls a little to one side.
      this.turnTo(14, 6, dt);
    }
    // Breathing: the mantle swells and eases, slowly.
    this.sx += (1 + (this.asleep ? 0.035 * Math.sin(t * 1.4) : 0) - this.sx) * refill;
    this.sy += (1 - this.sy) * refill;
  }

  /** The glide has run out: pulse on toward the waypoint, pick a new one, or hover a moment. */
  private next() {
    this.urgent = false;
    this.arrive = null;
    if (this.behaviour === "doze") {
      // Down head-first to just above the resting spot, then settle.
      const spot = this.dozeSpot();
      if (Math.hypot(spot.x - this.x, spot.y - this.y) < 40) {
        this.phase = "settle";
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
