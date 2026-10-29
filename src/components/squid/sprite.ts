/**
 * The glow squid, as pixel data. An original sprite on a 19 x 23 grid: an arrow mantle with fins, eyes looking up,
 * eight arms fanned out and the two long tentacles (with clubs) in the middle. Limb ids are ranks: #1 and #2 are the
 * tentacles, #3 to #10 the arms from left to right.
 *
 * Everything is built once, at import, into SVG path strings (one per colour), so rendering is a handful of paths.
 */

type Pt = [number, number];

/** '#' body, 'f' fin, 'o' eye white, 'p' pupil, 's' photophore. */
const BODY = [
  "........###........",
  ".......#####.......",
  "....ff#######ff....",
  "..ffff#######ffff..",
  "...fff#######fff...",
  ".....f#######f.....",
  "......#######......",
  "......#s###s#......",
  ".....#########.....",
  "....##op###po##....",
  "....##oo###oo##....",
  "....###########....",
  ".....#########.....",
];

/** Arms fan out from under the head to columns 0-6 and 12-18; the tentacles hang straight down the middle. */
const TOP = 12;
const LEN = 6;
const LIMBS: { id: number; pts: Pt[]; club?: -1 | 1 }[] = [
  { id: 3, pts: [[5, TOP], [2, TOP + 3], [0, TOP + 5], [0, TOP + LEN - 1], [1, TOP + LEN]] },
  { id: 4, pts: [[6, TOP], [3, TOP + 4], [2, TOP + LEN]] },
  { id: 5, pts: [[7, TOP], [5, TOP + 3], [4, TOP + LEN - 1], [5, TOP + LEN]] },
  { id: 6, pts: [[7, TOP], [6, TOP + 3], [6, TOP + LEN - 1]] },
  { id: 1, pts: [[8, TOP], [8, TOP + LEN + 2], [7, TOP + LEN + 4]], club: -1 },
  { id: 2, pts: [[10, TOP], [10, TOP + LEN + 2], [11, TOP + LEN + 4]], club: 1 },
  { id: 7, pts: [[11, TOP], [12, TOP + 3], [12, TOP + LEN - 1]] },
  { id: 8, pts: [[11, TOP], [13, TOP + 3], [14, TOP + LEN - 1], [13, TOP + LEN]] },
  { id: 9, pts: [[12, TOP], [15, TOP + 4], [16, TOP + LEN]] },
  { id: 10, pts: [[13, TOP], [16, TOP + 3], [18, TOP + 5], [18, TOP + LEN - 1], [17, TOP + LEN]] },
];

