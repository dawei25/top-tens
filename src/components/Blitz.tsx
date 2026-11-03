import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BLITZ_SECONDS,
  blitzAvailable,
  blitzGuess,
  blitzHistory,
  blitzScore,
  blitzShareText,
  dailyBlitzPlayed,
  dailyBlitzShareText,
  finishBlitz,
  isOver,
  missedTop,
  newBlitz,
  recordBlitz,
  recordDailyBlitz,
  resumeBlitz,
  saveLiveBlitz,
  startBlitz,
  timeLeft,
  type BlitzHit,
  type BlitzResult,
  type BlitzRun,
  type BlitzState,
} from "../game/blitz";
import { dailyGame, entryForDate, localDate, todayEntry, type DailyEntry } from "../game/daily";
import type { Lexicon } from "../game/junk";
import { loadPuzzle, type PuzzleMeta } from "../game/puzzles";
import { load, save } from "../game/storage";
import { shownValue } from "../game/state";
import { emitPlay } from "../game/events";
import type { Entry, Puzzle } from "../game/types";
import { Loading } from "./Game";
import { END_FOCUS_MS, ModeTag, ScreenHead, SwapLabel } from "./pixel";
import { blitzPrompt, notOnList } from "./copy";
import { CountUp, ScoreFloat } from "./motion/effects";
import { BlitzResultsSquid, BlitzSquid, ScoreBump } from "./squid";

interface Props {
  id: string;
  meta?: PuzzleMeta;
  schedule: DailyEntry[];
  today: string;
  lexicon?: Lexicon;
  /** Open the past-runs panel (<base>/runs). */
  showRuns?: boolean;
  /** Show this past run's results (its startedAt), at <base>/run-<startedAt>. */
  openRun?: number;
  /** Set when this is a date's Today's Blitz (n is that date's daily number). */
  dailyBlitz?: { date: string; n: number };
  /**
   * That date's daily, when it is this same list and the player hasn't finished it (see blitzHold): the round and
   * its results show only what the player hit, and the rest waits for the daily. The schedule gives every day a Blitz
   * on another list, so this is a guard; the "rest shows once you finish" copy appears only here.
   */
  hold?: DailyEntry;
  /** Today's Blitz list while it's unplayed: a free round on it is closed (it would be practice for a one-try round). */
  todaysBlitz?: string;
  /** This screen's own address, "#blitz-<id>" or "#dailyblitz-<date>"; sub-views hang off it. */
  base: string;
  onBack: () => void;
  onHome: () => void;
  /**
   * A fresh round on another random open Blitz list: Roll again after a round, Random Blitz after Today's Blitz.
   * Missing when no other list is open.
   */
  onRoll?: () => void;
  /**
   * This round was rolled (Random Blitz, a category, Roll again) in this tab. Until the clock starts it offers Roll
   * again in the clock card, to skip to another list; never once the round is on.
   */
  rolled?: boolean;
  /**
   * Play again on a past run: a fresh free round on this same list. Missing while the list is held (today's list or
   * Blitz, or a future day's).
   */
  onReplay?: () => void;
}

interface Feedback {
  tone: "good" | "bad" | "warn";
  text: string;
  suggestions?: string[];
  key: number;
}

function describe(r: BlitzResult, puzzle: Puzzle): Omit<Feedback, "key"> | null {
  switch (r.kind) {
    case "scored":
      return { tone: "good", text: r.corrected ? `Counted as ${r.hit.name}. +${r.hit.points}` : `${r.hit.name}. +${r.hit.points}` };
    case "duplicate":
      return { tone: "warn", text: `Already got ${r.name}.` };
    case "choices":
      return { tone: "warn", text: "Did you mean", suggestions: r.suggestions };
    case "none":
      if (r.vague) return { tone: "warn", text: "More than one fits. Be more specific." };
      if (r.unscored) return { tone: "warn", text: `${r.unscored} is on the list, but without a figure. No points.` };
      // Plain misses only: "Not one of the 258 countries here." (or "Not on this list." without a noun).
      return { tone: "bad", text: r.junk ? "Doesn't look like an answer." : notOnList(puzzle) };
    default:
      return null;
  }
}

