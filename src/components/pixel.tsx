import { useEffect, useState } from "react";

export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** "2026-10-29" -> "Oct 29, 2026"; anything unparseable comes back as is. */
export function formatAsOf(asOf: string): string {
  const m = asOf.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return asOf;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (Number.isNaN(d.getTime())) return asOf;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Wikipedia: List of ..." -> "Wikipedia". */
export function sourceSite(name: string): string {
  return name.split(":")[0].trim() || name;
}

/**
 * Mode identity, the same everywhere: classic (name the top 10, 5 lives) is pink, Blitz (90 s, points) is gold.
 */
export type Mode = "classic" | "blitz" | "both";
const MODE_TAG: Record<Mode, string> = { classic: "5 lives", blitz: "Blitz · 90 s", both: "Lists + Blitz" };
export function ModeTag({ mode }: { mode: Mode }) {
  return <span className={`mode-tag ${mode}`}>{MODE_TAG[mode]}</span>;
}

/** The keyboard hint on a home key; CSS shows it only on the focused key, and only with a fine pointer. */
export function EnterHint() {
  return (
    <span className="enter-hint" aria-hidden="true">
      enter
    </span>
  );
}

/** Builds a crisp SVG path from a pixel map ("#" = on). */
function pixels(rows: string[]): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") d += `M${x} ${y}h1v1h-1z`;
  });
  return d;
}

const HEART = pixels([".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."]);
const ARROW = pixels(["...#....", "..##....", ".#######", "########", ".#######", "..##....", "...#...."]);

export function Heart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 7 6" shapeRendering="crispEdges" aria-hidden="true">
      <path d={HEART} fill="currentColor" />
    </svg>
  );
}

export function BackArrow() {
  return (
    <svg className="pixel-icon" viewBox="0 0 8 7" shapeRendering="crispEdges" aria-hidden="true">
      <path d={ARROW} fill="currentColor" />
    </svg>
  );
}

/**
 * Types a name in like arcade initials. The untyped rest is laid out but transparent, so the row never
 * changes height while typing.
 */
export function TypeIn({ text, animate, delay = 0 }: { text: string; animate: boolean; delay?: number }) {
  // -1: waiting for its turn (nothing shown yet, but the row already has its final height).
  const [n, setN] = useState(animate ? -1 : text.length);
  useEffect(() => {
    if (!animate) {
      setN(text.length);
      return;
    }
    setN(-1);
    const step = Math.max(10, Math.min(40, 420 / text.length));
    let i = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      setN(0);
      timer = setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length) clearInterval(timer);
      }, step);
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [animate, text, delay]);

  if (n >= text.length) return <>{text}</>;
  return (
    <>
      <span className="sr-only">{text}</span>
      {n < 0 ? (
        <span className="type-ghost" aria-hidden="true">
          {text}
        </span>
      ) : (
        <span aria-hidden="true">
          {text.slice(0, n)}
          <span className="type-cursor">{text[n]}</span>
          <span className="type-ghost">{text.slice(n + 1)}</span>
        </span>
      )}
    </>
  );
}
