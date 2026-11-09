/**
 * The ocean's engine: one requestAnimationFrame loop for the whole layer, at about 30 fps (a timer sleeps between
 * frames, so the page isn't woken on every vsync), paused while the tab is hidden. Each frame it steps the scene, the
 * swim, the squid's limbs and the effects, and draws the two low-res canvases: the backdrop (at 15 fps), and the
 * squid with the effects in front of it. No layout reads per frame: sizes are read on resize; the glass panels
 * ([data-glass]) are read after a resize, a scroll or an event, and at most twice a second otherwise.
 *
 * Open water (room.ts): on screens 700px and wider, wherever the glass leaves room for it, the squid lives entirely
 * in open water, limbs included, and never goes behind a panel: its waypoints, its dozing spot on the seabed, its
 * flight from ink and its loops are all picked in open water, and the swim plans every move to stay there. When a
 * panel comes over it (a result card, a new screen, a scroll), it swims out to the nearest free water. Where there is
 * no such room (phones, narrow strips), it roams behind the glass as before.
 *
 * It listens to play events for the reactions (a find: the limb flashes and shimmers, a glow pulse, a happy wiggle
 * and, in open water, a quick hop; a lost life inks and flees; a perfect 10 loops and bursts; Blitz hits) and to
 * input for idling: after IDLE_MS without a key or a tap, the squid sinks to the seabed and dozes until the next one.
 * With reduced motion it draws one still frame: the squid parked in open water, its limbs at rest, lit.
 *
 * The easter egg: a tap or click on the squid's own pixels (never on a control over it, nor one the browser hands
 * the tap's click to, never while a dialog is open) makes it blush, flinch and wave a tentacle, with a pixel heart; a
 * third tap in a row and it spins, then darts off with a puff of ink (ink always comes out with a dart, never in place:
 * see inkAndFlee). With reduced motion it only blushes for a moment. The layer still takes no pointer itself: the taps are read on the window, passively, and the page under the
 * finger gets them as ever.
 */
import { onPlay, type PlayEvent } from "../../game/events";
import { reducedMotion } from "../pixel";
import { squidSound } from "../sound/squid";
import { limbColor } from "../squid/colors";
import { SquidBody, type Motion } from "./body";
import { Fx } from "./fx";
import { ENV_BACK, ENV_R, Room, type Box } from "./room";
import { Scene } from "./scene";
import { squidAt, type OceanSquidState } from "./store";
import { Swimmer, type Pt } from "./swim";

export interface OceanEls {
  root: HTMLElement;
  back: HTMLCanvasElement;
  front: HTMLCanvasElement;
  /** The squid's aria-hidden stand-in in the DOM (its state as data attributes). */
  squid: HTMLElement;
}

export interface Ocean {
  /** The squid's state from the screen on top (lit limbs, mood, heat, flare). */
  setState(s: OceanSquidState): void;
  stop(): void;
}

const FRAME_MS = 1000 / 30;
/** The backdrop's own rate: its pieces move a pixel at a time, a few times a second. */
const BG_FPS = 15;
const IDLE_MS = 20000;
/** The squid in sprite px: mantle width, and the height it keeps clear (mantle and the arms' reach). */
const SQUID_W = 20;
const SQUID_H = 30;
/** Glass is re-read at least this often (ms) while the squid keeps to open water. */
const ROOM_MS = 500;

const CYAN = "#4de3ff";
const GOLD = "#ffd166";
const PINK = "#ff5d8f";
const WHITE = "#e8fbff";

/** Panels the ocean shows through: marked [data-glass], or (a layout without the marks) the app's column. */
const GLASS = "[data-glass]";
/** Bare UI the squid keeps out from behind too (not glass, but it would hide there): Home's logo and header keys. */
const SOLID = ".home .logo, .home-keys";
const DOCK = "[data-guess-dock]";
const DOCK_FALLBACK = ".guess-row";
/** The heading check (dev stats): travel faster than this (CSS px/s) must be within OFF_DEG of the heading. */
const CHECK_SPEED = 15;
const OFF_DEG = 30;

/**
 * The tap easter egg. Anything under the finger that is (or is inside) a control, or looks pressable, keeps the tap
 * to itself: the squid only answers taps on bare page or glass.
 */
const CONTROL =
  'a[href], button, input, select, textarea, label, summary, dialog, [role="button"], [role="link"], [role="switch"], ' +
  '[role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="slider"], [role="dialog"], ' +
  '[contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex^="-"]), .slot.has-fact, .slot.hintable';
/** How near the squid's pixels a tap counts (sprite px): a fingertip gets more room than a mouse pointer. */
const TAP_TOL_TOUCH = 2.5;
const TAP_TOL_MOUSE = 0.75;
/** A tap moves less than this (CSS px) and lifts within this (ms); a drag or a scroll is no tap. */
const TAP_SLOP = 12;
const TAP_MS = 600;
/** How long a tap waits for its click (ms) before the squid takes it anyway (no click came: a bare-page tap). */
const CLICK_WAIT_MS = 250;
/** Taps closer together than this (ms) make a streak; the third in a row is the trick. */
const STREAK_MS = 900;
const TRICK_TAPS = 3;
/** Reduced motion: a tap only blushes it, this long (ms). */
const STILL_BLUSH_MS = 600;
/** The siphon, where ink comes out: this far behind the mantle's pivot along the body (sprite px), at the arms' roots. */
const SIPHON = 6;
/** Ink waits this long (s) for a way out to dart along; after that it is dropped, never squirted in place. */
const INK_DUE = 2;
const RAD = Math.PI / 180;

/**
 * A render-only move on top of the swim: it changes how the squid is drawn, never where it is or where it heads.
 * `wob` rocks it side to side (rad), `boing` squashes and stretches the mantle, `flare` spreads the arms, `spin` turns
 * it once round (+1 or -1).
 */
interface Flourish {
  at: number;
  dur: number;
  wob: number;
  boing: number;
  flare: number;
  spin: number;
}

