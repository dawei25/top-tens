/**
 * The Web Audio half of the sound layer: one lazily created AudioContext, one master gain, and three chip voices
 * (pulse, triangle, noise) with short envelopes. Every call is a no-op without Web Audio, and nothing here throws.
 */
import { pulseCoefficients } from "./music";

/** Master volume. Voices peak well under 1 on top of this, so the loudest chord stays modest. */
export const MASTER_GAIN = 0.45;

type Ctor = typeof AudioContext;
function audioCtor(): Ctor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext;
}

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
let failed = false;
const pulses = new Map<number, PeriodicWave>();
let noiseBuffer: AudioBuffer | undefined;

/**
 * The context, created on first call (call it from a user gesture) and resumed if suspended (iOS Safari starts
 * it suspended, and suspends it again after interruptions). Undefined when Web Audio is missing or broken.
 */
export function audio(): AudioContext | undefined {
  if (failed) return undefined;
  try {
    if (!ctx) {
      const C = audioCtor();
      if (!C) {
        failed = true;
        return undefined;
      }
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    }
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    failed = true;
    return undefined;
  }
}

/** The context only if it already exists (never creates one: that needs a gesture). */
export function existingAudio(): AudioContext | undefined {
  return ctx;
}

/** Sound off: let the device sleep its audio hardware. */
export function suspendAudio(): void {
  try {
    if (ctx && ctx.state === "running") void ctx.suspend().catch(() => {});
  } catch {
    // ignore
  }
}

function pulseWave(c: AudioContext, duty: number): PeriodicWave {
  let w = pulses.get(duty);
  if (!w) {
    const { real, imag } = pulseCoefficients(duty);
    w = c.createPeriodicWave(real, imag);
    pulses.set(duty, w);
  }
  return w;
}

function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    const len = Math.floor(c.sampleRate * 0.5);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    // 1-bit noise held for a few samples, like the NES noise channel: grittier than white noise.
    let v = 1;
    for (let i = 0; i < len; i++) {
      if (i % 4 === 0) v = Math.random() < 0.5 ? -1 : 1;
      data[i] = v;
    }
  }
  return noiseBuffer;
}

export type Wave = "pulse12" | "pulse25" | "square" | "triangle";

export interface Tone {
  freq: number;
  /** Seconds from now. */
  at?: number;
  /** Seconds the note sounds before its release. */
  dur: number;
  /** Peak gain before the master (0-1). */
  gain: number;
  wave?: Wave;
  /** Glide to this frequency over the note (a bloop, a slide). */
  slideTo?: number;
  /** Release time in seconds. */
  release?: number;
}

/** High notes sound louder at the same gain; tame them so a fast Blitz never gets shrill. */
function loudness(freq: number): number {
  return freq <= 900 ? 1 : Math.max(0.45, (900 / freq) ** 0.7);
}

export function tone(t: Tone): void {
  const c = ctx;
  if (!c || !master || c.state === "closed") return;
  try {
    const start = c.currentTime + 0.005 + (t.at ?? 0);
    const release = t.release ?? 0.06;
    const end = start + t.dur + release;
    const osc = c.createOscillator();
    const wave = t.wave ?? "pulse25";
    if (wave === "pulse12") osc.setPeriodicWave(pulseWave(c, 0.125));
    else if (wave === "pulse25") osc.setPeriodicWave(pulseWave(c, 0.25));
    else osc.type = wave;
    osc.frequency.setValueAtTime(t.freq, start);
    if (t.slideTo) osc.frequency.exponentialRampToValueAtTime(t.slideTo, start + t.dur + release);
    const g = c.createGain();
    const peak = t.gain * loudness(t.freq);
    // Chip envelope: near-instant attack, a quick drop to a sustain, then a short release. No clicks.
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.004);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.55, 0.0002), start + Math.min(0.08, t.dur));
    g.gain.setValueAtTime(Math.max(peak * 0.55, 0.0002), start + t.dur);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(end + 0.02);
    osc.onended = () => g.disconnect();
  } catch {
    // ignore
  }
}

export interface Noise {
  at?: number;
  dur: number;
  gain: number;
  /** Lowpass cutoff in Hz (soft, wet sounds) or highpass with a negative value (a dry tick). */
  filter?: number;
}

export function burst(n: Noise): void {
  const c = ctx;
  if (!c || !master || c.state === "closed") return;
  try {
    const start = c.currentTime + 0.005 + (n.at ?? 0);
    const src = c.createBufferSource();
    src.buffer = noise(c);
    const f = c.createBiquadFilter();
    const cutoff = n.filter ?? 2000;
    f.type = cutoff < 0 ? "highpass" : "lowpass";
    f.frequency.value = Math.abs(cutoff);
    const g = c.createGain();
    g.gain.setValueAtTime(n.gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
    src.connect(f).connect(g).connect(master);
    src.start(start, Math.random() * 0.3);
    src.stop(start + n.dur + 0.02);
    src.onended = () => g.disconnect();
  } catch {
    // ignore
  }
}