/** Rows on the answer board before the first answer (wide screens). */
const BOARD_ROWS = 6;

/** "Oct 29, 21:40" in the player's time. */
export function runTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Why Blitz is closed for this list, in the same order blitzAvailable checks. */
function refusal(puzzle: Puzzle, schedule: DailyEntry[], today: string): { text: string; play: string; label?: string } {
  const daily = schedule.find((e) => e.id === puzzle.id && e.date >= today);
  if (!puzzle.blitz) return { text: "This list can't be played as a Blitz yet.", play: `#p-${puzzle.id}` };
  if (daily && daily.date > today)
    return { text: "This list is a future daily. It opens for Blitz after its day.", play: "" };
  if (daily) return { text: "This is today's daily. Finish it first: Blitz shows every answer.", play: `#daily-${daily.date}` };
  return { text: "Blitz isn't available for this list.", play: `#p-${puzzle.id}` };
}

/** A free round on Today's Blitz list, before that round is played. */
function heldForToday(today: string) {
  return { text: "This is today's Blitz. It's one round: play it from Today's Blitz.", play: `#dailyblitz-${today}`, label: "Today's Blitz" };
}

/** The ticking countdown. Only it re-renders ten times a second; it calls onExpire when the time is up. */
function Clock({ state, onExpire }: { state: BlitzState; onExpire: () => void }) {
  const [, tick] = useState(0);
  const running = !!state.startedAt && !state.endedAt;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      if (timeLeft(state) <= 0) onExpire();
      else tick((n) => n + 1);
    }, 100);
    return () => clearInterval(t);
  }, [running, state, onExpire]);
  const ms = timeLeft(state);
  const secs = !state.startedAt ? String(BLITZ_SECONDS) : (Math.ceil(ms / 100) / 10).toFixed(1);
  return (
    <span className={`blitz-clock ${running && ms < 10_000 ? "low" : ""}`} role="timer" data-testid="blitz-clock" data-started={!!state.startedAt} aria-label={`${Math.ceil(ms / 1000)} seconds left`}>
      {secs}
    </span>
  );
}

function HitRow({ points, name, value, testId = "blitz-hit" }: { points: string; name: string; value?: string; testId?: string }) {
  return (
    <li className="blitz-hit" data-testid={testId}>
      <span className="blitz-pts">{points}</span>
      <span className="blitz-name">{name}</span>
      {value && <span className="value">{value}</span>}
    </li>
  );
}

