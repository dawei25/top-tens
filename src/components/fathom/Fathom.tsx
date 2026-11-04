import { useEffect, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import {
  bandLabel,
  echoText,
  formatAmount,
  loadFathom,
  lockIn,
  MAX_TOTAL,
  MULTIPLIERS,
  nextQuestion,
  phaseOf,
  POINTS_PER_QUESTION,
  QUESTIONS_PER_GAME,
  readBank,
  readNumber,
  resumable,
  saveFathom,
  scoreGame,
  shareText,
  startGame,
  timesOff,
  totalOf,
  type Band,
  type FathomGame,
  type FathomQuestion,
  type MultiplierId,
  type NumberError,
  type Scored,
} from "../../game/fathom";
import { Loading } from "../Game";
import { CountUp } from "../motion/effects";
import { END_FOCUS_MS, reducedMotion, ScreenHead, SwapLabel } from "../pixel";
import { Gauge } from "./Gauge";
import { BUOY, placed, SQUID } from "./sprites";
import "./fathom.css";

/**
 * Fathom (beta, #fathom): five questions that each ask for a number. Type a guess (THOUSAND, MILLION and BILLION
 * multiply it), lock it in, see how far off it was on a sonar, and NEXT; five of those and the results. No timer, no
 * lives, and nothing here touches the rest of the game: its own save, no record, stats or backend. Reached only by
 * its link; App loads this screen as its own chunk.
 */

interface Props {
  onBack: () => void;
  onHome: () => void;
}

const BANK_URL = `${import.meta.env.BASE_URL}fathom/questions.json`;

/** The questions, or null when the file isn't there (or isn't a bank, or holds too few for a game). */
async function loadBank(): Promise<FathomQuestion[] | null> {
  try {
    const res = await fetch(BANK_URL);
    if (!res.ok) return null;
    const bank = readBank(await res.json());
    return bank && bank.length >= QUESTIONS_PER_GAME ? bank : null;
  } catch {
    return null;
  }
}

const ERRORS: Record<NumberError, string> = {
  empty: "Type a number first.",
  zero: "Has to be more than zero.",
  negative: "No negatives. It's more than zero.",
  text: "That doesn't read as a number.",
};

const focusGuess = () => document.querySelector<HTMLInputElement>('[data-testid="fathom-input"]')?.focus();

export default function Fathom({ onBack, onHome }: Props) {
  const [bank, setBank] = useState<FathomQuestion[] | null | "missing">(null);
  const [game, setGame] = useState<FathomGame | null>(null);

  useEffect(() => {
    let live = true;
    loadBank().then((b) => {
      if (!live) return;
      if (!b) return setBank("missing");
      // Pick up a game left unfinished (a reload, the phone dropping the tab); otherwise a new draw.
      const save = loadFathom();
      const resumed = resumable(save, b);
      if (resumed) setGame(resumed);
      else {
        const next = startGame(save, b);
        saveFathom(next);
        setGame(next.game!);
      }
      setBank(b);
    });
    return () => {
      live = false;
    };
  }, []);

  const head = (
    <ScreenHead onBack={onBack} onHome={onHome}>
      <span className="label mode">Fathom · beta</span>
    </ScreenHead>
  );

  if (bank === "missing") {
    return (
      <main className="screen fathom" data-testid="fathom" data-phase="missing">
        {head}
        <section data-glass className="panel prompt" data-testid="fathom-missing">
          <p className="label pink">No questions</p>
          <h1>The questions aren't here yet.</h1>
          <p className="caption">fathom is in beta. try again later.</p>
        </section>
      </main>
    );
  }
  if (!bank || !game) return <Loading />;

  const byId = new Map(bank.map((q) => [q.id, q]));
  const questions = game.ids.map((id) => byId.get(id)!);
  const scored = scoreGame(game, bank);
  const phase = phaseOf(game);

  const update = (next: FathomGame) => {
    setGame(next);
    saveFathom({ ...loadFathom(), game: next });
  };
  // From a tap on NEXT, the next question's box takes focus inside the tap itself, so a phone opens its keyboard.
  const next = () => {
    flushSync(() => update(nextQuestion(game)));
    focusGuess();
  };
  const again = () => {
    const fresh = startGame(loadFathom(), bank);
    saveFathom(fresh);
    flushSync(() => setGame(fresh.game!));
    scrollTo({ top: 0 });
    focusGuess();
  };

  if (phase === "results") {
    return (
      <main className="screen fathom" data-testid="fathom" data-phase="results">
        {head}
        <Results scored={scored} onAgain={again} />
      </main>
    );
  }

  const question = questions[game.at];
  return (
    <main className="screen fathom" data-testid="fathom" data-phase={phase}>
      {head}
      <section className="panel prompt fathom-q" data-glass data-testid="fathom-question" data-question={question.id}>
        <div className="prompt-top">
          <span className="label cyan">
            Question {game.at + 1} of {QUESTIONS_PER_GAME}
          </span>
          <Pips bands={scored.map((s) => s.band)} at={game.at} />
        </div>
        <h1>{question.question}</h1>
        {question.definition && <p className="caption">{question.definition}</p>}
      </section>
      {phase === "question" ? (
        <Ask key={question.id} question={question} onLock={(value) => update(lockIn(game, value))} />
      ) : (
        <Reveal key={question.id} scored={scored[game.at]} last={game.at === QUESTIONS_PER_GAME - 1} onNext={next} />
      )}
    </main>
  );
}

/** The question on screen: the field with its unit, the echo of what it reads, the multiplier keys and LOCK IN. */
function Ask({ question, onLock }: { question: FathomQuestion; onLock: (value: number) => void }) {
  const [text, setText] = useState("");
  const [mult, setMult] = useState<MultiplierId | null>(null);
  const [error, setError] = useState<NumberError | null>(null);
  const factor = MULTIPLIERS.find((m) => m.id === mult)?.factor ?? 1;
  const reading = readNumber(text, question.unit);
  const value = "value" in reading && Number.isFinite(reading.value * factor) ? reading.value * factor : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value === null) {
      setError("error" in reading ? reading.error : "text");
      focusGuess();
      return;
    }
    onLock(value);
  };

  // The line under the field: what was read, why it can't be, or what to do.
  const echo = error
    ? { tone: "error", text: ERRORS[error] }
    : value !== null
      ? { tone: "value", text: echoText(value) }
      : text.trim()
        ? { tone: "hint", text: "can't read that yet." }
        : { tone: "hint", text: mult ? `type the number of ${mult}s.` : "type a number." };

  return (
    <form className="panel fathom-ask" data-glass onSubmit={submit} data-testid="fathom-ask">
      <label className="fathom-field">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          inputMode="decimal"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder="your guess"
          aria-label="Your guess"
          aria-describedby="fathom-unit fathom-echo"
          aria-invalid={error ? true : undefined}
          data-testid="fathom-input"
        />
        <span className="fathom-unit" id="fathom-unit" data-testid="fathom-unit">
          {question.unit}
        </span>
      </label>
      <p className="fathom-echo" id="fathom-echo" role="status" data-testid="fathom-echo" data-tone={echo.tone} data-value={value ?? undefined}>
        {echo.text}
      </p>
      <div className="fathom-keys">
        <div className="fathom-mults" role="group" aria-label="Multiply by">
          {MULTIPLIERS.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`key fathom-mult ${mult === m.id ? "on" : ""}`}
              aria-pressed={mult === m.id}
              data-testid={`fathom-${m.id}`}
              // A press keeps focus (and a phone's keyboard) in the field.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setMult((x) => (x === m.id ? null : m.id));
                setError(null);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button type="submit" className="key key-pink fathom-lock" data-testid="fathom-lock" disabled={!text.trim()}>
          Lock in
        </button>
      </div>
    </form>
  );
}

