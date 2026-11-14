import type { ListRating, RatingReason, Saved } from "../game/storage";
import type { OutboxKind } from "./outbox";
import { LIST_ID } from "./plays";

/**
 * "Good list?": a thumbs up or down on a list in a mode, after its results, or on a Fathom question (mode "fathom", the
 * question's id as the list id: the same mechanics and tables, the owner, Nov 14). Kept in the save (so it shows as
 * chosen later, offline and without a backend, and syncs), and sent to rate_list (supabase/migrations) when there is a
 * backend. The database checks the same things, so keep the two in step.
 */

export type { RatingReason } from "../game/storage";

/** What can be rated, and have notes: a list game, a Blitz round, a Fathom question (rate_list, submit_feedback). */
export const RATING_MODES = ["list", "blitz", "fathom"] as const;
export type RatingMode = (typeof RATING_MODES)[number];
/** A list's own modes, a list game and a Blitz round: what plays and missed guesses take (never Fathom). */
export type ListMode = Exclude<RatingMode, "fathom">;

export const isRatingMode = (x: unknown): x is RatingMode => (RATING_MODES as readonly unknown[]).includes(x);

/** Why not, after a thumbs down: the fixed set the database takes (rate_list). */
export const RATING_REASONS: readonly RatingReason[] = ["too-hard", "too-easy", "boring", "unfair", "wrong-data"];

/** One rating as the server gets it. 0 takes a rating back. */
export interface Rating {
  listId: string;
  mode: RatingMode;
  rating: -1 | 0 | 1;
  reason: RatingReason | null;
  /** Epoch ms it was given: the latest wins, in the save and in the outbox. */
  at: number;
}

/** Where a rating lives in the save's `ratings`. */
export const ratingKey = (mode: RatingMode, listId: string): string => `${mode}:${listId}`;
export const RATING_KEY = new RegExp(`^(?:${RATING_MODES.join("|")}):[a-z0-9-]{1,64}$`);

export const isReason = (x: unknown): x is RatingReason => (RATING_REASONS as readonly unknown[]).includes(x);

/** Why the server would refuse this rating, or null if it's fine. */
export function invalidRating(r: Rating): string | null {
  if (typeof r?.listId !== "string" || !LIST_ID.test(r.listId)) return "list id";
  if (!isRatingMode(r.mode)) return "mode";
  if (r.rating !== -1 && r.rating !== 0 && r.rating !== 1) return "rating";
  if (r.reason !== null && (!isReason(r.reason) || r.rating !== -1)) return "reason";
  if (!Number.isFinite(r.at)) return "at";
  return null;
}

/** Ratings in the outbox: one waits per list and mode (the latest), each named by when it was given. */
export const RATINGS: OutboxKind<Rating> = {
  key: (r) => `${ratingKey(r.mode, r.listId)}:${r.at}`,
  invalid: (r) => invalidRating(r),
  slot: (r) => ratingKey(r.mode, r.listId),
};

/** The arguments of the rate_list database function. */
export function rateArgs(r: Rating, clientId: string) {
  return { p_list_id: r.listId, p_mode: r.mode, p_rating: r.rating, p_reason: r.reason, p_client_id: clientId };
}

/** The player's rating of a list in a mode, from the save; null when there is none (or it was taken back). */
export function ratingOf(s: Saved, mode: RatingMode, listId: string): ListRating | null {
  const r = s.ratings?.[ratingKey(mode, listId)];
  return r && r.rating !== 0 ? r : null;
}

/** The save with this rating as the player's latest for its list and mode. */
export function withRating(s: Saved, r: Rating): Saved {
  const kept: ListRating = r.reason ? { rating: r.rating, reason: r.reason, at: r.at } : { rating: r.rating, at: r.at };
  return { ...s, ratings: { ...s.ratings, [ratingKey(r.mode, r.listId)]: kept } };
}
