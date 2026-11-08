/**
 * The squid's own sounds, for the tap easter egg (components/ocean): not play events, so not in cues.ts. Like every
 * cue, silent unless sound is on, and never the one to create the AudioContext (the press that tapped the squid
 * already woke it, in sound/index.ts).
 */
import { burst, existingAudio, tone } from "./engine";
import { note } from "./music";
import { soundPref } from "./pref";

/** A tap: a little rising boop. A trick (a few taps in a row): a whirl up, then a soft squirt of ink. */
export type SquidSound = "boop" | "trick";

export function squidSound(kind: SquidSound): void {
  if (!soundPref.get()) return;
  const c = existingAudio();
  if (!c) return;
  if (c.state !== "running") void c.resume().catch(() => {});
  renderSquidSound(kind);
}

export function renderSquidSound(kind: SquidSound): void {
  if (kind === "boop") {
    tone({ freq: note("E5"), slideTo: note("B5"), dur: 0.05, gain: 0.14, wave: "pulse12", release: 0.05 });
    return;
  }
  // The spin: four quick blips up the scale; then, as it inks and darts off, a low bloop and a puff of noise.
  ["C5", "E5", "G5", "C6"].forEach((n, i) => tone({ freq: note(n), at: i * 0.07, dur: 0.035, gain: 0.11, wave: "pulse12", release: 0.04 }));
  tone({ freq: 520, slideTo: 140, at: 0.55, dur: 0.12, gain: 0.2, wave: "triangle", release: 0.06 });
  burst({ at: 0.55, dur: 0.1, gain: 0.04, filter: 700 });
}
