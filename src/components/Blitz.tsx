import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BLITZ_SECONDS,
  blitzAvailable,
  blitzGuess,
  blitzHistory,
  blitzScore,
  blitzShareText,
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
import { localDate, type DailyEntry } from "../game/daily";
import type { Lexicon } from "../game/junk";
import { loadPuzzle, type PuzzleMeta } from "../game/puzzles";
import { load, save } from "../game/storage";
import type { Entry, Puzzle } from "../game/types";
import { Loading } from "./Game";
import { ModeTag, ScreenHead } from "./pixel";

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
  /** This screen's own address, "#blitz-<id>" or "#dailyblitz-<date>"; sub-views hang off it. */
  base: string;
  onBack: () => void;
  onHome: () => void;
}

interface Feedback {
  tone: "good" | "bad" | "warn";
  text: string;
  suggestions?: string[];
  key: number;
}

function describe(r: BlitzResult): Omit<Feedback, "key"> | null {
  switch (r.kind) {
    case "scored":
      return { tone: "good", text: r.corrected ? `Counted as ${r.hit.name}. +${r.hit.points}` : `${r.hit.name}. +${r.hit.points}` };
    case "duplicate":
      return { tone: "warn", text: `Already got ${r.name}.` };
    case "choices":
      return { tone: "warn", text: "Did you mean", suggestions: r.suggestions };
    case "none":
      return { tone: "bad", text: r.junk ? "Doesn't look like an answer." : "Not on this list." };
    default:
      return null;
  }
}

