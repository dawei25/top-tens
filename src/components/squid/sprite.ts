/**
 * The glow squid, as pixel data. An original sprite on a 20 x 24 grid: an arrow mantle with fins, glowing eyes
 * looking up, eight arms fanned out and the two long tentacles (with clubs) in the middle. Limb ids are ranks: #1
 * and #2 are the tentacles, #3 to #10 the arms from left to right.
 *
 * Voxel style: every limb is two pixels wide, a lit left face and a shaded right face, so neighbours read apart even
 * when they touch; the body has a teal rim, so the squid reads as a switched-off neon sign until it lights up.
 * Each limb's last rows are kept apart as its tip, which sways on its own.
 *
 * Everything is built once, at import, into SVG path strings (one per colour), so rendering is a handful of paths.
 */

type Pt = [number, number];

/** '#' body, 'f' fin, 'e' eye, 'p' pupil, 's' photophore. The roaming squid (components/ocean) draws this too. */
export const BODY = [
  ".........##.........",
  "........####........",
  "...ff..######..ff...",
  "..ffff########ffff..",
  "..fffff######fffff..",
  "....fff######fff....",
  "......########......",
  "......##s##s##......",
  "......########......",
  ".....##########.....",
  "....##pe####ep##....",
  "....##ee####ee##....",
  "....############....",
  ".....##########.....",
];

/** Limbs as the path of their left pixel, listed back (outer arms) to front (the tentacles). */
const TOP = 13;
const ARM = 7;
const TENT = 10;
const LIMBS: { id: number; pts: Pt[]; club?: -1 | 1 }[] = [
  { id: 3, pts: [[5, TOP], [2, TOP + 3], [0, TOP + ARM - 2], [1, TOP + ARM]] },
  { id: 10, pts: [[13, TOP], [16, TOP + 3], [18, TOP + ARM - 2], [17, TOP + ARM]] },
  { id: 4, pts: [[6, TOP], [4, TOP + 3], [3, TOP + ARM]] },
  { id: 9, pts: [[12, TOP], [14, TOP + 3], [15, TOP + ARM]] },
  { id: 5, pts: [[6, TOP], [6, TOP + 3], [5, TOP + ARM + 1]] },
  { id: 8, pts: [[12, TOP], [12, TOP + 3], [13, TOP + ARM + 1]] },
  { id: 6, pts: [[7, TOP], [7, TOP + ARM]] },
  { id: 7, pts: [[11, TOP], [11, TOP + ARM]] },
  { id: 1, pts: [[8, TOP], [8, TOP + TENT - 2], [7, TOP + TENT]], club: -1 },
  { id: 2, pts: [[10, TOP], [10, TOP + TENT - 2], [11, TOP + TENT]], club: 1 },
];
/**
 * Where each limb leaves the head, back (outer arms) to front (the tentacles): its id (rank), the column of its
 * two-pixel root, and its rest angle from straight down in the sprite (negative leans left). For the roaming squid,
 * whose limbs are long procedural chains.
 */
export const LIMB_ROOTS: { id: number; x: number; y: number; angle: number }[] = LIMBS.map((l) => {
  const [x0, y0] = l.pts[0];
  const [x1, y1] = l.pts[l.pts.length - 1];
  return { id: l.id, x: x0 + 1, y: y0 + 0.5, angle: Math.atan2(x1 - x0, y1 - y0) };
});

/** Rows at the end of a limb that sway, and that taper to one pixel. */
const TIP = 3;

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

/** One pixel per row along the path (limbs only run downward), so the two-wide stroke stays two wide. */
function rows(pts: Pt[]): Pt[] {
  const byRow = new Map<number, number>();
  for (let i = 0; i < pts.length - 1; i++) for (const [x, y] of line(pts[i], pts[i + 1])) if (!byRow.has(y)) byRow.set(y, x);
  return [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([y, x]) => [x, y]);
}

/** One SVG path of 1 x 1 squares. */
export function cells(list: Pt[]): string {
  return list.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join("");
}

