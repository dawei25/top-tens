/**
 * The ocean's engine: one requestAnimationFrame loop for the whole layer, at about 30 fps (a timer sleeps between
 * frames, so the page isn't woken on every vsync), paused while the tab is hidden. Each frame it steps the scene, the
 * swim, the squid's limbs and the effects, and draws the low-res canvases: the backdrop (at 15 fps), the squid with
 * the effects in front of it, and, while a word is being grabbed, the overlay above the UI. No layout reads per
 * frame: sizes are read on resize; the glass panels ([data-glass]) and the guess dock ([data-guess-dock]) are read
 * lazily after a resize, a scroll or an event, when the squid next needs them (a new waypoint, a find); a found
 * row or a hovered key once, when its event happens.
 *
 * It listens to play events for the reactions (a find: the squid darts head-first to the guess box, then strikes
 * and grabs the word, at once if it is already near; a lost
 * life inks and flees; a perfect 10 loops and bursts; Blitz hits) and to input for idling: after IDLE_MS without a
 * key or a tap, the squid sinks to the seabed and dozes until the next one. With reduced motion it draws one still
 * frame: the squid parked, its limbs at rest, lit.
 */
import { onPlay, type PlayEvent } from "../../game/events";
import { reducedMotion } from "../pixel";
import { limbColor } from "../squid/colors";
import { SquidBody, type Motion } from "./body";
import { Fx } from "./fx";
import { GUESS_INPUT, Grabs } from "./grab";
import { Scene } from "./scene";
import { squidAt, type OceanSquidState } from "./store";
import { Swimmer, type Pt } from "./swim";

