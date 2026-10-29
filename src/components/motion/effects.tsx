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