/** The site a source link goes to, by name: "Wikipedia", or the host. */
function siteOf(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return /(^|\.)wikipedia\.org$/.test(host) ? "Wikipedia" : host;
  } catch {
    return "";
  }
}

/** A locked-in question: the verdict, the answer against the guess, the sonar, the fact and its source, then NEXT. */
function Reveal({ scored, last, onNext }: { scored: Scored; last: boolean; onNext: () => void }) {
  const { question: q, guess, points, band } = scored;
  const card = useRef<HTMLElement>(null);
  const nextKey = useRef<HTMLButtonElement>(null);
  // Into view at once; NEXT takes focus a beat later, so an Enter still held from LOCK IN presses nothing.
  useEffect(() => {
    card.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    const t = setTimeout(() => nextKey.current?.focus({ preventScroll: true }), END_FOCUS_MS);
    return () => clearTimeout(t);
  }, []);
  const site = siteOf(q.source.url);
  return (
    <section ref={card} className="panel fathom-reveal enter" data-glass data-testid="fathom-reveal" data-band={band} data-points={points} aria-live="polite">
      <div className="reveal-head">
        <BandChip band={band} />
        <p className="reveal-points" data-testid="fathom-points" data-points={points}>
          <b>{points}</b> {points === 1 ? "point" : "points"}
        </p>
      </div>
      <div className="reveal-figures">
        <div className="figure">
          <p className="label gold">
            <Mark kind="buoy" /> The answer
          </p>
          <p className="figure-n gold" data-testid="fathom-answer">
            <span>{formatAmount(q.answer)}</span> <span className="figure-unit">{q.unit}</span>
          </p>
        </div>
        <div className="figure">
          <p className="label cyan">
            <Mark kind="squid" /> Your guess
          </p>
          <p className="figure-n" data-testid="fathom-guess">
            <span>{formatAmount(guess)}</span> <span className="figure-unit">{q.unit}</span>
          </p>
          <p className="figure-off" data-band={band} data-testid="fathom-off">
            {timesOff(guess, q.answer)}
          </p>
        </div>
      </div>
      <Gauge guess={guess} answer={q.answer} typical={q.typical} band={band} />
      <p className="fathom-fact" data-testid="fathom-fact">
        {q.fact}
      </p>
      <p className="fathom-source">
        source:{" "}
        <a href={q.source.url} target="_blank" rel="noreferrer" data-testid="fathom-source">
          {q.source.title}
        </a>
        {site && `, ${site}`}
      </p>
      <button ref={nextKey} type="button" className="key key-pink fathom-next" data-testid="fathom-next" onClick={onNext}>
        {last ? "Results" : "Next"}
      </button>
    </section>
  );
}