/** Debug numbers for frame-time and motion checks, exposed as window.__ocean in dev when the URL has ?oceanstats. */
interface Stats {
  frames: number;
  /** Time spent in the frame callback, total and worst (the dev checks below are not counted). */
  drawMs: number;
  maxMs: number;
  /** Gaps between frames: the worst, and how many ran over 50 ms (a dropped beat at 30 fps). */
  maxGap: number;
  slow: number;
  at: number;
  /** Where the squid is (CSS px), for zoomed screenshots. */
  x: number;
  y: number;
  jet: number;
  /** Frames checked for head-first travel (moving faster than CHECK_SPEED), and those off by more than OFF_DEG. */
  checked: number;
  offHeading: number;
  worstDeg: number;
  /** The last few off-heading frames: what the squid was doing. */
  offLog: string[];
  /**
   * The glass check, on wide screens (1100px and up): frames checked, and frames where any pixel of the squid (body
   * or limbs) was over a glass rect, read fresh that frame. `overlap` counts the squid's own doing; `relocating`
   * frames where it was still swimming out from under glass that came over it (a panel appeared, a new screen, a
   * scroll). `behind`: wide frames with no room at all (it roams behind the glass). `closest`: the nearest any pixel
   * came to the glass (CSS px). `envOut`: frames where a pixel lay outside the planning envelope (turning, the limbs
   * lag outside it for a moment: turns keep extra room for that).
   */
  wide: number;
  overlap: number;
  relocating: number;
  behind: number;
  closest: number;
  /** What it was doing at its closest. */
  closestAt: string;
  /** The worst time (ms) spent reading the glass in one frame (forced layout after a screen change included). */
  readMs: number;
  envOut: number;
  envMax: number;
  overlapLog: string[];
  /** Wide frames with no room, by screen (location.hash); frames outside the envelope, by what it was doing. */
  behindBy: Record<string, number>;
  envBy: Record<string, number>;
  /** Reactions seen: finds, inks, wins, Blitz hits, dozes. */
  seen: Record<string, number>;
  /** What the squid is doing, and its heading (degrees, 0 is up); whether it keeps to open water. */
  state: string;
  tilt: number;
  room: boolean;
}

