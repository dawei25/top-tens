/**
 * The roaming squid, drawn on the ocean's low-res canvas: the mantle from sprite.ts's pixel grid, and ten long
 * procedural limbs.
 *
 * Mantle: the grid is rotated and squashed per frame by sampling it through the inverse transform, from a Scale2x
 * (EPX) upscale so small details (eyes, the fin edges) survive rotation, as RotSprite does. Fins have three frames
 * (spread, half, folded): they flap slowly while it hovers and fold flat on a jet. Palettes follow its mood: a
 * switched-off neon squid, brighter with Blitz momentum, lit up on a perfect 10, dimmed when down or dozing.
 *
 * Limbs: each a chain of 8 to 15 nodes pinned at the head, moved by Verlet integration with water damping
 * (Jakobsen, "Advanced Character Physics", 2001) and pulled gently toward a rest pose, then put back at fixed
 * distances from root to tip (a follow-the-leader distance constraint). The rest pose fans the arms out and
 * ripples them with a travelling sine wave, one phase per limb; on a jet it closes them into a streamlined cone
 * behind the mantle, then opens them again through the glide. Inertia does the rest: they trail on a jet, swing
 * on when it stops, and rest on the seabed when it dozes. The two feeding tentacles (#1 and #2) are the longest,
 * with clubs.
 *
 * Everything is drawn as whole pixels: tapered strokes stamped along each segment, batched into one path per colour.
 */
import { BODY, LIMB_ROOTS } from "../squid/sprite";
import { limbColor, mix } from "../squid/colors";
import type { SquidMood } from "../squid/Squid";
import { glowSprite } from "./scene";

type Ctx = CanvasRenderingContext2D;

/** The mantle's pivot in sprite px (the middle of the mantle). */
const PIVOT_X = 10;
const PIVOT_Y = 7;
const W = BODY[0].length;
const H = BODY.length;

export interface Pose {
  /** Canvas px. */
  x: number;
  y: number;
  /** Radians, clockwise; 0 is upright. */
  angle: number;
  sx: number;
  sy: number;
}

export interface Look {
  lit: ReadonlySet<number>;
  mood: SquidMood;
  heat: number;
  doze: boolean;
}

/** What the limbs are doing this frame, from the swim. */
export interface Motion {
  /** Seconds since the last jet. */
  jetAge: number;
  /** 0-1 while the mantle fills for a jet. */
  inflating: number;
  hovering: boolean;
  asleep: boolean;
}

interface Limb {
  id: number;
  tentacle: boolean;
  /** Root on the sprite, relative to the pivot. */
  u: number;
  v: number;
  /** Rest angle from straight down (body space), and how far the tip curls. */
  rest: number;
  curl: number;
  n: number;
  seg: number;
  phase: number;
  x: Float32Array;
  y: Float32Array;
  ox: Float32Array;
  oy: Float32Array;
}

/* ---------------------------------------------------------------- palettes */

type Tone = "rim" | "left" | "right" | "spot" | "eye" | "pupil" | "lid";
type Palette = Record<Tone, string>;
const NORMAL: Palette = { rim: "#2a8aa2", left: "#15465a", right: "#0f3445", spot: "#2d93ad", eye: "#a6f1ff", pupil: "#06101e", lid: "#2a8aa2" };
const WON: Palette = { rim: "#d4faff", left: "#5fe6ff", right: "#29b7df", spot: "#ffffff", eye: "#c8f8ff", pupil: "#0b2a4a", lid: "#d4faff" };
const NIGHT = "#050a14";
const mapPal = (p: Palette, f: (c: string, k: Tone) => string): Palette =>
  Object.fromEntries(Object.entries(p).map(([k, c]) => [k, f(c, k as Tone)])) as Palette;

/** Unlit limbs: the switched-off teal of the body, alternating two shades limb to limb so neighbours read apart. */
const UNLIT = ["#1d6f86", "#14536a"];
const UNLIT_CORE = ["#2a8aa2", "#1f6f86"];
const SUCKER = "#ff5d8f";

/* ---------------------------------------------------------------- the mantle grid */

