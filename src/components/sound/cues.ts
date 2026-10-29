/**
 * Play events in, sound cues out. `react` is pure (which cue, at what pitch, the Blitz momentum and the
 * once-per-round fanfare); `render` turns a cue into chip voices.
 */
import type { PlayEvent } from "../../game/events";
import { blitzDegree, classicFreq, degreeToFreq, NO_MOMENTUM, note, passesBest, stepMomentum, type Momentum } from "./music";
import { burst, tone } from "./engine";

export type Cue =
  /** Classic: a top-10 answer found. */
  | { kind: "found"; rank: number }
  /** Classic: all ten found; flawless with every life kept. */
  | { kind: "perfect"; flawless: boolean }
  /** A miss that cost a life: an ink bloop. */
  | { kind: "ink" }
  /** A free miss (and a Blitz miss): barely there. */
  | { kind: "tick" }
  | { kind: "hint" }
  | { kind: "lose" }
  | { kind: "give-up" }
  /** Blitz: a hit at this pentatonic degree (rank plus momentum); `big` for a real top-10 answer. */
  | { kind: "hit"; degree: number; big: boolean }
  /** Blitz: the hit that passed the previous best. */
  | { kind: "fanfare" }
  | { kind: "time-up"; best: boolean };

export interface CueState {
  momentum: Momentum;
  /** The previous-best fanfare already played this Blitz round. */
  fanfare: boolean;
}
export const START: CueState = { momentum: NO_MOMENTUM, fanfare: false };

/** `now` in ms (any monotonic clock), for momentum. */
export function react(e: PlayEvent, s: CueState, now: number): [CueState, Cue[]] {
  switch (e.kind) {
    case "found":
      return [s, [{ kind: "found", rank: e.rank }]];
    case "miss":
      return [s, [{ kind: e.lifeLost ? "ink" : "tick" }]];
    case "hint":
      return [s, [{ kind: "hint" }]];
    case "end":
      if (e.status === "won") return [s, [{ kind: "perfect", flawless: e.lives >= 5 }]];
      return [s, [{ kind: e.status === "lost" ? "lose" : "give-up" }]];
    case "blitz-start":
      return [START, []];
    case "blitz-hit": {
      const momentum = stepMomentum(s.momentum, now);
      const cues: Cue[] = [{ kind: "hit", degree: blitzDegree(e.rank, momentum.step), big: e.rank >= 1 && e.rank <= 10 }];
      let fanfare = s.fanfare;
      if (!fanfare && passesBest(e.score, e.points, e.best)) {
        fanfare = true;
        cues.push({ kind: "fanfare" });
      }
      return [{ momentum, fanfare }, cues];
    }
    case "blitz-miss":
      return [s, [{ kind: "tick" }]];
    case "blitz-end":
      return [START, [{ kind: "time-up", best: e.best }]];
  }
}

type Step = [name: string, at: number, dur: number];

/** A run of pulse notes: [note, start, length] in seconds. */
function phrase(steps: Step[], gain: number, wave: "pulse12" | "pulse25" | "triangle" = "pulse25", release = 0.06) {
  for (const [n, at, dur] of steps) tone({ freq: note(n), at, dur, gain, wave, release });
}