/** Pixel line from a to b, inclusive (Bresenham). */
function line([x0, y0]: Pt, [x1, y1]: Pt): Pt[] {
  const out: Pt[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function polyline(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) out.push(...line(pts[i], pts[i + 1]).slice(i ? 1 : 0));
  return out;
}

/** One SVG path of 1 x 1 squares. */
export function cells(list: Pt[]): string {
  return list.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("");
}

export interface LimbArt {
  id: number;
  /** Alternate bands down the limb (a voxel, segmented look), and pink suckers on a tentacle's club. */
  a: string;
  b: string;
  suckers: string;
  /** Every pixel of the limb, for its glow. */
  all: string;
}

export interface SquidArt {
  w: number;
  h: number;
  /** Body tones, voxel style: rim highlight, lit left face, shaded right face, dark rim. */
  body: Record<"h" | "l" | "d" | "k", string>;
  fin: Record<"h" | "l" | "d" | "k", string>;
  eyes: string;
  pupils: string;
  /** The top row of each eye, drawn over in body colour when the squid is down (half-closed eyes). */
  lids: string;
  spots: string;
  /** Every body pixel, for the body's glow. */
  silhouette: string;
  limbs: LimbArt[];
}

function build(): SquidArt {
  const body = new Map<string, string>();
  BODY.forEach((row, y) => [...row].forEach((c, x) => c !== "." && body.set(`${x},${y}`, c)));
  const w = BODY[0].length;
  const cx = (w - 1) / 2;

  const tones = { body: { h: [], l: [], d: [], k: [] }, fin: { h: [], l: [], d: [], k: [] } } as Record<
    "body" | "fin",
    Record<"h" | "l" | "d" | "k", Pt[]>
  >;
  const eyes: Pt[] = [];
  const pupils: Pt[] = [];
  const spots: Pt[] = [];
  const lids: Pt[] = [];
  const all: Pt[] = [];
  for (const [k, c] of body) {
    const [x, y] = k.split(",").map(Number) as Pt;
    all.push([x, y]);
    if (c === "o" || c === "p") {
      (c === "o" ? eyes : pupils).push([x, y]);
      // The first eye row (pupils looking up) is the lid line.
      if (BODY[y - 1]?.[x] === "#") lids.push([x, y]);
      continue;
    }
    if (c === "s") {
      spots.push([x, y]);
      continue;
    }
    const has = (dx: number, dy: number) => body.has(`${x + dx},${y + dy}`);
    const tone = !has(0, -1) || !has(-1, 0) ? "h" : !has(1, 0) || !has(0, 1) ? "k" : x <= cx ? "l" : "d";
    tones[c === "f" ? "fin" : "body"][tone].push([x, y]);
  }

  let h = BODY.length;
  const limbs: LimbArt[] = LIMBS.map((l) => {
    const px = polyline(l.pts).filter(([x, y]) => !body.has(`${x},${y}`));
    const a = px.filter((_, i) => i % 2 === 0);
    const b = px.filter((_, i) => i % 2 === 1);
    const suckers: Pt[] = [];
    const club: Pt[] = [];
    if (l.club) {
      // The club: the last three pixels doubled to the outside, the middle one a sucker.
      px.slice(-3).forEach(([x, y], i) => (i === 1 ? suckers : club).push([x + l.club!, y]));
    }
    const every = [...px, ...club, ...suckers];
    for (const [, y] of every) h = Math.max(h, y + 1);
    return { id: l.id, a: cells(a), b: cells([...b, ...club]), suckers: cells(suckers), all: cells(every) };
  }).sort((p, q) => p.id - q.id);

  const join = (r: Record<"h" | "l" | "d" | "k", Pt[]>) =>
    ({ h: cells(r.h), l: cells(r.l), d: cells(r.d), k: cells(r.k) }) as Record<"h" | "l" | "d" | "k", string>;
  return {
    w,
    h,
    body: join(tones.body),
    fin: join(tones.fin),
    eyes: cells(eyes),
    pupils: cells(pupils),
    lids: cells(lids),
    spots: cells(spots),
    silhouette: cells(all),
    limbs,
  };
}

export const SQUID = build();

/**
 * Blitz momentum halo: pixel rings on a 32 x 32 grid centred on 0,0 (the squid's head). The outer two are dashed in
 * two phases, a and b, which take turns lighting up like chase lights on a cabinet marquee.
 */
function ring(r: number): Pt[] {
  const out: { p: Pt; a: number }[] = [];
  for (let y = -16; y < 16; y++)
    for (let x = -16; x < 16; x++) {
      const d = Math.hypot(x + 0.5, y + 0.5);
      if (Math.abs(d - r) < 0.5) out.push({ p: [x, y], a: Math.atan2(y + 0.5, x + 0.5) });
    }
  return out.sort((p, q) => p.a - q.a).map((c) => c.p);
}
const dashes = (cellsOnRing: Pt[], phase: 0 | 1) => cells(cellsOnRing.filter((_, i) => Math.floor(i / 2) % 2 === phase));
const MID = ring(9.5);
const OUTER = ring(12);
export const HALO = {
  inner: cells(ring(7)),
  midA: dashes(MID, 0),
  midB: dashes(MID, 1),
  outerA: dashes(OUTER, 0),
  outerB: dashes(OUTER, 1),
};