/** Each pixel's tone, for one fin frame: fins keep only their pixels within `reach` of the body on their row. */
function toneGrid(reach: number): (Tone | null)[] {
  const keep = (x: number, y: number) => {
    const c = BODY[y]?.[x];
    if (!c || c === ".") return false;
    if (c !== "f") return true;
    let d = 1;
    while (d <= W && BODY[y][x - d] !== "#" && BODY[y][x + d] !== "#") d++;
    return d <= reach;
  };
  const out: (Tone | null)[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = BODY[y][x];
      if (!keep(x, y)) out.push(null);
      else if (c === "e") out.push("eye");
      else if (c === "p") out.push("pupil");
      else if (c === "s") out.push("spot");
      else if (!keep(x, y - 1) || !keep(x - 1, y) || !keep(x + 1, y)) out.push("rim");
      else out.push(x < W / 2 ? "left" : "right");
    }
  }
  return out;
}
const FIN_FRAMES = [toneGrid(99), toneGrid(2), toneGrid(1)];
/** The top row of each eye, closed over when the lids are down. */
const LID = new Set<number>();
for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) if ("ep".includes(BODY[y][x]) && BODY[y - 1][x] === "#") LID.add(y * W + x);

const rgba = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  // Little-endian RGBA in one 32-bit word.
  return (0xff << 24) | ((n & 0xff) << 16) | (n & 0xff00) | ((n >> 16) & 0xff);
};

/** Scale2x (EPX): doubles a pixel grid, rounding diagonal edges instead of blocking them. */
function scale2x(src: Uint32Array, w: number, h: number): Uint32Array {
  const out = new Uint32Array(w * h * 4);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : src[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = at(x, y);
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      const o = y * 2 * w * 2 + x * 2;
      out[o] = c === a && c !== d && a !== b ? a : p;
      out[o + 1] = a === b && a !== c && b !== d ? b : p;
      out[o + w * 2] = d === c && d !== b && c !== a ? c : p;
      out[o + w * 2 + 1] = b === d && b !== a && d !== c ? d : p;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- pixel strokes */

/** Rects to fill, batched by colour: one path (and one fill) per colour per frame. */
export class Rects {
  private by = new Map<string, number[]>();
  add(color: string, x: number, y: number, w: number, h = w) {
    let list = this.by.get(color);
    if (!list) this.by.set(color, (list = []));
    list.push(x, y, w, h);
  }
  flush(ctx: Ctx) {
    for (const [color, r] of this.by) {
      if (!r.length) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < r.length; i += 4) ctx.rect(r[i], r[i + 1], r[i + 2], r[i + 3]);
      ctx.fill();
      r.length = 0;
    }
  }
}

/**
 * A tapered pixel stroke along a chain of points: a `width(s)`-px square stamped every half pixel (s from 0 at the
 * root to 1 at the tip), with a one-pixel bright core where it is two or more wide.
 */
export function strokeChain(
  out: Rects,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  n: number,
  width: (s: number) => number,
  face: (s: number) => string,
  core: ((s: number) => string) | null,
) {
  let lx = NaN;
  let ly = NaN;
  let lw = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = xs[i];
    const ay = ys[i];
    const dx = xs[i + 1] - ax;
    const dy = ys[i + 1] - ay;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2));
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      const s = (i + f) / (n - 1);
      const w = Math.max(1, Math.round(width(s)));
      const cx = ax + dx * f;
      const cy = ay + dy * f;
      const x = Math.round(cx - w / 2);
      const y = Math.round(cy - w / 2);
      if (x === lx && y === ly && w === lw) continue;
      lx = x;
      ly = y;
      lw = w;
      out.add(face(s), x, y, w);
      if (core && w >= 2) out.add(core(s), Math.round(cx - 0.5), Math.round(cy - 0.5), 1);
    }
  }
}

/* ---------------------------------------------------------------- the squid */

export class SquidBody {
  pose: Pose = { x: 0, y: 0, angle: 0, sx: 1, sy: 1 };
  /** Limbs out of the ocean (reaching through the glass for a word): not drawn here meanwhile. */
  readonly away = new Set<number>();
  private limbs: Limb[];
  private cache = new Map<string, Uint32Array>();
  private scratch: HTMLCanvasElement;
  private sctx: Ctx;
  private img: ImageData;
  private buf: Uint32Array;
  private glow = new Map<string, HTMLCanvasElement>();
  private litAt = new Map<number, number>();
  private known = new Set<number>();
  private rects = new Rects();
  private placed = false;

