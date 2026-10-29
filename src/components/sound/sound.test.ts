import { describe, expect, it } from "vitest";
import {
  blitzDegree,
  classicDegree,
  classicFreq,
  degreeToFreq,
  degreeToMidi,
  MOMENTUM_MAX,
  MOMENTUM_WINDOW_MS,
  NO_MOMENTUM,
  note,
  passesBest,
  stepMomentum,
  type Momentum,
} from "./music";
import { react, START, type Cue, type CueState } from "./cues";
import { createSoundPref, readSoundPref, SOUND_KEY, writeSoundPref, type PrefStorage } from "./pref";
import type { PlayEvent } from "../../game/events";

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.01);

describe("notes and the scale", () => {
  it("names notes in equal temperament", () => {
    close(note("A4"), 440);
    close(note("C4"), 261.63);
    close(note("C#4"), 277.18);
  });
  it("walks C major pentatonic across octaves", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(degreeToMidi)).toEqual([60, 62, 64, 67, 69, 72, 74]);
    expect(degreeToMidi(-1)).toBe(57);
    close(degreeToFreq(5), note("C5"));
  });
});

describe("classic: rank to pitch", () => {
  it("gives every rank its own note, #1 highest", () => {
    const freqs = Array.from({ length: 10 }, (_, i) => classicFreq(i + 1));
    expect(new Set(freqs).size).toBe(10);
    for (let i = 1; i < 10; i++) expect(freqs[i - 1]).toBeGreaterThan(freqs[i]);
  });
  it("spans G4 (#10) to E6 (#1)", () => {
    close(classicFreq(10), note("G4"));
    close(classicFreq(1), note("E6"));
  });
  it("clamps ranks outside 1-10", () => {
    expect(classicDegree(0)).toBe(classicDegree(1));
    expect(classicDegree(14)).toBe(classicDegree(10));
  });
});

describe("blitz: rank to pitch", () => {
  it("rises with rank, an octave per factor of ten", () => {
    expect(blitzDegree(1)).toBe(10);
    expect(blitzDegree(10)).toBe(5);
    expect(blitzDegree(100)).toBe(0);
    expect(blitzDegree(5000)).toBe(0);
    for (const [hi, lo] of [[1, 2], [2, 5], [5, 20], [20, 60]]) expect(blitzDegree(hi)).toBeGreaterThan(blitzDegree(lo));
  });
  it("adds momentum on top", () => {
    expect(blitzDegree(10, 3)).toBe(blitzDegree(10) + 3);
  });
});

describe("blitz momentum", () => {
  const run = (times: number[]) => times.reduce<Momentum[]>((acc, t) => [...acc, stepMomentum(acc.at(-1) ?? NO_MOMENTUM, t)], []);

  it("starts at 0 and steps up on quick hits", () => {
    expect(run([0, 1000, 2000, 2500]).map((m) => m.step)).toEqual([0, 1, 2, 3]);
  });
  it("caps", () => {
    const steps = run(Array.from({ length: 10 }, (_, i) => i * 500)).map((m) => m.step);
    expect(Math.max(...steps)).toBe(MOMENTUM_MAX);
    expect(steps.at(-1)).toBe(MOMENTUM_MAX);
  });
  it("resets after a pause", () => {
    expect(run([0, 1000, 1000 + MOMENTUM_WINDOW_MS, 2000 + 2 * MOMENTUM_WINDOW_MS + 1]).map((m) => m.step)).toEqual([0, 1, 2, 0]);
  });
});

describe("passing the previous best", () => {
  it("fires only on the hit that crosses it", () => {
    expect(passesBest(110, 20, 100)).toBe(true);
    expect(passesBest(120, 10, 100)).toBe(false); // already past
    expect(passesBest(100, 20, 100)).toBe(false); // tied, not passed
    expect(passesBest(50, 20, undefined)).toBe(false);
    expect(passesBest(50, 50, 0)).toBe(false);
  });
});