export function startOcean(els: OceanEls): Ocean {
  const { root, back, front, squid } = els;
  const bctx = back.getContext("2d")!;
  const fctx = front.getContext("2d")!;
  const scene = new Scene();
  const fx = new Fx();
  const body = new SquidBody();

  let px = 3;
  let vw = 0;
  let vh = 0;
  let t = 20 + Math.random() * 40;
  let raf = 0;
  let wait: ReturnType<typeof setTimeout> | 0 = 0;
  let last = 0;
  let bgIn = 0;
  let backDirty = false;
  let running = false;
  let still = reducedMotion();
  let lastInput = performance.now();
  let state: OceanSquidState | null = null;
  let lit = new Set<number>();
  let heat = 0;
  let bubbleIn = 0;
  let trailIn = 0;
  let room: Room | null = null;
  let escapedAt = 0;
  const bornAt = performance.now();
  const timers: { at: number; fn: () => void }[] = [];
  const later = (s: number, fn: () => void) => timers.push({ at: t + s, fn });
  /** Render-only moves playing now (a find's wiggle, a tap's flinch, the trick's spin). */
  let flourishes: Flourish[] = [];
  /** Blushing until then (swim time): full, then fading over its last 0.3 s. Reduced motion: on or off. */
  let blushUntil = -1;
  let stillBlush = 0;
  let stillTimer: ReturnType<typeof setTimeout> | undefined;
  /** The trick plays until then (swim time): taps meanwhile are ignored. */
  let trickUntil = -1;

  // Dev only: production builds drop this (and the hooks below) entirely, unless built with VITE_OCEANSTATS=1 (for
  // frame-time checks of a production build).
  const stats: Stats | null =
    (import.meta.env.DEV || import.meta.env.VITE_OCEANSTATS === "1") && typeof location !== "undefined" && location.search.includes("oceanstats")
      ? {
          frames: 0,
          drawMs: 0,
          maxMs: 0,
          maxGap: 0,
          slow: 0,
          at: 0,
          x: 0,
          y: 0,
          jet: 0,
          checked: 0,
          offHeading: 0,
          worstDeg: 0,
          offLog: [],
          wide: 0,
          overlap: 0,
          relocating: 0,
          behind: 0,
          closest: Infinity,
          closestAt: "",
          readMs: 0,
          envOut: 0,
          envMax: 0,
          overlapLog: [],
          behindBy: {},
          envBy: {},
          seen: {},
          state: "",
          tilt: 0,
          room: false,
        }
      : null;
  /** The squid as drawn last frame (CSS px, heading), for the heading check; null after a jump (a resize). */
  let drawn: { x: number; y: number; a: number } | null = null;
  if (stats) {
    const g = globalThis as unknown as {
      __ocean: Stats;
      __oceanGo: (x: number, y: number) => void;
      __oceanSwim: (x: number, y: number) => void;
    };
    g.__ocean = stats;
    // Debug: send the squid somewhere (for screenshots of it in open water).
    g.__oceanGo = (x, y) => swimmer.dart({ x, y });
    // Debug: a calm swim there (turn on the fins, then jet), and hover.
    g.__oceanSwim = (x, y) => swimmer.perk({ x, y });
  }

  const world = () => ({
    w: vw,
    h: vh,
    sw: SQUID_W * px,
    sh: SQUID_H * px,
    floor: (x: number) => scene.floorAt(x / px, t) * px,
    prefer,
  });
  const swimmer = new Swimmer({
    w: 400,
    h: 800,
    sw: 60,
    sh: 90,
    floor: () => 800,
  });

  /** Canvas px of a viewport point. */
  const cv = (p: Pt) => ({ x: p.x / px, y: p.y / px });

  /** The flourishes playing now, summed: an extra turn (rad), a squash (+ wider and shorter, - narrower and longer), arm spread. */
  function flourish() {
    let turn = 0;
    let squash = 0;
    let flare = 0;
    for (const f of flourishes) {
      const u = (t - f.at) / f.dur;
      if (u < 0 || u >= 1) continue;
      const fade = 1 - u;
      turn += f.wob * Math.sin(u * Math.PI * 4) * fade;
      // A full turn, eased in and out (it ends where it began).
      if (f.spin) turn += f.spin * Math.PI * 2 * (u < 0.5 ? 2 * u * u : 1 - (2 - 2 * u) ** 2 / 2);
      squash += f.boing * Math.sin(u * Math.PI * 3) * fade;
      flare += f.flare * Math.sin(u * Math.PI);
    }
    return { turn, squash, flare };
  }

  const motion = (): Motion => ({
    jetAge: swimmer.jetAge,
    inflating: swimmer.inflating,
    hovering: swimmer.hovering,
    asleep: swimmer.asleep,
    flare: flourish().flare,
  });

  /**
   * The squid's pose on the canvas: the swim's (its idle surge is part of the swim, along its heading), with any
   * flourish drawn on top.
   */
  function pose() {
    const f = flourish();
    body.pose = {
      x: swimmer.x / px,
      y: swimmer.y / px,
      angle: swimmer.tilt * RAD + f.turn,
      sx: swimmer.sx * (1 + f.squash),
      sy: swimmer.sy * (1 - 0.8 * f.squash),
    };
    squidAt.x = swimmer.x;
    squidAt.y = swimmer.y;
    squidAt.live = true;
  }

  function resize() {
    vw = innerWidth;
    vh = innerHeight;
    layout.dirty = true;
    drawn = null;
    px = vw < 700 ? 3 : 4;
    const cw = Math.ceil(vw / px);
    const ch = Math.ceil(vh / px);
    for (const c of [back, front]) {
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
      }
      c.style.width = `${cw * px}px`;
      c.style.height = `${ch * px}px`;
    }
    bctx.imageSmoothingEnabled = false;
    fctx.imageSmoothingEnabled = false;
    root.style.setProperty("--ocean-px", `${px}px`);
    scene.resize(cw, ch);
    swimmer.setWorld(world());
    // A jump anyway: if the glass now covers it, it starts out in open water instead of swimming out.
    refreshRoom(true);
    if (room && swimmer.fit() < 0) {
      const p = nearestFit(swimmer);
      if (p) swimmer.place(p, p.h);
    }
    pose();
    body.settle(t, motion());
    if (still) park();
    draw(true);
  }

  /** Reduced motion: the squid rests upright, limbs at rest, in the clearest open water (or the lower right). */
  function park() {
    const spot = room ? clearestSpot(false, false) : null;
    if (spot) {
      swimmer.x = spot.x;
      swimmer.y = spot.y;
    } else {
      swimmer.x = vw * (vw >= 700 ? 0.8 : 0.5);
      // Wide screens: in the open water beside the column. Phones: low, behind the clearer glass round the guess box.
      swimmer.y = vw >= 700 ? Math.min(vh * 0.55, world().floor(vw * 0.8) - SQUID_H * px) : vh - SQUID_H * px * 1.15;
    }
    swimmer.tilt = 0;
    swimmer.sx = swimmer.sy = 1;
    swimmer.jetAge = 9;
    fx.clear();
    pose();
    body.settle(t, { jetAge: 9, inflating: 0, hovering: false, asleep: false });
  }

  /**
   * Draw a frame. The backdrop only moves by a pixel now and then (snow, kelp, the ridges' drift), so it is redrawn
   * at BG_FPS, or every frame while a bloom glows on it; the squid and the effects in front run at the full rate.
   */
  function draw(backToo: boolean) {
    if (backToo || fx.back || backDirty) {
      scene.draw(bctx, t);
      fx.drawBack(bctx);
      backDirty = fx.back;
    }
    fctx.clearRect(0, 0, front.width, front.height);
    body.draw(fctx, t, {
      lit,
      mood: state?.mood ?? "play",
      heat,
      doze: swimmer.behaviour === "doze",
      blush: still ? stillBlush : Math.max(0, Math.min(1, (blushUntil - t) / 0.3)),
    });
    fx.drawFront(fctx);
  }

  /** 30 fps; asleep on the seabed nothing hurries, so the whole ocean idles at the backdrop's rate. */
  const frameMs = () => (swimmer.asleep ? 1000 / BG_FPS : FRAME_MS);

  function frame(now: number) {
    raf = 0;
    if (!running) return;
    // Woken early (timers are coarse): wait for the next vsync.
    if (now - last < frameMs() - 6) {
      raf = requestAnimationFrame(frame);
      return;
    }
    try {
      tick(now);
    } catch (err) {
      // Decorative: a bug here stops the ocean (a still frame stays), never the game.
      pause();
      console.error(err);
      return;
    }
    // Sleep until just before the next frame is due, so the page is only woken ~30 times a second.
    wait = setTimeout(
      () => {
        wait = 0;
        if (running) raf = requestAnimationFrame(frame);
      },
      Math.max(0, frameMs() - (performance.now() - now) - 10),
    );
  }

  function tick(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t0 = stats ? performance.now() : 0;
    t += dt;
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= t) timers.splice(i, 1)[0].fn();
    }
    if (flourishes.length) flourishes = flourishes.filter((f) => t - f.at < f.dur);
    const r0 = stats ? performance.now() : 0;
    refreshRoom(false);
    if (stats) stats.readMs = Math.max(stats.readMs, performance.now() - r0);
    // Glass came over it (a panel appeared, a new screen, a scroll): out to the nearest open water (and again, if a
    // second later it is still under glass).
    if (room && swimmer.behaviour !== "loop" && (!swimmer.escaping || t - escapedAt > 3) && swimmer.fit() < 0) {
      const p = nearestFit(swimmer);
      if (p && performance.now() - bornAt < 1500) {
        // Still loading (the screen drew after the ocean started): it starts out there.
        swimmer.place(p, p.h);
        pose();
        body.settle(t, motion());
        drawn = null;
      } else if (p) {
        if (swimmer.behaviour === "doze") delete squid.dataset.doze;
        swimmer.escape(p, p.h);
        escapedAt = t;
      }
    }
    if (swimmer.behaviour !== "doze" && now - lastInput > IDLE_MS) doze();
    inkStillDue();
    scene.step(dt, t);
    swimmer.step(dt, t);
    pose();
    const m = motion();
    body.step(dt, t, m, swimmer.behaviour === "doze" ? (x) => scene.floorAt(x, t) : null);
    if (swimmer.asleep && (bubbleIn -= dt) <= 0) {
      bubbleIn = 1.6 + Math.random();
      const p = cv({
        x: swimmer.x + SQUID_W * px * 0.15,
        y: swimmer.y - 7 * px,
      });
      fx.bubble(p.x, p.y);
    }
    // Momentum: a trail of light bits behind a hot squid.
    if (heat >= 2 && (trailIn -= dt) <= 0) {
      trailIn = heat >= 4 ? 0.05 : heat >= 3 ? 0.09 : 0.16;
      fx.sparksAt(body.pose.x, body.pose.y + 4, 1, 3, heat >= 4 ? [GOLD, CYAN, WHITE] : [CYAN, WHITE]);
    }
    fx.step(dt);
    bgIn -= dt;
    const backToo = bgIn <= 0;
    if (backToo) bgIn += 1 / BG_FPS;
    draw(backToo);
    if (stats) check(now, dt, performance.now() - t0);
  }

  /** Dev: the frame time, the heading check and the glass check (see Stats). */
  function check(now: number, dt: number, ms: number) {
    const s = stats!;
    // Head-first: the drawn squid's travel this frame against its heading (halfway through the frame's turn).
    const cx = body.pose.x * px;
    const cy = body.pose.y * px;
    const a = swimmer.tilt;
    if (drawn && dt > 0) {
      const vx = (cx - drawn.x) / dt;
      const vy = (cy - drawn.y) / dt;
      const v = Math.hypot(vx, vy);
      if (v > CHECK_SPEED) {
        const d = a - drawn.a;
        const mid = ((drawn.a + (d - 360 * Math.round(d / 360)) / 2) * Math.PI) / 180;
        const cos = (vx * Math.sin(mid) - vy * Math.cos(mid)) / v;
        const off = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
        s.checked++;
        s.worstDeg = Math.max(s.worstDeg, off);
        if (off > OFF_DEG) {
          s.offHeading++;
          s.offLog.push(
            `${swimmer.state} v=${v.toFixed(0)} off=${off.toFixed(0)} dt=${(dt * 1000).toFixed(0)}ms${swimmer.escaping ? " escaping" : ""}; at ${swimmer.clock.toFixed(2)}; ${swimmer.note}`,
          );
          if (s.offLog.length > 20) s.offLog.shift();
        }
      }
    }
    drawn = { x: cx, y: cy, a };

    // The glass, read fresh: is any pixel of the squid over it? And is every pixel inside the planning envelope?
    if (vw >= 1100) {
      s.wide++;
      const boxes = [...document.querySelectorAll(`${GLASS}, ${SOLID}`)]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh);
      // The squid's plans use the glass as last read: if it has moved since, it came over the squid.
      const stale = !room || !room.same(boxes, vw, vh);
      const ang = body.pose.angle;
      const ex = body.pose.x - Math.sin(ang) * ENV_BACK;
      const ey = body.pose.y + Math.cos(ang) * ENV_BACK;
      let over = false;
      let near = Infinity;
      let env = 0;
      body.eachPoint((x, y, r) => {
        env = Math.max(env, Math.hypot(x - ex, y - ey) + r);
        const l = (x - r) * px;
        const rt = (x + r) * px;
        const tp = (y - r) * px;
        const bt = (y + r) * px;
        for (const b of boxes) {
          const gx = Math.max(b.left - rt, l - b.right, 0);
          const gy = Math.max(b.top - bt, tp - b.bottom, 0);
          const gap = Math.hypot(gx, gy);
          if (gap < near) near = gap;
          if (rt > b.left && l < b.right && bt > b.top && tp < b.bottom) over = true;
        }
      });
      s.envMax = Math.max(s.envMax, env);
      if (env > ENV_R) {
        s.envOut++;
        const k = `${swimmer.state}${swimmer.asleep ? " asleep" : ""}`;
        s.envBy[k] = (s.envBy[k] ?? 0) + 1;
      }
      if (performance.now() - bornAt < 1500) {
        // Loading: the screen draws after the ocean starts; the squid is placed in open water once it has.
      } else if (!room) {
        s.behind++;
        s.behindBy[location.hash] = (s.behindBy[location.hash] ?? 0) + 1;
      } else if (swimmer.escaping || (over && stale)) {
        if (over) s.relocating++;
      } else {
        if (near < s.closest) s.closestAt = `${swimmer.state}${swimmer.asleep ? " asleep" : ""} tilt ${swimmer.tilt.toFixed(0)}`;
        s.closest = Math.min(s.closest, near);
        if (over) {
          s.overlap++;
          s.overlapLog.push(
            `${swimmer.state} at ${swimmer.x.toFixed(0)},${swimmer.y.toFixed(0)} tilt ${swimmer.tilt.toFixed(0)} fit ${swimmer.fit().toFixed(0)}`,
          );
          if (s.overlapLog.length > 20) s.overlapLog.shift();
        }
      }
    }

    s.state = swimmer.state;
    s.tilt = swimmer.tilt;
    s.room = !!room;
    s.frames++;
    s.drawMs += ms;
    s.maxMs = Math.max(s.maxMs, ms);
    const gap = s.at ? now - s.at : 0;
    s.at = now;
    s.maxGap = Math.max(s.maxGap, gap);
    if (gap > 50) s.slow++;
    s.x = swimmer.x;
    s.y = swimmer.y;
    s.jet = swimmer.jetAge;
  }

  function start() {
    if (running || still || document.visibilityState === "hidden") return;
    running = true;
    last = performance.now();
    bgIn = 0;
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    cancelAnimationFrame(raf);
    clearTimeout(wait);
    raf = wait = 0;
  }

  /* ---------------- idle ---------------- */

  function doze() {
    if (stats) stats.seen.doze = (stats.seen.doze ?? 0) + 1;
    if (room) {
      // A column of open water down to the seabed, and the height where it can right itself above it.
      const site = dozeSite();
      if (!site) {
        // Nowhere to settle: it keeps roaming, slowly, and tries again later.
        lastInput = performance.now();
        return;
      }
      swimmer.doze(site.x, site.y);
    } else {
      // Read once, as it nods off: settle in open water if there is any.
      swimmer.doze(openSpot(true)?.x);
    }
    squid.dataset.doze = "";
    bubbleIn = 2;
  }
  function onInput() {
    lastInput = performance.now();
    layout.dirty = true;
    if (swimmer.behaviour === "doze") {
      swimmer.wake();
      delete squid.dataset.doze;
    }
  }

  /* ---------------- where to be seen ---------------- */

  /**
   * The glass panels, in viewport CSS px. Read lazily, at most once per resize, scroll or event (and every ROOM_MS
   * while the squid keeps to open water), never per frame. Without [data-glass] marks, the app's column (main) stands
   * in for the glass; without [data-guess-dock], the guess row.
   */
  const layout = {
    dirty: true,
    at: 0,
    burst: 0,
    glass: [] as DOMRect[],
    solid: [] as DOMRect[],
    dock: null as DOMRect | null,
  };
  function readLayout(maxAge = 3000) {
    const now = performance.now();
    if (!layout.dirty && now - layout.at < maxAge) return layout;
    layout.dirty = false;
    layout.at = now;
    const marked = document.querySelectorAll(GLASS);
    const els = marked.length ? [...marked] : [document.querySelector("main")].filter((e) => e !== null);
    const shown = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh;
    layout.glass = els.map((e) => e.getBoundingClientRect()).filter(shown);
    layout.solid = [...document.querySelectorAll(SOLID)].map((e) => e.getBoundingClientRect()).filter(shown);
    const dock = document.querySelector(DOCK) ?? document.querySelector(DOCK_FALLBACK);
    const dr = dock?.getBoundingClientRect();
    layout.dock = dr && dr.width > 0 && dr.bottom > 0 && dr.top < vh ? dr : null;
    return layout;
  }

  /** Open water for this layout (700px and wider), or null; rebuilt only when the glass has moved. */
  function refreshRoom(force: boolean) {
    if (vw < 700) {
      if (room) swimmer.setRoom((room = null));
      return;
    }
    // After a resize, a scroll, an event or a new screen, read every frame for a few frames (the screen may render
    // a frame or two later); otherwise every ROOM_MS.
    const burst = layout.burst > 0;
    if (burst) layout.burst--;
    if (!force && !burst && !layout.dirty && performance.now() - layout.at < ROOM_MS) return;
    if (layout.dirty) layout.burst = 8;
    const { glass, solid } = readLayout(force || burst ? 0 : ROOM_MS);
    const boxes: Box[] = [...glass, ...solid].map((r) => ({
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
    }));
    if (room && room.same(boxes, vw, vh)) return;
    room = Room.build(boxes, vw, vh, px);
    swimmer.setRoom(room);
  }

  /**
   * Can it get from where it is to p in open water: a turn here that fits, then a straight glide; or, roughly
   * upright, a drift straight down to it (a strip too thin to turn round in)?
   */
  function reachable(r: Room, p: Pt) {
    const dx = p.x - swimmer.x;
    const dy = p.y - swimmer.y;
    if (dy > 30 && Math.abs(dx) < 4 && Math.abs(swimmer.tilt - 360 * Math.round(swimmer.tilt / 360)) <= 50)
      return r.drop(swimmer.x, swimmer.y, swimmer.tilt, dy) >= dy - 8;
    const h = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return r.sweep(swimmer.x, swimmer.y, swimmer.tilt, h) !== null && r.line(swimmer.x, swimmer.y, p.x, p.y);
  }

  /**
   * A spot in open water the squid can get to from where it is, sampled across the viewport (so the biggest stretches
   * of open water get the most visits), plus a few straight ahead and straight below. Prefers spots clear of the
   * glass and not right where it is already; `low` (out of lives) keeps low; `near` favours spots close by.
   */
  function freeSpot(opt: { low?: boolean; near?: boolean } = {}): Pt | null {
    const r = room;
    if (!r) return null;
    const cands: Pt[] = [];
    for (let i = 0; i < 36; i++) cands.push({ x: Math.random() * vw, y: Math.random() * vh });
    const hx = Math.sin((swimmer.tilt * Math.PI) / 180);
    const hy = -Math.cos((swimmer.tilt * Math.PI) / 180);
    for (const d of [120, 200, 300]) {
      cands.push({ x: swimmer.x + hx * d, y: swimmer.y + hy * d });
      cands.push({ x: swimmer.x, y: swimmer.y + d * 0.8 });
    }
    let best: Pt | null = null;
    let score = -Infinity;
    for (const p of cands) {
      const f = r.best(p.x, p.y).slack;
      if (f < 0 || !reachable(r, p)) continue;
      const d = Math.hypot(p.x - swimmer.x, p.y - swimmer.y);
      let k = Math.min(f, 80) + Math.random() * 60;
      // Somewhere it can turn round, or upright (it can drift down): never boxed in, facing the glass.
      const h = (Math.atan2(p.x - swimmer.x, -(p.y - swimmer.y)) * 180) / Math.PI;
      if (r.free(p.x, p.y) < 0 && Math.abs(h) > 50 && d > 4) k -= 150;
      if (d < 120) k -= 90;
      if (opt.near) k -= d * 0.3;
      if (opt.low) k += (p.y / vh) * 160;
      if (k > score) {
        score = k;
        best = p;
      }
    }
    return best;
  }

  /**
   * The spot in open water nearest a point (searched in rings around it), and the heading that fits there. A spot
   * with room to turn round wins if there is one not much further off; else one it fits upright (it can drift down
   * from there); else any.
   */
  function nearestFit(p: Pt): (Pt & { h: number }) | null {
    const r = room;
    if (!r) return null;
    const reach = Math.hypot(vw, vh);
    let first: (Pt & { h: number }) | null = null;
    let firstK = -Infinity;
    let until = reach;
    for (let d = 0; d < Math.min(reach, until); d += 16) {
      const n = d ? Math.max(12, Math.round(d / 10)) : 1;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = p.x + Math.cos(a) * d;
        const y = p.y + Math.sin(a) * d;
        const c = r.clear(x, y);
        if (c - r.back - r.r >= 0) return { x, y, h: r.best(x, y).h };
        // No heading can fit nearer the glass than this (the envelope's middle is r.back away).
        if (c < r.r - r.back || (first && d > until - 16)) continue;
        const f = r.best(x, y);
        if (f.slack < 0) continue;
        const kk = (Math.abs(f.h) <= 50 ? 100 : 0) + f.slack;
        if (!first || (d <= until - 250 && kk > firstK)) {
          firstK = kk;
          first = { x, y, h: f.h };
          until = d + 250;
        }
      }
    }
    return first;
  }

  /**
   * The clearest spot on a grid, nearer is better: for the perfect-10 loops, room to turn round (`free`); for reduced
   * motion's parking place, room upright.
   */
  function clearestSpot(near: boolean, free: boolean): Pt | null {
    const r = room;
    if (!r) return null;
    let best: Pt | null = null;
    let score = -Infinity;
    for (let y = 24; y < vh; y += 24) {
      for (let x = 24; x < vw; x += 24) {
        const f = free ? r.free(x, y) : r.fit(x, y, 0);
        if (f < 0) continue;
        const k = Math.min(f, 140) - (near ? Math.hypot(x - swimmer.x, y - swimmer.y) * 0.15 : 0) + (x / vw) * 10;
        if (k > score) {
          score = k;
          best = { x, y };
        }
      }
    }
    return best;
  }

  /**
   * Where to doze (in open water): a column whose water is clear all the way down to the seabed for the squid
   * upright, and where it rights itself above it: right where it is, if it is nearly upright already; else in a
   * column like that, at a height with room to turn round (best), or at the height nearest its own (it rights itself
   * slowly, about its middle). Nearer columns, and shorter sinks, win.
   */
  function dozeSite(): Pt | null {
    const r = room;
    if (!r) return null;
    const sh = SQUID_H * px;
    const restAt = (x: number) => scene.floorAt(x / px, t) * px - sh * 0.5;
    const tilt = swimmer.tilt - 360 * Math.round(swimmer.tilt / 360);
    if (Math.abs(tilt) <= 30 && r.sweep(swimmer.x, swimmer.y, tilt, 0) !== null) {
      const rest = restAt(swimmer.x);
      if (rest > swimmer.y && r.drop(swimmer.x, swimmer.y, 0, rest - swimmer.y, true) >= rest - swimmer.y) return { x: swimmer.x, y: swimmer.y };
    }
    let best: Pt | null = null;
    let score = -Infinity;
    for (let x = 16; x < vw; x += 16) {
      const rest = restAt(x);
      if (r.fit(x, rest, 0, true) < 0) continue;
      let turnY: number | null = null;
      let top = rest;
      for (let y = rest; y > 0 && r.fit(x, y, 0, true) >= 0; y -= 10) {
        top = y;
        if (r.free(x, y) >= 8) {
          turnY = y;
          break;
        }
      }
      // With no room to turn round in the column: at the height nearest its own, at least a body above the seabed.
      const y = turnY ?? Math.min(Math.max(swimmer.y, top), rest - SQUID_H * px * 0.5);
      if (y < top) continue;
      const k = (turnY !== null ? 200 : 0) - Math.abs(x - swimmer.x) * 0.5 - Math.abs(y - swimmer.y) * 0.3 - (rest - y) * 0.3 + Math.random() * 40;
      if (k > score) {
        score = k;
        best = { x, y };
      }
    }
    return best;
  }

  /** How far a point is from the nearest glass panel (0 inside one). */
  function clearance(x: number, y: number, glass: DOMRect[]) {
    let best = Infinity;
    for (const r of glass) {
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  }

  /**
   * Behind the glass (no room): a spot in what open water there is, sampled, scored by how clear of the glass it
   * is. `near` favours spots close to the squid (dozing, the loops); `room` is the clearance it needs. Null when the
   * glass covers everything (phones).
   */
  function openSpot(near = false, need0 = 0): Pt | null {
    const { glass } = readLayout();
    const sw = SQUID_W * px;
    const sh = SQUID_H * px;
    const need = Math.max(sw * 0.9, need0);
    let best: Pt | null = null;
    let score = -Infinity;
    for (let i = 0; i < 18; i++) {
      const x = sw + Math.random() * Math.max(1, vw - sw * 2);
      const y = sh * 0.6 + Math.random() * Math.max(1, vh * 0.88 - sh * 0.6);
      const c = clearance(x, y, glass);
      if (c < need) continue;
      let k = Math.min(c, 160) + Math.random() * 50;
      if (near) k -= Math.hypot(x - swimmer.x, y - swimmer.y) * 0.4;
      if (k > score) {
        score = k;
        best = { x, y };
      }
    }
    return best;
  }

  /**
   * Each new waypoint. In open water (room): a free spot there. Behind the glass: mostly in what open water there
   * is; with none (a phone, where the glass covers most of the ocean), most go to the strips where the squid shows:
   * around the guess dock (clear glass), or the open water around Home's title.
   */
  function prefer(low: boolean): Pt | null {
    if (room) return freeSpot({ low });
    const open = openSpot();
    if (open) return Math.random() < 0.85 ? open : null;
    if (Math.random() > 0.7) return null;
    const sw = SQUID_W * px;
    const x = sw + Math.random() * Math.max(1, vw - sw * 2);
    const bar = readLayout().dock;
    if (bar) {
      const top = Math.max(bar.top - 20, 0);
      const bottom = Math.min(bar.bottom + 10, vh) - 10;
      return { x, y: top + Math.random() * Math.max(1, bottom - top) };
    }
    const title = document.querySelector(".home .title")?.getBoundingClientRect();
    if (title && title.bottom > 0)
      return {
        x,
        y: Math.max(SQUID_H * px * 0.5, title.top + Math.random() * title.height),
      };
    return null;
  }

  /* ---------------- reactions ---------------- */

  /** The squid's centre in canvas px. */
  const here = () => cv({ x: swimmer.x, y: swimmer.y });

  function glow(color: string, strength: number, delay = 0) {
    later(delay, () => {
      const p = here();
      const s = 24 * strength;
      fx.bloom(p.x, p.y, s * 1.6, color, 0.9, 0.85);
      fx.ring(p.x, p.y, SQUID_W * 0.4, s * 0.9, color, 0.55);
    });
  }

  function burst(colors: string[], big: boolean) {
    const p = here();
    const reach = Math.min(scene.w, scene.h) * (big ? 0.22 : 0.14);
    fx.bloom(p.x, p.y, reach * 2.4, colors[0], 1.6, 1);
    colors.forEach((c, i) => fx.ring(p.x, p.y, 4, reach * (1 - i * 0.18), c, 0.9, i * 0.12));
    fx.sparksAt(p.x, p.y, big ? 36 : 20, reach * 0.8, colors);
  }

  /** A life lost: it inks and darts off (a cloud as big as the screen for the last one). */
  function ink(big: boolean) {
    const size = Math.min(scene.w, scene.h) * (big ? 0.5 : 0.2);
    inkAndFlee(size, big);
  }

  /**
   * Ink comes with a dart, never in place: the squid flees (turning, or flipping round where it is hemmed in) and the
   * cloud comes out of its siphon as the jet fires, so it is already darting off as the ink appears. The ink stays due
   * until then: if something else takes over the flee first (the glass a miss redraws comes over it, or blocks the
   * turn it planned), it flees again from where it is (once any escape is over). With nowhere to go for INK_DUE
   * seconds, no ink. A second ink before the first is out joins it: one cloud, the bigger.
   */
  let inkDue: { size: number; big: boolean; n?: number; until: number } | null = null;
  function inkAndFlee(size: number, big: boolean, n?: number) {
    if (inkDue && inkDue.size > size) return;
    inkDue = { size, big, n, until: t + INK_DUE };
    fleeForInk();
  }
  function fleeForInk() {
    const d = inkDue;
    if (!d) return;
    swimmer.flee(() => {
      inkDue = null;
      puff(siphon(), d.size, d.big, d.n);
    });
  }
  /** Each frame: ink still due and the flee taken over, flee again; too late, drop it. */
  function inkStillDue() {
    if (!inkDue || swimmer.fleeing) return;
    if (t > inkDue.until) inkDue = null;
    else if (!swimmer.escaping) fleeForInk();
  }

  /** Where the ink comes out (canvas px): the siphon, under the mantle where the arms leave it, behind the eyes. */
  function siphon(): Pt {
    const p = here();
    const a = swimmer.tilt * RAD;
    return { x: p.x - Math.sin(a) * SIPHON, y: p.y + Math.cos(a) * SIPHON };
  }

  /** An ink cloud at p (canvas px), counted on the stand-in with its centre (CSS px), for tests and tools. */
  function puff(p: Pt, size: number, big: boolean, n?: number) {
    fx.ink(p.x, p.y, size, big, n);
    count("inks");
    squid.dataset.inkAt = `${Math.round(p.x * px)},${Math.round(p.y * px)}`;
  }

  /**
   * A limb comes on (a find, a Blitz top-10 hit): it flashes white-hot and a shimmer runs down it, its tip throws a
   * few sparks, the squid glows and gives a happy wiggle; in open water it also gives a quick hop (bigger for the
   * feeding tentacles, #1 and #2). About half a second, all of it in the ocean.
   */
  function lightUp(rank: number, hop: boolean) {
    const big = rank <= 2;
    const color = rank === 1 ? GOLD : limbColor(rank);
    body.flash(rank, t);
    glow(color, big ? 1.5 : 1.15);
    later(0.18, () => {
      const p = body.limbAt(rank, 1);
      fx.sparksAt(p.x, p.y, big ? 12 : 7, big ? 9 : 6, [color, WHITE]);
    });
    wiggle(rank);
    if (hop && room) swimmer.hop(big);
  }

  /** Reactions are counted, and the one playing named, on the squid's DOM stand-in (for tests and tools). */
  let reacting = 0;
  const count = (k: "finds" | "pokes" | "inks") => (squid.dataset[k] = String(Number(squid.dataset[k] ?? 0) + 1));
  function reactFor(kind: string, s: number, still = false) {
    const id = ++reacting;
    squid.dataset.react = kind;
    const done = () => id === reacting && delete squid.dataset.react;
    if (still) setTimeout(done, s * 1000);
    else later(s, done);
  }

  /**
   * An answer found, alongside its limb lighting (with the flash, well under a second): the squid rocks side to side,
   * its mantle squashes and springs back and its arms flare out. A little bigger for a top-3 answer; a Blitz hit
   * outside the top 10 (`rank` null) gets a smaller one.
   */
  function wiggle(rank: number | null) {
    const top3 = rank !== null && rank <= 3;
    const k = rank === null ? 0.5 : top3 ? 1.4 : 1;
    const dur = top3 ? 0.55 : 0.45;
    flourishes.push({ at: t, dur, wob: 0.14 * k, boing: 0.07 * k, flare: 0.3 * k, spin: 0 });
    count("finds");
    reactFor(rank === null ? "hit" : top3 ? "find-top3" : "find", dur);
  }

  /**
   * Beside an element, read once now: just outside its nearer side when there is open water there (wide screens),
   * so the reaction shows; otherwise a third of the way across it, behind the glass.
   */
  function besidePoint(el: Element | null): Pt | null {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) return null;
    const y = r.top + r.height / 2;
    const off = SQUID_W * px * 1.15;
    const sides = [r.left - off, r.right + off].filter((x) => x > off && x < vw - off);
    if (!sides.length) return { x: r.left + r.width * 0.35, y };
    return {
      x: sides.reduce((a, b) => (Math.abs(a - swimmer.x) <= Math.abs(b - swimmer.x) ? a : b)),
      y,
    };
  }

  let pendingInk: "small" | "big" | null = null;

  function onEvent(e: PlayEvent) {
    onInput();
    if (still) return;
    if (stats) stats.seen[e.kind] = (stats.seen[e.kind] ?? 0) + 1;
    switch (e.kind) {
      case "found":
        lightUp(e.rank, true);
        break;
      case "miss":
      case "hint":
        if (e.kind === "hint" || e.lifeLost) {
          // The round's last life arrives as an end event right after this one: wait a tick to know which ink.
          pendingInk = pendingInk ?? "small";
          queueMicrotask(flushInk);
        }
        break;
      case "end":
        if (e.status === "lost") {
          pendingInk = "big";
          queueMicrotask(flushInk);
        } else if (e.status === "won") {
          // Out into the clearest open water first, so the loops show (after the last find's hop).
          later(0.7, () => {
            const open = room ? clearestSpot(true, true) : openSpot(true, Math.min(Math.max(Math.min(vw, vh) * 0.11, 36), 110) * 2);
            if (open) swimmer.dart(open);
            later(open ? 1.1 : 0.35, () => {
              const fx2 = () => burst([CYAN, GOLD, PINK], true);
              if (!swimmer.loops(2, fx2)) fx2();
            });
          });
        }
        break;
      case "blitz-hit": {
        const top = e.rank >= 1 && e.rank <= 10;
        if (room) {
          if (top) lightUp(e.rank, true);
          else {
            glow(CYAN, 0.8, 0.05);
            wiggle(null);
          }
          break;
        }
        // Behind the glass: over to the newest hit row (drawn after this event: read it on the next frame).
        later(0.04, () => {
          const p = besidePoint(document.querySelector(".blitz-hits .blitz-hit:first-child"));
          if (p) swimmer.dart(p);
        });
        if (top) body.flash(e.rank, t);
        glow(e.rank === 1 ? GOLD : CYAN, top ? 1.2 + heat * 0.15 : 0.8, 0.1);
        wiggle(top ? e.rank : null);
        break;
      }
      default:
        break;
    }
  }
  function flushInk() {
    if (!pendingInk) return;
    const big = pendingInk === "big";
    pendingInk = null;
    ink(big);
  }

  /* ---------------- state from the screen ---------------- */

  function setState(s: OceanSquidState) {
    const prev = state;
    layout.dirty = true;
    state = s;
    heat = s.heat;
    lit = new Set(s.lit.filter((r) => r >= 1 && r <= 10));
    // A limb coming on while the screen is up flashes into its colour; a screen arriving with limbs lit shows them.
    body.noteLit(lit, t, !still && !!prev && prev.session === s.session);
    const hot = 1 + 0.22 * s.heat;
    swimmer.speed = s.mood === "lost" ? 0.45 : s.mood === "gave-up" ? 0.7 : hot;
    swimmer.cadence = s.mood === "lost" ? 0.45 : s.mood === "gave-up" ? 0.7 : s.mood === "won" ? 1.2 : 1 + 0.35 * s.heat;
    swimmer.low = s.mood === "lost";
    // Passing your best (Blitz): a gold flare, once per round.
    if (!still && prev && prev.session === s.session && s.flare > prev.flare) burst([GOLD, WHITE, CYAN], false);
    if (still) {
      // The screen changed under a parked squid: park it again, in this screen's open water.
      refreshRoom(true);
      park();
      draw(false);
    }
  }

  /* ---------------- hover perk (Home) ---------------- */

  const todayKey = (e: Event) => (e.target instanceof Element ? e.target.closest(".mode-key.today") : null);
  function onOver(e: PointerEvent) {
    if (still || e.pointerType !== "mouse") return;
    const key = todayKey(e);
    if (!key) return;
    const p = besidePoint(key);
    const q = p && room ? nearestFit(p) : p;
    if (q) swimmer.perk(q);
  }
  function onOut(e: PointerEvent) {
    const key = todayKey(e);
    if (!key || (e.relatedTarget instanceof Node && key.contains(e.relatedTarget))) return;
    if (swimmer.behaviour === "perk") swimmer.perk(null);
  }

  /* ---------------- the tap easter egg ---------------- */

  /** A press that landed on the squid, waiting to see if it lifts as a tap. */
  let down: { id: number; x: number; y: number; at: number } | null = null;
  /** A tap on the squid, waiting for its click: the browser may hand that click to a control nearby (a phone's touch
   *  adjustment snaps a tap to a key within the finger's reach), and then the tap was the control's. */
  let tapped: { x: number; timer: ReturnType<typeof setTimeout> } | null = null;
  let streak = 0;
  let lastPoke = -Infinity;

  /** A control, or inside one, or anything that looks pressable (a row with a click handler, a note's label). */
  function pressable(el: Element) {
    if (el.closest(CONTROL)) return true;
    const cursor = getComputedStyle(el).cursor;
    return cursor === "pointer" || cursor === "help";
  }
  /** The squid takes this press: it is on its own pixels, and on nothing the player could mean instead. */
  function onSquid(e: PointerEvent) {
    const tol = e.pointerType === "mouse" ? TAP_TOL_MOUSE : TAP_TOL_TOUCH;
    if (!body.hits(e.clientX / px, e.clientY / px, tol)) return false;
    const el = e.target instanceof Element ? e.target : null;
    return !!el && !document.querySelector('dialog[open], [aria-modal="true"]') && !pressable(el);
  }
  function onDown(e: PointerEvent) {
    down = null;
    if (!e.isPrimary || e.button > 0) return;
    if (onSquid(e)) down = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() };
  }
  function onUp(e: PointerEvent) {
    const d = down;
    down = null;
    if (!d || e.pointerId !== d.id || performance.now() - d.at > TAP_MS) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_SLOP) return;
    if (tapped) clearTimeout(tapped.timer);
    // Its click follows at once; a browser that sends none for a tap on bare page (Safari, outside the app) gets the
    // reaction a beat later anyway.
    tapped = { x: e.clientX / px, timer: setTimeout(() => settleTap(true), CLICK_WAIT_MS) };
  }
  function onClick(e: MouseEvent) {
    if (tapped) settleTap(!(e.target instanceof Element && pressable(e.target)));
  }
  function settleTap(ours: boolean) {
    const tap = tapped;
    tapped = null;
    if (!tap) return;
    clearTimeout(tap.timer);
    if (ours) poke(tap.x);
  }
  const onCancel = () => (down = null);

  /**
   * Tapped: a boop, or (the third tap in a row) the trick; with reduced motion, only a blush. While a trick or a dart
   * from its ink plays out, taps are ignored, and build no streak toward another one: one cloud at a time.
   */
  function poke(tapX: number) {
    if (still) {
      // A short colour change, nothing moves: the parked frame, blushing, then the same frame again.
      count("pokes");
      squidSound("boop");
      stillBlush = 1;
      draw(false);
      clearTimeout(stillTimer);
      stillTimer = setTimeout(() => {
        stillBlush = 0;
        if (still) draw(false);
      }, STILL_BLUSH_MS);
      reactFor("blush", STILL_BLUSH_MS / 1000, true);
      return;
    }
    if (t < trickUntil || swimmer.fleeing || inkDue) {
      streak = 0;
      return;
    }
    const now = performance.now();
    streak = now - lastPoke < STREAK_MS ? streak + 1 : 1;
    lastPoke = now;
    count("pokes");
    if (streak >= TRICK_TAPS && swimmer.behaviour !== "loop") {
      streak = 0;
      trick();
    } else boop(tapX);
    if (stats) stats.seen.poke = (stats.seen.poke ?? 0) + 1;
  }

  /**
   * A boop: it blushes, flinches (a squash and a little jolt, the arms flicking out) and waves the tentacle nearer the
   * tap, and a pixel heart pops up over its head. About a second, in place.
   */
  function boop(tapX: number) {
    squidSound("boop");
    blushUntil = t + 1.2;
    flourishes.push({ at: t, dur: 0.5, wob: 0.1, boing: 0.16, flare: 0.4, spin: 0 });
    const left = body.limbAt(1, 1);
    const right = body.limbAt(2, 1);
    const id = Math.abs(left.x - tapX) <= Math.abs(right.x - tapX) ? 1 : 2;
    body.wave(id, t, 1, id === 1 ? -1 : 1);
    // The heart pops clear of its arms: over its head when it is upright-ish, straight above its mantle when it lies on
    // its side (the arms trail sideways), beside its mantle when it is head-down (the arms are above it).
    const p = here();
    const side = tapX < p.x ? -1 : 1;
    const a = swimmer.tilt * RAD;
    if (Math.cos(a) > 0.5) fx.heart(p.x + Math.sin(a) * 11 + side * 3, p.y - Math.cos(a) * 11 - 3);
    else if (Math.cos(a) > -0.5) fx.heart(p.x + Math.sin(a) * 3, p.y - 12);
    else fx.heart(p.x + side * 14, p.y - 3);
    reactFor("boop", 1);
  }

  /**
   * The trick, for a few taps in a row: it spins once on the spot (where it has room to turn round; else it wobbles),
   * throwing sparks, then darts off with a little puff of ink (inkAndFlee). The spin takes about half a second; taps
   * do nothing more until the dart is over. Already fleeing (a life lost meanwhile), that one ink is all.
   */
  function trick() {
    squidSound("trick");
    const SPIN = 0.55;
    trickUntil = t + SPIN + 0.35;
    blushUntil = t + SPIN + 0.6;
    const p = here();
    const turn = !room || room.free(swimmer.x, swimmer.y) >= 0;
    swimmer.pause(SPIN);
    flourishes.push(
      turn
        ? { at: t, dur: SPIN, wob: 0, boing: 0.1, flare: 0.6, spin: Math.random() < 0.5 ? 1 : -1 }
        : { at: t, dur: SPIN, wob: 0.22, boing: 0.2, flare: 0.6, spin: 0 },
    );
    fx.sparksAt(p.x, p.y, 14, 7, [CYAN, GOLD, PINK, WHITE], 0.05);
    fx.ring(p.x, p.y, 4, 14, CYAN, 0.5);
    later(SPIN, () => {
      if (!swimmer.fleeing && !inkDue) inkAndFlee(Math.min(scene.w, scene.h) * 0.08, false, 7);
    });
    reactFor("trick", SPIN + 0.6);
  }

  /* ---------------- wiring ---------------- */

  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const onMotion = () => {
    still = !!mq?.matches;
    flourishes = [];
    inkDue = null;
    blushUntil = -1;
    stillBlush = 0;
    if (still) {
      pause();
      delete squid.dataset.doze;
      refreshRoom(true);
      park();
      draw(true);
    } else start();
  };
  const onVis = () => (document.visibilityState === "hidden" ? pause() : start());
  const inputs = ["keydown", "pointerdown", "wheel", "touchstart"] as const;

  const onScroll = () => (layout.dirty = true);
  addEventListener("resize", resize);
  addEventListener("scroll", onScroll, { passive: true, capture: true });
  addEventListener("hashchange", onScroll);
  document.addEventListener("visibilitychange", onVis);
  mq?.addEventListener("change", onMotion);
  for (const ev of inputs) addEventListener(ev, onInput, { passive: true, capture: true });
  // The easter egg reads taps on the window, passively: it never takes one from the page.
  addEventListener("pointerdown", onDown, { passive: true, capture: true });
  addEventListener("pointerup", onUp, { passive: true, capture: true });
  addEventListener("pointercancel", onCancel, { passive: true, capture: true });
  addEventListener("click", onClick, { passive: true, capture: true });
  document.addEventListener("pointerover", onOver);
  document.addEventListener("pointerout", onOut);
  const offPlay = onPlay(onEvent);

  swimmer.x = innerWidth * 0.7;
  swimmer.y = innerHeight * 0.55;
  resize();
  pose();
  body.settle(t, motion());
  if (still) park();
  draw(true);
  start();

  return {
    setState,
    stop() {
      pause();
      removeEventListener("resize", resize);
      removeEventListener("scroll", onScroll, { capture: true });
      removeEventListener("hashchange", onScroll);
      document.removeEventListener("visibilitychange", onVis);
      mq?.removeEventListener("change", onMotion);
      for (const ev of inputs) removeEventListener(ev, onInput, { capture: true });
      removeEventListener("pointerdown", onDown, { capture: true });
      removeEventListener("pointerup", onUp, { capture: true });
      removeEventListener("pointercancel", onCancel, { capture: true });
      removeEventListener("click", onClick, { capture: true });
      clearTimeout(stillTimer);
      if (tapped) clearTimeout(tapped.timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      offPlay();
      squidAt.live = false;
    },
  };
}