/** "Oct 29, 21:40" in the player's time. */
export function runTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Why Blitz is closed for this list, in the same order blitzAvailable checks. */
function refusal(puzzle: Puzzle, schedule: DailyEntry[], today: string): { text: string; play: string } {
  const daily = schedule.find((e) => e.id === puzzle.id && e.date >= today);
  if (!puzzle.blitz) return { text: "This list can't be played as a Blitz yet.", play: `#p-${puzzle.id}` };
  if (daily && daily.date > today)
    return { text: "This list is a future daily. It opens for Blitz after its day.", play: "" };
  if (daily) return { text: "This is today's daily. Finish it first: Blitz shows every answer.", play: `#daily-${daily.date}` };
  return { text: "Blitz isn't available for this list.", play: `#p-${puzzle.id}` };
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

function HitRow({ points, name, value }: { points: string; name: string; value?: string }) {
  return (
    <li className="blitz-hit" data-testid="blitz-hit">
      <span className="blitz-pts">{points}</span>
      <span className="blitz-name">{name}</span>
      {value && <span className="value">{value}</span>}
    </li>
  );
}

/** A round's answers by points, then the biggest it missed. Shared by the results and past runs. */
function RoundLists({ puzzle, hits, byName }: { puzzle: Puzzle; hits: BlitzHit[]; byName: Map<string, Entry> }) {
  return (
    <>
      <section className="panel blitz-list" aria-labelledby="blitz-got">
        <h2 id="blitz-got" className="label cyan">
          Your answers
        </h2>
        {hits.length ? (
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
      <section className="panel blitz-list missed" aria-labelledby="blitz-missed">
        <h2 id="blitz-missed" className="label">
          Biggest you missed
        </h2>
        <ol>
          {missedTop(puzzle, { puzzleId: puzzle.id, hits }, 10).map((e) => (
            <HitRow key={e.name} points={e.rank ? `#${e.rank}` : ""} name={e.name} value={e.value} />
          ))}
        </ol>
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
    <details className="panel blitz-runs" data-testid="past-runs" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
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
  base,
  onBack,
  onHome,
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
  const inputRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<BlitzState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    loadPuzzle(id)
      .then((p) => {
        setPuzzle(p);
        // A round left mid-way: carry on (the clock never stopped), or show how it ended.
        const back = resumeBlitz(load(), id);
        if (back) setNote(back.over ? "away" : "resumed");
        setState(back ? back.state : newBlitz(p));
      })
      .catch((e) => setError(String(e.message ?? e)));
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
    // Only a round finished on its own date can be that date's Today's Blitz; the first one counts.
    if (dailyBlitz && dailyBlitz.date === localDate()) {
      const d = recordDailyBlitz(next, dailyBlitz.date, state);
      next = d.saved;
      daily = { counted: d.counted, score: next.blitzDaily?.[dailyBlitz.date]?.score ?? blitzScore(state) };
    }
    save(next);
    setRecord({ best: r.best, previous: r.previous, daily });
  }, [state, record, id, dailyBlitz]);

  const expire = useCallback(() => setState((s) => (s ? finishBlitz(s) : s)), []);

  const byName = useMemo(() => {
    const m = new Map<string, Entry>();
    if (puzzle) for (const e of [...puzzle.answers, ...puzzle.extras]) m.set(e.name, e);
    return m;
  }, [puzzle]);

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
  if (!puzzle || !state) return <Loading />;

  const saved = load();
  if (!blitzAvailable(puzzle, schedule, today, saved)) {
    const why = refusal(puzzle, schedule, today);
    return (
      <main className="screen game">
        <section className="panel error blitz-closed" data-testid="blitz-closed">
          <p className="label gold">Blitz closed</p>
          <h1 className="blitz-closed-title">{puzzle.title}</h1>
          <p>{why.text}</p>
          <div className="results-actions">
            {why.play && (
              <a className="key key-pink" href={why.play}>
                Play the list
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
    }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Judged against the real clock: a guess sent after 0 doesn't count, even before the screen catches up.
    const { state: next, result } = blitzGuess(startBlitz(state), puzzle, input, lexicon, feedback?.suggestions);
    setState(next);
    if (result.kind === "over" || isOver(next)) return;
    if (result.kind === "scored") keepLive(next);
    const fb = describe(result);
    if (fb) setFeedback({ ...fb, key: Date.now() });
    if (result.kind !== "choices" && result.kind !== "empty") setInput("");
    inputRef.current?.focus();
  };
  const again = () => {
    setState(newBlitz(puzzle));
    setRecord(null);
    setFeedback(null);
    setNote(null);
    setInput("");
    setCopied(false);
    scrollTo({ top: 0, behavior: "auto" });
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

  const score = blitzScore(state);
  const hits = [...state.hits].reverse();
  const n = state.hits.length;
  const runs = blitzHistory(saved, id);
  const best = saved.blitzBest?.[id];
  const pastRuns = <PastRuns runs={runs} best={best} open={runsOpen} onToggle={setRunsOpen} onOpen={openRun} />;
  const viewRun = openAt ? runs.find((r) => r.startedAt === openAt) : undefined;

  let body: React.ReactNode;
  if (viewRun) {
    const isBest = viewRun.score === best;
    const k = viewRun.hits.length;
    body = (
      <>
        <section className="panel results" data-testid="run-view" aria-live="polite">
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
          <div className="results-actions">
            <button className="key" onClick={onBack} autoFocus>
              Back
            </button>
          </div>
        </section>
        <RoundLists puzzle={puzzle} hits={viewRun.hits} byName={byName} />
      </>
    );
  } else if (!over) {
    body = (
      <>
        <section className="panel blitz-meter" aria-label="Clock and score">
          <div className="blitz-meter-cell">
            <span className="label">Time</span>
            <Clock state={state} onExpire={expire} />
          </div>
          <div className="blitz-meter-cell right">
            <span className="label">Score</span>
            <span className="blitz-score" data-testid="blitz-score" aria-live="polite">
              {score}
            </span>
            <span className="caption">
              {n} answer{n === 1 ? "" : "s"}
            </span>
          </div>
        </section>

        {note === "resumed" && <p className="blitz-note caption" data-testid="blitz-note">resumed. the clock kept running while you were away.</p>}

        {hits.length > 0 && (
          <ol className="panel blitz-hits" aria-label="Your answers, newest first">
            {hits.map((h) => (
              <HitRow key={h.name} points={`+${h.points}`} name={h.name} value={byName.get(h.name)?.value} />
            ))}
          </ol>
        )}

        {!state.startedAt && pastRuns}

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
      </>
    );
  } else {
    body = (
      <>
        <section className="panel results enter" data-testid="blitz-results" aria-live="polite">
          <p className="label gold">Time's up</p>
          {note === "away" && <p className="caption">time ran out while you were away.</p>}
          <p className="score" aria-label={`${score} points`}>
            <span className={`score-n ${record?.best && score > 0 ? "gold" : ""}`} data-testid="blitz-final">
              {score}
            </span>
            <span className="score-of">pts</span>
          </p>
          <div className="results-meta">
            <p>
              <b>{n}</b> answer{n === 1 ? "" : "s"} in {BLITZ_SECONDS} seconds
            </p>
            {record?.daily &&
              (record.daily.counted ? (
                <p className="gold" data-testid="daily-blitz-line" data-counted="true">
                  today's blitz: <b>{record.daily.score}</b>
                </p>
              ) : (
                <p data-testid="daily-blitz-line" data-counted="false">
                  replay: today's score stays <b>{record.daily.score}</b>
                </p>
              ))}
            {record &&
              (record.best && score > 0 ? (
                <p className="gold">
                  new best on this list{record.previous !== undefined ? ` (was ${record.previous})` : ""}
                </p>
              ) : (
                <p>
                  best on this list: <b>{record.previous ?? score}</b>
                </p>
              ))}
          </div>
          <div className="results-actions">
            <button className="key key-gold" onClick={share}>
              {copied ? "Copied" : "Share"}
            </button>
            <button className="key" data-testid="blitz-again" onClick={again} autoFocus>
              Play again
            </button>
            <a className="key" href={`#p-${puzzle.id}`}>
              The list
            </a>
          </div>
        </section>
        <RoundLists puzzle={puzzle} hits={state.hits} byName={byName} />
        {pastRuns}
      </>
    );
  }

  return (
    <main className={`screen game blitz ${over ? "blitz-over" : ""}`} data-testid="blitz-screen" data-list={puzzle.id}>
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode gold">
          {!dailyBlitz ? "Blitz" : dailyBlitz.date === today ? `Today's Blitz #${dailyBlitz.n}` : `Blitz #${dailyBlitz.n}`}
        </span>
      </ScreenHead>

      <section className="panel prompt">
        <div className="prompt-top">
          <span className="label cyan">{meta?.category ?? "Top 10"}</span>
          <ModeTag mode="blitz" />
        </div>
        <h1>{puzzle.title}</h1>
        <p className="caption">
          name as many as you can. scored by {(puzzle.metric ?? "the number").toLowerCase()}: bigger is better.
        </p>
      </section>

      {body}
    </main>
  );
}
