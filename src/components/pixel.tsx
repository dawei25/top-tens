import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { SoundToggle } from "./sound/SoundToggle";
import { MenuKey } from "./menu";
import { ROLL_NEW } from "./copy";

export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The least time between a game's or round's end and SHARE taking focus. Results never autofocus a key: until this
 * passes focus is nowhere, so a key the player was still pressing (Enter on the last guess, held or pressed twice)
 * presses nothing on the results.
 */
export const END_FOCUS_MS = 900;

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

/** A day the way the screens name it: "2026-11-10" -> "Nov 10", with the year only when it isn't `today`'s. */
export function shortDate(date: string, today: string): string {
  const full = formatAsOf(date);
  return date.slice(0, 4) === today.slice(0, 4) ? full.replace(/, \d{4}$/, "") : full;
}

/** "Wikipedia: List of ..." -> "Wikipedia". */
export function sourceSite(name: string): string {
  return name.split(":")[0].trim() || name;
}

/**
 * Mode identity, the same everywhere: classic (name the top 10, 5 lives) is pink, Blitz (90 s, points) is gold.
 * A game screen's header names its mode once; the screen itself (lives, the clock) shows the rules.
 */
export type Mode = "classic" | "blitz";

/** Whether a media query matches now, kept current (false where there is no matchMedia). */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (change: () => void) => {
      if (typeof matchMedia !== "function") return () => {};
      const mq = matchMedia(query);
      mq.addEventListener("change", change);
      return () => mq.removeEventListener("change", change);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => typeof matchMedia === "function" && matchMedia(query).matches, () => false);
}

/** Phones: the guess box is the dock at the bottom of the screen (index.css, under 700px). */
export const PHONE = "(max-width: 699px)";

/**
 * Roll new list, before play (a rolled list before its first guess, a rolled Blitz before its clock starts): its own
 * box right of the guess panel, outside it (owner, Nov 6), level with the guess row and no taller (the pill, on
 * phones; owner, Nov 7). The results' key for the same action has the same name (ROLL_NEW). It lives in the guess
 * form, which makes room for it while `on` (data-roll, index.css). When play starts it fades out and the guess panel
 * stretches into its room. Where it never shows (dailies, Today's Blitz, links, replays) there is none.
 */
export function RollBox({ slot, on, onRoll }: { slot: boolean; on: boolean; onRoll?: () => void }) {
  if (!slot) return null;
  return (
    <button
      type="button"
      className="roll-box"
      data-testid="reroll"
      data-gone={on ? undefined : ""}
      // Glass to the ocean only while it shows: once gone it leaves the squid its water.
      data-glass={on ? "" : undefined}
      disabled={!on}
      onClick={onRoll}
    >
      {ROLL_NEW}
    </button>
  );
}

/** The guess form's data-roll: "on" while the roll box shows, "gone" after it (the panel takes its room back). */
export const rollState = (slot: boolean, on: boolean) => (!slot ? undefined : on ? "on" : "gone");

/**
 * The keyboard hint on a home key, on its status line. Always laid out; CSS makes it visible only on the focused key,
 * and only with a fine pointer, so showing it never moves anything.
 */
export function EnterHint() {
  return (
    <span className="enter-hint" aria-hidden="true">
      enter
    </span>
  );
}

