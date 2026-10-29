import { useEffect, useRef, useState } from "react";
import { loadPuzzle, dayNumber, type PuzzleMeta } from "../game/puzzles";
import { judgeGuess } from "../game/match";
import { applyGuess, giveUp, MAX_LIVES, newGame, shareText, type GameState } from "../game/state";
import { load, save } from "../game/storage";
import type { Lexicon } from "../game/junk";
import type { GuessResult, Puzzle } from "../game/types";

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

function describe(r: GuessResult): Omit<Feedback, "key"> | null {
  switch (r.kind) {
    case "correct":
      return { tone: "good", text: `#${r.entry.rank}` };
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

export function Game({ id, daily, lexicon, onHome, onRoll }: Props) {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [input, setInput] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastFound, setLastFound] = useState<number | null>(null);
  const [shake, setShake] = useState(0);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  if (error) {
    return (
      <main className="game">
        <p>{error}</p>
        <button className="btn" onClick={onHome}>
          Home
        </button>
      </main>
    );
  }
  if (!puzzle || !game) return <div className="loading">Loading…</div>;

  const over = game.status !== "playing";
  const fill = (name: string) => {
    setInput(name);
    inputRef.current?.focus();
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
    setGame(state);
    setFeedback({ ...fb, key: Date.now() });
    if (result.kind === "correct") setLastFound(result.entry.rank);
    if (result.kind === "near" || result.kind === "unknown" || result.kind === "typo") setShake((n) => n + 1);
    // Keep the text on a typo so it can be fixed by hand as well as by tapping a suggestion.
    if (result.kind !== "typo") setInput("");
    inputRef.current?.focus();
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    guess(input);
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
      ? [{ key: i, text: l.result.entry.rank ? `#${l.result.entry.rank} ${l.result.entry.name}` : l.result.entry.name }]
      : [],
  );

  return (
    <main className={`game status-${game.status}`}>
      <header className="game-head">
        <button className="icon-btn" onClick={onHome} aria-label="Home">
          ←
        </button>
        <span className="game-mode">{daily ? "Today's list" : "Random list"}</span>
        <div className="lives" aria-label={`${game.lives} lives left`}>
          {Array.from({ length: MAX_LIVES }, (_, i) => (
            <span key={i} className={`life ${i < game.lives ? "on" : "off"}`} />
          ))}
        </div>
      </header>

      <section className="prompt">
        <h1>{puzzle.title}</h1>
        <p>{puzzle.prompt}</p>
        <div className="progress">
          <b>{game.found.length}</b>/10
        </div>
      </section>

      <ol className="slots">
        {puzzle.answers.map((a) => {
          const found = game.found.includes(a.rank);
          const revealed = found || over;
          return (
            <li
              key={a.rank}
              className={`slot ${found ? "found" : revealed ? "missed" : "hidden"} ${lastFound === a.rank ? "just" : ""}`}
            >
              <span className="rank">{a.rank}</span>
              <span className="name">{revealed ? a.name : ""}</span>
              {revealed && a.value && <span className="value">{a.value}</span>}
            </li>
          );
        })}
      </ol>

      {misses.length > 0 && (
        <div className="miss-list" aria-label="Wrong guesses">
          {misses.map((m) => (
            <span key={m.key} className="miss-chip">
              {m.text}
            </span>
          ))}
        </div>
      )}

      {!over ? (
        <form className="guess" onSubmit={submit}>
          {feedback && (
            <div key={feedback.key} className={`toast ${feedback.tone}`} role="status">
              {feedback.text}
              {feedback.suggestions?.map((s) => (
                <button key={s} type="button" className="suggestion" onClick={() => fill(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          <div key={shake} className={`guess-row ${shake ? "shake" : ""}`}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a guess…"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              aria-label="Your guess"
            />
            <button className="btn btn-primary" type="submit" disabled={!input.trim()}>
              Guess
            </button>
          </div>
          <button type="button" className="link give-up" onClick={() => setGame(giveUp(game))}>
            Give up
          </button>
        </form>
      ) : (
        <section className="results">
          <h2>
            {game.status === "won" ? "Perfect 10!" : `${game.found.length}/10`}
            <small>
              {game.status === "won"
                ? `with ${game.lives} ${game.lives === 1 ? "life" : "lives"} to spare`
                : game.status === "gave-up"
                  ? "You gave up"
                  : "Out of lives"}
            </small>
          </h2>
          <div className="results-actions">
            <button className="btn btn-primary" onClick={share}>
              {copied ? "Copied!" : "Share"}
            </button>
            <button className="btn btn-secondary" onClick={onRoll}>
              Roll another
            </button>
          </div>
          <p className="source">
            {puzzle.metric && <>Ranked by {puzzle.metric.toLowerCase()}. </>}
            Source:{" "}
            <a href={puzzle.source.url} target="_blank" rel="noreferrer">
              {puzzle.source.name}
            </a>{" "}
            (as of {puzzle.source.asOf})
          </p>
        </section>
      )}
    </main>
  );
}
