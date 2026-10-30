/**
 * The ocean's one-off effects, in canvas px (the same low resolution as the scene, so they are chunky pixels too):
 * - ink: pixel ink blobs that swell, drift and fade out through dither steps (in front of the squid);
 * - rings and sparks: the glow pulse of a find, the perfect-10 burst, the personal-best flare (in front);
 * - blooms: soft light behind the squid (behind it);
 * - bubbles: a dozing squid's breath (in front).
 * All behind the UI: the canvases are part of the ocean layer.
 */
import { glowSprite } from "./scene";

type Ctx = CanvasRenderingContext2D;

interface Blob {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  t: number;
  life: number;
  tone: number;
  delay: number;
}
interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  t: number;
  life: number;
  color: string;
  delay: number;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  color: string;
  delay: number;
}
interface Bloom {
  x: number;
  y: number;
  size: number;
  t: number;
  life: number;
  sprite: HTMLCanvasElement;
  peak: number;
}
interface Bubble {
  x: number;
  y: number;
  t: number;
  life: number;
  phase: number;
}

/** Ink: deep indigo, a lighter violet, a flat shadow; with a pink gloss pixel on top. */
const INK = ["#1a0f36", "#2a1650", "#0d0720"];
const GLOSS = "#ff8cbe";

/** 4 x 4 dither masks for 1/4, 2/4 and 3/4 coverage (levels 0, 1, 2; level 3 is solid). */
const MASKS = [
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1],
  [1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1],
];

export class Fx {
  private blobs: Blob[] = [];
  private rings: Ring[] = [];
  private sparks: Spark[] = [];
  private blooms: Bloom[] = [];
  private bubbles: Bubble[] = [];
  private patterns = new Map<string, CanvasPattern | null>();
  private sprites = new Map<string, HTMLCanvasElement>();

  get front() {
    return this.blobs.length + this.rings.length + this.sparks.length + this.bubbles.length > 0;
  }

  get back() {
    return this.blooms.length > 0;
  }

  clear() {
    this.blobs = [];
    this.rings = [];
    this.sparks = [];
    this.blooms = [];
    this.bubbles = [];
  }

