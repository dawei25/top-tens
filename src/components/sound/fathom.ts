/**
 * Fathom's sounds (the estimation game): a soft click on LOCK IN, a sonar ping as the answer shows, then the band's
 * own sound (Dead on a bright rising chord with a sparkle, Close a warm two-note chime, Near one soft note, Far a low
 * thud, Lost at sea a sinking bubble), and a short fanfare on the results that grows with the total. Quiet and short,
 * on the game's chip voices, and only with sound on (the speaker key).
 *
 * `fathomVoices` is pure (what to play), so it can be tested; `playFathom` plays it. Fathom calls these from the press
 * itself (LOCK IN, NEXT), where the sound layer has its audio ready (./index.ts).
 */
import type { Band } from "../../game/fathom";
import { burst, existingAudio, tone, type Noise, type Tone } from "./engine";
import { degreeToFreq, note } from "./music";
import { soundPref } from "./pref";

export type FathomCue =
  /** LOCK IN pressed. */
  | { kind: "lock" }
  /** The answer shows: the ping, then the band's sound. */
  | { kind: "reveal"; band: Band }
  /** The results, with the total (0 to 500). */
  | { kind: "results"; total: number };

export type Voice = { tone: Tone } | { noise: Noise };

/** When the band's sound starts on a reveal, after the click and the ping (seconds). */
export const BAND_AT = 0.45;

const t = (tone: Tone): Voice => ({ tone });

function bandVoices(band: Band, at: number): Voice[] {
  switch (band) {
    case "dead-on": {
      // A quick C major run up, the chord over a bass, and a sparkle on top.
      const run = ["C5", "E5", "G5", "C6"].map((n, i) => t({ freq: note(n), at: at + i * 0.06, dur: 0.05, gain: 0.16 }));
      const chord = at + 0.26;
      return [
        ...run,
        ...["C5", "E5", "G5"].map((n) => t({ freq: note(n), at: chord, dur: 0.3, gain: 0.1, release: 0.3 })),
        t({ freq: note("C6"), at: chord, dur: 0.3, gain: 0.07, wave: "pulse12", release: 0.3 }),
        t({ freq: note("C3"), at: chord, dur: 0.3, gain: 0.35, wave: "triangle", release: 0.3 }),
        t({ freq: note("G6"), at: chord + 0.16, dur: 0.04, gain: 0.06, wave: "pulse12", release: 0.1 }),
        t({ freq: note("C7"), at: chord + 0.23, dur: 0.07, gain: 0.05, wave: "pulse12", release: 0.14 }),
      ];
    }
    case "close":
      // A warm two-note chime, rising a fourth.
      return [
        t({ freq: note("G5"), at, dur: 0.08, gain: 0.28, wave: "triangle", release: 0.35 }),
        t({ freq: note("C6"), at: at + 0.13, dur: 0.1, gain: 0.28, wave: "triangle", release: 0.45 }),
      ];
    case "near":
      return [t({ freq: note("E5"), at, dur: 0.08, gain: 0.22, wave: "triangle", release: 0.25 })];
    case "far":
      // A low thud: a quick drop in pitch with a muffled knock under it.
      return [t({ freq: 150, slideTo: 55, at, dur: 0.1, gain: 0.45, wave: "triangle", release: 0.08 }), { noise: { at, dur: 0.1, gain: 0.06, filter: 300 } }];
    case "lost":
      // A bubble sinking away, and a smaller one after it.
      return [
        t({ freq: 700, slideTo: 160, at, dur: 0.3, gain: 0.2, wave: "triangle", release: 0.1 }),
        t({ freq: 520, slideTo: 130, at: at + 0.14, dur: 0.22, gain: 0.1, wave: "triangle", release: 0.08 }),
      ];
  }
}

/** How big the results' fanfare is: 0 under 100 points, one more step every 100, 5 for a perfect 500. */
export const fanfareLevel = (total: number): number => Math.max(0, Math.min(5, Math.floor(total / 100)));

function fanfareVoices(total: number): Voice[] {
  const level = fanfareLevel(total);
  const at = 0.1;
  // Two notes up the pentatonic from C5, one more per level; the last one held.
  const steps = level + 2;
  const last = at + (steps - 1) * 0.07;
  const out: Voice[] = [];
  for (let i = 0; i < steps; i++) {
    const end = i === steps - 1;
    out.push(t({ freq: degreeToFreq(5 + i), at: at + i * 0.07, dur: end ? 0.2 : 0.05, gain: 0.15, release: end ? 0.25 : 0.06 }));
  }
  const top = degreeToFreq(5 + steps - 1);
  if (level >= 2) out.push(t({ freq: note("C3"), at: last, dur: 0.2, gain: 0.3, wave: "triangle", release: 0.25 }));
  if (level >= 4) for (const f of [top / 2, (top * 3) / 4]) out.push(t({ freq: f, at: last, dur: 0.2, gain: 0.08, release: 0.25 }));
  if (level >= 5) {
    out.push(t({ freq: top * 2, at: last + 0.14, dur: 0.04, gain: 0.05, wave: "pulse12", release: 0.1 }));
    out.push(t({ freq: top * 3, at: last + 0.21, dur: 0.06, gain: 0.04, wave: "pulse12", release: 0.14 }));
  }
  return out;
}

/** What a cue plays: chip voices with their start times (seconds from now). */
export function fathomVoices(cue: FathomCue): Voice[] {
  switch (cue.kind) {
    case "lock":
      // A soft click.
      return [{ noise: { dur: 0.025, gain: 0.05, filter: -2500 } }, t({ freq: 1500, dur: 0.012, gain: 0.06, wave: "triangle", release: 0.02 })];
    case "reveal": {
      // The sonar ping, its faint echo, then the band.
      const ping = { freq: note("E6"), slideTo: 1250, wave: "triangle" as const };
      return [
        t({ ...ping, at: 0.06, dur: 0.05, gain: 0.2, release: 0.45 }),
        t({ ...ping, at: 0.34, dur: 0.03, gain: 0.06, release: 0.3 }),
        ...bandVoices(cue.band, BAND_AT),
      ];
    }
    case "results":
      return fanfareVoices(cue.total);
  }
}

/** When a voice has died away (seconds from now). */
export const voiceEnd = (v: Voice): number =>
  "tone" in v ? (v.tone.at ?? 0) + v.tone.dur + (v.tone.release ?? 0.06) : (v.noise.at ?? 0) + v.noise.dur;

/** Play a cue, if sound is on and the sound layer has its audio (it starts on the press that called this). */
export function playFathom(cue: FathomCue): void {
  if (!soundPref.get()) return;
  const c = existingAudio();
  if (!c) return;
  if (c.state !== "running") void c.resume().catch(() => {});
  for (const v of fathomVoices(cue)) {
    if ("tone" in v) tone(v.tone);
    else burst(v.noise);
  }
}