/** Builds a crisp SVG path from a pixel map ("#" = on). */
export function pixels(rows: string[]): string {
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

/**
 * A life: one of the squid's ink sacs, an 8 x 9 droplet with a rim, ink inside (deeper at the bottom) and a gloss.
 * Colours come from CSS (.ink-sac .rim / .ink / .deep / .glint), so a spent sac can go hollow.
 */
const SAC = [
  "...rr...",
  "..riir..",
  ".rigiir.",
  "rigiiiir",
  "rgiiiiir",
  "riiiiiir",
  "riidddir",
  ".rdddir.",
  "..rrrr..",
];
const sac = (c: string) => pixels(SAC.map((row) => row.replace(new RegExp(`[^${c}]`, "g"), ".").replace(new RegExp(c, "g"), "#")));
const SAC_PATHS = { rim: sac("r"), ink: sac("i"), deep: sac("d"), glint: sac("g") };

export function InkSac({ className }: { className?: string }) {
  return (
    <svg className={`ink-sac ${className ?? ""}`} viewBox="0 0 8 9" shapeRendering="crispEdges" aria-hidden="true">
      <path className="ink" d={SAC_PATHS.ink} />
      <path className="deep" d={SAC_PATHS.deep} />
      <path className="glint" d={SAC_PATHS.glint} />
      <path className="rim" d={SAC_PATHS.rim} />
    </svg>
  );
}

const HOUSE = pixels(["...##...", "..####..", ".######.", "########", ".##..##.", ".##..##.", ".##..##."]);

export function BackArrow() {
  return (
    <svg className="pixel-icon" viewBox="0 0 8 7" shapeRendering="crispEdges" aria-hidden="true">
      <path d={ARROW} fill="currentColor" />
    </svg>
  );
}

export function HomeIcon() {
  return (
    <svg className="pixel-icon" viewBox="0 0 8 7" shapeRendering="crispEdges" aria-hidden="true">
      <path d={HOUSE} fill="currentColor" />
    </svg>
  );
}

/**
 * The clue's magnifying glass, 9 x 9: a round lens with a glint and a faint glass tint ("g"), a thick handle.
 * Colour comes from CSS (currentColor), so the row can light it.
 */
const LENS = [
  "..###....",
  ".#ggg#...",
  "#g#ggg#..",
  "#ggggg#..",
  ".#ggg#...",
  "..###.#..",
  "......##.",
  ".......##",
  "........#",
];
const LENS_RIM = pixels(LENS);
const LENS_GLASS = pixels(LENS.map((row) => row.replace(/#/g, ".").replace(/g/g, "#")));

export function ClueIcon() {
  return (
    <svg className="clue-icon" viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">
      <path className="glass" d={LENS_GLASS} fill="currentColor" />
      <path d={LENS_RIM} fill="currentColor" />
    </svg>
  );
}

/**
 * A key's label that changes in place (GIVE UP -> SURE?, SHARE -> COPIED): both words take the same spot and the key
 * keeps the width of the longer one, so a second press in the same place still lands on it (UX 11). Only the shown
 * word is read out.
 */
export function SwapLabel({ on, off, active }: { off: ReactNode; on: ReactNode; active: boolean }) {
  return (
    <span className="swap">
      <span data-shown={!active || undefined} aria-hidden={active || undefined}>
        {off}
      </span>
      <span data-shown={active || undefined} aria-hidden={!active || undefined}>
        {on}
      </span>
    </span>
  );
}

/**
 * Every screen's header: BACK (one step up) on the left, the screen's own middle, the sound key, HOME and the menu
 * key on the right. Escape is Back too, except while typing in a field, while a dialog is open over the screen (the
 * Escape closes it), or when something on the screen already used the Escape (a hint confirm marks it with
 * preventDefault).
 */
export function ScreenHead({ onBack, onHome, children }: { onBack: () => void; onHome: () => void; children: ReactNode }) {
  const back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (document.querySelector("dialog[open]")) return;
      back.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <header className="game-head" data-glass>
      {/* The menu key leads, at the left end (owner), as on Home. */}
      <div className="game-head-start">
        <MenuKey />
        <button className="key key-icon" onClick={onBack} aria-label="Back" title="Back (Esc)" data-testid="nav-back">
          <BackArrow />
        </button>
      </div>
      <div className="game-head-mid" data-testid="screen-title">
        {children}
      </div>
      <div className="game-head-end">
        <SoundToggle />
        <button className="key key-icon" onClick={onHome} aria-label="Home" title="Home" data-testid="nav-home">
          <HomeIcon />
        </button>
      </div>
    </header>
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
