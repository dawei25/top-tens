/**
 * What the roaming squid shows, set by the screen on top (Game, Blitz) and read by the ocean behind every screen.
 * A screen publishes its persistent state (lit limbs, mood, Blitz momentum); with no screen publishing (Home,
 * Archive, Past runs) the squid just roams, unlit. Also where the squid is right now, for the effects in front of
 * the glass (the ink dim centres on it).
 */
import type { SquidMood } from "../squid/Squid";

export interface OceanSquidState {
  /** Which screen published it: a new one gets a fresh squid (nothing replays from the screen before). */
  session: number;
  mode: "classic" | "blitz" | "roam";
  /** Lit limbs, by rank (1-10). */
  lit: readonly number[];
  mood: SquidMood;
  /** Blitz momentum, 0-4. */
  heat: number;
  /** Bumped once per round when the score passes the list's best. */
  flare: number;
}

const ROAM: OceanSquidState = { session: 0, mode: "roam", lit: [], mood: "play", heat: 0, flare: 0 };
let state = ROAM;
const subs = new Set<() => void>();

const same = (a: OceanSquidState, b: OceanSquidState) =>
  a.session === b.session && a.mode === b.mode && a.mood === b.mood && a.heat === b.heat && a.flare === b.flare && a.lit.join() === b.lit.join();

/** Publish the squid's state (null: back to roaming). */
export function setOceanSquid(next: OceanSquidState | null) {
  const s = next ?? ROAM;
  if (same(s, state)) return;
  state = s;
  for (const fn of subs) fn();
}

export function subscribeOceanSquid(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export const getOceanSquid = () => state;

/** The squid's centre in viewport CSS px, kept current by the ocean (live is false while none is running). */
export const squidAt = { x: 0, y: 0, live: false };
