import { useEffect, useRef, useState } from "react";
import { loadPuzzle, type PuzzleMeta } from "../game/puzzles";
import { shownValue } from "../game/state";
import type { ListRun as Run } from "../game/history";
import type { Puzzle } from "../game/types";
import { load } from "../game/storage";
import { runTime } from "./Blitz";
import { Loading } from "./Game";
import { ParBlock, usePar } from "./par";
import { metricLabel } from "./copy";
import { MoreRanks } from "./MoreRanks";
import { formatAsOf, ordinal, ScreenHead, sourceSite } from "./pixel";
import { RateList } from "./rate/RateList";
import { ClassicSquid } from "./squid";

interface Props {
  id: string;
  meta?: PuzzleMeta;
  /** The run's startedAt, its address in Past runs (#p-<id>/run-<startedAt>). */
  startedAt: number;
  onBack: () => void;
  onHome: () => void;
  /** Play again: a fresh free game on this list. Missing while the list is held (today's or a future day's). */
  onReplay?: () => void;
}

/** How the run ended, in the results' words. */
function ending(run: Run): string {
  if (run.status === "won") return `with ${run.lives} ${run.lives === 1 ? "life" : "lives"} to spare.`;
  return run.status === "gave-up" ? "you gave up." : "out of lives.";
}

/**
 * One finished list game from Past runs, as it ended: the board with what was found and what was missed, the score
 * against the players' average, Play again (a fresh free game on this list) and Back. Each run has its own address,
 * so a row always opens its own run, never the list's latest game.
 */
