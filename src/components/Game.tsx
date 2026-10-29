import { useEffect, useRef, useState, type CSSProperties } from "react";
import { loadPuzzle, dayNumber, type PuzzleMeta } from "../game/puzzles";
import { judgeGuess } from "../game/match";
import { applyGuess, giveUp, MAX_LIVES, newGame, shareText, type GameState } from "../game/state";
import { load, save } from "../game/storage";
import type { Lexicon } from "../game/junk";
import type { GuessResult, Puzzle } from "../game/types";
import { BackArrow, formatAsOf, Heart, ordinal, reducedMotion, sourceSite, TypeIn } from "./pixel";

interface Props {
  id: string;
  meta?: PuzzleMeta;
  daily: boolean;
  lexicon?: Lexicon;
  onHome: () => void;
  onRoll: () => void;
}

interface Feedback {
  tone: "good" | "bad" | "warn";
  text: string;
  /** Tappable answers for an ambiguous typo. */
  suggestions?: string[];
  key: number;
}

/** Milliseconds between missed rows typing in at the end of a game. */
const REVEAL_STEP = 90;
/** Mouse rest before a row's fact opens, so sweeping across the board doesn't flicker rows open. */
const HOVER_DELAY = 180;

function describe(r: GuessResult): Omit<Feedback, "key"> | null {
  switch (r.kind) {
    case "correct":
      return { tone: "good", text: `${r.entry.name}. #${r.entry.rank} on the board.` };
    case "duplicate":
      return { tone: "warn", text: `Already guessed ${r.entry.name}` };
    case "near":
      return {
        tone: "bad",
        text: !r.entry.rank
          ? `${r.entry.name} isn't in the top 10`
          : `${r.entry.name} is #${r.entry.rank}.${r.entry.rank <= 15 ? " So close." : ""}`,
      };
    case "typo":
      return { tone: "warn", text: "Did you mean", suggestions: r.suggestions };
    case "unknown":
      return {
        tone: "warn",
        text: r.junk ? "That doesn't look like an answer. No life lost." : "Not a recognized answer for this list. No life lost.",
      };
    default:
      return null;
  }
}

