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
  rankedDepth,
  shownValue,
  type GameState,
} from "../game/state";
import { load, save } from "../game/storage";
import { dailyGame, localDate, lockDaily, streak, type DailyEntry } from "../game/daily";
import { blitzAvailable } from "../game/blitz";
import { recordListRun } from "../game/history";
import { emitPlay } from "../game/events";
import type { Lexicon } from "../game/junk";
import type { GuessResult, Puzzle } from "../game/types";
import { Countdown } from "./Countdown";
import { ClueIcon, END_FOCUS_MS, formatAsOf, InkSac, ordinal, reducedMotion, RerollKey, ScreenHead, sourceSite, SwapLabel, TypeIn } from "./pixel";
import { CLUE_LABEL, confirmGuess, GUESS_HINT, NO_LIFE_LOST, notOnList, PLACEHOLDER, PLACEHOLDER_SHORT, SO_CLOSE, STREAK_NOTE } from "./copy";
import { FloatNote } from "./Note";
import { CountUp } from "./motion/effects";
import { ClassicSquid, ResultsSquid, SquidFx } from "./squid";
import { ParBlock, usePar } from "./par";
import { reportList } from "../net";

interface Props {
  id: string;
  meta?: PuzzleMeta;
  /** Set when playing a daily (today's or one from the archive). */
  daily?: DailyEntry;
  /** The player's local date, from App. */
  today: string;
  schedule: DailyEntry[];
  lexicon?: Lexicon;
  onBack: () => void;
  onHome: () => void;
  /** A fresh random list: Roll again on a random list, Random list on a finished daily. */
  onRoll: () => void;
  /**
   * This game was rolled (Random list, a category, Roll again) in this tab. Until the first guess it offers Roll again
   * beside GUESS, to skip to another list; never once play starts, so a losing game can't be dodged.
   */
  rolled?: boolean;
  /** Today's Blitz, while it's unplayed (a finished daily offers it). */
  onDailyBlitz?: () => void;
  /**
   * Today's Blitz list while it's unplayed. A free Blitz of it would be a practice run at a one-try round, so this
   * list offers Today's Blitz instead of its own Blitz key.
   */
  todaysBlitz?: string;
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

function describe(r: GuessResult, puzzle: Puzzle): Omit<Feedback, "key"> | null {
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
          ? // A place outside a regional list's region: "Japan isn't in Europe."
            r.entry.elsewhere && puzzle.region
            ? `${r.entry.name} isn't in ${puzzle.region}.`
            : shownValue(r.entry)
            ? `${r.entry.name}: ${shownValue(r.entry)}. Not in the top 10.`
            : rankedDepth(puzzle) > 10
              ? `${r.entry.name} is outside the top ${rankedDepth(puzzle)}.`
              : `${r.entry.name} isn't in the top 10.`
          : `${r.entry.name} is #${r.entry.rank}${shownValue(r.entry) ? `, ${shownValue(r.entry)}` : ""}.${r.entry.rank <= 15 ? ` ${SO_CLOSE}` : ""}`,
      };
    case "typo":
      return { tone: "warn", text: "Did you mean", suggestions: r.suggestions };
    case "unknown":
      return {
        tone: "warn",
        // The noun copy is for a plain miss only: a vague guess may well be part of the list's names.
        text: `${r.vague ? "More than one answer fits. Be more specific." : r.junk ? "That doesn't look like an answer." : notOnList(puzzle)} ${NO_LIFE_LOST}`,
      };
    default:
      return null;
  }
}

