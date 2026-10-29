/**
 * Play events: what just happened in a round, for the feedback layers (the squid, sound). The game screens emit;
 * layers listen. Nothing here changes game state, and a listener that throws never breaks play.
 */
export type PlayEvent =
  /** Classic: a top-10 answer found (by guess). `found` counts the answers found so far, this one included. */
  | { kind: "found"; rank: number; found: number }
  /** Classic: a guess that found nothing new. `lifeLost` when it cost a life; `rank` for a real answer outside the top 10. */
  | { kind: "miss"; lifeLost: boolean; rank?: number }
  /** Classic: a first-letter hint, paid with a life. */
  | { kind: "hint"; rank: number; lives: number }
  /** Classic: the round ended. `lives` left; a win with every life kept is flawless. */
  | { kind: "end"; status: "won" | "lost" | "gave-up"; lives: number; found: number }
  /** Blitz: the clock started (first keystroke). */
  | { kind: "blitz-start" }
  /** Blitz: an answer scored. `rank` is its place on the list; `score` the running total. */
  | { kind: "blitz-hit"; rank: number; points: number; score: number; best?: number }
  /** Blitz: a guess that scored nothing. */
  | { kind: "blitz-miss" }
  /** Blitz: time's up. `best` when this round beat the list's previous best. */
  | { kind: "blitz-end"; score: number; best: boolean };

type Listener = (e: PlayEvent) => void;
const listeners = new Set<Listener>();

/** Listen for play events; returns the unsubscribe function. */
export function onPlay(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitPlay(e: PlayEvent): void {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      console.error(err);
    }
  }
}
