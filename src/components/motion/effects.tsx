/**
 * Small motion hooks for the UI markup. Each one is decorative only: aria-hidden extras, or the same text the
 * screen already had (textContent never changes), so tests and screen readers see the final state at once.
 * The animations themselves are in src/motion.css.
 */
import { useState, type CSSProperties } from "react";

/**
 * Text with each ":" in its own span, so the colons can blink like a digital clock ("01:15:52").
 * The spans are stable across ticks, so the blink keeps running while the digits change.
 */
export function BlinkColons({ text }: { text: string }) {
  const parts = text.split(":");
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="motion-colon">:</span>}
          {p}
        </span>
      ))}
    </>
  );
}

/**
 * A number that counts up from 0 when its results panel enters. The real number stays in the DOM (and in
 * textContent) for layout, tests and readers; CSS draws the counting copy over it.
 */
export function CountUp({ value }: { value: number }) {
  return (
    <span className="motion-count" style={{ "--to": value } as CSSProperties}>
      <span className="motion-count-n">{value}</span>
    </span>
  );
}

/** Pieces of a heart flying apart: [dx, dy] in px. Roughly the heart's own pixels, thrown outward. */
const SHARDS: [number, number][] = [
  [-28, -24],
  [-8, -32],
  [12, -30],
  [30, -18],
  [-34, 4],
  [34, 6],
  [-22, 24],
  [-4, 32],
  [18, 26],
];

/** The lost heart shatters into pixels. Mount it fresh for each lost life (index = the heart that went out). */
export function PixelBurst({ index }: { index: number }) {
  return (
    <span className="motion-burst" style={{ "--i": index } as CSSProperties} aria-hidden="true">
      {SHARDS.map(([x, y], k) => (
        <i key={k} style={{ "--dx": `${x}px`, "--dy": `${y}px` } as CSSProperties} />
      ))}
    </span>
  );
}

/** "+57" rising off a score each time it goes up. Nothing on the first render or when the score drops or resets. */
export function ScoreFloat({ score }: { score: number }) {
  const [seen, setSeen] = useState(score);
  const [pop, setPop] = useState<{ gain: number; n: number } | null>(null);
  if (score !== seen) {
    setSeen(score);
    setPop(score > seen ? { gain: score - seen, n: (pop?.n ?? 0) + 1 } : null);
  }
  if (!pop) return null;
  return (
    <span key={pop.n} className="motion-float" aria-hidden="true" onAnimationEnd={() => setPop(null)}>
      +{pop.gain}
    </span>
  );
}
