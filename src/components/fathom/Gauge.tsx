import { useLayoutEffect, useRef, useState } from "react";
import { bandOf, type Band } from "../../game/fathom";
import { BUOY, placed, SQUID } from "./sprites";

/**
 * The reveal's sonar: a pixel strip that places the guess and the answer on a log scale. The answer is the gold buoy
 * in the middle; the squid marks where the guess landed, with a sonar ping around it. Under the track, the bands of
 * the score (dead on in the middle, then close, near, far, lost at sea) in their colours, the guess's band lit.
 *
 * Drawn on a grid of P x P pixel cells as wide as the card allows (an odd number, so the buoy has a middle column),
 * so the art stays crisp at any width. Decoration: the reveal's text already says how far off the guess is.
 */

/** CSS px per art pixel: 3 on a phone, 4 from 560px (fathom.css keeps the gauge's height in step). */
const pixelSize = () => (typeof matchMedia === "function" && matchMedia("(min-width: 560px)").matches ? 4 : 3);
const ROWS = 20;
/** The track's row; the band strip (three rows) sits two rows under it. */
const TRACK = 14;
const STRIP = TRACK + 3;
const STRIP_ROWS = 3;

/** The squid's top row: under the buoy's diamond, so a guess dead on still shows the buoy above it. */
const SQUID_TOP = 5;

interface Props {
  guess: number;
  answer: number;
  typical: number;
  band: Band;
}

export function Gauge(props: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [{ cols, P }, setGrid] = useState({ cols: 0, P: 3 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const P = pixelSize();
      const n = Math.floor(el.clientWidth / P);
      setGrid((g) => (g.P === P && g.cols === (n % 2 ? n : n - 1) ? g : { cols: n % 2 ? n : n - 1, P }));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const art = cols >= 31 ? draw(cols, props) : null;
  return (
    <div ref={ref} className="fathom-gauge" aria-hidden="true" data-testid="fathom-gauge">
      {art && (
        <div className="gauge-art" style={{ width: cols * P }}>
          <svg width={cols * P} height={ROWS * P} viewBox={`0 0 ${cols} ${ROWS}`} shapeRendering="crispEdges">
            {art.bands.map((b) => (
              <rect key={b.x} className={`g-band ${b.band === props.band ? "hit" : ""}`} data-band={b.band} x={b.x} y={STRIP} width={b.w} height={STRIP_ROWS} />
            ))}
            <rect className="g-track" x={0} y={TRACK} width={cols} height={1} />
            {art.ticks.map((t) => (
              <rect key={t.x} className="g-tick" x={t.x} y={TRACK + 1} width={1} height={2} />
            ))}
            <path className="g-buoy" d={art.buoy} />
            <path className="g-ping g-ping-far" d={art.pingFar} />
            <path className="g-ping g-ping-near" d={art.pingNear} />
            <path className="g-squid" d={art.squid} />
          </svg>
          <div className="gauge-ticks">
            {art.ticks.map((t) => (
              <span key={t.x} style={{ left: (t.x + 0.5) * P }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The cells on a pixel circle of radius r around (cx, cy), inside rows 0..TRACK-1 and the grid's columns. */
function ring(cx: number, cy: number, r: number, cols: number): string {
  let d = "";
  for (let y = 0; y < TRACK - 1; y++) {
    for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(cols - 1, Math.ceil(cx + r + 1)); x++) {
      if (Math.round(Math.hypot(x + 0.5 - cx, y + 0.5 - cy)) === r) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return d;
}

/** Tick values on the scale, in log10: 1-2-5 steps on a short scale, powers of ten (every few) on a long one. */
function tickValues(lo: number, hi: number): number[] {
  const span = hi - lo;
  const steps = span < 1.2 ? [1, 2, 5] : [1];
  const every = span > 8 ? Math.ceil(span / 6) : 1;
  const out: number[] = [];
  for (let k = Math.floor(lo) - 1; k <= Math.ceil(hi); k++) {
    if (k % every !== 0) continue;
    for (const s of steps) {
      const v = s * 10 ** k;
      if (Math.log10(v) >= lo && Math.log10(v) <= hi) out.push(v);
    }
  }
  return out;
}

/** "200", "0.5", "5K", "2M", "1B", "3T", "1e18". */
function tickLabel(v: number): string {
  const short = (x: number) => String(+x.toPrecision(3));
  if (v >= 1e15) return `1e${Math.round(Math.log10(v))}`;
  if (v >= 1e12) return `${short(v / 1e12)}T`;
  if (v >= 1e9) return `${short(v / 1e9)}B`;
  if (v >= 1e6) return `${short(v / 1e6)}M`;
  if (v >= 1e3) return `${short(v / 1e3)}K`;
  return short(v);
}

function draw(cols: number, { guess, answer, typical }: Props) {
  const c = Math.log10(answer);
  const d = Math.log10(guess / answer);
  const m = Math.log10(typical);
  // Half the scale, in log10: room for the guess (with a margin), and never so tight the bands crowd the middle.
  const half = Math.max(Math.abs(d) * 1.25, m * 2.2, 0.3);
  const mid = (cols - 1) / 2;
  const xOf = (lv: number) => Math.round(mid + ((lv - c) / half) * mid);

  // The bands, one run of cells each, mirrored around the answer.
  const bands: { x: number; w: number; band: Band }[] = [];
  for (let x = 0; x < cols; x++) {
    const dist = (Math.abs(x - mid) / mid) * half;
    const band = bandOf(Math.round(100 * (1 - (2 / Math.PI) * Math.atan(dist / m))));
    const last = bands[bands.length - 1];
    if (last && last.band === band) last.w += 1;
    else bands.push({ x, w: 1, band });
  }

  // Ticks with room for their labels (14 cells, 42px, apart), clear of the ends.
  const ticks: { x: number; label: string }[] = [];
  for (const v of tickValues(c - half, c + half)) {
    const x = xOf(Math.log10(v));
    if (x < 4 || x > cols - 5) continue;
    if (ticks.length && x - ticks[ticks.length - 1].x < 14) continue;
    ticks.push({ x, label: tickLabel(v) });
  }

  const ax = Math.round(mid);
  const pole = Array.from({ length: TRACK + 3 - BUOY.length }, () => "..#..");
  const buoy = placed([...BUOY, ...pole], ax - 2, 0);

  const gx = Math.min(cols - 4, Math.max(3, xOf(c + d)));
  const squid = placed(SQUID, gx - 3, SQUID_TOP);
  const cy = SQUID_TOP + SQUID.length / 2;
  return { bands, ticks, buoy, squid, pingNear: ring(gx + 0.5, cy, 6, cols), pingFar: ring(gx + 0.5, cy, 9, cols) };
}
