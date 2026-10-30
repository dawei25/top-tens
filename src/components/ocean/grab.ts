/**
 * The squid grabbing a found word: the limb for that rank comes out of the ocean, through the glass, toward the
 * viewer (thicker toward its tip, dim where it is still behind the glass), clamps the typed word off the guess box
 * as a pixel tile, carries it up to its row and sets it there, lights up in its colour, and goes back behind the
 * glass. The one moment that crosses the glass: drawn on a pixelated overlay canvas above the UI (pointer-events
 * none, aria-hidden), with the word tile a DOM element above it, so it is the real text in the game font.
 *
 * Timing (s), after a real squid's tentacle strike (the feeding tentacles shoot out in a few tens of ms; the arms
 * are slower): a wait while the squid darts over (none if it is already near), then reach, grip, carry, set,
 * retract. The word lands within about 1.1 s. The game is not waiting: the row's text is in the DOM at once (kept
 * transparent until the word lands) and the guess box is already cleared; the word sits where it was typed until
 * the club takes it.
 *
 * Each grab is its own limb, so a fast typist's overlapping finds each get one. The limb itself is a rope of nodes
 * with both ends pinned (the squid's limb root, and the scripted tip), relaxed each frame (Jakobsen's stick
 * constraints), with a ripple running down it.
 */
import { limbColor, mix } from "../squid/colors";
import { Rects, strokeChain } from "./body";

type Ctx = CanvasRenderingContext2D;
type P = { x: number; y: number };

const N = 18;
const NIGHT = "#050a14";
const UNLIT = "#2a8aa2";
const UNLIT_CORE = "#7fdcef";
const SUCKER = "#ff5d8f";
/** How far left of the word's text the club holds it, CSS px (the tile's own padding is 6). */
const HOLD = 7;

const easeOut = (s: number) => 1 - (1 - s) ** 3;
const easeIn = (s: number) => s * s * s;
const easeInOut = (s: number) => (s < 0.5 ? 4 * s * s * s : 1 - (-2 * s + 2) ** 3 / 2);
const clamp01 = (s: number) => Math.min(1, Math.max(0, s));

interface Grab {
  rank: number;
  color: string;
  /** Seconds into the strike; while waiting for the squid, the seconds waited so far. */
  t: number;
  /** Waiting for the squid to come close before it strikes, at most `wait` s. */
  waiting: boolean;
  wait: number;
  reach: number;
  grip: number;
  carry: number;
  set: number;
  back: number;
  /** CSS px: where the club takes the word, and where it sets it. */
  from: P;
  to: P;
  fromSize: number;
  toSize: number;
  tile: HTMLElement;
  /** The row being filled: marked while the word is on its way, so its numeral lights when the word lands. */
  row: HTMLElement;
  /** The row's rect (CSS px), for the splash as the word lands. */
  rowRect: DOMRect;
  input: HTMLElement;
  /** Keeps the row's real text hidden until the word lands. */
  hide: Animation | null;
  /** Rope nodes, canvas px. */
  x: Float32Array;
  y: Float32Array;
  ox: Float32Array;
  oy: Float32Array;
  landed: boolean;
  lastTip: P;
}

export interface GrabHost {
  /** Canvas px per CSS px divisor (the ocean's pixel size). */
  px(): number;
  /** The squid's root for limb `rank`, in canvas px, now. */
  rootOf(rank: number): P;
  /** The ocean limb leaves the water (hidden there) and comes back. */
  away(rank: number, out: boolean): void;
  /** The limb lights up: the word is set. */
  lit(rank: number): void;
  /** Close enough to strike (the squid has come over to the guess box). */
  ready(): boolean;
}

/** The guess box's text field: inside the floating dock when there is one, else the guess row's. */
export const GUESS_INPUT = "[data-guess-dock] input, input[data-guess-dock], .guess-row input";

export class Grabs {
  private list: Grab[] = [];
  private ctx: Ctx;
  private rects = new Rects();
  private dirty = false;
  private canvas: HTMLCanvasElement;
  private layer: HTMLElement;
  private host: GrabHost;

  constructor(canvas: HTMLCanvasElement, layer: HTMLElement, host: GrabHost) {
    this.canvas = canvas;
    this.layer = layer;
    this.host = host;
    this.ctx = canvas.getContext("2d")!;
  }

  get active() {
    return this.list.length > 0;
  }

