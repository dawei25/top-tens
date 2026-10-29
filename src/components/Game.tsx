import { useEffect, useRef, useState, type CSSProperties } from "react";
import { loadPuzzle, type PuzzleMeta } from "../game/puzzles";
import { judgeGuess } from "../game/match";
import {
  applyGuess,
  applyHint,
  canHint,
  giveUp,
  hintLetter,
  MAX_LIVES,
  newGame,
  shareText,
  type GameState,
} from "../game/state";
import { load, save } from "../game/storage";
import { localDate, streak, type DailyEntry } from "../game/daily";
import { blitzAvailable } from "../game/blitz";
import type { Lexicon } from "../game/junk";
import type { GuessResult, Puzzle } from "../game/types";
import { Countdown } from "./Countdown";
import { BackArrow, formatAsOf, Heart, ordinal, reducedMotion, sourceSite, TypeIn } from "./pixel";

interface Props {
  id: string;
  meta?: PuzzleMeta;
  /** Set when playing a daily (today's or one from the archive). */
  daily?: DailyEntry;
  /** The player's local date, from App. */
  today: string;
  schedule: DailyEntry[];
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

function describe(r: GuessResult): Omit<Feedback, "key"> | null {
  switch (r.kind) {
    case "correct":
      return { tone: "good", text: `${r.entry.name}. #${r.entry.rank} on the board.` };
    case "duplicate":
      return { tone: "warn", text: `Already guessed ${r.entry.name}` };
    case "near":
      return {
        tone: "bad",
        // Show the entry's own number when the data has it: "Gasherbrum IV is #17, 7,932 m."
        text: !r.entry.rank
          ? r.entry.value
            ? `${r.entry.name}: ${r.entry.value}. Not in the top 10.`
            : `${r.entry.name} isn't in the top 10`
          : `${r.entry.name} is #${r.entry.rank}${r.entry.value ? `, ${r.entry.value}` : ""}.${r.entry.rank <= 15 ? " So close." : ""}`,
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

export function Game({ id, meta, daily, today, schedule, lexicon, onHome, onRoll }: Props) {
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
  /** The hidden row showing the "first letter?" confirm. */
  const [hintAsk, setHintAsk] = useState<number | null>(null);
  const yesRef = useRef<HTMLButtonElement>(null);

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
    // Only a daily finished on its own date counts toward the streak; archive replays don't.
    if (daily && game.status !== "playing" && daily.date === localDate()) s.daily[daily.date] = daily.id;
    save(s);
  }, [game, puzzle, id, daily]);

  // The hint confirm closes on Escape or a press anywhere outside its row.
  useEffect(() => {
    if (hintAsk === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setHintAsk(null);
      inputRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(`[data-hint-rank="${hintAsk}"]`)) setHintAsk(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    // Opened from the keyboard: take focus to YES. Opened by click or tap, focus stays in the guess box.
    if (document.activeElement?.classList.contains("blank-toggle")) yesRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [hintAsk]);

  // "No hints on your last life" clears itself.
  const refused = hintAsk !== null && !!game && !canHint(game, hintAsk);
  useEffect(() => {
    if (!refused) return;
    const t = setTimeout(() => setHintAsk(null), 2500);
    return () => clearTimeout(t);
  }, [refused]);

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
    const offered = feedback?.suggestions;
    const preview = judgeGuess(text, puzzle, new Set(game.found), lexicon, offered);
    if ((preview.kind === "correct" || preview.kind === "near") && preview.corrected) {
      fill(preview.entry.name);
      setFeedback({ tone: "warn", text: `Did you mean ${preview.entry.name}? Press Enter to guess it.`, key: Date.now() });
      return;
    }
    const { state, result } = applyGuess(game, puzzle, text, lexicon, offered);
    const fb = describe(result);
    if (!fb) return;
    setHintAsk(null);
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
  const takeHint = (rank: number) => {
    const next = applyHint(game, rank);
    setHintAsk(null);
    inputRef.current?.focus();
    if (next === game) return;
    setGame(next);
    setLostLife({ i: next.lives, key: Date.now() });
    const entry = puzzle.answers.find((a) => a.rank === rank);
    if (entry) setFeedback({ tone: "warn", text: `#${rank} starts with ${hintLetter(entry.name)}. One life spent.`, key: Date.now() });
  };
  /** Forget this list's result (and its streak day) and start it over, fresh. */
  const playAgain = () => {
    const s = load();
    delete s.games[id];
    if (daily) delete s.daily[daily.date];
    // A roll of today's daily list shares its saved game, so it takes today's streak day with it too.
    if (s.daily[localDate()] === id) delete s.daily[localDate()];
    save(s);
    setHintAsk(null);
    setGame(newGame(puzzle));
    setInput("");
    setFeedback(null);
    setLastFound(null);
    setShake({ n: 0, hit: false });
    setLostLife(null);
    setEndedHere(false);
    setCopied(false);
    setOpenFacts(new Set());
    scrollTo({ top: 0, behavior: "auto" });
    // The guess box mounts with autoFocus.
  };

  const share = async () => {
    const url = `${location.origin}${location.pathname}${daily ? `#daily-${daily.date}` : `#p-${puzzle.id}`}`;
    const text = shareText(game, puzzle, url, daily?.n);
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
  // The source's own date for its numbers when it states one, otherwise the day we read it.
  const asOf = puzzle.source.dataAsOf ? `data as of ${puzzle.source.dataAsOf}` : `as of ${formatAsOf(puzzle.source.asOf)}`;

  // Facts only ever belong to revealed rows: a hidden row's fact would be a hint.
  const factRanks = puzzle.answers.filter((a) => a.fact && (over || game.found.includes(a.rank))).map((a) => a.rank);
  const toggleFact = (rank: number) =>
    setOpenFacts((prev) => {
      const next = new Set(prev);
      if (!next.delete(rank)) next.add(rank);
      return next;
    });
  const allFactsOpen = factRanks.length > 0 && factRanks.every((r) => openFacts.has(r));

  const hints = game.hints ?? [];
  // Count this game in before the save effect has run, so the results show the streak it just made.
  let dailyStreak: ReturnType<typeof streak> | null = null;
  if (daily && over) {
    const sv = load();
    if (daily.date === localDate()) sv.daily[daily.date] = daily.id;
    dailyStreak = streak(sv);
  }
  const mode = !daily ? "Random list" : daily.date === today ? `Daily #${daily.n}` : `Archive #${daily.n}`;
  // Count this game in before the save effect runs, so finishing today's daily opens Blitz on the results at once.
  const blitzOpen = (() => {
    const sv = load();
    sv.games[id] = game;
    return blitzAvailable(puzzle, schedule, today, sv);
  })();

  return (
    <main className={`screen game status-${game.status}`}>
      <header className="game-head">
        <button className="key key-icon" onClick={onHome} aria-label="Home">
          <BackArrow />
        </button>
        <div className="game-head-mid">
          <span className="label mode">{mode}</span>
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
          {blitzOpen && !over && (
            <a className="key key-xs key-blitz-sm" href={`#blitz-${puzzle.id}`} title="90 seconds, as many as you can">
              Blitz
            </a>
          )}
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
          , {asOf}
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
            const open = !!fact && openFacts.has(a.rank);
            const hinted = !revealed && hints.includes(a.rank);
            const hintable = !revealed && !hinted;
            const asking = hintable && hintAsk === a.rank;
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
                  open ? "fact-open" : "",
                  hintable ? "hintable" : "",
                  hinted ? "hinted" : "",
                  asking ? "asking" : "",
                ].join(" ")}
                style={{ "--d": `${revealDelay}ms` } as CSSProperties}
                data-hint-rank={revealed ? undefined : a.rank}
                {...(hintable && {
                  onClick: () => setHintAsk((r) => (r === a.rank ? null : a.rank)),
                  // Same as facts: a click or tap here leaves the guess box focused (and the phone keyboard up).
                  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
                })}
                {...(fact && {
                  onClick: () => toggleFact(a.rank),
                  // Keep focus where it is (the guess box during play), so opening a fact never costs a keystroke.
                  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
                  // Hover is pure CSS; this only arms it once the mouse actually moves here (see index.css), and
                  // touches the DOM directly so hovering never re-renders the board.
                  onPointerMove: (e: React.PointerEvent<HTMLLIElement>) => {
                    const el = e.currentTarget;
                    if (e.pointerType === "mouse" && !("hover" in el.dataset)) el.dataset.hover = "";
                  },
                })}
              >
                <span className="rank">{ordinal(a.rank)}</span>
                <span className="slot-body">
                  <span className="name">
                    {revealed ? (
                      fact ? (
                        // The name itself is the keyboard toggle; the row draws its focus ring.
                        <button type="button" className="name-toggle" aria-expanded={open} aria-controls={`fact-${a.rank}`}>
                          <TypeIn text={a.name} animate={typing} delay={revealDelay} />
                        </button>
                      ) : (
                        <TypeIn text={a.name} animate={typing} delay={revealDelay} />
                      )
                    ) : hinted ? (
                      <span className="blank" aria-label={`not found yet, starts with ${hintLetter(a.name)}`}>
                        <b className="hint-letter">{hintLetter(a.name)}</b> . . . . . . .
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="blank-toggle"
                        aria-label={`Not found yet. Hint for #${a.rank}`}
                        aria-expanded={asking}
                      >
                        <span className="blank" aria-hidden="true">
                          . . . . . . . .
                        </span>
                      </button>
                    )}
                  </span>
                  {revealed && a.value && <span className="value">{a.value}</span>}
                </span>
                {asking && (
                  <div className="hint-ask">
                    {canHint(game, a.rank) ? (
                      <>
                        <span>hint: first letter? costs 1 life</span>
                        <button
                          ref={yesRef}
                          type="button"
                          className="key key-xs key-gold"
                          onClick={(e) => {
                            e.stopPropagation();
                            takeHint(a.rank);
                          }}
                        >
                          Yes
                        </button>
                      </>
                    ) : (
                      <span role="status">no hints on your last life</span>
                    )}
                  </div>
                )}
                {/* Always in the DOM once revealed, so desktop hover is pure CSS (no re-render); hidden until opened or hovered. */}
                {fact && (
                  <p className="fact" id={`fact-${a.rank}`}>
                    {fact.text}
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
          {(dailyStreak || hints.length > 0) && (
            <div className="results-meta">
              {hints.length > 0 && <p>hints used: {hints.length}</p>}
              {dailyStreak && (
                <p>
                  streak <b className="pink">{dailyStreak.current}</b> · best <b>{dailyStreak.best}</b>
                </p>
              )}
              {daily && <Countdown />}
            </div>
          )}
          <div className="results-actions">
            <button ref={shareRef} className="key key-pink" onClick={share}>
              {copied ? "Copied" : "Share"}
            </button>
            {blitzOpen && (
              <a className="key key-blitz" href={`#blitz-${puzzle.id}`}>
                Blitz
              </a>
            )}
            <button className="key" onClick={playAgain}>
              Play again
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
            , {asOf}.
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