  constructor() {
    this.limbs = LIMB_ROOTS.map((r) => {
      const tentacle = r.id <= 2;
      // Tentacles longest; then the middle arms, the outer ones a little shorter.
      const n = tentacle ? 16 : r.id === 3 || r.id === 10 ? 11 : r.id === 4 || r.id === 9 ? 12 : 13;
      const seg = tentacle ? 2.05 : 1.8;
      const rest = tentacle ? (r.id === 1 ? -0.08 : 0.08) : r.angle * 1.6;
      return {
        id: r.id,
        tentacle,
        u: r.x - PIVOT_X,
        v: r.y - PIVOT_Y,
        rest,
        curl: tentacle ? 0.12 : 0.35,
        n,
        seg,
        phase: r.id * 1.9,
        x: new Float32Array(n),
        y: new Float32Array(n),
        ox: new Float32Array(n),
        oy: new Float32Array(n),
      };
    });
    this.scratch = document.createElement("canvas");
    this.scratch.width = this.scratch.height = 48;
    this.sctx = this.scratch.getContext("2d")!;
    this.img = this.sctx.createImageData(48, 48);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  /** Where limb `id` leaves the head, in canvas px. */
  rootOf(id: number) {
    const l = this.limbs.find((m) => m.id === id)!;
    return this.toWorld(l.u, l.v);
  }

  private toWorld(u: number, v: number) {
    const { x, y, angle, sx, sy } = this.pose;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: x + u * sx * c - v * sy * s, y: y + u * sx * s + v * sy * c };
  }

  /** The rest pose of limb `l`'s node j: its heading from straight down, in body space. */
  private heading(l: Limb, j: number, t: number, m: Motion) {
    const s = j / (l.n - 1);
    // Bunched into a cone on the jet, opening over the glide; wider as the mantle fills; splayed asleep.
    let spread = 1 - 0.85 * Math.exp(-m.jetAge * 1.7);
    spread *= 1 + 0.4 * m.inflating;
    if (m.asleep) spread = 1.5;
    const swimming = m.jetAge < 1.2;
    const amp = (m.asleep ? 0.1 : swimming ? 0.22 : 0.3) * (l.tentacle ? 0.8 : 1);
    const wave = amp * s * Math.sin(t * (m.hovering ? 1.6 : 2.6) - j * 0.55 + l.phase);
    const curl = l.curl * s * s * Math.sign(l.rest || 1) * (0.6 + 0.4 * Math.sin(t * 0.6 + l.phase));
    return l.rest * spread + curl + wave;
  }

  /** Put every limb in its rest pose at once (first frame, a resize, reduced motion). */
  settle(t: number, m: Motion) {
    this.fin = this.finFrame(t, m);
    for (const l of this.limbs) {
      const r = this.toWorld(l.u, l.v);
      let px = r.x;
      let py = r.y;
      for (let j = 0; j < l.n; j++) {
        if (j > 0) {
          const h = this.heading(l, j, t, m) - this.pose.angle;
          px += Math.sin(h) * l.seg;
          py += Math.cos(h) * l.seg;
        }
        l.x[j] = l.ox[j] = px;
        l.y[j] = l.oy[j] = py;
      }
    }
    this.placed = true;
  }