export interface OceanEls {
  root: HTMLElement;
  back: HTMLCanvasElement;
  front: HTMLCanvasElement;
  /** Above the UI: the grabbing limb, and a layer for the word tiles. */
  overlay: HTMLCanvasElement;
  tiles: HTMLElement;
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

const CYAN = "#4de3ff";
const GOLD = "#ffd166";
const PINK = "#ff5d8f";
const WHITE = "#e8fbff";

/** Panels the ocean shows through: marked [data-glass], or (a layout without the marks) the app's column. */
const GLASS = "[data-glass]";
const DOCK = "[data-guess-dock]";
const DOCK_FALLBACK = ".guess-row";
/** The heading check (dev stats): travel faster than this (CSS px/s) must be within OFF_DEG of the heading. */
const CHECK_SPEED = 15;
const OFF_DEG = 30;
/** A find: the squid darts over first, unless it is near the box already; it strikes after at most WAIT_S. */
const WAIT_S = 0.5;

/** Debug numbers for frame-time and motion checks, exposed as window.__ocean in dev when the URL has ?oceanstats. */
interface Stats {
  frames: number;
  /** Time spent in the frame callback, total and worst. */
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
  /** Reactions seen: finds, inks, wins, Blitz hits, dozes. */
  seen: Record<string, number>;
  /** What the squid is doing, and its heading (degrees, 0 is up). */
  state: string;
  tilt: number;
}

export function startOcean(els: OceanEls): Ocean {
  const { root, back, front, overlay, tiles, squid } = els;
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
  const timers: { at: number; fn: () => void }[] = [];
  const later = (s: number, fn: () => void) => timers.push({ at: t + s, fn });

  // Dev only: production builds drop this (and the hooks below) entirely.
  const stats: Stats | null =
    import.meta.env.DEV && typeof location !== "undefined" && location.search.includes("oceanstats")
      ? { frames: 0, drawMs: 0, maxMs: 0, maxGap: 0, slow: 0, at: 0, x: 0, y: 0, jet: 0, checked: 0, offHeading: 0, worstDeg: 0, offLog: [], seen: {}, state: "", tilt: 0 }
      : null;
  /** The squid as drawn last frame (CSS px, heading), for the heading check; null after a jump (a resize). */
  let drawn: { x: number; y: number; a: number } | null = null;
  if (stats) {
    const g = globalThis as unknown as { __ocean: Stats; __oceanGo: (x: number, y: number) => void; __oceanSwim: (x: number, y: number) => void };
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
  const swimmer = new Swimmer({ w: 400, h: 800, sw: 60, sh: 90, floor: () => 800 });

  const grabs = new Grabs(overlay, tiles, {
    px: () => px,
    rootOf: (rank) => body.rootOf(rank),
    away: (rank, out) => (out ? body.away.add(rank) : body.away.delete(rank)),
    lit: (rank) => {
      body.flash(rank, t);
      glow(limbColor(rank), 1, 0);
    },
    ready: () => nearStrike(),
  });

  /** Canvas px of a viewport point. */
  const cv = (p: Pt) => ({ x: p.x / px, y: p.y / px });

  const motion = (): Motion => ({
    jetAge: swimmer.jetAge,
    inflating: swimmer.inflating,
    hovering: swimmer.hovering,
    asleep: swimmer.asleep,
  });

  /** The squid's pose on the canvas: the swim's (its idle surge is part of the swim, along its heading). */
  function pose() {
    body.pose = { x: swimmer.x / px, y: swimmer.y / px, angle: (swimmer.tilt * Math.PI) / 180, sx: swimmer.sx, sy: swimmer.sy };
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
    grabs.resize(cw, ch, px);
    bctx.imageSmoothingEnabled = false;
    fctx.imageSmoothingEnabled = false;
    root.style.setProperty("--ocean-px", `${px}px`);
    scene.resize(cw, ch);
    swimmer.setWorld(world());
    pose();
    body.settle(t, motion());
    if (still) park();
    draw(true);
  }

  /** Reduced motion: the squid rests in the lower right, upright, limbs at rest, over a still scene. */
  function park() {
    swimmer.x = vw * (vw >= 700 ? 0.8 : 0.5);
    // Wide screens: in the open water beside the column. Phones: low, behind the clearer glass round the guess box.
    swimmer.y = vw >= 700 ? Math.min(vh * 0.55, world().floor(vw * 0.8) - SQUID_H * px) : vh - SQUID_H * px * 1.15;
    swimmer.tilt = 0;
    swimmer.sx = swimmer.sy = 1;
    swimmer.jetAge = 9;
    fx.clear();
    grabs.clear();
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
    body.draw(fctx, t, { lit, mood: state?.mood ?? "play", heat, doze: swimmer.behaviour === "doze" });
    fx.drawFront(fctx);
    grabs.draw();
  }

  /** 30 fps; asleep on the seabed nothing hurries, so the whole ocean idles at the backdrop's rate. */
  const frameMs = () => (swimmer.asleep && !grabs.active ? 1000 / BG_FPS : FRAME_MS);

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
    wait = setTimeout(() => {
      wait = 0;
      if (running) raf = requestAnimationFrame(frame);
    }, Math.max(0, frameMs() - (performance.now() - now) - 10));
  }

  function tick(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t0 = stats ? performance.now() : 0;
    t += dt;
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= t) timers.splice(i, 1)[0].fn();
    }
    if (swimmer.behaviour !== "doze" && now - lastInput > IDLE_MS) doze();
    scene.step(dt, t);
    swimmer.step(dt, t);
    pose();
    const m = motion();
    body.step(dt, t, m, swimmer.behaviour === "doze" ? (x) => scene.floorAt(x, t) : null);
    grabs.step(dt, now);
    if (swimmer.asleep && (bubbleIn -= dt) <= 0) {
      bubbleIn = 1.6 + Math.random();
      const p = cv({ x: swimmer.x + SQUID_W * px * 0.15, y: swimmer.y - 7 * px });
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
    if (stats) {
      const ms = performance.now() - t0;
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
          stats.checked++;
          stats.worstDeg = Math.max(stats.worstDeg, off);
          if (off > OFF_DEG) {
            stats.offHeading++;
            stats.offLog.push(`${swimmer.state} v=${v.toFixed(0)} off=${off.toFixed(0)}`);
            if (stats.offLog.length > 20) stats.offLog.shift();
          }
        }
      }
      drawn = { x: cx, y: cy, a };
      stats.state = swimmer.state;
      stats.tilt = swimmer.tilt;
      stats.frames++;
      stats.drawMs += ms;
      stats.maxMs = Math.max(stats.maxMs, ms);
      const gap = stats.at ? now - stats.at : 0;
      stats.at = now;
      stats.maxGap = Math.max(stats.maxGap, gap);
      if (gap > 50) stats.slow++;
      stats.x = swimmer.x;
      stats.y = swimmer.y;
      stats.jet = swimmer.jetAge;
    }
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
    // A grab cut short leaves nothing behind (its word's row is already filled in).
    if (grabs.active) grabs.clear();
  }

  /* ---------------- idle ---------------- */

  function doze() {
    // Read once, as it nods off: settle in open water if there is any.
    if (stats) stats.seen.doze = (stats.seen.doze ?? 0) + 1;
    swimmer.doze(openSpot(true)?.x);
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
   * The glass panels and the guess dock, in viewport CSS px. Read lazily, at most once per resize, scroll or event
   * (and never older than a few seconds when asked for), never per frame. Without [data-glass] marks, the app's
   * column (main) stands in for the glass; without [data-guess-dock], the guess row.
   */
  const layout = { dirty: true, at: 0, glass: [] as DOMRect[], dock: null as DOMRect | null, board: null as DOMRect | null };
  function readLayout() {
    const now = performance.now();
    if (!layout.dirty && now - layout.at < 3000) return layout;
    layout.dirty = false;
    layout.at = now;
    const marked = document.querySelectorAll(GLASS);
    const els = marked.length ? [...marked] : [document.querySelector("main")].filter((e) => e !== null);
    layout.glass = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh);
    const dock = document.querySelector(DOCK) ?? document.querySelector(DOCK_FALLBACK);
    const dr = dock?.getBoundingClientRect();
    layout.dock = dr && dr.width > 0 && dr.bottom > 0 && dr.top < vh ? dr : null;
    // The board's column (wide screens put it on the left, with open water to its right).
    const col = document.querySelector(".board-col")?.getBoundingClientRect();
    layout.board = col && col.width > 0 ? col : null;
    return layout;
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
   * A spot in open water (the viewport minus the glass), where the squid shows: sampled, scored by how clear of the
   * glass it is, and on wide screens favouring the water right of the board (.board-col, or the tallest panel, when
   * it sits left).
   * `near` favours spots close to the squid (dozing, the loops); `room` is the clearance it needs. Null when the
   * glass covers everything (phones).
   */
  function openSpot(near = false, room = 0): Pt | null {
    const { glass } = readLayout();
    const sw = SQUID_W * px;
    const sh = SQUID_H * px;
    const need = Math.max(sw * 0.9, room);
    const board = layout.board ?? glass.reduce<DOMRect | null>((a, r) => (!a || r.height > a.height ? r : a), null);
    const boardRight = vw >= 900 && board && board.left + board.width / 2 < vw / 2 ? board.right : null;
    let best: Pt | null = null;
    let score = -Infinity;
    for (let i = 0; i < 18; i++) {
      const x = sw + Math.random() * Math.max(1, vw - sw * 2);
      const y = sh * 0.6 + Math.random() * Math.max(1, vh * 0.88 - sh * 0.6);
      const c = clearance(x, y, glass);
      if (c < need) continue;
      let k = Math.min(c, 160) + Math.random() * 50;
      if (boardRight !== null && x > boardRight + sw) k += 140;
      if (near) k -= Math.hypot(x - swimmer.x, y - swimmer.y) * 0.4;
      if (k > score) {
        score = k;
        best = { x, y };
      }
    }
    return best;
  }

  /**
   * Each new waypoint: mostly in open water. With none (a phone, where the glass covers most of the ocean), most go
   * to the strips where the squid shows: around the guess dock (clear glass, close to the next grab), or the open
   * water around Home's title.
   */
  function prefer(): Pt | null {
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
    if (title && title.bottom > 0) return { x, y: Math.max(SQUID_H * px * 0.5, title.top + Math.random() * title.height) };
    return null;
  }

  /** Where the squid strikes from at the guess dock: beside it in open water, or just above it behind the glass. */
  function dockPoint(): Pt | null {
    const { dock: r, glass } = readLayout();
    if (!r) return null;
    const sw = SQUID_W * px;
    const sh = SQUID_H * px;
    // In open water by the box, if there is some: above it first (its limbs hang down to the box), then either
    // side; the clearest spot wins (the box itself doesn't count as cover).
    const others = glass.filter((g) => !(g.left === r.left && g.top === r.top && g.width === r.width));
    const spots = [
      { x: r.left + Math.min(r.width * 0.3, 120), y: r.top - sh * 0.55, bias: 30 },
      { x: r.left - sw * 1.15, y: r.top + r.height / 2 - sh * 0.3, bias: 0 },
      { x: r.right + sw * 1.15, y: r.top + r.height / 2 - sh * 0.3, bias: 0 },
    ].filter((p) => p.x > sw && p.x < vw - sw && p.y > sh * 0.5);
    let best: Pt | null = null;
    let score = sw * 0.6;
    for (const p of spots) {
      const k = Math.min(clearance(p.x, p.y, others), sw * 2) + p.bias;
      if (k > score) {
        score = k;
        best = { x: p.x, y: p.y };
      }
    }
    if (best) return best;
    // No open water (a phone): just above the box, behind the glass, its limbs hanging toward it.
    const p = besideRect(r);
    return { x: p.x, y: Math.min(p.y - sh * 0.3, vh - sh * 1.25) };
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

  function ink(big: boolean) {
    const p = here();
    fx.ink(p.x, p.y, Math.min(scene.w, scene.h) * (big ? 0.5 : 0.2), big);
    swimmer.flee();
  }

  /**
   * Beside an element, read once now: just outside its nearer side when there is open water there (wide screens),
   * so the reaction shows; otherwise a third of the way across it, behind the glass.
   */
  function besidePoint(el: Element | null): Pt | null {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) return null;
    return besideRect(r);
  }
  function besideRect(r: DOMRect): Pt {
    const y = r.top + r.height / 2;
    const off = SQUID_W * px * 1.15;
    const sides = [r.left - off, r.right + off].filter((x) => x > off && x < vw - off);
    if (!sides.length) return { x: r.left + r.width * 0.35, y };
    return { x: sides.reduce((a, b) => (Math.abs(a - swimmer.x) <= Math.abs(b - swimmer.x) ? a : b)), y };
  }

  let pendingInk: "small" | "big" | null = null;
  /** Where the squid is headed to strike from (a find), or null: grabs strike once it is within strikeR() of it. */
  let strikeAt: Pt | null = null;
  const strikeR = () => Math.max(110, Math.min(vw, vh) * 0.2);
  const nearStrike = () => !strikeAt || Math.hypot(strikeAt.x - swimmer.x, strikeAt.y - swimmer.y) < strikeR();

  function onEvent(e: PlayEvent) {
    onInput();
    if (still) return;
    if (stats) stats.seen[e.kind] = (stats.seen[e.kind] ?? 0) + 1;
    switch (e.kind) {
      case "found": {
        // It goes for the word: darts head-first to the guess box (beside it, in open water, on wide screens), then
        // strikes; already near, it strikes at once. The box is cleared and the row filled in meanwhile.
        const p = document.querySelector(GUESS_INPUT) ? dockPoint() : null;
        strikeAt = p;
        const near = nearStrike();
        if (grabs.start(e.rank, document, near ? 0 : WAIT_S)) {
          if (p && !near) swimmer.dart(p);
        } else {
          const p = besidePoint(document.querySelector(`[data-testid="slot"][data-rank="${e.rank}"]`));
          swimmer.dart(p ?? { x: Math.random() * vw, y: vh * (0.2 + Math.random() * 0.5) });
          glow(e.rank === 1 ? GOLD : CYAN, e.rank <= 2 ? 1.6 : 1.2, 0.1);
        }
        break;
      }
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
          // Out into open water first if there is any beside the column, so the loops show (after the last grab).
          later(1.1, () => {
            const open = openSpot(true, Math.min(Math.max(Math.min(vw, vh) * 0.11, 36), 110) * 2);
            if (open) swimmer.dart(open);
            later(open ? 1.1 : 0.35, () => swimmer.loops(2, () => burst([CYAN, GOLD, PINK], true)));
          });
        }
        break;
      case "blitz-hit": {
        const top = e.rank >= 1 && e.rank <= 10;
        // The newest hit row is drawn after this event: read it on the next frame.
        later(0.04, () => {
          const p = besidePoint(document.querySelector(".blitz-hits .blitz-hit:first-child"));
          if (p) swimmer.dart(p);
        });
        glow(e.rank === 1 ? GOLD : CYAN, top ? 1.2 + heat * 0.15 : 0.8, 0.1);
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
    if (still) draw(false);
  }

  /* ---------------- hover perk (Home) ---------------- */

  const todayKey = (e: Event) => (e.target instanceof Element ? e.target.closest(".mode-key.today") : null);
  function onOver(e: PointerEvent) {
    if (still || e.pointerType !== "mouse") return;
    const key = todayKey(e);
    if (!key) return;
    const p = besidePoint(key);
    if (p) swimmer.perk(p);
  }
  function onOut(e: PointerEvent) {
    const key = todayKey(e);
    if (!key || (e.relatedTarget instanceof Node && key.contains(e.relatedTarget))) return;
    if (swimmer.behaviour === "perk") swimmer.perk(null);
  }

  /* ---------------- wiring ---------------- */

  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const onMotion = () => {
    still = !!mq?.matches;
    if (still) {
      pause();
      delete squid.dataset.doze;
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
  document.addEventListener("pointerover", onOver);
  document.addEventListener("pointerout", onOut);
  const offPlay = onPlay(onEvent);

  resize();
  swimmer.x = vw * 0.7;
  swimmer.y = vh * 0.55;
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
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      offPlay();
      squidAt.live = false;
    },
  };
}
