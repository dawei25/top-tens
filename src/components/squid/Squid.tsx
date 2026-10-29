/**
 * TENtacle's glow squid: ten limbs for a top 10's ten slots. Purely decorative (aria-hidden); what it shows is derived
 * from the props, so loading a game in progress or finished shows the right limbs lit with nothing replayed. One-off
 * moves (a limb lighting, a flinch, the win hop, the loss jet, the Blitz flare, a results cheer) only play for changes
 * that happen while it is on screen, and never with reduced motion.
 *
 * Two layers: crisp pixels on top, and under them a blurred copy of only the lit parts and the eyes (the glow). Glow
 * lives on its own HTML-level layer because CSS filters on SVG children are unreliable in Safari.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { reducedMotion } from "../pixel";
import { SQUID } from "./sprite";
import { fireworksFrom } from "./fireworks";
import "./squid.css";

export type SquidMood = "play" | "won" | "lost" | "gave-up";

interface Props {
  /** Classic lights a new limb as the grabbed word lands; Blitz lights it at once. */
  mode: "classic" | "blitz";
  /** Lit limbs, by rank (1-10). */
  lit: readonly number[];
  mood?: SquidMood;
  /** Blitz momentum, 0 (none) to 4 (on fire). */
  heat?: number;
  /** Bump to replay a flinch (a life lost). */
  flinch?: number;
  /** Bump to replay the flare (a new personal best). */
  flare?: number;
  /** The big squid on a results panel. */
  hero?: boolean;
  /** Celebrate once, this many ms after mounting: the perfect-10 hop, or the new-best spin. */
  cheer?: { kind: "win" | "best"; delay: number } | null;
  testId?: string;
}

const { w: W, h: H } = SQUID;
const VIEW = `0 0 ${W} ${H}`;
const MOTES = 8;

/** #1 is gold; #1 and #2 are the long tentacles (their grab strains, so they light a beat later); fresh ones flash. */
const limbClass = (id: number, fresh: ReadonlySet<number>) =>
  `${id === 1 ? " first" : ""}${id <= 2 ? " tentacle" : ""}${fresh.has(id) ? " fresh" : ""}`;

/** Run a one-off move on an element, unless motion is reduced. */
function play(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions) {
  if (!el || reducedMotion() || typeof el.animate !== "function") return;
  el.animate(frames, opts);
}

/** Two hops, the second higher, in squid pixels (so the hero squid jumps further). */
const hop = (el: Element | null, unit: number) =>
  play(
    el,
    [
      { transform: "none" },
      { transform: `translateY(${unit}px) scale(1.1, 0.9)`, offset: 0.12 },
      { transform: `translateY(${-3 * unit}px)`, offset: 0.3 },
      { transform: "none", offset: 0.45 },
      { transform: `translateY(${unit}px) scale(1.12, 0.88)`, offset: 0.55 },
      { transform: `translateY(${-5 * unit}px) scale(0.95, 1.08)`, offset: 0.75 },
      { transform: "none" },
    ],
    { duration: 900, easing: "steps(12, end)" },
  );

/** A quick arcade spin. */
const spin = (el: Element | null) =>
  play(el, [{ transform: "rotate(0)" }, { transform: "rotate(360deg) scale(1.15)", offset: 0.8 }, { transform: "none" }], {
    duration: 520,
    easing: "steps(8, end)",
  });