  /**
   * One physics step: Verlet with water drag and a pull toward the rest pose, then the distance constraints. With
   * `floor`, the limbs rest on the seabed (dozing).
   */
  step(dt: number, t: number, m: Motion, floor: ((x: number) => number) | null) {
    if (!this.placed) return this.settle(t, m);
    this.fin = this.finFrame(t, m);
    const f = Math.min(3, dt * 30);
    const damp = Math.pow(0.86, f);
    for (const l of this.limbs) {
      const r = this.toWorld(l.u, l.v);
      l.x[0] = l.ox[0] = r.x;
      l.y[0] = l.oy[0] = r.y;
      let rx = r.x;
      let ry = r.y;
      for (let j = 1; j < l.n; j++) {
        const h = this.heading(l, j, t, m) - this.pose.angle;
        rx += Math.sin(h) * l.seg;
        ry += Math.cos(h) * l.seg;
        const s = j / (l.n - 1);
        // Stiffer near the root, loose at the tip: the tips lag, swing and settle last.
        const k = Math.min(0.6, (0.2 * (1 - s) ** 1.2 + 0.045) * f);
        const vx = (l.x[j] - l.ox[j]) * damp;
        const vy = (l.y[j] - l.oy[j]) * damp;
        l.ox[j] = l.x[j];
        l.oy[j] = l.y[j];
        l.x[j] += vx + (rx - l.x[j]) * k;
        l.y[j] += vy + (ry - l.y[j]) * k;
      }
      // Distance constraints, root to tip (the root is pinned, so one pass settles them).
      for (let j = 1; j < l.n; j++) {
        const dx = l.x[j] - l.x[j - 1];
        const dy = l.y[j] - l.y[j - 1];
        const d = Math.hypot(dx, dy) || 1;
        l.x[j] = l.x[j - 1] + (dx / d) * l.seg;
        l.y[j] = l.y[j - 1] + (dy / d) * l.seg;
        if (floor) {
          const fy = floor(l.x[j]);
          if (l.y[j] > fy) l.y[j] = fy;
        }
      }
    }
  }

  /** Note limbs newly lit (outside a grab), so they flash white-hot as they come on. */
  noteLit(lit: ReadonlySet<number>, t: number, flash: boolean) {
    for (const id of lit) if (!this.known.has(id) && flash) this.litAt.set(id, t);
    this.known = new Set(lit);
  }

  /** A limb comes on now (the grab set its word): it flashes into its colour. */
  flash(id: number, t: number) {
    this.litAt.set(id, t);
  }

  draw(ctx: Ctx, t: number, look: Look) {
    const { pose } = this;
    const dim = look.mood === "lost" ? 0.5 : look.mood === "gave-up" ? 0.32 : look.doze ? 0.2 : 0;
    const charge = look.lit.size / 10;

    // Glow, under everything: the body's halo grows with the lit limbs and the momentum.
    const halo = look.mood === "won" ? 0.85 : Math.min(0.9, 0.16 + charge * 0.4 + look.heat * 0.12) * (1 - dim);
    this.glowAt(ctx, look.mood === "won" || look.heat >= 4 ? "#bff6ff" : "#4de3ff", pose.x, pose.y, 30, halo);

    const colorOf = (id: number) => {
      if (!look.lit.has(id)) return null;
      let c: string = limbColor(id);
      const since = this.litAt.get(id);
      if (since !== undefined && t - since < 0.45) c = mix("#ffffff", c, (t - since) / 0.45);
      return dim ? mix(c, NIGHT, dim) : c;
    };

    for (const l of this.limbs) {
      if (!look.lit.has(l.id) || this.away.has(l.id)) continue;
      // Glow in the limb's own colour (never the passing flash tint: the sprites are cached by colour).
      const c = limbColor(l.id);
      const mid = l.n >> 1;
      this.glowAt(ctx, c, l.x[mid], l.y[mid], 8, 0.5 * (1 - dim));
      this.glowAt(ctx, c, l.x[l.n - 1], l.y[l.n - 1], 8, 0.45 * (1 - dim));
    }

    const out = this.rects;
    for (const l of this.limbs) {
      if (this.away.has(l.id)) continue;
      const c = colorOf(l.id);
      const shade = l.id % 2;
      const face = c ?? (dim ? mix(UNLIT[shade], NIGHT, dim) : UNLIT[shade]);
      const core = c ? mix(c, "#ffffff", 0.55) : dim ? mix(UNLIT_CORE[shade], NIGHT, dim) : UNLIT_CORE[shade];
      const clubFrom = l.tentacle ? 1 - 3 / (l.n - 1) : 2;
      strokeChain(
        out,
        l.x,
        l.y,
        l.n,
        l.tentacle ? (s) => (s >= clubFrom ? 2 : 1) : (s) => (s < 0.55 ? 2 : 1),
        () => face,
        () => core,
      );
      if (l.tentacle) {
        // The club's suckers, on its inner side.
        const j = l.n - 2;
        const side = l.id === 1 ? 1 : -1;
        const nx = -(l.y[j + 1] - l.y[j - 1]);
        const ny = l.x[j + 1] - l.x[j - 1];
        const d = Math.hypot(nx, ny) || 1;
        out.add(dim ? mix(SUCKER, NIGHT, dim) : SUCKER, Math.round(l.x[j] + (nx / d) * side * 1.5 - 0.5), Math.round(l.y[j] + (ny / d) * side * 1.5 - 0.5), 1);
      }
    }
    out.flush(ctx);

    // The mantle, over the limbs' roots.
    this.drawMantle(ctx, look, dim);
  }