export function Game({ id, meta, daily, lexicon, onHome, onRoll }: Props) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastFound, setLastFound] = useState<number | null>(null);
  const [shake, setShake] = useState({ n: 0, hit: false });
  const [lostLife, setLostLife] = useState<{ i: number; key: number } | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Whether the game ended while on screen (so the end reveal plays), as opposed to loading a finished one. */
  const [endedHere, setEndedHere] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  /** Facts opened by tap, click or keyboard (by rank). */
  const [openFacts, setOpenFacts] = useState<ReadonlySet<number>>(() => new Set());
  /** Fact shown because the mouse rests on its row. */
  const [hoverFact, setHoverFact] = useState<number | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  useEffect(() => {
    loadPuzzle(id)
      .then((p) => {
        setPuzzle(p);
        setGame(load().games[id] ?? newGame(p));
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [id]);

  useEffect(() => {
    if (!game || !puzzle) return;
    const s = load();
    s.games[id] = game;
    if (daily && game.status !== "playing") s.daily[dayNumber()] = id;
    save(s);
  }, [game, puzzle, id, daily]);

  const over = !!game && game.status !== "playing";
  const missedCount = puzzle && game ? puzzle.answers.length - game.found.length : 0;
  const resultsDelay = endedHere && !reducedMotion() ? missedCount * REVEAL_STEP + 350 : 0;

  // Second beat of the end: once the table has revealed, bring the verdict into view and focus SHARE.
  useEffect(() => {
    if (!over || !endedHere) return;
    const t = setTimeout(() => {
      shareRef.current?.focus({ preventScroll: true });
      resultsRef.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
    }, resultsDelay);
    return () => clearTimeout(t);
  }, [over, endedHere, resultsDelay]);

  useEffect(() => {
    if (!confirmQuit) return;
    const t = setTimeout(() => setConfirmQuit(false), 3000);
    return () => clearTimeout(t);
  }, [confirmQuit]);

  if (error) {
    return (
      <main className="screen game">
        <section className="panel error">
          <p className="label pink">Error</p>
          <p>{error}</p>
          <button className="key" onClick={onHome}>
            Home
          </button>
        </section>
      </main>
    );
  }
  if (!puzzle || !game) return <Loading />;

  const fill = (name: string) => {
    setInput(name);
    inputRef.current?.focus();
  };
  const commit = (state: GameState) => {
    if (state.status !== "playing" && game.status === "playing") setEndedHere(true);
    setGame(state);
  };
  const guess = (text: string) => {
    // A misspelling is corrected in the box, never submitted for the player.
    const preview = judgeGuess(text, puzzle, new Set(game.found), lexicon);
    if ((preview.kind === "correct" || preview.kind === "near") && preview.corrected) {
      fill(preview.entry.name);
      setFeedback({ tone: "warn", text: `Did you mean ${preview.entry.name}? Press Enter to guess it.`, key: Date.now() });
      return;
    }
    const { state, result } = applyGuess(game, puzzle, text, lexicon);
    const fb = describe(result);
    if (!fb) return;
    commit(state);
    setFeedback({ ...fb, key: Date.now() });
    if (result.kind === "correct") setLastFound(result.entry.rank);
    if (state.lives < game.lives) setLostLife({ i: state.lives, key: Date.now() });
    if (result.kind === "near" || result.kind === "unknown" || result.kind === "typo")
      setShake((s) => ({ n: s.n + 1, hit: result.kind === "near" }));
    // Keep the text on a typo so it can be fixed by hand as well as by tapping a suggestion.
    if (result.kind !== "typo") setInput("");
    inputRef.current?.focus();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    guess(input);
  };
  const quit = () => {
    if (!confirmQuit) return setConfirmQuit(true);
    setConfirmQuit(false);
    commit(giveUp(game));
  };

  const share = async () => {
    const url = `${location.origin}${location.pathname}#p-${puzzle.id}`;
    const text = shareText(game, puzzle, url);
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Share sheet dismissed.
    }
  };

  const misses = game.log.flatMap((l, i) =>
    l.result.kind === "near"
      ? [{ key: i, rank: l.result.entry.rank, name: l.result.entry.name }]
      : [],
  );
  const missedRanks = puzzle.answers.filter((a) => !game.found.includes(a.rank)).map((a) => a.rank);
  const animate = !reducedMotion();
  const asOf = formatAsOf(puzzle.source.asOf);

  // Facts only ever belong to revealed rows: a hidden row's fact would be a hint.
  const factRanks = puzzle.answers.filter((a) => a.fact && (over || game.found.includes(a.rank))).map((a) => a.rank);
  const factShown = (rank: number) => openFacts.has(rank) || hoverFact === rank;
  const toggleFact = (rank: number) => {
    clearTimeout(hoverTimer.current);
    const shown = factShown(rank);
    setHoverFact(null);
    setOpenFacts((prev) => {
      const next = new Set(prev);
      if (shown) next.delete(rank);
      else next.add(rank);
      return next;
    });
  };
  const allFactsOpen = factRanks.length > 0 && factRanks.every((r) => openFacts.has(r));

  return (
    <main className={`screen game status-${game.status}`}>
      <header className="game-head">
        <button className="key key-icon" onClick={onHome} aria-label="Home">
          <BackArrow />
        </button>
        <div className="game-head-mid">
          <span className="label mode">{daily ? "Today's list" : "Random list"}</span>
          <div
            key={lostLife?.key}
            className={`lives ${lostLife ? "lives-hit" : ""}`}
            role="img"
            aria-label={`${game.lives} ${game.lives === 1 ? "life" : "lives"} left`}
          >
            {Array.from({ length: MAX_LIVES }, (_, i) => (
              <Heart key={i} className={`life ${i < game.lives ? "on" : "off"} ${lostLife?.i === i ? "lost" : ""}`} />
            ))}
          </div>
        </div>
        {!over ? (
          <button className={`key key-sm ${confirmQuit ? "key-danger" : ""}`} onClick={quit} onBlur={() => setConfirmQuit(false)}>
            {confirmQuit ? "Sure?" : "Give up"}
          </button>
        ) : (
          <span className="key-sm-spacer" aria-hidden="true" />
        )}
      </header>

      <section className="panel prompt">
        <div className="prompt-top">
          <span className="label cyan">{meta?.category ?? "Top 10"}</span>
          <span className="count" aria-label={`${game.found.length} of 10 found`}>
            <b>{game.found.length}</b>/10
          </span>
        </div>
        <h1>{puzzle.title}</h1>
        <p className="caption">{puzzle.prompt}</p>
        <p className="asof">
          <a href={puzzle.source.url} target="_blank" rel="noreferrer">
            {sourceSite(puzzle.source.name)}
          </a>
          , as of {asOf}
        </p>
      </section>

      <section className="panel board" aria-label="Top 10">
        <div className="board-head" aria-hidden="true">
          <span>Rank</span>
          <span className="slot-body">
            <span>Name</span>
            <span className="board-metric">{puzzle.metric ?? "Value"}</span>
          </span>
        </div>
        <ol className="slots">
          {puzzle.answers.map((a) => {
            const found = game.found.includes(a.rank);
            const revealed = found || over;
            const just = found && lastFound === a.rank;
            const missIdx = missedRanks.indexOf(a.rank);
            const revealDelay = !found && endedHere ? missIdx * REVEAL_STEP : 0;
            const typing = animate && (just || (!found && endedHere));
            const fact = revealed ? a.fact : undefined;
            const shown = !!fact && factShown(a.rank);
            return (
              <li
                key={a.rank}
                className={[
                  "slot",
                  found ? "found" : revealed ? "missed" : "hidden",
                  a.rank === 1 ? "top" : "",
                  just ? "just" : "",
                  !found && endedHere ? "late" : "",
                  fact ? "has-fact" : "",
                  shown ? "fact-open" : "",
                ].join(" ")}
                style={{ "--d": `${revealDelay}ms` } as CSSProperties}
                {...(fact && {
                  onClick: (e: React.MouseEvent) => {
                    if (!(e.target as Element).closest("a")) toggleFact(a.rank);
                  },
                  // Keep focus where it is (the guess box during play), so opening a fact never costs a keystroke.
                  onMouseDown: (e: React.MouseEvent) => {
                    if (!(e.target as Element).closest("a")) e.preventDefault();
                  },
                  onPointerEnter: (e: React.PointerEvent) => {
                    if (e.pointerType !== "mouse") return;
                    clearTimeout(hoverTimer.current);
                    hoverTimer.current = setTimeout(() => setHoverFact(a.rank), HOVER_DELAY);
                  },
                })}
                onPointerLeave={(e) => {
                  if (e.pointerType !== "mouse") return;
                  clearTimeout(hoverTimer.current);
                  setHoverFact((h) => (h === a.rank ? null : h));
                }}
              >
                <span className="rank">{ordinal(a.rank)}</span>
                <span className="slot-body">
                  <span className="name">
                    {revealed ? (
                      <>
                        <TypeIn text={a.name} animate={typing} delay={revealDelay} />
                        {fact && (
                          <button
                            type="button"
                            className="fact-mark"
                            aria-expanded={shown}
                            aria-controls={`fact-${a.rank}`}
                            aria-label={`Fact about ${a.name}`}
                          >
                            i
                          </button>
                        )}
                      </>
                    ) : (
                      <span className="blank" aria-label="not found yet">
                        . . . . . . . .
                      </span>
                    )}
                  </span>
                  {revealed && a.value && <span className="value">{a.value}</span>}
                </span>
                {fact && shown && (
                  <p className="fact" id={`fact-${a.rank}`}>
                    {fact.text}{" "}
                    <a className="fact-source" href={fact.source} target="_blank" rel="noreferrer">
                      source
                    </a>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        {over && factRanks.length > 0 && (
          <div className="board-foot">
            <button
              type="button"
              className="fact-all"
              aria-pressed={allFactsOpen}
              onClick={() => setOpenFacts(allFactsOpen ? new Set() : new Set(factRanks))}
            >
              {allFactsOpen ? "hide facts" : "show all facts"}
            </button>
          </div>
        )}
      </section>

      {misses.length > 0 && (
        <section className="misses" aria-label="Wrong guesses">
          <span className="label">Misses</span>
          {misses.map((m) => (
            <span key={m.key} className="miss-chip">
              {m.rank ? <b>#{m.rank}</b> : null} {m.name}
            </span>
          ))}
        </section>
      )}

      {!over ? (
        <form className="guess" onSubmit={submit}>
          <div className="feedback-line">
            {feedback ? (
              <div key={feedback.key} className={`feedback ${feedback.tone}`} role="status">
                <span>{feedback.text}</span>
                {feedback.suggestions?.map((s) => (
                  <button key={s} type="button" className="suggestion" onClick={() => fill(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <p className="feedback hint">type a name, press enter. typos are free.</p>
            )}
          </div>
          <div key={shake.n} className={`guess-row ${shake.n ? "shake" : ""} ${shake.hit ? "hit" : ""}`}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="type a guess..."
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="send"
              aria-label="Your guess"
            />
            <button className="key key-pink" type="submit" disabled={!input.trim()}>
              Guess
            </button>
          </div>
        </form>
      ) : (
        <section
          ref={resultsRef}
          className={`panel results ${endedHere ? "enter" : ""}`}
          style={{ "--d": `${resultsDelay}ms` } as CSSProperties}
          aria-live="polite"
        >
          <p className={`label ${game.status === "won" ? "gold" : "pink"}`}>
            {game.status === "won" ? "Perfect 10" : game.status === "gave-up" ? "Gave up" : "Game over"}
          </p>
          <p className="score" aria-label={`${game.found.length} out of 10`}>
            <span className={`score-n ${game.status === "won" ? "gold" : ""}`}>{game.found.length}</span>
            <span className="score-of">/10</span>
          </p>
          <p className="caption">
            {game.status === "won"
              ? `with ${game.lives} ${game.lives === 1 ? "life" : "lives"} to spare.`
              : game.status === "gave-up"
                ? "you gave up. the full list is above."
                : "out of lives. the full list is above."}
          </p>
          <div className="results-actions">
            <button ref={shareRef} className="key key-pink" onClick={share}>
              {copied ? "Copied" : "Share"}
            </button>
            <button className="key" onClick={onRoll}>
              Roll another
            </button>
          </div>
          <p className="source">
            {puzzle.metric && <>ranked by {puzzle.metric.toLowerCase()}. </>}
            source:{" "}
            <a href={puzzle.source.url} target="_blank" rel="noreferrer">
              {puzzle.source.name}
            </a>
            , as of {asOf}.
          </p>
        </section>
      )}
    </main>
  );
}

export function Loading() {
  return (
    <div className="loading">
      <span className="label cyan blink">Loading</span>
    </div>
  );
}
