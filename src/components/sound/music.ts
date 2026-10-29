/**
 * The pure half of the sound layer: notes, the scale, rank-to-pitch and Blitz momentum. No Web Audio here, so it
 * can be unit tested.
 *
 * Everything sits on C major pentatonic (C D E G A): any order of notes makes a pleasant tune, and there is no
 * semitone in it to clash.
 */

/** Semitone offsets of the major pentatonic within one octave. */
const PENTATONIC = [0, 2, 4, 7, 9];
/** MIDI note of degree 0: C4 (middle C, 261.6 Hz). */
const BASE_MIDI = 60;

export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Pentatonic degree (0 = C4, 5 = C5, ...; negative goes below C4) to its MIDI note. */
export function degreeToMidi(degree: number): number {
  const d = Math.round(degree);
  const octave = Math.floor(d / PENTATONIC.length);
  const step = d - octave * PENTATONIC.length;
  return BASE_MIDI + 12 * octave + PENTATONIC[step];
}

export function degreeToFreq(degree: number): number {
  return midiToFreq(degreeToMidi(degree));
}

/** Named notes for the jingles, e.g. note("E5"). Accepts C..B with an optional # and an octave. */
export function note(name: string): number {
  const m = name.match(/^([A-G])(#?)(-?\d)$/);
  if (!m) throw new Error(`bad note ${name}`);
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as "C"] + (m[2] ? 1 : 0);
  return midiToFreq(12 * (Number(m[3]) + 1) + pc);
}

/**
 * Classic: rank 10 is the lowest note (G4), rank 1 the highest (E6), one pentatonic step apart: ten notes, ten slots.
 * Ranks outside 1-10 are clamped.
 */
export const CLASSIC_LOW = 3; // G4
export function classicDegree(rank: number): number {
  const r = Math.min(10, Math.max(1, Math.round(rank)));
  return CLASSIC_LOW + (10 - r);
}
export function classicFreq(rank: number): number {
  return degreeToFreq(classicDegree(rank));
}

/**
 * Blitz: lists run far past 10 (every country counts), so pitch follows rank on a log scale, one octave per factor
 * of ten: #1 is C6, #10 is C5, #100 and below bottom out at C4. Bigger answers ring higher; momentum (below) adds
 * whole pentatonic steps on top.
 */
export const BLITZ_TOP = 10; // C6
export function blitzDegree(rank: number, momentum = 0): number {
  const r = Math.max(1, rank);
  const base = Math.max(0, BLITZ_TOP - Math.round(5 * Math.log10(r)));
  return base + momentum;
}

/**
 * Blitz momentum: hits in quick succession step the pitch up one pentatonic degree each, up to MOMENTUM_MAX.
 * A gap longer than MOMENTUM_WINDOW_MS since the last hit starts over at 0.
 */
export const MOMENTUM_WINDOW_MS = 3000;
export const MOMENTUM_MAX = 4;
export interface Momentum {
  step: number;
  /** Time of the last hit (ms, any monotonic clock); undefined before the first hit. */
  at?: number;
}
export const NO_MOMENTUM: Momentum = { step: 0 };
export function stepMomentum(prev: Momentum, now: number): Momentum {
  const quick = prev.at !== undefined && now - prev.at <= MOMENTUM_WINDOW_MS;
  return { step: quick ? Math.min(MOMENTUM_MAX, prev.step + 1) : 0, at: now };
}

/**
 * Whether this Blitz hit is the one that passes the previous best: before it the score was at or under the best,
 * after it above. A best of 0 (or none) is nothing to pass.
 */
export function passesBest(score: number, points: number, best: number | undefined): boolean {
  if (!best || best <= 0) return false;
  return score > best && score - points <= best;
}

/**
 * Fourier coefficients of a pulse wave with the given duty cycle (0.125, 0.25, 0.5), for createPeriodicWave.
 * The NES pulse channels use 12.5%, 25% and 50%; 25% is the classic "chip" voice, thinner than a square.
 */
export function pulseCoefficients(duty: number, harmonics = 64): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    // A pulse of width d, centered on t = 0, is a cosine series with a_n = 2 sin(n pi d) / (n pi).
    real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  }
  return { real, imag };
}