export function Game({ id, meta, daily, today, schedule, lexicon, onBack, onHome, onRoll, rolled, onDailyBlitz, todaysBlitz }: Props) {
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
  const parFile = usePar();

  useEffect(() => {
    loadPuzzle(id)
      .then((p) => {
        setPuzzle(p);
        // A daily is one try: once finished, it always opens on its result.
        const s = load();
        setGame((daily ? dailyGame(s, daily) : s.games[id]) ?? newGame(p));
      })
      .catch((e) => setError(String(e.message ?? e)));
    // The daily is fixed for this screen (App keys it by date).
  }, [id]);

  useEffect(() => {
    if (!game || !puzzle) return;
    let s = load();
    // A locked daily leaves the list's own save alone (a later roll of the same list may be using it).
    if (!(daily && s.dailyGames?.[daily.date])) s.games[id] = game;
    // Only a daily finished on its own date counts toward the streak; archive plays don't.
    if (daily && game.status !== "playing" && daily.date === localDate()) s.daily[daily.date] = daily.id;
    if (daily) s = lockDaily(s, daily.date, game);
    // Past runs: a finished game goes into the history (a no-op if it's already there), so a roll can't lose it.
    save(recordListRun(s, game, daily?.n));
  }, [game, puzzle, id, daily]);

  // The hint confirm closes on Escape, or a click or tap anywhere outside its row. On the click, not the press: the
  // confirm takes room on the board, so closing it on pointer down moved the board under the pointer and the press
  // missed what it was aimed at (GIVE UP, a row lower down).
  useEffect(() => {
    if (hintAsk === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape closes the hint confirm first; marking it keeps the header from also going Back.
      e.preventDefault();
      setHintAsk(null);
      inputRef.current?.focus();
    };
    const onClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.(`[data-hint-rank="${hintAsk}"]`)) setHintAsk(null);
    };
    // Capture phase: the keydown before the header's Escape-is-Back listener, the click before React's own click
    // handlers (so a click on another row's clue key still opens that row).
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick, true);
    // Opened from the keyboard: take focus to YES. Opened by click or tap, focus stays in the guess box.
    if (document.activeElement?.classList.contains("blank-toggle")) yesRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onClick, true);
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

  // Second beat of the end: once the table has revealed, bring the verdict into view and focus SHARE. Never at once,
  // even without the reveal: the Enter that sent the last guess (or one right behind it) must land on nothing.
  useEffect(() => {
    if (!over || !endedHere) return;
    const t = setTimeout(() => {
      shareRef.current?.focus({ preventScroll: true });
      resultsRef.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
    }, Math.max(resultsDelay, END_FOCUS_MS));
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
        <section data-glass className="panel error">
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
    if (state.status !== "playing" && game.status === "playing") {
      setEndedHere(true);
      emitPlay({ kind: "end", status: state.status, lives: state.lives, found: state.found.length });
      // Score stats (and sync): a no-op without a backend. Only today's daily counts as a daily there.
      reportList(state, daily?.date === today ? today : undefined);
    }
    setGame(state);
  };
  const guess = (text: string) => {
    // A misspelling is corrected in the box, never submitted for the player.
    const offered = feedback?.suggestions;
    const preview = judgeGuess(text, puzzle, new Set(game.found), lexicon, offered);
    if ((preview.kind === "correct" || preview.kind === "near") && preview.corrected) {
      fill(preview.entry.name);
      setFeedback({ tone: "warn", text: confirmGuess(preview.entry.name), key: Date.now() });
      return;
    }
    const { state, result } = applyGuess(game, puzzle, text, lexicon, offered);
    const fb = describe(result, puzzle);
    if (!fb) return;
    setHintAsk(null);
    if (result.kind === "correct") emitPlay({ kind: "found", rank: result.entry.rank, found: state.found.length });
    else if (result.kind === "near") emitPlay({ kind: "miss", lifeLost: state.lives < game.lives, rank: result.entry.rank });
    else if (result.kind === "unknown") emitPlay({ kind: "miss", lifeLost: false });
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
    emitPlay({ kind: "hint", rank, lives: next.lives });
    setGame(next);
    setLostLife({ i: next.lives, key: Date.now() });
    const entry = puzzle.answers.find((a) => a.rank === rank);
    if (entry) setFeedback({ tone: "warn", text: `#${rank} starts with ${hintLetter(entry.name)}. One life spent.`, key: Date.now() });
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
  // Roll again before play: a rolled list keeps a slot for it right of GUESS, and offers it until anything happens
  // (no guess, no clue, nothing said in the feedback line). Then it fades out of its slot, so nothing moves.
  const rerollSlot = !!rolled && !daily;
  const reroll = rerollSlot && game.status === "playing" && game.log.length === 0 && hints.length === 0 && !feedback;
  const par = parFile?.[puzzle.id];
  // Count this game in before the save effect has run, so the results show the streak it just made.
  let dailyStreak: ReturnType<typeof streak> | null = null;
  if (daily && over) {
    const sv = load();
    if (daily.date === localDate()) sv.daily[daily.date] = daily.id;
    dailyStreak = streak(sv);
  }
  const mode = !daily ? "Random list" : daily.date === today ? `Daily #${daily.n}` : `Archive #${daily.n}`;
  // The list's own Blitz key. Never on a daily: Blitz shows every answer, and a round there would be a practice run
  // at the day's one-try Blitz (a finished daily offers Today's Blitz instead). Nor on Today's Blitz list until that
  // round is played. Count this game in before the save effect runs, so finishing a list opens its Blitz at once.
  const heldBlitz = todaysBlitz === puzzle.id;
  const blitzOpen =
    !daily &&
    !heldBlitz &&
    (() => {
      const sv = load();
      sv.games[id] = game;
      return blitzAvailable(puzzle, schedule, today, sv);
    })();

  const missChips = misses.length > 0 && (
    <section className="misses" aria-label="Wrong guesses" data-glass>
      <span className="label">Misses</span>
      {misses.map((m) => (
        <span key={m.key} className="miss-chip">
          {m.rank ? <b>#{m.rank}</b> : null} {m.name}
        </span>
      ))}
    </section>
  );

  return (
    <main className={`screen game stage status-${game.status}`}>
      {/* The stage. Wide screens: the header across the frame, then two aligned columns: the title card and the board
          on the left, the control card (guess box, feedback, misses; the result card at the end) on the right.
          Narrower, both column wrappers dissolve (display: contents) into one centered column. */}
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode">{mode}</span>
        <div
          key={lostLife?.key}
          className={`lives ${lostLife ? "lives-hit" : ""}`}
          data-testid="lives"
          data-lives={game.lives}
          role="img"
          aria-label={`${game.lives} ${game.lives === 1 ? "life" : "lives"} left`}
        >
          {Array.from({ length: MAX_LIVES }, (_, i) => (
            <InkSac key={i} className={`life ${i < game.lives ? "on" : "off"} ${lostLife?.i === i ? "lost" : ""}`} />
          ))}
        </div>
      </ScreenHead>

      <div className="board-col">
        <section className="panel prompt" data-glass data-testid="title-card">
          <div className="prompt-top">
            <span className="label cyan">{meta?.category ?? "Top 10"}</span>
            {/* The score, then the list's Blitz key; on a narrow card the key drops under the score. The players'
                average waits for the results, where it says how you did. */}
            <span className="prompt-end">
              <span className="count" aria-label={`${game.found.length} of 10 found`}>
                <b>{game.found.length}</b>/10
              </span>
              {blitzOpen && !over && (
                <a className="key key-xs key-blitz-sm" data-testid="title-blitz" href={`#blitz-${puzzle.id}`} title="90 seconds, as many as you can">
                  Play Blitz
                </a>
              )}
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
                  data-testid="slot"
                  data-rank={a.rank}
                  data-state={found ? "found" : revealed ? "missed" : hinted ? "hinted" : "hidden"}
                  className={[
                    "slot",
                    found ? "found" : revealed ? "missed" : "hidden",
                    a.rank === 1 ? "top" : "",
                    just ? "just" : "",
                    !found && endedHere ? "late" : "",
                    fact ? "has-fact" : "",
                    open ? "fact-open" : "",
                    hintable ? "hintable" : "",
                    // On the last life the magnifiers dim; a press still says why.
                    hintable && !canHint(game, a.rank) ? "clue-off" : "",
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
                          <b className="hint-letter" data-testid="hint-letter">{hintLetter(a.name)}</b> . . . . . . .
                        </span>
                      ) : (
                        // The whole row is the clue key; the magnifier at its end says so without a hover.
                        <button
                          type="button"
                          className="blank-toggle"
                          data-testid="hint-open"
                          aria-label={`#${a.rank} not found yet. ${CLUE_LABEL}`}
                          title={CLUE_LABEL}
                          aria-expanded={asking}
                        >
                          <span className="blank" aria-hidden="true">
                            . . . . . . . .
                          </span>
                          <span className="clue" data-testid="clue" aria-hidden="true">
                            <ClueIcon />
                          </span>
                        </button>
                      )}
                    </span>
                    {revealed && shownValue(a) && <span className="value">{shownValue(a)}</span>}
                  </span>
                  {/* The confirm takes the row's own place, on one line over its dots and magnifier (QUIT -> SURE?
                      style), so nothing on the board moves. A second press on the row closes it. */}
                  {asking && (
                    <div className="hint-ask" data-testid="hint-ask">
                      {canHint(game, a.rank) ? (
                        <>
                          <span className="hint-q">first letter? 1 life</span>
                          <button
                            ref={yesRef}
                            data-testid="hint-yes"
                            type="button"
                            className="key key-xs key-gold key-inrow"
                            onClick={(e) => {
                              e.stopPropagation();
                              takeHint(a.rank);
                            }}
                          >
                            Yes
                          </button>
                        </>
                      ) : (
                        <span className="hint-q" role="status" data-testid="hint-refused">
                          no clues on your last life
                        </span>
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
          {/* Board actions sit under the board: GIVE UP while playing, the facts toggle once it's over. */}
          {!over ? (
            <div className="board-foot">
              <button
                type="button"
                className={`key key-xs ${confirmQuit ? "key-danger" : ""}`}
                onClick={quit}
                data-testid="give-up"
                data-confirm={confirmQuit || undefined}
                onBlur={() => setConfirmQuit(false)}
              >
                {/* The key keeps GIVE UP's width while it asks, so the second press lands where the first did. */}
                <SwapLabel off="Give up" on="Sure?" active={confirmQuit} />
              </button>
            </div>
          ) : (
            factRanks.length > 0 && (
              <div className="board-foot">
                <button
                  type="button"
                  className="fact-all"
                  data-testid="facts-toggle"
                  aria-pressed={allFactsOpen}
                  onClick={() => setOpenFacts(allFactsOpen ? new Set() : new Set(factRanks))}
                >
                  {allFactsOpen ? "hide facts" : "show all facts"}
                </button>
              </div>
            )
          )}
        </section>
      </div>

      <div className="control-col" data-testid="control-col">
        {!over ? (
          <div className="control-card" data-glass>
            {missChips}
            <form className="guess" onSubmit={submit} data-guess-dock data-glass>
              <div className="feedback-line">
                {feedback ? (
                  <div key={feedback.key} className={`feedback ${feedback.tone}`} role="status" data-testid="feedback" data-tone={feedback.tone}>
                    <span>{feedback.text}</span>
                    {feedback.suggestions?.map((s) => (
                      <button key={s} type="button" className="suggestion" data-testid="suggestion" onClick={() => fill(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="feedback hint">{GUESS_HINT}</p>
                )}
              </div>
              <div key={shake.n} className={`guess-row ${rerollSlot ? "has-reroll" : ""} ${shake.n ? "shake" : ""} ${shake.hit ? "hit" : ""}`}>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={rerollSlot ? PLACEHOLDER_SHORT : PLACEHOLDER}
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  aria-label="Your guess"
                />
                <button className="key key-pink" type="submit" data-testid="guess-submit" disabled={!input.trim()}>
                  Guess
                </button>
                <RerollKey slot={rerollSlot} on={reroll} onRoll={onRoll} />
              </div>
            </form>
          </div>
        ) : (
          <>
            {missChips}
            <section
              ref={resultsRef}
              data-testid="results"
              className={`panel results ${endedHere ? "enter" : ""}`}
              style={{ "--d": `${resultsDelay}ms` } as CSSProperties}
              aria-live="polite"
              data-glass
            >
              <ResultsSquid found={game.found} status={game.status} cheerAt={endedHere ? resultsDelay + 550 : undefined} />
              <p className={`label ${game.status === "won" ? "gold" : "pink"}`} data-motion={game.status === "gave-up" ? undefined : "banner"}>
                {game.status === "won" ? "Perfect 10" : game.status === "gave-up" ? "Gave up" : "Game over"}
              </p>
              <p className="score" data-testid="score" data-found={game.found.length} aria-label={`${game.found.length} out of 10`}>
                <span className={`score-n ${game.status === "won" ? "gold" : ""}`}><CountUp value={game.found.length} /></span>
                <span className="score-of">/10</span>
              </p>
              {par && <ParBlock list={par} score={game.found.length} id={puzzle.id} />}
              <p className="caption">
                {game.status === "won"
                  ? `with ${game.lives} ${game.lives === 1 ? "life" : "lives"} to spare.`
                  : game.status === "gave-up"
                    ? "you gave up. the full list is on the board."
                    : "out of lives. the full list is on the board."}
              </p>
              {(dailyStreak || hints.length > 0) && (
                <div className="results-meta">
                  {hints.length > 0 && <p>clues used: {hints.length}</p>}
                  {dailyStreak && (
                    <p>
                      <FloatNote label="days in a row" note={STREAK_NOTE} id="streak-note" testId="streak-tip" />{" "}
                      <b className="pink">{dailyStreak.current}</b> · most <b>{dailyStreak.best}</b>
                    </p>
                  )}
                  {daily && <Countdown />}
                </div>
              )}
              {/* No autofocus here: SHARE takes focus a beat after the end (above), so a key still held lands nowhere. */}
              <div className="results-actions">
                {/* Free play leads with Roll again: a new random list, never this one (so not "Play again"). The same
                    list again is only ever offered from its run in Past runs. */}
                {!daily && (
                  <button className="key key-pink" data-testid="play-again" onClick={onRoll}>
                    Roll again
                  </button>
                )}
                <button ref={shareRef} className={daily ? "key key-pink" : "key"} data-testid="share" onClick={share}>
                  <SwapLabel off="Share" on="Copied" active={copied} />
                </button>
                {/* A daily is one try: no replay, just somewhere else to go. Today's Blitz list offers that round. */}
                {(daily || heldBlitz) && onDailyBlitz && (
                  <button className="key key-blitz" data-testid="results-daily-blitz" onClick={onDailyBlitz}>
                    Today's Blitz
                  </button>
                )}
                {/* A daily already offers Today's Blitz; a second gold Blitz key there reads like the same thing. */}
                {blitzOpen && (
                  <a className="key key-blitz" data-testid="blitz-key" href={`#blitz-${puzzle.id}`} title="90 seconds, as many as you can">
                    Play Blitz
                  </a>
                )}
                {daily && (
                  <button className="key" data-testid="results-roll" onClick={onRoll}>
                    Random list
                  </button>
                )}
              </div>
              <p className="source">
                {/* The metric as the list writes it: lowercasing it would turn "UN 2025" into "un 2025". */}
                {puzzle.metric && (
                  <>
                    ranked by <span className="metric">{puzzle.metric}</span>.{" "}
                  </>
                )}
                source:{" "}
                <a href={puzzle.source.url} target="_blank" rel="noreferrer">
                  {puzzle.source.name}
                </a>
                , {asOf}.
              </p>
            </section>
          </>
        )}
      </div>
      <SquidFx />
      <ClassicSquid found={game.found} status={game.status} />
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