describe("cues for play events", () => {
  const feed = (events: [PlayEvent, number?][]) => {
    let s: CueState = START;
    const out: Cue[][] = [];
    for (const [e, t = 0] of events) {
      const [next, cues] = react(e, s, t);
      s = next;
      out.push(cues);
    }
    return out;
  };

  it("classic: found, misses, hint, ends", () => {
    const out = feed([
      [{ kind: "found", rank: 3, found: 1 }],
      [{ kind: "miss", lifeLost: true, rank: 14 }],
      [{ kind: "miss", lifeLost: false }],
      [{ kind: "hint", rank: 2, lives: 3 }],
      [{ kind: "end", status: "won", lives: 5, found: 10 }],
      [{ kind: "end", status: "won", lives: 2, found: 10 }],
      [{ kind: "end", status: "lost", lives: 0, found: 4 }],
      [{ kind: "end", status: "gave-up", lives: 3, found: 4 }],
    ]);
    expect(out).toEqual([
      [{ kind: "found", rank: 3 }],
      [{ kind: "ink" }],
      [{ kind: "tick" }],
      [{ kind: "hint" }],
      [{ kind: "perfect", flawless: true }],
      [{ kind: "perfect", flawless: false }],
      [{ kind: "lose" }],
      [{ kind: "give-up" }],
    ]);
  });

  it("blitz: momentum climbs on quick hits and the best fanfare plays once a round", () => {
    const hit = (rank: number, points: number, score: number, best?: number): PlayEvent => ({ kind: "blitz-hit", rank, points, score, best });
    const out = feed([
      [{ kind: "blitz-start" }, 0],
      [hit(10, 50, 50, 120), 100],
      [hit(10, 50, 100, 120), 1100],
      [hit(10, 50, 150, 120), 2100], // passes 120
      [hit(10, 50, 200, 120), 9000], // after a pause: momentum back to 0, no second fanfare
      [{ kind: "blitz-miss" }, 9100],
      [{ kind: "blitz-end", score: 200, best: true }, 10000],
      [{ kind: "blitz-start" }, 20000],
      [hit(10, 150, 150, 120), 20100], // a new round may pass it again
    ]);
    const base = blitzDegree(10);
    expect(out[1]).toEqual([{ kind: "hit", degree: base, big: true }]);
    expect(out[2]).toEqual([{ kind: "hit", degree: base + 1, big: true }]);
    expect(out[3]).toEqual([{ kind: "hit", degree: base + 2, big: true }, { kind: "fanfare" }]);
    expect(out[4]).toEqual([{ kind: "hit", degree: base, big: true }]);
    expect(out[5]).toEqual([{ kind: "tick" }]);
    expect(out[6]).toEqual([{ kind: "time-up", best: true }]);
    expect(out[8]).toEqual([{ kind: "hit", degree: base, big: true }, { kind: "fanfare" }]);
  });

  it("blitz: an answer outside the top 10 is not big", () => {
    const [, cues] = react({ kind: "blitz-hit", rank: 40, points: 20, score: 20 }, START, 0);
    expect(cues).toEqual([{ kind: "hit", degree: blitzDegree(40), big: false }]);
  });
});

describe("sound preference", () => {
  const fake = (init: Record<string, string> = {}) => {
    const data = new Map(Object.entries(init));
    const s: PrefStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)) };
    return { s, data };
  };
  const broken: PrefStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };

  it("is off by default and for anything but 'on'", () => {
    expect(readSoundPref(fake().s)).toBe(false);
    expect(readSoundPref(fake({ [SOUND_KEY]: "yes" }).s)).toBe(false);
    expect(readSoundPref(fake({ [SOUND_KEY]: "on" }).s)).toBe(true);
    expect(readSoundPref(undefined)).toBe(false);
  });

  it("round-trips under its own key", () => {
    const { s, data } = fake({ "top-tens:v1": "{}" });
    writeSoundPref(true, s);
    expect(data.get(SOUND_KEY)).toBe("on");
    expect(readSoundPref(s)).toBe(true);
    writeSoundPref(false, s);
    expect(readSoundPref(s)).toBe(false);
    expect(data.get("top-tens:v1")).toBe("{}");
  });

  it("survives storage that throws", () => {
    expect(readSoundPref(broken)).toBe(false);
    expect(() => writeSoundPref(true, broken)).not.toThrow();
    const pref = createSoundPref(broken);
    pref.set(true);
    expect(pref.get()).toBe(true);
  });

  it("store: notifies on change, persists, and a new store reads it back", () => {
    const { s } = fake();
    const pref = createSoundPref(s);
    let calls = 0;
    const off = pref.subscribe(() => calls++);
    expect(pref.get()).toBe(false);
    pref.set(true);
    pref.set(true); // no change, no notice
    expect(calls).toBe(1);
    expect(createSoundPref(s).get()).toBe(true);
    off();
    pref.set(false);
    expect(calls).toBe(1);
    expect(createSoundPref(s).get()).toBe(false);
  });
});
