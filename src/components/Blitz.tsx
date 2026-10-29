import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BLITZ_SECONDS,
  blitzAvailable,
  blitzGuess,
  blitzScore,
  blitzShareText,
  finishBlitz,
  isOver,
  missedTop,
  newBlitz,
  recordBlitz,
  startBlitz,
  timeLeft,
  type BlitzResult,
  type BlitzState,
} from "../game/blitz";
import type { DailyEntry } from "../game/daily";
import type { Lexicon } from "../game/junk";
import { loadPuzzle, type PuzzleMeta } from "../game/puzzles";
import { load, save } from "../game/storage";
import type { Entry, Puzzle } from "../game/types";
import { Loading } from "./Game";
import { BackArrow } from "./pixel";

interface Props {
  id: string;
  meta?: PuzzleMeta;
  schedule: DailyEntry[];
  today: string;
  lexicon?: Lexicon;
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
    <span className={`blitz-clock ${running && ms < 10_000 ? "low" : ""}`} role="timer" aria-label={`${Math.ceil(ms / 1000)} seconds left`}>
      {secs}
    </span>
  );
}

export function Blitz({ id, meta, schedule, today, lexicon, onHome }: Props) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<BlitzState | null>(null);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [copied, setCopied] = useState(false);
  /** The best-score check for the finished round. */
  const [record, setRecord] = useState<{ best: boolean; previous?: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadPuzzle(id)
      .then((p) => {
        setPuzzle(p);
        setState(newBlitz(p));
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [id]);

  const over = !!state?.endedAt;
  // Record once per finished round.
  useEffect(() => {
    if (!state?.endedAt || record) return;
    const r = recordBlitz(load(), id, state);
    save(r.saved);
    setRecord({ best: r.best, previous: r.previous });
  }, [state, record, id]);

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

  if (!blitzAvailable(puzzle, schedule, today, load())) {
    const why = refusal(puzzle, schedule, today);
    return (
      <main className="screen game">
        <section className="panel error blitz-closed">
          <p className="label pink">Blitz closed</p>
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

  const fill = (name: string) => {
    setInput(name);
    inputRef.current?.focus();
  };
  const onType = (value: string) => {
    setInput(value);
    // The clock starts on the first keystroke, not on load.
    if (value && !state.startedAt) setState(startBlitz(state));
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Judged against the real clock: a guess sent after 0 doesn't count, even before the screen catches up.
    const { state: next, result } = blitzGuess(startBlitz(state), puzzle, input, lexicon, feedback?.suggestions);
    setState(next);
    if (result.kind === "over" || isOver(next)) return;
    const fb = describe(result);
    if (fb) setFeedback({ ...fb, key: Date.now() });
    if (result.kind !== "choices" && result.kind !== "empty") setInput("");
    inputRef.current?.focus();
  };
  const again = () => {
    setState(newBlitz(puzzle));
    setRecord(null);
    setFeedback(null);
    setInput("");
    setCopied(false);
    scrollTo({ top: 0, behavior: "auto" });
  };
  const share = async () => {
    const text = blitzShareText(state, puzzle, `${location.origin}${location.pathname}#blitz-${puzzle.id}`);
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

  return (
    <main className={`screen game blitz ${over ? "blitz-over" : ""}`}>
      <header className="game-head">
        <button className="key key-icon" onClick={onHome} aria-label="Home">
          <BackArrow />
        </button>
        <div className="game-head-mid">
          <span className="label mode pink">Blitz</span>
        </div>
        <a className="key key-sm" href={`#p-${puzzle.id}`}>
          List
        </a>
      </header>

      <section className="panel prompt">
        <div className="prompt-top">
          <span className="label cyan">{meta?.category ?? "Top 10"}</span>
          <span className="label pink">{BLITZ_SECONDS} seconds</span>
        </div>
        <h1>{puzzle.title}</h1>
        <p className="caption">
          name as many as you can. bigger {(puzzle.metric ?? "number").toLowerCase()}, more points.
        </p>
      </section>

      {!over ? (
        <>
          <section className="panel blitz-meter" aria-label="Clock and score">
            <div className="blitz-meter-cell">
              <span className="label">Time</span>
              <Clock state={state} onExpire={expire} />
            </div>
            <div className="blitz-meter-cell right">
              <span className="label">Score</span>
              <span className="blitz-score" aria-live="polite">
                {score}
              </span>
              <span className="caption">
                {n} answer{n === 1 ? "" : "s"}
              </span>
            </div>
          </section>

          {hits.length > 0 && (
            <ol className="panel blitz-hits" aria-label="Your answers, newest first">
              {hits.map((h) => (
                <li key={h.name} className="blitz-hit">
                  <span className="blitz-pts">+{h.points}</span>
                  <span className="blitz-name">{h.name}</span>
                  {byName.get(h.name)?.value && <span className="value">{byName.get(h.name)?.value}</span>}
                </li>
              ))}
            </ol>
          )}

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
              <button className="key key-pink" type="submit" disabled={!input.trim()}>
                Guess
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <section className="panel results enter" aria-live="polite">
            <p className="label pink">Time's up</p>
            <p className="score" aria-label={`${score} points`}>
              <span className={`score-n ${record?.best && score > 0 ? "gold" : ""}`}>{score}</span>
              <span className="score-of">pts</span>
            </p>
            <div className="results-meta">
              <p>
                <b>{n}</b> answer{n === 1 ? "" : "s"} in {BLITZ_SECONDS} seconds
              </p>
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
              <button className="key key-pink" onClick={share}>
                {copied ? "Copied" : "Share"}
              </button>
              <button className="key" onClick={again} autoFocus>
                Play again
              </button>
              <a className="key" href={`#p-${puzzle.id}`}>
                The list
              </a>
            </div>
          </section>

          <section className="panel blitz-list" aria-labelledby="blitz-got">
            <h2 id="blitz-got" className="label cyan">
              Your answers
            </h2>
            {n ? (
              <ol>
                {[...state.hits]
                  .sort((a, b) => b.points - a.points)
                  .map((h) => (
                    <li key={h.name} className="blitz-hit">
                      <span className="blitz-pts">+{h.points}</span>
                      <span className="blitz-name">{h.name}</span>
                      {byName.get(h.name)?.value && <span className="value">{byName.get(h.name)?.value}</span>}
                    </li>
                  ))}
              </ol>
            ) : (
              <p className="caption">none this time.</p>
            )}
          </section>

          <section className="panel blitz-list missed" aria-labelledby="blitz-missed">
            <h2 id="blitz-missed" className="label pink">
              Biggest you missed
            </h2>
            <ol>
              {missedTop(puzzle, state, 10).map((e) => (
                <li key={e.name} className="blitz-hit">
                  <span className="blitz-pts">{e.rank ? `#${e.rank}` : ""}</span>
                  <span className="blitz-name">{e.name}</span>
                  {e.value && <span className="value">{e.value}</span>}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  );
}