  /** A soft glow, from sprites cached per colour and size, so each frame only copies them (never scales). */
  private glowAt(ctx: Ctx, color: string, x: number, y: number, size: number, alpha: number) {
    if (alpha <= 0.01) return;
    const key = `${color}${size}`;
    let g = this.glow.get(key);
    if (!g) this.glow.set(key, (g = glowSprite(color, size >> 1)));
    ctx.globalAlpha = alpha;
    ctx.drawImage(g, Math.round(x - g.width / 2), Math.round(y - g.height / 2));
    ctx.globalAlpha = 1;
  }

  /** Fin frame: folded flat on a jet, a slow flap (spread, half, folded, half) while hovering, a ripple gliding. */
  private finFrame(t: number, m: Motion) {
    if (m.jetAge < 0.5) return 2;
    if (m.asleep) return 1;
    if (m.hovering) return [0, 1, 2, 1][Math.floor(t * 4.5) % 4];
    return [0, 1][Math.floor(t * 2.5) % 2];
  }
  private fin = 0;

  private palette(look: Look, dim: number): { key: string; pal: Palette } {
    if (look.mood === "won") return { key: "won", pal: WON };
    if (dim) return { key: `dim${dim}`, pal: mapPal(NORMAL, (c) => mix(c, NIGHT, dim)) };
    const h = look.heat;
    if (!h) return { key: "n", pal: NORMAL };
    return { key: `h${h}`, pal: mapPal(NORMAL, (c, k) => (k === "pupil" ? c : mix(c, WON[k], h * 0.16))) };
  }

  private sprite(look: Look, dim: number): Uint32Array {
    const { key, pal } = this.palette(look, dim);
    const lids = look.doze || look.mood === "lost" || look.mood === "gave-up";
    const id = `${key}|${this.fin}|${lids}`;
    let s = this.cache.get(id);
    if (!s) {
      const tones = FIN_FRAMES[this.fin];
      const grid = new Uint32Array(W * H);
      tones.forEach((tone, i) => {
        if (!tone) return;
        grid[i] = rgba(pal[lids && LID.has(i) ? "lid" : tone]);
      });
      s = scale2x(grid, W, H);
      this.cache.set(id, s);
    }
    return s;
  }

  private drawMantle(ctx: Ctx, look: Look, dim: number) {
    const src = this.sprite(look, dim);
    const { x, y, angle, sx, sy } = this.pose;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const R = Math.ceil(Math.hypot(PIVOT_X, PIVOT_Y) * Math.max(sx, sy)) + 1;
    const x0 = Math.floor(x) - R;
    const y0 = Math.floor(y) - R;
    const size = Math.min(48, R * 2 + 2);
    const buf = this.buf;
    buf.fill(0);
    for (let j = 0; j < size; j++) {
      const dy = y0 + j + 0.5 - y;
      for (let i = 0; i < size; i++) {
        const dx = x0 + i + 0.5 - x;
        // Back through the rotation and squash, into the 2x sprite.
        const u = (dx * c + dy * s) / sx + PIVOT_X;
        const v = (-dx * s + dy * c) / sy + PIVOT_Y;
        if (u < 0 || v < 0 || u >= W || v >= H) continue;
        const p = src[Math.floor(v * 2) * W * 2 + Math.floor(u * 2)];
        if (p) buf[j * 48 + i] = p;
      }
    }
    this.sctx.putImageData(this.img, 0, 0, 0, 0, size, size);
    ctx.drawImage(this.scratch, 0, 0, size, size, x0, y0, size, size);
  }
}
