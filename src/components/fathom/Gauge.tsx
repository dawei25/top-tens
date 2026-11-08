import { useLayoutEffect, useRef, useState } from "react";
import { missText, offAxis, type Band, type NameIt, type Round } from "../../game/fathom";
import { BUOY, placed, SQUID } from "./sprites";

/**
 * The reveal's sonar: the answer (a name-it round's target) is the gold buoy in the middle, and the squid sits left of
 * it (too low, or early) or right of it (too high, or late) by how far off the guess was, on the round's own scale with
 * its edges where the score reaches 0 (offAxis, the distance the points come from: 10x off for an estimate and a ratio
 * list, 10x off the share or what's left for a percent, about 2.15x off how long ago for a year, 3.3 steps for a steps
 * list), with the miss written under it ("30% low", "6 points low", "3 years early", "3 land borders too many"). The
 * stretch of track from the buoy to the squid is lit in the
 * band's colour. No bands, no numbers on the scale: just where you landed. A Dead on or Close guess makes the squid hop
 * among sparkles (not with reduced motion; fathom.css).
 *
 * Drawn on a grid of P x P pixel cells as wide as the card allows (an odd number, so the buoy has a middle column),
 * so the art stays crisp at any width. Decoration: the reveal's text already says how far off the guess is.
 */

/** CSS px per art pixel: 3 on a phone, 4 from 560px (fathom.css keeps the gauge's height in step). */
const pixelSize = () => (typeof matchMedia === "function" && matchMedia("(min-width: 560px)").matches ? 4 : 3);
const ROWS = 17;
/** The track's row. */
const TRACK = 14;
/** The squid's top row: under the buoy's diamond, so a guess dead on still shows the buoy above it. */
const SQUID_TOP = 5;
/** Cells between the squid's middle and the grid's edge at 10x off. */
const EDGE = 4;

interface Props {
  guess: number;
  answer: number;
  band: Band;
  round: Round;
  /** The question's unit and, on a name-it round, its list's scoring: the miss is said in them. */
  unit: string;
  nameIt?: NameIt;
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
  const miss = missText(props, props.guess);
  return (
    <div ref={ref} className="fathom-gauge" aria-hidden="true" data-testid="fathom-gauge" data-band={props.band}>
      {art && (
        <div className="gauge-art" style={{ width: cols * P }}>
          <svg width={cols * P} height={ROWS * P} viewBox={`0 0 ${cols} ${ROWS}`} shapeRendering="crispEdges">
            <rect className="g-track" x={0} y={TRACK} width={cols} height={1} />
            <rect className="g-cap" x={0} y={TRACK - 1} width={1} height={3} />
            <rect className="g-cap" x={cols - 1} y={TRACK - 1} width={1} height={3} />
            {art.reach.w > 0 && <rect className="g-reach" x={art.reach.x} y={TRACK} width={art.reach.w} height={1} />}
            <path className="g-buoy" d={art.buoy} />
            <path className="g-ping g-ping-far" d={art.pingFar} />
            <path className="g-ping g-ping-near" d={art.pingNear} />
            <g className="g-sparks">
              {art.sparks.map((d, i) => (
                <path key={i} className="g-spark" style={{ animationDelay: `${0.45 + i * 0.09}s` }} d={d} />
              ))}
            </g>
            <path className="g-squid" data-x={art.gx} d={art.squid} />
          </svg>
          <div className="gauge-label">
            <span
              data-testid="fathom-off"
              data-x={art.gx}
              style={{ left: (art.gx + 0.5) * P, transform: `translateX(${(-100 * (art.gx + 0.5)) / cols}%)` }}
            >
              {miss}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The cells on a pixel circle of radius r around (cx, cy), above the track and inside the grid's columns. */
function ring(cx: number, cy: number, r: number, cols: number): string {
  let d = "";
  for (let y = 0; y < TRACK - 1; y++) {
    for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(cols - 1, Math.ceil(cx + r + 1)); x++) {
      if (Math.round(Math.hypot(x + 0.5 - cx, y + 0.5 - cy)) === r) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return d;
}

/** A small pixel sparkle (a plus) centred on (x, y). */
const spark = (x: number, y: number) => `M${x} ${y - 1}h1v3h-1zM${x - 1} ${y}h3v1h-3z`;

function draw(cols: number, { guess, answer, round, nameIt }: Props) {
  // How far off on the round's scale (negative: too low or early), clamped where the score reaches 0.
  const d = offAxis(round, guess, answer, nameIt?.scoring);
  const mid = (cols - 1) / 2;
  const ax = Math.round(mid);
  const gx = Math.round(mid + d * (mid - EDGE));

  const pole = Array.from({ length: TRACK + 3 - BUOY.length }, () => "..#..");
  const buoy = placed([...BUOY, ...pole], ax - 2, 0);
  const squid = placed(SQUID, gx - 3, SQUID_TOP);
  const cy = SQUID_TOP + SQUID.length / 2;
  // The track from the buoy to the squid, lit.
  const reach = { x: Math.min(ax, gx), w: Math.abs(gx - ax) };
  // Sparkles around the squid (a hop for Dead on and Close), kept inside the grid.
  const sx = (dx: number) => Math.max(1, Math.min(cols - 2, gx + dx));
  const sparks = [spark(sx(-6), 3), spark(sx(6), 2), spark(sx(-4), 11), spark(sx(7), 9), spark(sx(1), 1)];
  return { gx, buoy, squid, reach, sparks, pingNear: ring(gx + 0.5, cy, 6, cols), pingFar: ring(gx + 0.5, cy, 9, cols) };
}
