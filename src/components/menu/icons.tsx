/**
 * The menu's pixel icons, each a small map ("#" = on) drawn as one crisp SVG path in currentColor, like the header's
 * arrow and house.
 */

function pixels(rows: string[]): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") d += `M${x} ${y}h1v1h-1z`;
  });
  return d;
}

interface Glyph {
  w: number;
  h: number;
  d: string;
}
const glyph = (rows: string[]): Glyph => ({ w: rows[0].length, h: rows.length, d: pixels(rows) });

const GLYPHS = {
  menu: glyph(["########", "########", "........", "########", "########", "........", "########", "########"]),
  close: glyph(["##....##", "###..###", ".######.", "..####..", "..####..", ".######.", "###..###", "##....##"]),
  list: glyph(["##.######", "##.######", ".........", "##.######", "##.######", ".........", "##.######", "##.######"]),
  bolt: glyph([".....###", "....###.", "...###..", "..######", ".######.", "...###..", "..###...", ".###....", "##......"]),
  dice: glyph([
    ".#######.",
    "#########",
    "##.###.##",
    "#########",
    "####.####",
    "#########",
    "##.###.##",
    "#########",
    ".#######.",
  ]),
  archive: glyph([
    ".##...##.",
    "#########",
    "#########",
    "#.......#",
    "#.##.##.#",
    "#.......#",
    "#.##.##.#",
    "#.......#",
    "#########",
  ]),
  history: glyph([
    "..#####..",
    ".#.....#.",
    "#...#...#",
    "#...#...#",
    "#...###.#",
    "#.......#",
    "#.......#",
    ".#.....#.",
    "..#####..",
  ]),
  stats: glyph(["......##", "......##", "...##.##", "...##.##", "##.##.##", "##.##.##", "........", "########"]),
  user: glyph(["...###...", "..#####..", "..#####..", "...###...", ".........", ".#######.", "#########", "#########"]),
  /** The same player, hollow: nobody signed in (Home's account card). */
  userOut: glyph(["...###...", "..#...#..", "..#...#..", "...###...", ".........", ".#######.", "#.......#", "#########"]),
  settings: glyph([
    "....#....",
    ".#.###.#.",
    "..#####..",
    ".###.###.",
    "###...###",
    ".###.###.",
    "..#####..",
    ".#.###.#.",
    "....#....",
  ]),
  help: glyph([".#####.", "##...##", ".....##", "...###.", "...##..", ".......", "...##.."]),
  mail: glyph(["#########", "##.....##", "#.#...#.#", "#..#.#..#", "#...#...#", "#.......#", "#########"]),
  lock: glyph([
    "..#####..",
    ".##...##.",
    ".#.....#.",
    ".#.....#.",
    "#########",
    "####.####",
    "####.####",
    "#########",
    "#########",
  ]),
} satisfies Record<string, Glyph>;

export type GlyphName = keyof typeof GLYPHS;

/**
 * One pixel icon. With `unit`, each map pixel is that many CSS pixels (whole pixels stay crisp, and icons of
 * different maps share one pixel size); without it, CSS sizes it (.pixel-icon: the header keys' width).
 */
export function Pixel({ name, className = "pixel-icon", unit }: { name: GlyphName; className?: string; unit?: number }) {
  const g = GLYPHS[name];
  return (
    <svg
      className={className}
      viewBox={`0 0 ${g.w} ${g.h}`}
      width={unit && g.w * unit}
      height={unit && g.h * unit}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path d={g.d} fill="currentColor" />
    </svg>
  );
}
