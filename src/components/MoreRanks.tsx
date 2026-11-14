import { shownValue } from "../game/state";
import type { Puzzle } from "../game/types";
import { nextRanks } from "./nextRanks";
import { ordinal } from "./pixel";

/**
 * Under a finished list's board, ranks 11 to 20 with their figures, shown directly (the owner, Nov 14: "instead of
 * having this as a button just show it directly. be sure to differentiate the top 10 from 11-20 tho"). A divider row
 * with its label ("11 to 20", "11 to 15" when the list stops sooner) sets them apart, and the rows are quieter than the
 * top 10's: smaller, dimmer, no row lines, so the top 10 stays the hero. The ones the player guessed (each cost a life)
 * are marked as the misses are, in pink. A list with none of them shows nothing; only finished games render this.
 */
export function MoreRanks({ puzzle, guessed }: { puzzle: Puzzle; guessed: ReadonlySet<number> }) {
  const next = nextRanks(puzzle);
  if (!next) return null;
  return (
    <>
      <p className="ranks-divider" data-testid="more-ranks-label" aria-hidden="true">
        <span>{next.label}</span>
      </p>
      <ol className="next-ranks" data-testid="more-ranks" aria-label={next.name}>
        {next.rows.map((e) => {
          const mine = guessed.has(e.rank);
          return (
            <li key={e.name} className={`next-rank${mine ? " guessed" : ""}`} data-testid="more-rank" data-rank={e.rank} data-guessed={mine || undefined}>
              <span className="rank">{ordinal(e.rank)}</span>
              <span className="slot-body">
                <span className="name">
                  {e.name}
                  {mine && <span className="sr-only"> (you guessed it)</span>}
                </span>
                {shownValue(e) && <span className="value">{shownValue(e)}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