  /** An ink cloud at (x, y); `size` is the cloud's reach in canvas px. */
  ink(x: number, y: number, size: number, big: boolean) {
    const n = big ? 34 : 14;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() ** 0.7;
      const speed = size * (0.25 + 0.75 * d) * (big ? 0.9 : 1.1);
      this.blobs.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed * 0.8 - size * 0.08,
        r: Math.max(2, size * (big ? 0.22 : 0.2) * (0.5 + Math.random() * 0.7) * (1.2 - d * 0.5)),
        t: 0,
        life: (big ? 4.2 : 2.2) * (0.75 + Math.random() * 0.4),
        tone: k % 3 === 0 ? 1 : k % 4 === 0 ? 2 : 0,
        delay: d * (big ? 0.25 : 0.12),
      });
    }
  }

  ring(x: number, y: number, r0: number, r1: number, color: string, life = 0.6, delay = 0) {
    this.rings.push({ x, y, r0, r1, t: 0, life, color, delay });
  }

  sparksAt(x: number, y: number, n: number, reach: number, colors: string[], delay = 0) {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.3;
      const v = reach * (0.6 + Math.random() * 0.6) * 1.8;
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.7 + Math.random() * 0.5, color: colors[k % colors.length], delay });
    }
  }

  bloom(x: number, y: number, size: number, color: string, life = 0.8, peak = 0.9) {
    let sprite = this.sprites.get(color);
    if (!sprite) this.sprites.set(color, (sprite = glowSprite(color, 16)));
    this.blooms.push({ x, y, size, t: 0, life, sprite, peak });
  }

  bubble(x: number, y: number) {
    this.bubbles.push({ x, y, t: 0, life: 2.6, phase: Math.random() * 6 });
  }

  step(dt: number) {
    const keep = <T extends { t: number; life: number; delay?: number }>(list: T[]) =>
      list.filter((p) => (p.t += dt) < p.life + (p.delay ?? 0));
    for (const b of this.blobs) {
      if (b.t < b.delay) continue;
      const drag = Math.exp(-2.2 * dt);
      b.vx *= drag;
      b.vy = b.vy * drag - 1.2 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    for (const s of this.sparks) {
      if (s.t < s.delay) continue;
      const drag = Math.exp(-3 * dt);
      s.vx *= drag;
      s.vy = s.vy * drag + 6 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    for (const b of this.bubbles) b.y -= 7 * dt;
    this.blobs = keep(this.blobs);
    this.rings = keep(this.rings);
    this.sparks = keep(this.sparks);
    this.blooms = keep(this.blooms);
    this.bubbles = keep(this.bubbles);
  }

  /** Behind the squid: blooms. */
  drawBack(ctx: Ctx) {
    for (const b of this.blooms) {
      const s = b.t / b.life;
      ctx.globalAlpha = b.peak * (s < 0.15 ? s / 0.15 : 1 - (s - 0.15) / 0.85);
      const size = Math.round(b.size * (0.8 + 0.4 * s));
      ctx.drawImage(b.sprite, Math.round(b.x - size / 2), Math.round(b.y - size / 2), size, size);
    }
    ctx.globalAlpha = 1;
  }

  /** In front of the squid: ink, rings, sparks, bubbles. */
  drawFront(ctx: Ctx) {
    for (const b of this.blobs) {
      if (b.t < b.delay) continue;
      const s = (b.t - b.delay) / b.life;
      const r = Math.round(b.r * Math.min(1, 0.3 + s * 3));
      // Solid at first, then 3/4, 2/4, 1/4 coverage as it thins out.
      const level = s < 0.45 ? 3 : s < 0.65 ? 2 : s < 0.85 ? 1 : 0;
      ctx.fillStyle = level === 3 ? INK[b.tone] : this.pattern(ctx, INK[b.tone], level);
      disc(ctx, Math.round(b.x), Math.round(b.y), r);
      if (level >= 2 && b.tone !== 2 && r >= 3) {
        ctx.fillStyle = GLOSS;
        ctx.globalAlpha = level === 3 ? 0.75 : 0.4;
        ctx.fillRect(Math.round(b.x - r * 0.45), Math.round(b.y - r * 0.5), r > 5 ? 2 : 1, 1);
        ctx.globalAlpha = 1;
      }
    }
    for (const ring of this.rings) {
      if (ring.t < ring.delay) continue;
      const s = (ring.t - ring.delay) / ring.life;
      const r = Math.round(ring.r0 + (ring.r1 - ring.r0) * (1 - (1 - s) ** 2));
      ctx.globalAlpha = Math.max(0, 1 - s) ** 0.8;
      ctx.fillStyle = ring.color;
      circle(ctx, Math.round(ring.x), Math.round(ring.y), r);
    }
    for (const sp of this.sparks) {
      if (sp.t < sp.delay) continue;
      const s = (sp.t - sp.delay) / sp.life;
      ctx.globalAlpha = s < 0.7 ? 1 : (1 - s) / 0.3;
      ctx.fillStyle = sp.color;
      ctx.fillRect(Math.round(sp.x), Math.round(sp.y), 1, 1);
    }
    ctx.fillStyle = "#9fe6f7";
    for (const b of this.bubbles) {
      const s = b.t / b.life;
      ctx.globalAlpha = 0.7 * (1 - s);
      const x = Math.round(b.x + Math.sin(b.t * 3 + b.phase) * 1.2);
      const y = Math.round(b.y);
      const big = s > 0.4;
      if (big) {
        ctx.fillRect(x, y - 1, 1, 1);
        ctx.fillRect(x - 1, y, 1, 1);
        ctx.fillRect(x + 1, y, 1, 1);
        ctx.fillRect(x, y + 1, 1, 1);
      } else ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  private pattern(ctx: Ctx, color: string, level: number): CanvasPattern | string {
    const key = `${color}${level}`;
    if (!this.patterns.has(key)) {
      const c = document.createElement("canvas");
      c.width = c.height = 4;
      const p = c.getContext("2d")!;
      p.fillStyle = color;
      MASKS[level].forEach((on, i) => on && p.fillRect(i % 4, Math.floor(i / 4), 1, 1));
      this.patterns.set(key, ctx.createPattern(c, "repeat"));
    }
    return this.patterns.get(key) ?? color;
  }
}

/** A filled pixel disc, one rect per row. */
function disc(ctx: Ctx, cx: number, cy: number, r: number) {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35);
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

/** A one-pixel circle outline (midpoint circle). */
function circle(ctx: Ctx, cx: number, cy: number, r: number) {
  let x = r;
  let y = 0;
  let err = 1 - r;
  while (x >= y) {
    for (const [px, py] of [
      [x, y],
      [y, x],
      [-y, x],
      [-x, y],
      [-x, -y],
      [-y, -x],
      [y, -x],
      [x, -y],
    ])
      ctx.fillRect(cx + px, cy + py, 1, 1);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}