  resize(cw: number, ch: number, px: number) {
    const c = this.canvas;
    if (c.width !== cw || c.height !== ch) {
      c.width = cw;
      c.height = ch;
    }
    c.style.width = `${cw * px}px`;
    c.style.height = `${ch * px}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  /**
   * Start a grab for a find, reading the guess box and the row once, now. With `wait`, the strike holds off until the
   * squid is close (host.ready) or `wait` s pass. Returns false when there is no room.
   */
  start(rank: number, scope: ParentNode, wait = 0): boolean {
    const input = scope.querySelector<HTMLInputElement>(GUESS_INPUT);
    const row = scope.querySelector<HTMLElement>(`[data-testid="slot"][data-rank="${rank}"]`);
    const name = row?.querySelector<HTMLElement>(".name");
    const text = input?.value.trim();
    if (!input || !row || !name || !text) return false;
    const ir = input.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const nr = name.getBoundingClientRect();
    // A row scrolled out of view (or under a guess bar across the bottom) has nothing to set the word into.
    const under = rr.left < ir.right && rr.right > ir.left && rr.bottom > ir.top && rr.top < ir.bottom + 8;
    if (rr.top < 0 || rr.bottom > innerHeight || under) return false;

    const cs = getComputedStyle(input);
    const fromSize = parseFloat(cs.fontSize) || 28;
    const toSize = parseFloat(getComputedStyle(name).fontSize) || 24;
    const from = { x: ir.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), y: ir.top + ir.height / 2 };
    const to = { x: nr.left, y: nr.top + Math.min(nr.height, toSize * 1.15) / 2 };
    const tentacle = rank <= 2;
    const color = limbColor(rank);

    // The word, cut out of the guess box as a tile, sitting where it was typed until the club takes it.
    const tile = document.createElement("div");
    tile.className = "grab-word";
    tile.style.setProperty("--limb", color);
    const label = document.createElement("span");
    label.className = "grab-text";
    label.textContent = text;
    label.style.fontSize = `${fromSize}px`;
    tile.appendChild(label);
    tile.style.transform = `translate(${from.x}px, ${from.y}px)`;
    this.layer.appendChild(tile);

    const g: Grab = {
      rank,
      color,
      t: 0,
      waiting: wait > 0,
      wait,
      // Struck from close by after a dart: a shorter reach.
      reach: wait > 0 ? 0.14 : tentacle ? 0.16 : 0.24,
      grip: tentacle ? 0.1 : 0.07,
      carry: 0.28,
      set: 0.07,
      back: 0.22,
      from,
      to,
      fromSize,
      toSize,
      tile,
      row,
      rowRect: rr,
      input,
      hide: null,
      x: new Float32Array(N),
      y: new Float32Array(N),
      ox: new Float32Array(N),
      oy: new Float32Array(N),
      landed: false,
      lastTip: from,
    };
    this.list.push(g);
    if (!g.waiting) this.strike(g);

    // The box's placeholder would show through where the word was: keep it hidden until the club takes the word.
    input.dataset.grabbing = "";
    row.dataset.grabbing = "";
    // The real name waits for the word to land (a hold, cancelled as it lands; capped, in case the ocean stops).
    const most = (wait + g.reach + g.grip + g.carry + g.set + 0.3) * 1000;
    if (typeof name.animate === "function") g.hide = name.animate([{ opacity: 0 }, { opacity: 0 }], { duration: most });
    return true;
  }

  /** The limb leaves the ocean: its rope starts at the squid's root for it. */
  private strike(g: Grab) {
    g.waiting = false;
    g.t = 0;
    const root = this.host.rootOf(g.rank);
    for (let i = 0; i < N; i++) {
      g.x[i] = g.ox[i] = root.x;
      g.y[i] = g.oy[i] = root.y;
    }
    this.host.away(g.rank, true);
  }

  /** The word is set: the row's text shows, and a splash of the limb's light runs across the row. */
  private land(g: Grab) {
    g.hide?.cancel();
    g.hide = null;
    const name = g.row.querySelector<HTMLElement>(".name");
    if (name && typeof name.animate === "function") name.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 60 });
    const rr = g.rowRect;
    const splash = document.createElement("div");
    splash.className = "grab-splash";
    splash.style.setProperty("--limb", g.color);
    Object.assign(splash.style, { left: `${rr.left}px`, top: `${rr.top}px`, width: `${rr.width}px`, height: `${rr.height}px` });
    this.layer.appendChild(splash);
    if (typeof splash.animate === "function")
      splash.animate([{ opacity: 0 }, { opacity: 1, offset: 30 / 360 }, { opacity: 0 }], { duration: 360, fill: "both", easing: "steps(8, end)" });
    setTimeout(() => splash.remove(), 400);
  }

  /** Where the club is (CSS px) and how far out toward the viewer the limb is (0-1), at time t into grab g. */
  private tip(g: Grab, base: P): { p: P; out: number; tug: number } {
    let t = g.t;
    if (t < g.reach) {
      // The strike: fast out, easing in to the word.
      const s = easeOut(t / g.reach);
      return { p: { x: base.x + (g.from.x - HOLD - base.x) * s, y: base.y + (g.from.y - base.y) * s }, out: s, tug: 0 };
    }
    t -= g.reach;
    const hold = { x: g.from.x - HOLD, y: g.from.y };
    if (t < g.grip) {
      // Clamped on: a tug (the feeding tentacles strain harder).
      const s = t / g.grip;
      const k = g.rank <= 2 ? 3 : 1.5;
      return { p: { x: hold.x + Math.sin(s * Math.PI * 4) * k, y: hold.y - Math.sin(s * Math.PI) * 2 }, out: 1, tug: 1 };
    }
    t -= g.grip;
    const dest = { x: g.to.x - HOLD, y: g.to.y };
    if (t < g.carry) {
      // Carried up in an arc that swings toward the viewer (the tile grows a little on the way).
      const s = easeInOut(t / g.carry);
      const lift = Math.max(40, Math.abs(dest.y - hold.y) * 0.22);
      const mx = (hold.x + dest.x) / 2 + 30;
      const my = (hold.y + dest.y) / 2 - lift;
      const u = 1 - s;
      return {
        p: { x: u * u * hold.x + 2 * u * s * mx + s * s * dest.x, y: u * u * hold.y + 2 * u * s * my + s * s * dest.y },
        out: 1,
        tug: Math.sin(s * Math.PI),
      };
    }
    t -= g.carry;
    if (t < g.set) return { p: dest, out: 1, tug: 0 };
    t -= g.set;
    // Back behind the glass, quicker as it goes.
    const s = easeIn(clamp01(t / g.back));
    return { p: { x: dest.x + (base.x - dest.x) * s, y: dest.y + (base.y - dest.y) * s }, out: 1 - s, tug: 0 };
  }

  step(dt: number, now: number) {
    if (!this.list.length) return;
    const px = this.host.px();
    for (const g of [...this.list]) {
      g.t += dt;
      if (g.waiting) {
        if (g.t >= g.wait || this.host.ready()) this.strike(g);
        else continue;
      }
      const total = g.reach + g.grip + g.carry + g.set + g.back;
      const landAt = g.reach + g.grip + g.carry + g.set;
      const rootC = this.host.rootOf(g.rank);
      const base = { x: rootC.x * px, y: rootC.y * px };
      const { p, tug } = this.tip(g, base);
      g.lastTip = p;

      if (g.t >= g.reach + g.grip && g.input.dataset.grabbing !== undefined) delete g.input.dataset.grabbing;
      // The word rides the club; it swells a little as it swings toward the viewer, then shrinks to the row's size.
      if (g.t >= g.reach && !g.landed) {
        const c = clamp01((g.t - g.reach - g.grip) / g.carry);
        const size = g.fromSize + (g.toSize - g.fromSize) * easeInOut(c);
        const swell = 1 + 0.18 * tug;
        g.tile.style.transform = `translate(${p.x + HOLD}px, ${p.y}px) scale(${((size / g.fromSize) * swell).toFixed(3)})`;
      }
      if (g.t >= landAt && !g.landed) {
        g.landed = true;
        g.tile.style.transform = `translate(${g.to.x}px, ${g.to.y}px) scale(${(g.toSize / g.fromSize).toFixed(3)})`;
        g.tile.classList.add("landed");
        delete g.row.dataset.grabbing;
        setTimeout(() => g.tile.remove(), 200);
        this.land(g);
        this.host.lit(g.rank);
      }

      // The rope: both ends pinned, relaxed toward even spacing a little longer than straight, so it bows and ripples.
      const tx = p.x / px;
      const ty = p.y / px;
      const bx = rootC.x;
      const by = rootC.y;
      g.x[0] = bx;
      g.y[0] = by;
      g.x[N - 1] = tx;
      g.y[N - 1] = ty;
      const len = (Math.hypot(tx - bx, ty - by) * 1.07) / (N - 1);
      const nx = -(ty - by);
      const ny = tx - bx;
      const nl = Math.hypot(nx, ny) || 1;
      const f = Math.min(3, dt * 30);
      for (let i = 1; i < N - 1; i++) {
        const vx = (g.x[i] - g.ox[i]) * 0.55;
        const vy = (g.y[i] - g.oy[i]) * 0.55;
        g.ox[i] = g.x[i];
        g.oy[i] = g.y[i];
        const ripple = Math.sin(now * 0.016 - i * 0.7) * 0.25 * f * Math.sin((Math.PI * i) / (N - 1));
        // A gentle pull toward its share of the line from the squid to the club, so it unfurls without kinks.
        const u = i / (N - 1);
        const pull = Math.min(0.6, (g.t < g.reach ? 0.45 : 0.3) * f);
        g.x[i] += vx + (nx / nl) * ripple + (bx + (tx - bx) * u - g.x[i]) * pull;
        g.y[i] += vy + (ny / nl) * ripple + (by + (ty - by) * u - g.y[i]) * pull;
      }
      for (let k = 0; k < 4; k++) {
        for (let i = 0; i < N - 1; i++) {
          const dx = g.x[i + 1] - g.x[i];
          const dy = g.y[i + 1] - g.y[i];
          const d = Math.hypot(dx, dy) || 1e-3;
          const diff = (d - len) / d / 2;
          const a = i === 0 ? 0 : 1;
          const b = i + 1 === N - 1 ? 0 : 1;
          const w = a + b || 1;
          g.x[i] += (dx * diff * 2 * a) / w;
          g.y[i] += (dy * diff * 2 * a) / w;
          g.x[i + 1] -= (dx * diff * 2 * b) / w;
          g.y[i + 1] -= (dy * diff * 2 * b) / w;
        }
      }

      if (g.t >= total) {
        this.host.away(g.rank, false);
        g.tile.remove();
        this.list.splice(this.list.indexOf(g), 1);
      }
    }
    this.dirty = true;
  }

  draw() {
    if (!this.dirty) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = this.list.length > 0;
    const out = this.rects;
    for (const g of this.list) {
      if (g.waiting) continue;
      const landAt = g.reach + g.grip + g.carry + g.set;
      const base = { x: g.x[0] * this.host.px(), y: g.y[0] * this.host.px() };
      const out01 = this.tip(g, base).out;
      const lit = g.t >= landAt;
      const since = g.t - landAt;
      const face = lit ? (since < 0.25 ? mix("#ffffff", g.color, since / 0.25) : g.color) : UNLIT;
      const core = lit ? mix(g.color, "#ffffff", 0.55) : UNLIT_CORE;
      // Thin where it leaves the squid, thick toward the tip as it comes toward the viewer; dim behind the glass.
      const tipW = 1 + 4.4 * out01 + (g.rank <= 2 ? 1 * out01 : 0);
      strokeChain(
        out,
        g.x,
        g.y,
        N,
        (s) => 1 + (tipW - 1) * s ** 1.6,
        (s) => (s < 0.28 ? mix(face, NIGHT, 0.55 * (1 - s / 0.28)) : face),
        (s) => (s < 0.28 ? mix(core, NIGHT, 0.55 * (1 - s / 0.28)) : core),
      );
      // Suckers along the inner edge of the club end.
      if (out01 > 0.4) {
        for (const i of [N - 2, N - 4, N - 6]) {
          const dx = g.x[i + 1] - g.x[i - 1];
          const dy = g.y[i + 1] - g.y[i - 1];
          const d = Math.hypot(dx, dy) || 1;
          const w = (1 + (tipW - 1) * (i / (N - 1)) ** 1.6) / 2 + 0.5;
          out.add(SUCKER, Math.round(g.x[i] + (dy / d) * w - 0.5), Math.round(g.y[i] - (dx / d) * w - 0.5), 1);
        }
      }
    }
    out.flush(ctx);
  }

  clear() {
    for (const g of this.list) {
      g.tile.remove();
      g.hide?.cancel();
      delete g.row.dataset.grabbing;
      delete g.input.dataset.grabbing;
      this.host.away(g.rank, false);
    }
    this.list = [];
    this.dirty = true;
    this.draw();
  }
}
