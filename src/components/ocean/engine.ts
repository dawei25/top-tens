/**
 * The ocean's engine: one requestAnimationFrame loop for the whole layer, at about 30 fps (a timer sleeps between
 * frames, so the page isn't woken on every vsync), paused while the tab is hidden. Each frame it steps the scene, the
 * swim, the squid's limbs and the effects, and draws the low-res canvases: the backdrop (at 15 fps), the squid with
 * the effects in front of it, and, while a word is being grabbed, the overlay above the UI. No layout reads per
 * frame: sizes are read on resize, and on-screen targets (a found row, the guess box, a hovered key) once, when
 * their event happens, or when the squid picks a new waypoint.
 *
 * It listens to play events for the reactions (a find: the squid darts to the guess box and grabs the word; a lost
 * life inks and flees; a perfect 10 loops and bursts; Blitz hits) and to input for idling: after IDLE_MS without a
 * key or a tap, the squid sinks to the seabed and dozes until the next one. With reduced motion it draws one still
 * frame: the squid parked, its limbs at rest, lit.
 */
import { onPlay, type PlayEvent } from "../../game/events";
import { reducedMotion } from "../pixel";
import { limbColor } from "../squid/colors";
import { SquidBody, type Motion } from "./body";
import { Fx } from "./fx";
import { Grabs } from "./grab";
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

/** Debug numbers for frame-time checks, exposed as window.__ocean when the URL has ?oceanstats. */
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

  const stats: Stats | null = typeof location !== "undefined" && location.search.includes("oceanstats") ? { frames: 0, drawMs: 0, maxMs: 0, maxGap: 0, slow: 0, at: 0, x: 0, y: 0, jet: 0 } : null;
  if (stats) {
    const g = globalThis as unknown as { __ocean: Stats; __oceanGo: (x: number, y: number) => void };
    g.__ocean = stats;
    // Debug: send the squid somewhere (for screenshots of it in open water).
    g.__oceanGo = (x, y) => swimmer.dart({ x, y });
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
  });

  /** Canvas px of a viewport point. */
  const cv = (p: Pt) => ({ x: p.x / px, y: p.y / px });

  const motion = (): Motion => ({
    jetAge: swimmer.jetAge,
    inflating: swimmer.inflating,
    hovering: swimmer.hovering,
    asleep: swimmer.asleep,
  });

  /** The squid's pose on the canvas: the swim's, with a slow bob while it hangs in the water. */
  function pose() {
    const bob = swimmer.asleep ? 0 : Math.sin(t * 1.25) * 0.8;
    body.pose = { x: swimmer.x / px, y: swimmer.y / px + bob, angle: (swimmer.tilt * Math.PI) / 180, sx: swimmer.sx, sy: swimmer.sy };
    squidAt.x = swimmer.x;
    squidAt.y = swimmer.y;
    squidAt.live = true;
  }

  function resize() {
    vw = innerWidth;
    vh = innerHeight;
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
    // Read once, as it nods off: settle in open water beside the column if there is any.
    swimmer.doze(openWater()?.x);
    squid.dataset.doze = "";
    bubbleIn = 2;
  }
  function onInput() {
    lastInput = performance.now();
    if (swimmer.behaviour === "doze") {
      swimmer.wake();
      delete squid.dataset.doze;
    }
  }

  /* ---------------- where to be seen ---------------- */

  /**
   * On a phone the column fills the width and the panels cover most of the ocean, so most new waypoints are in the
   * strips where the squid shows: around the input bar (clearer glass, close to the next grab), or the open water
   * around Home's title. Read when a waypoint is picked (every few seconds), not per frame.
   */
  function prefer(): Pt | null {
    if (openWater() || Math.random() > 0.7) return null;
    const sw = SQUID_W * px;
    const x = sw + Math.random() * Math.max(1, vw - sw * 2);
    const bar = document.querySelector(".guess")?.getBoundingClientRect();
    if (bar && bar.top < vh && bar.bottom > 0) {
      const top = Math.max(bar.top + 20, 0);
      const bottom = Math.min(bar.bottom, vh) - 10;
      return { x, y: top + Math.random() * Math.max(1, bottom - top) };
    }
    const title = document.querySelector(".home .title")?.getBoundingClientRect();
    if (title && title.bottom > 0) return { x, y: Math.max(SQUID_H * px * 0.5, title.top + Math.random() * title.height) };
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
    const y = r.top + r.height / 2;
    const off = SQUID_W * px * 1.15;
    const sides = [r.left - off, r.right + off].filter((x) => x > off && x < vw - off);
    if (!sides.length) return { x: r.left + r.width * 0.35, y };
    return { x: sides.reduce((a, b) => (Math.abs(a - swimmer.x) <= Math.abs(b - swimmer.x) ? a : b)), y };
  }

  /** The middle of the open water beside the app's column nearest the squid, or null if the column fills the width. */
  function openWater(): Pt | null {
    const main = document.querySelector("main");
    if (!main) return null;
    const r = main.getBoundingClientRect();
    const need = SQUID_W * px * 2.2;
    const xs = [r.left >= need ? r.left / 2 : null, vw - r.right >= need ? (r.right + vw) / 2 : null].filter((x) => x !== null);
    if (!xs.length) return null;
    const x = xs.reduce((a, b) => (Math.abs(a - swimmer.x) <= Math.abs(b - swimmer.x) ? a : b));
    return { x, y: Math.min(vh * 0.6, Math.max(vh * 0.3, swimmer.y)) };
  }

  let pendingInk: "small" | "big" | null = null;
  function onEvent(e: PlayEvent) {
    onInput();
    if (still) return;
    switch (e.kind) {
      case "found": {
        // It goes for the word: darts to the guess box (beside it, in open water, on wide screens) and reaches.
        const guessRow = document.querySelector(".guess-row");
        if (grabs.start(e.rank, document)) {
          const p = besidePoint(guessRow);
          // Its limbs hang below it: hold the mantle above the box, so they hang beside it, not off the screen.
          if (p) swimmer.dart({ x: p.x, y: Math.min(p.y - SQUID_H * px * 0.3, vh - SQUID_H * px * 1.25) });
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
          later(0.6, () => {
            const open = openWater();
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

  addEventListener("resize", resize);
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