export function ListRun({ id, meta, startedAt, onBack, onHome, onReplay }: Props) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Facts opened by tap, click or keyboard (by rank). */
  const [openFacts, setOpenFacts] = useState<ReadonlySet<number>>(() => new Set());
  const replayRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const parFile = usePar();
  const saved = load();
  const run = saved.listRuns?.find((r) => r.id === id && r.startedAt === startedAt);
  // A run keeps no guesses; while its game is still saved (the list's latest, or its daily's one try), that has them:
  // the life-costing ones mark ranks 11 to 20.
  const game = [saved.games[id], ...Object.values(saved.dailyGames ?? {})].find((g) => g?.puzzleId === id && g.startedAt === startedAt);
  const guessed = new Set(game?.log.flatMap((l) => (l.result.kind === "near" ? [l.result.entry.rank] : [])) ?? []);

  useEffect(() => {
    loadPuzzle(id)
      .then(setPuzzle)
      .catch((e) => setError(String(e.message ?? e)));
  }, [id]);
  // Keyboard-first: the main action is focused on arrival (not on touch screens, which have no Enter to press).
  useEffect(() => {
    if (!puzzle || (typeof matchMedia === "function" && !matchMedia("(pointer: fine)").matches)) return;
    (replayRef.current ?? backRef.current)?.focus({ preventScroll: true });
  }, [puzzle]);

  const mode = run?.daily ? `Daily #${run.daily}` : "Random list";
  if (!run || error) {
    return (
      <main className="screen game">
        <ScreenHead onBack={onBack} onHome={onHome}>
          <span className="label mode">Past run</span>
        </ScreenHead>
        <section data-glass className="panel error" data-testid="run-missing">
          <p>{error ?? "This run isn't in your past runs any more."}</p>
          <button className="key" onClick={onBack}>
            Back
          </button>
        </section>
      </main>
    );
  }
  if (!puzzle) return <Loading />;

  const n = run.found.length;
  const won = run.status === "won";
  const par = parFile?.[puzzle.id];
  const asOf = puzzle.source.dataAsOf ? `data as of ${puzzle.source.dataAsOf}` : `as of ${formatAsOf(puzzle.source.asOf)}`;
  const toggleFact = (rank: number) =>
    setOpenFacts((prev) => {
      const next = new Set(prev);
      if (!next.delete(rank)) next.add(rank);
      return next;
    });

  return (
    <main className={`screen game stage status-${run.status}`} data-testid="list-run" data-list={id}>
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode">{mode}</span>
      </ScreenHead>

      <div className="board-col">
        <section className="panel prompt" data-glass data-testid="title-card">
          <div className="prompt-top">
            <span className="label cyan">{meta?.category ?? "Top 10"}</span>
            <span className="prompt-end">
              <span className="count" aria-label={`${n} of 10 found`}>
                <b>{n}</b>/10
              </span>
            </span>
          </div>
          <h1>{puzzle.title}</h1>
          <p className="caption">{puzzle.prompt}</p>
          <p className="asof">
            <a href={puzzle.source.url} target="_blank" rel="noreferrer">
              {sourceSite(puzzle.source.name)}
            </a>
            , {asOf}
          </p>
        </section>

        <section className="panel board" aria-label="Top 10" data-glass>
          <div className="board-head" aria-hidden="true">
            <span>Rank</span>
            <span className="slot-body">
              <span>Name</span>
              <span className="board-metric">{puzzle.metric ?? "Value"}</span>
            </span>
          </div>
          <ol className="slots">
            {puzzle.answers.map((a) => {
              const found = run.found.includes(a.rank);
              const open = !!a.fact && openFacts.has(a.rank);
              return (
                <li
                  key={a.rank}
                  data-testid="slot"
                  data-rank={a.rank}
                  data-state={found ? "found" : "missed"}
                  className={["slot", found ? "found" : "missed", a.rank === 1 ? "top" : "", a.fact ? "has-fact" : "", open ? "fact-open" : ""].join(" ")}
                  {...(a.fact && {
                    onClick: () => toggleFact(a.rank),
                    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
                    // Hover opens a fact only once the mouse actually moves here (see index.css).
                    onPointerMove: (e: React.PointerEvent<HTMLLIElement>) => {
                      const el = e.currentTarget;
                      if (e.pointerType === "mouse" && !("hover" in el.dataset)) el.dataset.hover = "";
                    },
                  })}
                >
                  <span className="rank">{ordinal(a.rank)}</span>
                  <span className="slot-body">
                    <span className="name">
                      {a.fact ? (
                        <button type="button" className="name-toggle" aria-expanded={open} aria-controls={`fact-${a.rank}`}>
                          {a.name}
                        </button>
                      ) : (
                        a.name
                      )}
                      {!found && <span className="sr-only"> (missed)</span>}
                    </span>
                    {shownValue(a) && <span className="value">{shownValue(a)}</span>}
                  </span>
                  {a.fact && (
                    <p className="fact" id={`fact-${a.rank}`}>
                      {a.fact.text}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <MoreRanks puzzle={puzzle} guessed={guessed} />
        </section>
      </div>

      <div className="control-col" data-testid="control-col">
        {/* Like a Blitz run's view: the date on top (no results squid, which the date would run into). */}
        <section className="panel results lead" data-testid="run-view" data-found={n} data-glass>
          <p className="label gold">Past run · {runTime(run.finishedAt)}</p>
          <p className="score" aria-label={`${n} out of 10`}>
            <span className={`score-n ${won ? "gold" : ""}`}>{n}</span>
            <span className="score-of">/10</span>
          </p>
          {par && <ParBlock list={par} score={n} />}
          <p className="caption">{ending(run)}</p>
          {run.hints > 0 && (
            <div className="results-meta">
              <p>clues used: {run.hints}</p>
            </div>
          )}
          {/* Play again leads: a fresh free game on this same list. A held list waits for its day. */}
          <div className="results-actions">
            {onReplay && (
              <button ref={replayRef} className="key key-pink" data-testid="replay" onClick={onReplay}>
                Play again
              </button>
            )}
            <button ref={backRef} className="key" data-testid="run-back" onClick={onBack}>
              Back
            </button>
          </div>
          {!onReplay && (
            <p className="caption" data-testid="replay-held">
              back in free play after its day.
            </p>
          )}
          <p className="source">
            {/* The metric mid-sentence: only its first letter lowercased, and never an acronym's or a name's. */}
            {puzzle.metric && <>ranked by {metricLabel(puzzle.metric)}. </>}
            source:{" "}
            <a href={puzzle.source.url} target="_blank" rel="noreferrer">
              {puzzle.source.name}
            </a>
            , {asOf}.
          </p>
          <RateList listId={puzzle.id} mode="list" />
        </section>
      </div>
      <ClassicSquid found={run.found} status={run.status} />
    </main>
  );
}