export function Squid({ mode, lit, mood = "play", heat = 0, flinch = 0, flare = 0, hero = false, cheer = null, testId = "squid" }: Props) {
  const move = useRef<HTMLSpanElement>(null);
  const on = new Set(lit.filter((r) => r >= 1 && r <= 10));
  const key = [...on].sort((a, b) => a - b).join(",");
  const unit = hero ? 4 : 3;

  // Limbs lit since the last change while on screen (none on the first render: a loaded game replays nothing).
  const [seen, setSeen] = useState(key);
  const [fresh, setFresh] = useState<ReadonlySet<number>>(() => new Set());
  if (key !== seen) {
    const before = new Set(seen ? seen.split(",").map(Number) : []);
    setSeen(key);
    setFresh(new Set([...on].filter((r) => !before.has(r))));
  }

  // Sparks for a win or a new best, noticed as the props change (a game loaded already won throws none).
  const [burst, setBurst] = useState<{ kind: "win" | "best"; n: number } | null>(null);
  const [seenMood, setSeenMood] = useState(mood);
  const [seenFlare, setSeenFlare] = useState(flare);
  if (mood !== seenMood) {
    setSeenMood(mood);
    if (seenMood === "play" && mood === "won") setBurst({ kind: "win", n: (burst?.n ?? 0) + 1 });
  }
  if (flare !== seenFlare) {
    setSeenFlare(flare);
    if (flare) setBurst({ kind: "best", n: (burst?.n ?? 0) + 1 });
  }

  const flinchSeen = useRef(flinch);
  useEffect(() => {
    if (flinch === flinchSeen.current) return;
    flinchSeen.current = flinch;
    // Squeeze and recoil: the squid squirts.
    play(
      move.current,
      [
        { transform: "none" },
        { transform: "translate(0, 3px) scale(1.12, 0.84)" },
        { transform: "translate(0, -6px) scale(0.9, 1.1)" },
        { transform: "translate(-2px, 0)" },
        { transform: "none" },
      ],
      { duration: 420, easing: "steps(5, end)" },
    );
  }, [flinch]);

  // Mood changes while on screen: the win hop, the loss jet. A game loaded already over plays nothing.
  const prevMood = useRef(mood);
  useLayoutEffect(() => {
    const from = prevMood.current;
    prevMood.current = mood;
    if (from !== "play" || mood === "play") return;
    if (mood === "won") hop(move.current, unit);
    else if (mood === "lost") {
      // Squeeze, jet off the top of the screen, then drift back in, dim.
      play(
        move.current,
        [
          { transform: "none", opacity: 1 },
          { transform: "translateY(4px) scale(1.15, 0.8)", opacity: 1, offset: 0.12 },
          { transform: "translateY(-160px) scale(0.85, 1.25)", opacity: 1, offset: 0.32 },
          { transform: "translateY(-160px)", opacity: 0, offset: 0.33 },
          { transform: "translateY(-10px)", opacity: 0, offset: 0.7 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 1600, easing: "steps(16, end)" },
      );
    }
  }, [mood, unit]);

  useEffect(() => {
    if (flare) spin(move.current);
  }, [flare]);

  // A results squid's one celebration, once its panel has arrived (the cheer can be decided a moment after mounting,
  // as Blitz learns about a new best; it still plays only once).
  const cheered = useRef(false);
  const cheerKind = cheer?.kind;
  const cheerDelay = cheer?.delay ?? 0;
  useEffect(() => {
    if (!cheerKind || cheered.current || reducedMotion()) return;
    const c = { kind: cheerKind, delay: cheerDelay };
    const t = setTimeout(() => {
      cheered.current = true;
      if (c.kind === "win") {
        hop(move.current, unit);
        if (move.current) fireworksFrom(move.current);
      } else spin(move.current);
      setBurst((b) => ({ kind: c.kind, n: (b?.n ?? 0) + 1 }));
    }, c.delay);
    return () => clearTimeout(t);
  }, [cheerKind, cheerDelay, unit]);

  const style = { "--charge": on.size / 10 } as CSSProperties;
  const lids = mood === "lost" || mood === "gave-up";

  return (
    <span
      className={`squid${hero ? " hero" : ""}`}
      data-testid={testId}
      data-mode={mode}
      data-lit={on.size}
      data-mood={mood}
      data-heat={heat}
      style={style}
      aria-hidden="true"
    >
      <span className="squid-move" ref={move}>
        <svg className="squid-glow" viewBox={VIEW}>
          <path className="g-body" d={SQUID.silhouette} />
          <path className="g-eye" d={SQUID.eyes} />
          {SQUID.limbs.map((l) =>
            on.has(l.id) ? <path key={l.id} className={`g-limb${limbClass(l.id, fresh)}`} d={l.all} /> : null,
          )}
        </svg>
        <svg className="squid-px" viewBox={VIEW} shapeRendering="crispEdges">
          <path className="s-rim" d={SQUID.rim} />
          <path className="s-left" d={SQUID.left} />
          <path className="s-right" d={SQUID.right} />
          <path className="s-spot" d={SQUID.spots} />
          <path className="s-eye" d={SQUID.eyes} />
          <path className="s-pupil" d={SQUID.pupils} />
          {lids && <path className="s-lid" d={SQUID.lids} />}
          {SQUID.limbs.map((l) => (
            <g key={l.id} className={`limb${limbClass(l.id, fresh)}`} data-limb={l.id} data-on={on.has(l.id)}>
              <path className="l-a" d={l.a} />
              <path className="l-b" d={l.b} />
              <g className="tip">
                <path className="l-a" d={l.tipA} />
                {l.tipB && <path className="l-b" d={l.tipB} />}
                {l.suckers && <path className="l-s" d={l.suckers} />}
              </g>
            </g>
          ))}
        </svg>
      </span>
      {mode === "blitz" && !hero && (
        <span className="squid-motes">
          {Array.from({ length: MOTES }, (_, i) => (
            <i key={i} style={{ "--k": i } as CSSProperties} />
          ))}
        </span>
      )}
      {burst && <Sparks key={burst.n} kind={burst.kind} onDone={() => setBurst(null)} />}
    </span>
  );
}

/** Pixels thrown out in two rings: [dx, dy] in squid pixels. */
const RING: [number, number][] = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  const r = i % 2 ? 11 : 15;
  return [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)];
});

function Sparks({ kind, onDone }: { kind: "win" | "best"; onDone: () => void }) {
  return (
    <span className={`squid-sparks ${kind}`} onAnimationEnd={(e) => e.target === e.currentTarget.lastChild && onDone()}>
      {RING.map(([x, y], i) => (
        <i key={i} style={{ "--dx": x, "--dy": y, "--k": i } as CSSProperties} />
      ))}
    </span>
  );
}