/** A round's answers by points, then the biggest it missed. Shared by the results and past runs. */
function RoundLists({
  puzzle,
  hits,
  byName,
  gone = false,
  waitFor,
}: {
  puzzle: Puzzle;
  hits: BlitzHit[];
  byName: Map<string, Entry>;
  /** The round is no longer in the history (only its score is kept). */
  gone?: boolean;
  /** The unfinished daily this list would spoil ("today's list"): the answers missed stay hidden until it's done. */
  waitFor?: string;
}) {
  return (
    <>
      <section className="panel blitz-list" aria-labelledby="blitz-got" data-glass>
        <h2 id="blitz-got" className="label cyan">
          Your answers
        </h2>
        {gone ? (
          <p className="caption">this round's answers are no longer kept.</p>
        ) : hits.length ? (
          <ol>
            {[...hits]
              .sort((a, b) => b.points - a.points)
              .map((h) => (
                <HitRow key={h.name} points={`+${h.points}`} name={h.name} value={byName.get(h.name)?.value} />
              ))}
          </ol>
        ) : (
          <p className="caption">none this time.</p>
        )}
      </section>
      <section className="panel blitz-list missed" aria-labelledby="blitz-missed" data-testid="blitz-missed" data-glass>
        <h2 id="blitz-missed" className="label">
          Biggest you missed
        </h2>
        {waitFor ? (
          <p className="caption" data-testid="blitz-rest-hidden">
            the rest shows once you finish {waitFor}.
          </p>
        ) : (
          <ol>
            {missedTop(puzzle, { puzzleId: puzzle.id, hits }, 10).map((e) => (
              <HitRow key={e.name} testId="blitz-missed-row" points={e.rank ? `#${e.rank}` : ""} name={e.name} value={shownValue(e)} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

/** Quiet, collapsed list of finished rounds on this list; the best one in gold. */
function PastRuns({
  runs,
  best,
  open,
  onToggle,
  onOpen,
}: {
  runs: BlitzRun[];
  best?: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  onOpen: (r: BlitzRun) => void;
}) {
  if (!runs.length) return null;
  const bestAt = runs.find((r) => r.score === best)?.startedAt;
  return (
    <details className="panel blitz-runs" data-testid="past-runs" data-glass open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary data-testid="past-runs-toggle">
        <span className="label">Past runs</span>
        <span className="caption">
          {runs.length} · best <b className="gold">{best ?? Math.max(...runs.map((r) => r.score))}</b>
        </span>
      </summary>
      <ol>
        {runs.map((r) => (
          <li key={r.startedAt}>
            <button type="button" className={`blitz-run ${r.startedAt === bestAt ? "best" : ""}`} data-testid="past-run" onClick={() => onOpen(r)}>
              <span className="run-when">{runTime(r.startedAt)}</span>
              <span className="run-n">
                {r.hits.length} answer{r.hits.length === 1 ? "" : "s"}
              </span>
              <span className="run-score">{r.score}</span>
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function Blitz({
  id,
  meta,
  schedule,
  today,
  lexicon,
  showRuns = false,
  openRun: openAt,
  dailyBlitz,
  hold,
  todaysBlitz,
  base,
  onBack,
  onHome,
  onRoll,
  rolled,
  onReplay,
}: Props) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<BlitzState | null>(null);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [copied, setCopied] = useState(false);
  /** The best-score check for the finished round. */
  const [record, setRecord] = useState<{
    best: boolean;
    previous?: number;
    /** Today's Blitz: whether this round was the one that counts, and the day's score. */
    daily?: { counted: boolean; score: number };
  } | null>(null);
  /** How this round came back after the player left, if it did. */
  const [note, setNote] = useState<"resumed" | "away" | null>(null);
  /** Past-runs panel; stays open across a visit to one of its runs, so Back lands on the open list. */
  const [runsOpen, setRunsOpen] = useState(showRuns);
  useEffect(() => {
    if (showRuns) setRunsOpen(true);
  }, [showRuns]);
  /** A date's Blitz that was already played when this screen opened: one round only, so it shows that round. */
  const [locked, setLocked] = useState<{ score: number; answers: number; gone: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const stateRef = useRef<BlitzState | null>(null);
  stateRef.current = state;
  /** The round ended on screen (the buzzer or a guess after it), as opposed to coming back finished. */
  const [endedHere, setEndedHere] = useState(false);

  useEffect(() => {
    loadPuzzle(id)
      .then((p) => {
        setPuzzle(p);
        const saved = load();
        const played = dailyBlitz && dailyBlitzPlayed(saved, dailyBlitz.date);
        if (played) {
          const run = played.result.id === id ? played.run : undefined;
          const { score, answers } = played.result;
          setLocked({ score, answers, gone: !run });
          setRecord({ best: false, previous: saved.blitzBest?.[id], daily: { counted: true, score } });
          setState(run ? { puzzleId: id, startedAt: run.startedAt, endedAt: run.endedAt, hits: run.hits } : { ...newBlitz(p), endedAt: Date.now() });
          return;
        }
        // A round left mid-way: carry on (the clock never stopped), or show how it ended.
        const back = resumeBlitz(saved, id);
        if (back) setNote(back.over ? "away" : "resumed");
        setState(back ? back.state : newBlitz(p));
      })
      .catch((e) => setError(String(e.message ?? e)));
    // The date is fixed for this screen (App keys it by date).
  }, [id]);


  // Keep the live round in storage if the page goes away (tab closed, app switched).
  useEffect(() => {
    const keep = () => {
      const s = stateRef.current;
      if (s?.startedAt && !s.endedAt) save(saveLiveBlitz(load(), s));
    };
    const onVis = () => document.visibilityState === "hidden" && keep();
    addEventListener("pagehide", keep);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      removeEventListener("pagehide", keep);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const over = !!state?.endedAt;
  // Record once per finished round (recordBlitz is a no-op for a round it already has).
  useEffect(() => {
    if (!state?.endedAt || record) return;
    const r = recordBlitz(load(), id, state);
    let next = r.saved;
    let daily: { counted: boolean; score: number } | undefined;
    // A date's Blitz is one round: the first one finished locks it. Played after its date, it's marked late.
    if (dailyBlitz) {
      const d = recordDailyBlitz(next, dailyBlitz.date, state, dailyBlitz.date !== localDate());
      next = d.saved;
      daily = { counted: d.counted, score: next.blitzDaily?.[dailyBlitz.date]?.score ?? blitzScore(state) };
    }
    save(next);
    emitPlay({ kind: "blitz-end", score: blitzScore(state), best: r.best && r.previous !== undefined });
    setRecord({ best: r.best, previous: r.previous, daily });
  }, [state, record, id, dailyBlitz]);

  const expire = useCallback(() => {
    setEndedHere(true);
    setState((s) => (s ? finishBlitz(s) : s));
  }, []);

  // At the buzzer the player is mid-guess, often pressing Enter. No result key is autofocused: focus is nowhere for a
  // beat, then goes to SHARE (as the list's results do), so that Enter never starts another round unseen.
  useEffect(() => {
    if (!over || !endedHere) return;
    const t = setTimeout(() => shareRef.current?.focus({ preventScroll: true }), END_FOCUS_MS);
    return () => clearTimeout(t);
  }, [over, endedHere]);

  const byName = useMemo(() => {
    const m = new Map<string, Entry>();
    if (puzzle) for (const e of [...puzzle.answers, ...puzzle.extras]) m.set(e.name, e);
    return m;
  }, [puzzle]);

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
  if (!puzzle || !state) return <Loading />;

  const saved = load();
  // A date's own-list Blitz (hold) opens before its daily is finished: it holds back the answers missed instead.
  // A free round on Today's Blitz list waits until that round is played.
  const open = !!hold || blitzAvailable(puzzle, schedule, today, saved);
  if (!open || (!dailyBlitz && todaysBlitz === puzzle.id)) {
    const why = open ? heldForToday(today) : refusal(puzzle, schedule, today);
    return (
      <main className="screen game">
        <section data-glass className="panel error blitz-closed" data-testid="blitz-closed">
          <p className="label gold">Blitz closed</p>
          <h1 className="blitz-closed-title">{puzzle.title}</h1>
          <p>{why.text}</p>
          <div className="results-actions">
            {why.play && (
              <a className={`key ${why.label ? "key-blitz" : "key-pink"}`} data-testid="blitz-closed-go" href={why.play}>
                {why.label ?? "Play the list"}
              </a>
            )}
            <button className="key" onClick={onHome}>
              Home
            </button>
          </div>
        </section>
      </main>
    );
  }

  const keepLive = (s: BlitzState) => {
    if (s.startedAt && !isOver(s)) save(saveLiveBlitz(load(), s));
  };
  const fill = (name: string) => {
    setInput(name);
    inputRef.current?.focus();
  };
  const onType = (value: string) => {
    setInput(value);
    // The clock starts on the first keystroke, not on load.
    if (value && !state.startedAt) {
      const started = startBlitz(state);
      setState(started);
      keepLive(started);
      setNote(null);
      emitPlay({ kind: "blitz-start" });
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Judged against the real clock: a guess sent after 0 doesn't count, even before the screen catches up.
    const { state: next, result } = blitzGuess(startBlitz(state), puzzle, input, lexicon, feedback?.suggestions);
    setState(next);
    if (result.kind === "over" || isOver(next)) return setEndedHere(true);
    if (result.kind === "scored") {
      keepLive(next);
      emitPlay({ kind: "blitz-hit", rank: result.hit.rank, points: result.hit.points, score: blitzScore(next), best: load().blitzBest?.[id] });
    } else if (result.kind === "none" || result.kind === "duplicate") emitPlay({ kind: "blitz-miss" });
    const fb = describe(result, puzzle);
    if (fb) setFeedback({ ...fb, key: Date.now() });
    if (result.kind !== "choices" && result.kind !== "empty") setInput("");
    inputRef.current?.focus();
  };
  // A past run is its own address (<base>/run-<startedAt>), so browser back and the Back key both close it.
  const openRun = (r: BlitzRun) => {
    location.hash = `${base}/run-${r.startedAt}`;
    scrollTo({ top: 0, behavior: "auto" });
  };
  const share = async () => {
    const base = `${location.origin}${location.pathname}`;
    const text = dailyBlitz
      ? dailyBlitzShareText(state, puzzle, `${base}#dailyblitz-${dailyBlitz.date}`, dailyBlitz.n)
      : blitzShareText(state, puzzle, `${base}#blitz-${puzzle.id}`);
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

  const score = locked ? locked.score : blitzScore(state);
  const hits = [...state.hits].reverse();
  const n = locked ? locked.answers : state.hits.length;
  const runs = blitzHistory(saved, id);
  const best = saved.blitzBest?.[id];
  const pastRuns = <PastRuns runs={runs} best={best} open={runsOpen} onToggle={setRunsOpen} onOpen={openRun} />;
  const viewRun = openAt ? runs.find((r) => r.startedAt === openAt) : undefined;
  // "Play the list": a date's Blitz on that date's own list goes to that daily (one try, and where the rest of the answers
  // wait while it's unfinished). Otherwise the list itself, but never when that would be today's daily, still unplayed.
  const todays = todayEntry(schedule, today);
  const liveDaily = !!todays && todays.id === puzzle.id && (dailyGame(saved, todays)?.status ?? "playing") === "playing";
  const ownDaily = dailyBlitz && (entryForDate(schedule, dailyBlitz.date) ?? todayEntry(schedule, dailyBlitz.date));
  const waitFor = hold && (hold === todays ? "today's list" : `daily #${hold.n}`);
  const theList =
    ownDaily && ownDaily.id === puzzle.id
      ? { href: `#daily-${ownDaily.date}`, label: ownDaily === todays ? "Today's list" : "Play the list" }
      : liveDaily
        ? undefined
        : { href: `#p-${puzzle.id}`, label: "Play the list" };
  // A new best needs an old one to beat: never on a list's first round.
  const newBest = !!record?.best && score > 0 && record.previous !== undefined;

  // The stage (see Game): the board column holds the lists, the control column the clock, score and guess box while
  // playing, and the result card after. Narrower, it all stacks; "lead" items come up right after the title there.
  let board: React.ReactNode;
  let control: React.ReactNode;
  if (viewRun) {
    const isBest = viewRun.score === best;
    const k = viewRun.hits.length;
    control = (
      <section className="panel results lead" data-testid="run-view" aria-live="polite" data-glass>
        <p className="label gold">Past run · {runTime(viewRun.startedAt)}</p>
        <p className="score" aria-label={`${viewRun.score} points`}>
          <span className={`score-n ${isBest ? "gold" : ""}`}>{viewRun.score}</span>
          <span className="score-of">pts</span>
        </p>
        <div className="results-meta">
          <p>
            <b>{k}</b> answer{k === 1 ? "" : "s"} in {BLITZ_SECONDS} seconds
          </p>
          {isBest && <p className="gold">best on this list</p>}
        </div>
        {/* Play again leads: a fresh round on this same list. A held list waits for its day. */}
        <div className="results-actions">
          {onReplay && (
            <button className="key key-gold" data-testid="replay" onClick={onReplay} autoFocus>
              Play again
            </button>
          )}
          <button className="key" onClick={onBack} autoFocus={!onReplay}>
            Back
          </button>
        </div>
        {!onReplay && (
          <p className="caption" data-testid="replay-held">
            back in free play after its day.
          </p>
        )}
      </section>
    );
    board = <RoundLists puzzle={puzzle} hits={viewRun.hits} byName={byName} waitFor={waitFor} />;
  } else if (!over) {
    control = (
      <div className="control-card" data-glass>
        <section className="panel blitz-meter lead" aria-label="Clock and score" data-glass>
          <div className="blitz-meter-cell">
            <span className="label">Time</span>
            <Clock state={state} onExpire={expire} />
          </div>
          <div className="blitz-meter-cell right">
            {/* Before the clock starts, a rolled round can be skipped for another list. It sits beside SCORE, out of
                the flow, so nothing moves as it comes and goes. */}
            {rolled && onRoll && !state.startedAt && (
              <button type="button" className="key key-xs key-reroll" data-testid="reroll" onClick={onRoll}>
                Roll again
              </button>
            )}
            <span className="label">Score</span>
            <span className="blitz-score" data-testid="blitz-score" data-motion="score" aria-live="polite">
              {score}
            </span>
            <ScoreFloat score={score} />
            <ScoreBump score={score} />
            <span className="caption">
              {n} answer{n === 1 ? "" : "s"}
            </span>
          </div>
        </section>

        {note === "resumed" && (
          <p className="blitz-note caption lead" data-testid="blitz-note" data-glass>
            resumed. the clock kept running while you were away.
          </p>
        )}

        <form className="guess" onSubmit={submit} data-guess-dock data-glass>
          <div className="feedback-line">
            {feedback ? (
              <div key={feedback.key} className={`feedback ${feedback.tone}`} role="status" data-testid="feedback" data-tone={feedback.tone}>
                <span>{feedback.text}</span>
                {feedback.suggestions?.map((s) => (
                  <button key={s} type="button" className="suggestion" onClick={() => fill(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <p className="feedback hint">{state.startedAt ? "keep going." : "the clock starts when you type."}</p>
            )}
          </div>
          <div className="guess-row">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => onType(e.target.value)}
              placeholder="type a guess..."
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="send"
              aria-label="Your guess"
            />
            <button className="key key-gold" type="submit" disabled={!input.trim()}>
              Guess
            </button>
          </div>
        </form>
      </div>
    );
    // Wide screens show the answer board from the start: faint empty rows that fill in as you score (narrower, the
    // board only appears with the first answer).
    const empty = Math.max(0, BOARD_ROWS - hits.length);
    board = (
      <>
        <ol className={`panel blitz-hits ${hits.length ? "" : "is-empty"}`} aria-label="Your answers, newest first" data-glass>
          {hits.map((h) => (
            <HitRow key={h.name} points={`+${h.points}`} name={h.name} value={byName.get(h.name)?.value} />
          ))}
          {Array.from({ length: empty }, (_, i) => (
            <li key={`empty-${i}`} className="blitz-hit empty" aria-hidden="true">
              <span className="blitz-pts">+</span>
              <span className="blitz-name">. . . . . . . .</span>
            </li>
          ))}
        </ol>
        {!state.startedAt && pastRuns}
      </>
    );
  } else {
    control = (
      <section
        className="panel results enter lead"
        data-testid="blitz-results"
        data-locked={locked ? "true" : undefined}
        aria-live="polite"
        data-glass
      >
        <BlitzResultsSquid hits={state.hits} best={newBest} />
        {locked ? <p className="label gold">Played</p> : <p className="label gold" data-motion="banner">Time's up</p>}
        {note === "away" && <p className="caption">time ran out while you were away.</p>}
        <p className="score" aria-label={`${score} points`}>
          <span className={`score-n ${newBest ? "gold" : ""}`} data-testid="blitz-final">
            <CountUp value={score} />
          </span>
          <span className="score-of">pts</span>
        </p>
        <div className="results-meta">
          {locked && <p>one round only. this was yours.</p>}
          <p>
            <b>{n}</b> answer{n === 1 ? "" : "s"} in {BLITZ_SECONDS} seconds
          </p>
          {/* The day's score, only when it isn't the big number right above (it almost always is). */}
          {record?.daily?.counted && dailyBlitz && record.daily.score !== score && (
            <p className="gold" data-testid="daily-blitz-line">
              {dailyBlitz.date === today ? "today's blitz" : `blitz #${dailyBlitz.n}`}: <b>{record.daily.score}</b>
            </p>
          )}
          {/* A best needs something to beat: a first round on a list says nothing about it. */}
          {record &&
            record.previous !== undefined &&
            (newBest ? (
              <p className="gold" data-motion="banner" data-testid="blitz-best">
                new best on this list (was {record.previous})
              </p>
            ) : (
              <p data-testid="blitz-best">
                best on this list: <b>{record.previous}</b>
              </p>
            ))}
        </div>
        {/* A date's Blitz is one round: no Roll again there, a Random Blitz instead. Free play leads with Roll again
            (another list, never this one: so not "Play again"). No key is autofocused: SHARE takes focus a beat after
            the buzzer (above). */}
        <div className="results-actions">
          {!dailyBlitz && onRoll && (
            <button className="key key-gold" data-testid="blitz-again" onClick={onRoll}>
              Roll again
            </button>
          )}
          {!locked?.gone && (
            <button ref={shareRef} className={dailyBlitz ? "key key-gold" : "key"} data-testid="share" onClick={share}>
              <SwapLabel off="Share" on="Copied" active={copied} />
            </button>
          )}
          {/* While the rest waits for the daily, that daily is the next thing to play. */}
          {hold && theList && (
            <a className="key key-pink" data-testid="blitz-list" href={theList.href}>
              {theList.label}
            </a>
          )}
          {dailyBlitz && onRoll && (
            <button className="key" data-testid="blitz-roll" onClick={onRoll}>
              Random Blitz
            </button>
          )}
          {!hold && theList && (
            <a className="key" data-testid="blitz-list" href={theList.href}>
              {theList.label}
            </a>
          )}
        </div>
        {!onRoll && <p className="caption">no other lists are open for blitz yet.</p>}
      </section>
    );
    board = (
      <>
        <RoundLists puzzle={puzzle} hits={state.hits} byName={byName} gone={locked?.gone} waitFor={waitFor} />
        {pastRuns}
      </>
    );
  }

  return (
    <main className={`screen game blitz stage ${over ? "blitz-over" : ""}`} data-testid="blitz-screen" data-list={puzzle.id}>
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode gold">
          {!dailyBlitz ? "Blitz" : dailyBlitz.date === today ? `Today's Blitz #${dailyBlitz.n}` : `Blitz #${dailyBlitz.n}`}
        </span>
      </ScreenHead>

      <div className="board-col">
        <section className="panel prompt" data-glass data-testid="title-card">
          <div className="prompt-top">
            <span className="label cyan">{meta?.category ?? "Top 10"}</span>
            <ModeTag mode="blitz" />
          </div>
          <h1>{puzzle.title}</h1>
          <p className="caption" data-testid="title-prompt">
            {blitzPrompt(puzzle.prompt)}
          </p>
          {/* The metric as the list writes it: lowercased, "US$" and "UN" would read "us$" and "un". */}
          <p className="caption blitz-rule" data-testid="blitz-rule">
            name as many {puzzle.noun ? `${puzzle.noun} ` : ""}as you can. scored by{" "}
            {puzzle.metric ? <span className="metric">{puzzle.metric}</span> : "the number"}: bigger is better.
          </p>
        </section>

        {board}
      </div>
      <div className="control-col" data-testid="control-col">{control}</div>
      <BlitzSquid hits={viewRun ? viewRun.hits : state.hits} />
    </main>
  );
}
