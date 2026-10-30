/**
 * The deep-sea backdrop, drawn on a low-resolution canvas (one canvas pixel is several CSS px, scaled up with
 * image-rendering: pixelated). Back to front: dithered water with light from far above, light shafts, a far ridge,
 * distant jellies, marine snow, a rocky middle ridge, swaying kelp, the seabed with glowing tips, near snow.
 *
 * Everything static is rendered once per size into offscreen canvases; a frame is a dozen drawImage calls plus a
 * few hundred 1-px rects (snow, kelp, jellies). The three ridges are tiles that drift slowly with the current, at
 * different speeds (parallax). Seeded, so a resize redraws the same world.
 */

type Ctx = CanvasRenderingContext2D;
type Rgb = [number, number, number];

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
/** Ordered-dither threshold for a pixel, in (0, 1). */
const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

const rgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return [c, c.getContext("2d")!];
}

/** Water, surface to floor: navy with a little light up top, down to near-black. Dithered between bands. */
const WATER = ["#173b62", "#133356", "#102b4b", "#0d2441", "#0b1e37", "#09182d", "#071324", "#050e1b", "#040a14", "#03070e", "#02050a"].map(rgb);

/** Ridge colours: [body, rim (lit top edge), shade under the rim]. Farther is lighter (haze), nearer darker. */
const FAR = ["#0a1a2f", "#132e4b", "#0d223a"];
const MID = ["#061323", "#11304e", "#0a2038"];
const NEAR = ["#030a14", "#0f2c44", "#071a2c"];

const KELP = ["#0b3236", "#0f4447", "#16605c"];
const TIP_COLORS = ["#4de3ff", "#ff5d8f", "#ffd166", "#4de3ff", "#b48cff"];

interface Ray {
  c: HTMLCanvasElement;
  phase: number;
  base: number;
}
interface Kelp {
  x: number;
  y: number;
  len: number;
  amp: number;
  phase: number;
  speed: number;
  tone: number;
}
interface Jelly {
  x: number;
  y: number;
  size: number;
  color: string;
  glow: HTMLCanvasElement;
  alpha: number;
  rise: number;
  sway: number;
  period: number;
  phase: number;
}
interface Tip {
  x: number;
  y: number;
  color: string;
  rate: number;
  phase: number;
}

/** Ridge drift with the current, in canvas px per second: far, middle, near. */
const DRIFT = [0.25, 0.6, 1.1];