/** The end: the total, the five bands in a row, COPY RESULT and PLAY AGAIN, then each question with guess and answer. */
function Results({ scored, onAgain }: { scored: Scored[]; onAgain: () => void }) {
  const total = totalOf(scored);
  const [copied, setCopied] = useState(false);
  const copyKey = useRef<HTMLButtonElement>(null);
  // COPY RESULT takes focus a beat after the end, never at once: an Enter still held from NEXT lands on nothing.
  useEffect(() => {
    const t = setTimeout(() => copyKey.current?.focus({ preventScroll: true }), END_FOCUS_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText(scored));
      setCopied(true);
    } catch {
      // No clipboard here (an insecure page, a refusal): nothing to say it was copied.
    }
  };
  const bands = scored.map((s) => s.band);
  return (
    <>
      <section className="panel results enter fathom-results" data-glass data-testid="fathom-results" aria-live="polite">
        <p className="label cyan">Your total</p>
        <p className="score" data-testid="fathom-total" data-total={total} aria-label={`${total} out of ${MAX_TOTAL}`}>
          <span className="score-n">
            <CountUp value={total} />
          </span>
          <span className="score-of">/{MAX_TOTAL}</span>
        </p>
        <div className="band-row" role="img" aria-label={bands.map(bandLabel).join(", ")} data-testid="fathom-bands">
          {bands.map((b, i) => (
            <span key={i} className="band-sq" data-band={b} />
          ))}
        </div>
        <p className="caption">
          {QUESTIONS_PER_GAME} questions, up to {POINTS_PER_QUESTION} points each.
        </p>
        <div className="results-actions">
          <button type="button" className="key key-pink" data-testid="fathom-again" onClick={onAgain}>
            Play again
          </button>
          <button ref={copyKey} type="button" className="key" data-testid="fathom-copy" onClick={copy}>
            <SwapLabel off="Copy result" on="Copied" active={copied} />
          </button>
        </div>
      </section>
      <section className="panel fathom-recap" data-glass aria-label="Your answers">
        <ol>
          {scored.map((s) => (
            <li key={s.question.id} data-testid="fathom-row" data-question={s.question.id} data-points={s.points} data-band={s.band}>
              <span className="band-sq" data-band={s.band} aria-hidden="true" />
              <span className="recap-body">
                <span className="recap-q">{s.question.question}</span>
                <span className="recap-nums">
                  you <b>{formatAmount(s.guess)}</b> · answer <b className="gold">{formatAmount(s.question.answer)}</b> {s.question.unit}
                </span>
              </span>
              <span className="recap-points" aria-label={`${s.points} points, ${bandLabel(s.band)}`}>
                {s.points}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function BandChip({ band }: { band: Band }) {
  return (
    <span className="band-chip" data-band={band} data-testid="fathom-band">
      {bandLabel(band)}
    </span>
  );
}

/** Progress: a square per question, the answered ones in their band's colour, the one on screen outlined. */
function Pips({ bands, at }: { bands: Band[]; at: number }) {
  return (
    <span className="fathom-pips" aria-hidden="true">
      {Array.from({ length: QUESTIONS_PER_GAME }, (_, i) => (
        <span key={i} className={`pip ${i === at ? "now" : ""}`} data-band={bands[i]} />
      ))}
    </span>
  );
}

/** The gauge's two marks, small, beside the labels they stand for: the buoy (the answer) and the squid (you). */
const MARKS = { buoy: [...BUOY, "..#..", "..#.."], squid: SQUID };
function Mark({ kind }: { kind: keyof typeof MARKS }) {
  const rows = MARKS[kind];
  const w = rows[0].length;
  return (
    <svg className={`fathom-mark mark-${kind}`} viewBox={`0 0 ${w} ${rows.length}`} width={w * 2} height={rows.length * 2} shapeRendering="crispEdges" aria-hidden="true">
      <path d={placed(rows)} fill="currentColor" />
    </svg>
  );
}
