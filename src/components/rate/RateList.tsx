import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { load } from "../../game/storage";
import { rateList, useSaveVersion } from "../../net";
import { RATING_REASONS, ratingOf, type RatingMode, type RatingReason } from "../../net/ratings";
import { pixels } from "../pixel";
import "./rate.css";

/** The reasons a thumbs down can give, as the picker says them. */
const REASONS: Record<RatingReason, string> = {
  "too-hard": "too hard",
  "too-easy": "too easy",
  boring: "boring",
  unfair: "answers felt unfair",
  "wrong-data": "wrong data",
};
/** The picked reason as the row repeats it: short enough to share a phone's row with the keys. */
const PICKED: Record<RatingReason, string> = { ...REASONS, unfair: "unfair" };

/** A thumb, 10 x 10: the cuff on the left, the fist with its knuckles, the thumb up. Down is it upside down. */
const THUMB = [
  ".....#....",
  "....##....",
  "....##....",
  "...###....",
  "##.######.",
  "##.#######",
  "##.######.",
  "##.#######",
  "##.######.",
  "##.#####..",
];
const THUMB_UP = pixels(THUMB);
const THUMB_DOWN = pixels([...THUMB].reverse());

function Thumb({ down }: { down?: boolean }) {
  return (
    <svg className="thumb" viewBox="0 0 10 10" shapeRendering="crispEdges" aria-hidden="true">
      <path d={down ? THUMB_DOWN : THUMB_UP} fill="currentColor" />
    </svg>
  );
}

/**
 * "Good list?" at the foot of a list game's or a Blitz round's results, and of their runs in Past runs: a thumbs up
 * or down on the list in that mode. One tap rates it and marks the key; the other key switches; the marked key again
 * takes the rating back. It's kept in the save (so it shows here later, offline and without a backend) and sent to the
 * ratings table when there is one (src/net rateList).
 *
 * After a thumbs down, the reasons float over the card (nothing moves, DESIGN 5a): one tap picks one (again: none),
 * and the row names it; "why?" brings them back. Escape, a press elsewhere or "skip" closes them.
 */
export function RateList({ listId, mode }: { listId: string; mode: RatingMode }) {
  const version = useSaveVersion();
  const [mine, setMine] = useState(() => ratingOf(load(), mode, listId));
  // Another list, or a sync that brought this list's rating from another device: read the save again.
  const [seen, setSeen] = useState({ version, listId, mode });
  if (seen.version !== version || seen.listId !== listId || seen.mode !== mode) {
    setSeen({ version, listId, mode });
    setMine(ratingOf(load(), mode, listId));
  }
  const [asking, setAsking] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const downKey = useRef<HTMLButtonElement>(null);

  const rate = (rating: -1 | 0 | 1, reason?: RatingReason) => {
    rateList(listId, mode, rating, reason);
    setMine(ratingOf(load(), mode, listId));
  };
  /** Close the reasons; `refocus` when focus was in them (a pick, Escape, skip), so it doesn't fall to the page. */
  const close = (refocus: boolean) => {
    setAsking(false);
    if (refocus && wrap.current?.contains(document.activeElement)) downKey.current?.focus({ preventScroll: true });
  };
  const up = () => {
    setAsking(false);
    rate(mine?.rating === 1 ? 0 : 1);
  };
  const down = () => {
    if (mine?.rating === -1) {
      setAsking(false);
      rate(0);
    } else {
      rate(-1);
      setAsking(true);
    }
  };
  const pick = (reason: RatingReason) => {
    rate(-1, mine?.reason === reason ? undefined : reason);
    close(true);
  };

  useEffect(() => {
    if (!asking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Marked, so the screen's Escape-is-Back leaves it alone.
      e.preventDefault();
      close(true);
    };
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    // Capture phase, so it runs before the header's Escape-is-Back listener.
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [asking]);

  // Above the row, over the card; below it only when the top of the screen would cut it off.
  useLayoutEffect(() => {
    const el = pop.current;
    const row = wrap.current?.getBoundingClientRect();
    if (!asking || !el || !row) return;
    el.dataset.down = String(row.top - el.offsetHeight - 8 < 0 && row.bottom + el.offsetHeight + 8 <= innerHeight);
  }, [asking]);

  const rating = mine?.rating ?? 0;
  return (
    <div
      ref={wrap}
      className="rate"
      role="group"
      aria-labelledby={`rate-q-${mode}`}
      data-testid="rate"
      data-rating={rating}
      data-reason={mine?.reason}
      // Tabbing out of the open reasons closes them.
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (asking && to && !e.currentTarget.contains(to)) setAsking(false);
      }}
    >
      <span className="label rate-q" id={`rate-q-${mode}`}>
        Good list?
      </span>
      <button type="button" className="key rate-key up" data-testid="rate-up" aria-label="good list" aria-pressed={rating === 1} onClick={up}>
        <Thumb />
      </button>
      <button
        ref={downKey}
        type="button"
        className="key rate-key down"
        data-testid="rate-down"
        aria-label="not a good list"
        aria-pressed={rating === -1}
        aria-expanded={asking}
        aria-controls={`rate-reasons-${mode}`}
        onClick={down}
      >
        <Thumb down />
      </button>
      {/* Always laid out, so the keys never shift: the picked reason, or "why?" to give one, after a thumbs down. */}
      <span className="rate-note">
        {rating === -1 && !asking && (
          <button type="button" className="text-btn rate-why" data-testid="rate-why" onClick={() => setAsking(true)}>
            {mine?.reason ? PICKED[mine.reason] : "why?"}
          </button>
        )}
      </span>
      {asking && (
        <div ref={pop} className="rate-reasons" id={`rate-reasons-${mode}`} role="group" aria-label="Why not?" data-testid="rate-reasons">
          <div className="rate-reasons-head">
            <span className="label">Why not?</span>
            <button type="button" className="text-btn" data-testid="rate-skip" onClick={() => close(true)}>
              skip
            </button>
          </div>
          <div className="rate-reason-list">
            {RATING_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className="rate-reason"
                data-testid="rate-reason"
                data-reason={r}
                aria-pressed={mine?.reason === r}
                onClick={() => pick(r)}
              >
                {REASONS[r]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