export class Scene {
  w = 0;
  h = 0;
  private water!: HTMLCanvasElement;
  private rays: Ray[] = [];
  private ridges: HTMLCanvasElement[] = [];
  /** The near ridge's top edge per tile column, for rooting kelp and resting the squid. */
  private floor: Int16Array = new Int16Array(0);
  private kelp: Kelp[] = [];
  private jellies: Jelly[] = [];
  private tips: Tip[] = [];
  /** Snow, three depths: x, y, speed, wobble phase per flake. */
  private snow: Float32Array[] = [];

  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    const r = rng(1010);
    this.water = this.renderWater(w, h);
    this.rays = this.renderRays(w, h, r);
    const far = this.ridge(w, h, r, { top: 0.22, rough: 0.04, rocks: 3, rockR: [10, 20], colors: FAR });
    const mid = this.ridge(w, h, r, { top: 0.14, rough: 0.03, rocks: 6, rockR: [6, 14], colors: MID });
    const near = this.ridge(w, h, r, { top: 0.075, rough: 0.015, rocks: 4, rockR: [8, 18], colors: NEAR });
    this.ridges = [far.c, mid.c, near.c];
    this.floor = near.top;
    this.kelp = Array.from({ length: Math.round(w / 38) + 3 }, () => {
      const x = Math.floor(r() * w);
      return {
        x,
        y: near.top[x] + 3,
        len: Math.round(h * (0.12 + r() * 0.24)),
        amp: 1.5 + r() * 2.5,
        phase: r() * 6.28,
        speed: 0.6 + r() * 0.5,
        tone: r() < 0.5 ? 0 : 1,
      };
    });
    this.tips = [];
    // Glowing tips on little tube sponges along the seabed (the sponges themselves are baked into the near ridge).
    for (const s of near.sponges) this.tips.push({ x: s.x, y: s.y, color: TIP_COLORS[Math.floor(r() * TIP_COLORS.length)], rate: 0.4 + r() * 0.9, phase: r() * 6.28 });
    const jellyColors = ["#ff5d8f", "#4de3ff", "#ffd166", "#4de3ff", "#ff5d8f", "#b48cff"];
    this.jellies = Array.from({ length: w > 220 ? 5 : 3 }, (_, i) => {
      const color = jellyColors[i % jellyColors.length];
      return {
        x: r() * w,
        y: h * (0.12 + r() * 0.55),
        size: 5 + Math.floor(r() * 4) * 2,
        color,
        glow: glowSprite(color, 14),
        alpha: 0.32 + r() * 0.25,
        rise: 0.6 + r() * 1.1,
        sway: 2 + r() * 4,
        period: 2.6 + r() * 1.6,
        phase: r() * 10,
      };
    });
    const flakes = Math.round((w * h) / 420);
    this.snow = [0.6, 0.3, 0.1].map((share) => {
      const n = Math.max(4, Math.round(flakes * share));
      const a = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        a[i * 4] = r() * w;
        a[i * 4 + 1] = r() * h;
        a[i * 4 + 2] = 0.5 + r();
        a[i * 4 + 3] = r() * 6.28;
      }
      return a;
    });
  }

  /** The seabed's top edge (canvas px) under screen column x, at time t. */
  floorAt(x: number, t: number): number {
    const off = Math.floor(t * DRIFT[2]);
    const col = (((Math.floor(x) + off) % this.w) + this.w) % this.w;
    return this.floor[col] ?? this.h;
  }

  /** Advance the drifting bits by dt seconds (snow and jellies keep their own positions). */
  step(dt: number, t: number) {
    const { w, h } = this;
    const speeds = [1.1, 2.0, 3.4];
    this.snow.forEach((a, layer) => {
      const v = speeds[layer];
      const drift = DRIFT[layer];
      for (let i = 0; i < a.length; i += 4) {
        a[i + 1] += v * a[i + 2] * dt;
        a[i] += (Math.sin(t * 0.7 + a[i + 3]) * 0.35 - drift) * dt;
        if (a[i + 1] > h) {
          a[i + 1] -= h + 2;
          a[i] = Math.random() * w;
        }
        if (a[i] < -1) a[i] += w + 1;
      }
    });
    for (const j of this.jellies) {
      // Each bell contraction pushes it up a little: rise in pulses.
      const p = ((t + j.phase) % j.period) / j.period;
      const push = p < 0.25 ? 3 : 0.4;
      j.y -= j.rise * push * dt;
      j.x -= DRIFT[0] * dt;
      if (j.y < -j.size * 4) {
        j.y = h + j.size * 2;
        j.x = Math.random() * w;
      }
      if (j.x < -j.size * 2) j.x += w + j.size * 4;
    }
  }

  draw(ctx: Ctx, t: number) {
    ctx.globalAlpha = 1;
    ctx.drawImage(this.water, 0, 0);
    // Light from far above: shafts that breathe and lean a little.
    for (const ray of this.rays) {
      ctx.globalAlpha = ray.base * (0.55 + 0.45 * Math.sin(t * 0.19 + ray.phase));
      ctx.drawImage(ray.c, Math.round(Math.sin(t * 0.06 + ray.phase) * 2), 0);
    }
    ctx.globalAlpha = 1;
    this.tile(ctx, 0, t);
    this.drawSnow(ctx, 0, "#3f5f80");
    this.drawJellies(ctx, t);
    this.tile(ctx, 1, t);
    this.drawSnow(ctx, 1, "#7e9fbe");
    this.drawKelp(ctx, t);
    this.tile(ctx, 2, t);
    this.drawTips(ctx, t);
    this.drawSnow(ctx, 2, "#cde6f6");
    ctx.globalAlpha = 1;
  }

  private tile(ctx: Ctx, i: number, t: number) {
    const off = Math.floor(t * DRIFT[i]) % this.w;
    ctx.drawImage(this.ridges[i], -off, 0);
    if (off > 0) ctx.drawImage(this.ridges[i], this.w - off, 0);
  }

  private drawSnow(ctx: Ctx, layer: number, color: string) {
    const a = this.snow[layer];
    ctx.fillStyle = color;
    for (let i = 0; i < a.length; i += 4) ctx.fillRect(Math.floor(a[i]), Math.floor(a[i + 1]), 1, 1);
  }

  private drawJellies(ctx: Ctx, t: number) {
    for (const j of this.jellies) {
      const p = ((t + j.phase) % j.period) / j.period;
      // Bell: wide and flat when open, narrow and tall when it squeezes.
      const squeeze = p < 0.25 ? Math.sin((p / 0.25) * Math.PI) : 0;
      const bw = Math.max(3, Math.round(j.size - squeeze * 2));
      const bh = Math.round(j.size * 0.55 + squeeze);
      const x = Math.round(j.x + Math.sin(t * 0.3 + j.phase) * j.sway);
      const y = Math.round(j.y);
      const g = j.glow;
      ctx.globalAlpha = j.alpha * (0.6 + 0.4 * Math.sin(t * 1.3 + j.phase));
      ctx.drawImage(g, x - g.width / 2, y - g.height / 2 + 1);
      ctx.globalAlpha = j.alpha;
      ctx.fillStyle = j.color;
      // Dome rows.
      for (let row = 0; row < bh; row++) {
        const k = 1 - ((bh - row) / bh) ** 2;
        const half = Math.max(1, Math.round((bw / 2) * Math.sqrt(Math.max(0.15, k))));
        ctx.fillRect(x - half, y - bh + row, half * 2, 1);
      }
      // Trailing tentacles, waving out of step.
      const n = bw > 6 ? 4 : 3;
      const len = Math.round(j.size * 1.4 + (1 - squeeze) * 2);
      ctx.globalAlpha = j.alpha * 0.7;
      for (let k = 0; k < n; k++) {
        const tx = x - Math.floor(bw / 2) + 1 + Math.round((k * (bw - 2)) / (n - 1));
        for (let s = 0; s < len; s += 1) {
          if ((s + k) % 3 === 2) continue;
          ctx.fillRect(tx + Math.round(Math.sin(t * 2 + s * 0.5 + k) * (s / len) * 1.5), y + s, 1, 1);
        }
      }
      // A bright core.
      ctx.globalAlpha = Math.min(1, j.alpha + 0.3);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x - 1, y - bh + 1, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  private drawKelp(ctx: Ctx, t: number) {
    const { w } = this;
    const off = Math.floor(t * DRIFT[2]);
    for (const k of this.kelp) {
      let bx = (((k.x - off) % w) + w) % w;
      if (bx > w - 4) bx -= w;
      for (const cx of bx < 8 ? [bx, bx + w] : [bx]) {
        ctx.fillStyle = KELP[k.tone];
        const sway = (s: number) => Math.round(k.amp * (s / k.len) ** 1.3 * Math.sin(t * k.speed + s * 0.11 + k.phase));
        for (let s = 0; s < k.len; s++) ctx.fillRect(cx + sway(s), k.y - s, 2, 1);
        // Blades every few rows, alternating sides, lit on top.
        ctx.fillStyle = KELP[2];
        for (let s = 5; s < k.len - 2; s += 5) {
          const side = (s / 5) % 2 ? 1 : -1;
          const x = cx + sway(s) + (side > 0 ? 2 : -2);
          ctx.fillRect(x, k.y - s, 2, 1);
          ctx.fillRect(x + side, k.y - s - 1, 1, 1);
        }
      }
    }
  }

  private drawTips(ctx: Ctx, t: number) {
    const { w } = this;
    const off = Math.floor(t * DRIFT[2]);
    for (const tip of this.tips) {
      const x = (((tip.x - off) % w) + w) % w;
      const glow = Math.max(0, Math.sin(t * tip.rate + tip.phase)) ** 2;
      ctx.fillStyle = tip.color;
      ctx.globalAlpha = 0.18 * glow;
      ctx.fillRect(x - 1, tip.y - 1, 3, 3);
      ctx.globalAlpha = 0.35 + 0.65 * glow;
      ctx.fillRect(x, tip.y, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  private renderWater(w: number, h: number) {
    const [c, ctx] = canvas(w, h);
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const n = WATER.length - 1;
    for (let y = 0; y < h; y++) {
      const f = (y / Math.max(1, h - 1)) ** 0.8 * n;
      for (let x = 0; x < w; x++) {
        const col = WATER[Math.min(n, Math.floor(f + bayer(x, y)))];
        const i = (y * w + x) * 4;
        d[i] = col[0];
        d[i + 1] = col[1];
        d[i + 2] = col[2];
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private renderRays(w: number, h: number, r: () => number): Ray[] {
    const k = Math.max(3, Math.round(w / 70));
    const [cr, cg, cb] = rgb("#c8f6ff");
    return Array.from({ length: k }, (_, i) => {
      const [c, ctx] = canvas(w, h);
      const img = ctx.createImageData(w, h);
      const d = img.data;
      const x0 = ((i + 0.3 + r() * 0.5) * w) / k + w * 0.08;
      const slant = -0.22 - r() * 0.1;
      const width = 3 + r() * 6;
      const len = h * (0.5 + r() * 0.3);
      for (let y = 0; y < len; y++) {
        const fall = (1 - y / len) ** 1.5;
        const half = width * (1 + (y / h) * 1.6);
        const cx = x0 + slant * y;
        for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(w, Math.ceil(cx + half)); x++) {
          const across = 1 - Math.abs(x - cx) / half;
          if (across <= 0 || bayer(x, y) >= fall * across * 0.9) continue;
          const j = (y * w + x) * 4;
          d[j] = cr;
          d[j + 1] = cg;
          d[j + 2] = cb;
          d[j + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return { c, phase: r() * 6.28, base: 0.07 + r() * 0.05 };
    });
  }

  /**
   * A ridge tile as wide as the screen that wraps seamlessly: a periodic height line plus round boulders, filled
   * with the body colour, a lit rim along the top and a shaded band under it. Low sponges stand on the near one.
   */
  private ridge(
    w: number,
    h: number,
    r: () => number,
    o: { top: number; rough: number; rocks: number; rockR: [number, number]; colors: string[] },
  ) {
    const [c, ctx] = canvas(w, h);
    const waves = [1, 2, 3, 5, 8].map((k) => ({ k, a: (o.rough * h * (0.4 + r() * 0.6)) / Math.sqrt(k), p: r() * 6.28 }));
    const rocks = Array.from({ length: o.rocks }, () => ({ x: r() * w, rad: o.rockR[0] + r() * (o.rockR[1] - o.rockR[0]) }));
    const top = new Int16Array(w);
    for (let x = 0; x < w; x++) {
      let height = o.top * h;
      for (const wv of waves) height += wv.a * Math.sin((2 * Math.PI * wv.k * x) / w + wv.p);
      for (const rock of rocks) {
        let dx = Math.abs(x - rock.x);
        dx = Math.min(dx, w - dx);
        if (dx < rock.rad) height = Math.max(height, o.top * h * 0.6 + rock.rad * Math.sqrt(1 - (dx / rock.rad) ** 2));
      }
      top[x] = Math.round(h - Math.max(2, height));
    }
    const [body, rim, shade] = o.colors;
    ctx.fillStyle = body;
    for (let x = 0; x < w; x++) ctx.fillRect(x, top[x], 1, h - top[x]);
    // The shaded band: dithered, three px under the rim.
    ctx.fillStyle = shade;
    for (let x = 0; x < w; x++) for (let k = 1; k <= 3; k++) if (bayer(x, top[x] + k) < 0.75 - k * 0.2) ctx.fillRect(x, top[x] + k, 1, 1);
    // The rim catches light from above: only where the edge is fairly flat.
    ctx.fillStyle = rim;
    for (let x = 0; x < w; x++) {
      const l = top[(x - 1 + w) % w];
      const rr = top[(x + 1) % w];
      if (Math.abs(l - rr) <= 2) ctx.fillRect(x, top[x], 1, 1);
    }
    const sponges: { x: number; y: number }[] = [];
    if (o.colors === NEAR) {
      ctx.fillStyle = "#0b2433";
      const n = Math.round(w / 30) + 2;
      for (let i = 0; i < n; i++) {
        const x = Math.floor(r() * (w - 4)) + 2;
        const tall = 3 + Math.floor(r() * 6);
        ctx.fillRect(x, top[x] - tall, 1, tall + 1);
        if (r() < 0.5) ctx.fillRect(x + 1, top[x] - Math.floor(tall / 2), 1, Math.floor(tall / 2) + 1);
        sponges.push({ x, y: top[x] - tall - 1 });
      }
    }
    return { c, top, sponges };
  }
}

/** A soft round glow in one colour, for jellies and the squid's blooms. */
export function glowSprite(color: string, radius: number): HTMLCanvasElement {
  const size = radius * 2 + 2;
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, radius);
  const [r, gg, b] = rgb(color);
  g.addColorStop(0, `rgba(${r},${gg},${b},0.55)`);
  g.addColorStop(0.45, `rgba(${r},${gg},${b},0.18)`);
  g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export { bayer, rng };
