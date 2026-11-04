import type { OutboxKind } from "./outbox";
import { LIST_ID } from "./plays";
import type { RatingMode } from "./ratings";

/**
 * "add a note" under "Good list?": a few words on a list in a mode, for the improvement loop (docs/IMPROVE.md). Only in
 * a build with a backend: sent to submit_feedback (supabase/migrations), never kept in the save or synced. The database
 * checks the same things, so keep the two in step.
 */

/** The longest note, in characters (the database counts characters too). */
export const MAX_NOTE = 500;

export interface Feedback {
  listId: string;
  mode: RatingMode;
  /** The player's rating of the list when they wrote the note: 1, -1, or null for none. */
  rating: -1 | 1 | null;
  /** As cleanNote leaves it: 1 to MAX_NOTE characters. */
  text: string;
  /** Epoch ms it was written: names it in the outbox. */
  at: number;
}

/** A note as it's sent: one kind of line break, no other control characters, nothing blank at either end. */
export function cleanNote(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/(?![\n\t])\p{Cc}/gu, "")
    .trim();
}

/** Its length as the database counts it: characters (code points), not UTF-16 units. */
export const noteLength = (text: string): number => [...text].length;

/** Why the server would refuse this note, or null if it's fine. */
export function invalidFeedback(f: Feedback): string | null {
  if (typeof f?.listId !== "string" || !LIST_ID.test(f.listId)) return "list id";
  if (f.mode !== "list" && f.mode !== "blitz") return "mode";
  if (f.rating !== -1 && f.rating !== 1 && f.rating !== null) return "rating";
  if (typeof f.text !== "string" || cleanNote(f.text) !== f.text) return "text";
  const n = noteLength(f.text);
  if (n < 1 || n > MAX_NOTE) return "length";
  if (!Number.isFinite(f.at)) return "at";
  return null;
}

/** Notes in the outbox: every one waits its turn (a player may send several), each named by list, mode and time. */
export const FEEDBACK: OutboxKind<Feedback> = {
  key: (f) => `${f.mode}:${f.listId}:${f.at}`,
  invalid: (f) => invalidFeedback(f),
};

/** The arguments of the submit_feedback database function. */
export function feedbackArgs(f: Feedback, clientId: string) {
  return { p_list_id: f.listId, p_mode: f.mode, p_rating: f.rating, p_text: f.text, p_client_id: clientId };
}