/** Render one cue; `at` delays it (seconds), so a cue can follow the one before it. */
export function render(c: Cue, at = 0): void {
  switch (c.kind) {
    case "found": {
      const f = classicFreq(c.rank);
      tone({ freq: f, at, dur: 0.1, gain: 0.32, release: 0.14 });
      // A faint octave sparkle, like a coin.
      tone({ freq: f * 2, at: at + 0.055, dur: 0.04, gain: 0.07, wave: "pulse12", release: 0.08 });
      return;
    }
    case "perfect": {
      // Follows the tenth note: a quick C major run, then the chord over a triangle bass.
      const t = at + 0.2;
      phrase([["C5", t, 0.05], ["E5", t + 0.07, 0.05], ["G5", t + 0.14, 0.05], ["C6", t + 0.21, 0.05]], 0.2);
      const chord = t + 0.3;
      for (const n of ["C5", "E5", "G5"]) tone({ freq: note(n), at: chord, dur: 0.42, gain: 0.11, release: 0.35 });
      tone({ freq: note("C6"), at: chord, dur: 0.42, gain: 0.08, wave: "pulse12", release: 0.35 });
      tone({ freq: note("C3"), at: chord, dur: 0.42, gain: 0.4, wave: "triangle", release: 0.35 });
      // Flawless (no life lost): a little sparkle on top.
      if (c.flawless) phrase([["G6", chord + 0.16, 0.04], ["C7", chord + 0.23, 0.08]], 0.06, "pulse12", 0.12);
      return;
    }
    case "ink":
      // A low, soft bloop, with a wet splat of filtered noise under it.
      tone({ freq: 330, slideTo: 80, at, dur: 0.16, gain: 0.5, wave: "triangle", release: 0.08 });
      burst({ at, dur: 0.14, gain: 0.07, filter: 500 });
      return;
    case "tick":
      burst({ at, dur: 0.02, gain: 0.035, filter: -5000 });
      return;
    case "hint":
      // Two soft notes, rising: a question.
      tone({ freq: note("E5"), at, dur: 0.07, gain: 0.3, wave: "triangle", release: 0.08 });
      tone({ freq: note("A5"), at: at + 0.11, dur: 0.1, gain: 0.3, wave: "triangle", release: 0.12 });
      return;
    case "lose": {
      // After the last ink bloop: A minor pentatonic, falling, settling low.
      const t = at + 0.32;
      phrase([["E5", t, 0.08], ["D5", t + 0.13, 0.08], ["C5", t + 0.26, 0.08]], 0.18);
      tone({ freq: note("A4"), slideTo: note("G4"), at: t + 0.39, dur: 0.32, gain: 0.18, release: 0.2 });
      tone({ freq: note("A2"), at: t + 0.39, dur: 0.32, gain: 0.35, wave: "triangle", release: 0.2 });
      return;
    }
    case "give-up":
      phrase([["D5", at + 0.05, 0.08], ["A4", at + 0.18, 0.22]], 0.2, "triangle", 0.15);
      return;
    case "hit": {
      const f = degreeToFreq(c.degree);
      tone({ freq: f, at, dur: 0.07, gain: 0.26, release: 0.09 });
      // A real top-10 answer lands with some weight.
      if (c.big) tone({ freq: f / 2, at, dur: 0.07, gain: 0.3, wave: "triangle", release: 0.09 });
      return;
    }
    case "fanfare": {
      const t = at + 0.12;
      phrase([["G5", t, 0.04], ["C6", t + 0.055, 0.04], ["E6", t + 0.11, 0.04]], 0.14, "pulse12");
      tone({ freq: note("G6"), at: t + 0.165, dur: 0.16, gain: 0.14, wave: "pulse12", release: 0.16 });
      tone({ freq: note("C4"), at: t + 0.165, dur: 0.16, gain: 0.35, wave: "triangle", release: 0.16 });
      return;
    }
    case "time-up": {
      const t = at + 0.05;
      // Two blips, then the answer: down to C for a plain round, up to a bright chord for a new best.
      phrase([["G5", t, 0.05], ["G5", t + 0.1, 0.05]], 0.2);
      if (!c.best) {
        tone({ freq: note("C5"), at: t + 0.22, dur: 0.26, gain: 0.2, release: 0.2 });
        tone({ freq: note("C3"), at: t + 0.22, dur: 0.26, gain: 0.35, wave: "triangle", release: 0.2 });
        return;
      }
      phrase([["C6", t + 0.22, 0.04], ["E6", t + 0.28, 0.04]], 0.13, "pulse12");
      for (const n of ["C6", "E6", "G6"]) tone({ freq: note(n), at: t + 0.34, dur: 0.36, gain: 0.09, wave: "pulse12", release: 0.3 });
      tone({ freq: note("C4"), at: t + 0.34, dur: 0.36, gain: 0.3, wave: "triangle", release: 0.3 });
      return;
    }
  }
}

/** Turning sound on: a soft two-blip confirmation, so the player hears that it works. */
export function renderOn(): void {
  tone({ freq: note("C6"), dur: 0.035, gain: 0.12, wave: "pulse12", release: 0.05 });
  tone({ freq: note("G6"), at: 0.06, dur: 0.05, gain: 0.1, wave: "pulse12", release: 0.08 });
}