export interface LimbArt {
  id: number;
  /** Lit (left) and shaded (right) faces of the limb, without its tip. */
  a: string;
  b: string;
  /** The tip, which sways: faces and the pink sucker on a tentacle's club. */
  tipA: string;
  tipB: string;
  suckers: string;
  /** Every pixel of the limb, for its glow. */
  all: string;
}

export interface SquidArt {
  w: number;
  h: number;
  /** Body tones: the teal rim, then the lit left and shaded right faces. */
  rim: string;
  left: string;
  right: string;
  eyes: string;
  pupils: string;
  /** The top row of each eye, drawn over in body colour when the squid is down (half-closed eyes). */
  lids: string;
  spots: string;
  /** Every body pixel, for the body's glow. */
  silhouette: string;
  limbs: LimbArt[];
}

type Px = { x: number; y: number; id: number; face: "a" | "b" | "s"; tip: boolean };

function build(): SquidArt {
  const body = new Map<string, string>();
  BODY.forEach((row, y) => [...row].forEach((c, x) => c !== "." && body.set(`${x},${y}`, c)));
  const w = BODY[0].length;
  const cx = (w - 1) / 2;

  const tone = { rim: [] as Pt[], left: [] as Pt[], right: [] as Pt[] };
  const eyes: Pt[] = [];
  const pupils: Pt[] = [];
  const spots: Pt[] = [];
  const lids: Pt[] = [];
  const all: Pt[] = [];
  for (const [k, c] of body) {
    const [x, y] = k.split(",").map(Number) as Pt;
    all.push([x, y]);
    if (c === "e" || c === "p") {
      (c === "e" ? eyes : pupils).push([x, y]);
      if (BODY[y - 1]?.[x] === "#") lids.push([x, y]);
      continue;
    }
    if (c === "s") {
      spots.push([x, y]);
      continue;
    }
    const has = (dx: number, dy: number) => body.has(`${x + dx},${y + dy}`);
    if (!has(0, -1) || !has(-1, 0) || !has(1, 0)) tone.rim.push([x, y]);
    else (x <= cx ? tone.left : tone.right).push([x, y]);
  }

  // Limbs, back to front: a later (nearer) limb covers an earlier one where they cross.
  const px = new Map<string, Px>();
  for (const l of LIMBS) {
    const path = rows(l.pts);
    const last = path[path.length - 1][1];
    for (const [x, y] of path) {
      const tip = y > last - TIP;
      // The very end tapers to one pixel, so the ends read apart.
      const faces: ["a" | "b", number][] = y >= last - 1 ? [["a", 0]] : [["a", 0], ["b", 1]];
      for (const [face, dx] of faces) {
        const k = `${x + dx},${y}`;
        if (!body.has(k)) px.set(k, { x: x + dx, y, id: l.id, face, tip });
      }
    }
    if (l.club) {
      // The club: a pink sucker beside the tentacle, just above its end.
      const [x, y] = path[path.length - 2];
      const sx = l.club < 0 ? x - 1 : x + 1;
      px.set(`${sx},${y}`, { x: sx, y, id: l.id, face: "s", tip: true });
    }
  }
  let h = BODY.length;
  for (const p of px.values()) h = Math.max(h, p.y + 1);

  const pick = (id: number, f: (p: Px) => boolean): Pt[] => [...px.values()].filter((p) => p.id === id && f(p)).map((p) => [p.x, p.y]);
  const limbs: LimbArt[] = LIMBS.map((l) => ({
    id: l.id,
    a: cells(pick(l.id, (p) => p.face === "a" && !p.tip)),
    b: cells(pick(l.id, (p) => p.face === "b" && !p.tip)),
    tipA: cells(pick(l.id, (p) => p.face === "a" && p.tip)),
    tipB: cells(pick(l.id, (p) => p.face === "b" && p.tip)),
    suckers: cells(pick(l.id, (p) => p.face === "s")),
    all: cells(pick(l.id, () => true)),
  })).sort((p, q) => p.id - q.id);

  return {
    w,
    h,
    rim: cells(tone.rim),
    left: cells(tone.left),
    right: cells(tone.right),
    eyes: cells(eyes),
    pupils: cells(pupils),
    lids: cells(lids),
    spots: cells(spots),
    silhouette: cells(all),
    limbs,
  };
}

export const SQUID = build();
