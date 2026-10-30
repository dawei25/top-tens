/**
 * The squid as each screen uses it. Lit limbs and mood come from game state (props); play events only drive the
 * one-offs (Blitz momentum, the personal-best flare, the score bump). The playing squid roams the ocean behind the
 * app: ClassicSquid and BlitzSquid render nothing themselves, they hand their state to the ocean.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { onPlay } from "../../game/events";
import type { BlitzHit } from "../../game/blitz";
import type { GameState } from "../../game/state";
import { setOceanSquid, type OceanSquidState } from "../ocean/store";
import { reducedMotion } from "../pixel";
import { Squid, type SquidMood } from "./Squid";

let sessions = 0;

/** Show this screen's squid state in the ocean while mounted; back to plain roaming after. */
function useOceanSquid(s: Omit<OceanSquidState, "session">) {
  const [session] = useState(() => ++sessions);
  const { mode, mood, heat, flare } = s;
  const lit = s.lit.join(",");
  useLayoutEffect(() => {
    setOceanSquid({ session, mode, mood, heat, flare, lit: lit ? lit.split(",").map(Number) : [] });
  }, [session, mode, lit, mood, heat, flare]);
  useLayoutEffect(() => () => setOceanSquid(null), []);
}

const moodOf = (status: GameState["status"]): SquidMood => (status === "playing" ? "play" : status);

/** Classic: one limb per answer found; dims when the round is lost or given up. */
export function ClassicSquid({ found, status }: { found: readonly number[]; status: GameState["status"] }) {
  useOceanSquid({ mode: "classic", lit: found, mood: moodOf(status), heat: 0, flare: 0 });
  return null;
}

/**
 * The big squid on the classic results panel: the found ranks lit, the same moods as the roaming squid. A game won
 * on screen gets its hop and fireworks here (the roaming squid loops behind the glass): `cheerAt` is when, in ms
 * after the panel mounts.
 */
export function ResultsSquid({ found, status, cheerAt }: { found: readonly number[]; status: GameState["status"]; cheerAt?: number }) {
  return (
    <Squid
      mode="classic"
      hero
      testId="results-squid"
      lit={found}
      mood={status === "playing" ? "play" : status}
      cheer={status === "won" && cheerAt !== undefined ? { kind: "win", delay: cheerAt } : null}
    />
  );
}

/** The big squid on the Blitz results panel: the list's top-10 answers scored are lit; a new best spins it. */
export function BlitzResultsSquid({ hits, best }: { hits: readonly BlitzHit[]; best: boolean }) {
  const lit = hits.filter((h) => h.rank >= 1 && h.rank <= 10).map((h) => h.rank);
  return (
    <Squid
      mode="blitz"
      hero
      testId="results-squid"
      lit={lit}
      mood={lit.length === 10 ? "won" : "play"}
      cheer={best ? { kind: "best", delay: 700 } : null}
    />
  );
}

/** Hits closer together than this build momentum; further apart, it starts over. */
const STREAK_MS = 4000;
/** Momentum holds this long after the last hit, then drops a level every DECAY_STEP_MS. */
const HOLD_MS = 2500;
const DECAY_STEP_MS = 1300;
const MAX_HEAT = 4;

/**
 * Blitz: a limb lights for each top-10 answer scored. Quick hits stack up a glow (momentum) that fades over a few
 * seconds without one; passing the list's previous best flares once a round.
 */
export function BlitzSquid({ hits }: { hits: readonly BlitzHit[] }) {
  const [heat, setHeat] = useState(0);
  const [flare, setFlare] = useState(0);
  const heatRef = useRef(0);
  useEffect(() => {
    let last = -Infinity;
    let flared = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const set = (n: number) => {
      heatRef.current = n;
      setHeat(n);
    };
    const decay = () => {
      set(Math.max(0, heatRef.current - 1));
      timer = heatRef.current > 0 ? setTimeout(decay, DECAY_STEP_MS) : undefined;
    };
    const off = onPlay((e) => {
      if (e.kind === "blitz-start") {
        flared = false;
        last = -Infinity;
      } else if (e.kind === "blitz-end") {
        clearTimeout(timer);
        set(0);
      } else if (e.kind === "blitz-hit") {
        const now = performance.now();
        set(now - last < STREAK_MS ? Math.min(MAX_HEAT, heatRef.current + 1) : 1);
        last = now;
        clearTimeout(timer);
        timer = setTimeout(decay, HOLD_MS);
        if (!flared && e.best !== undefined && e.score > e.best) {
          flared = true;
          setFlare((n) => n + 1);
        }
      }
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  const lit = hits.filter((h) => h.rank >= 1 && h.rank <= 10).map((h) => h.rank);
  useOceanSquid({ mode: "blitz", lit, mood: "play", heat, flare });
  return null;
}

/**
 * Bumps the score next to it (the sibling marked data-motion="score") each time it goes up: a small gain nudges it,
 * a big one pops it with a little shake. Works on the element itself (no re-render, no remount), so its text and
 * live region are untouched.
 */
export function ScoreBump({ score }: { score: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(score);
  useEffect(() => {
    const gain = score - prev.current;
    prev.current = score;
    const el = ref.current?.parentElement?.querySelector<HTMLElement>('[data-motion="score"]');
    if (gain <= 0 || !el || reducedMotion() || typeof el.animate !== "function") return;
    // Points run 10 to 100: 0 for a small answer, 1 for a top one.
    const k = Math.min(1, Math.max(0, (gain - 10) / 80));
    const s = 1.06 + 0.2 * k;
    const shake = k > 0.45 ? 2 + 3 * k : 0;
    el.animate(
      [
        { transform: "none" },
        { transform: `scale(${s}) translateX(${-shake}px)`, offset: 0.25 },
        { transform: `scale(${1 + (s - 1) * 0.6}) translateX(${shake}px)`, offset: 0.5 },
        { transform: `scale(${1 + (s - 1) * 0.25}) translateX(${-shake / 2}px)`, offset: 0.75 },
        { transform: "none" },
      ],
      { duration: 180 + 220 * k, easing: "steps(6, end)" },
    );
    if (k > 0.6)
      el.animate([{ textShadow: "0 0 18px rgba(255, 209, 102, 0.9)" }, { textShadow: "0 0 0 transparent" }], {
        duration: 500,
        easing: "steps(5, end)",
      });
  }, [score]);
  return <span ref={ref} hidden />;
}
