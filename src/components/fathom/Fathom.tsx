import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { flushSync } from "react-dom";
import {
  askFor,
  bandLabel,
  editField,
  formatAmount,
  loadFathom,
  lockIn,
  MAX_TOTAL,
  missText,
  nextQuestion,
  phaseOf,
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
  TYPICAL_TOTAL,
  type Band,
  type FathomGame,
  type FathomQuestion,
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
 * Fathom (beta, #fathom): five questions that each ask for a number, in a unit that keeps it short ("kilometres",
 * "million people"). Type a guess, lock it in, see how far off it was on a sonar, and NEXT; five of those and the
 * results. No timer, no lives, and nothing here touches the rest of the game: its own save, no record, stats or
 * backend. Reached only by its link; App loads this screen as its own chunk.
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
    const json = await res.json();
    const bank = readBank(json);
    // Malformed questions are left out, not fatal; say so where whoever writes the file will look.
    const dropped = (json?.questions?.length ?? 0) - (bank?.length ?? 0);
    if (bank && dropped > 0) console.warn(`fathom: ${dropped} question(s) in the file left out (malformed or repeated ids)`);
    return bank && bank.length >= QUESTIONS_PER_GAME ? bank : null;
  } catch {
    return null;
  }
}

/** What's wrong, in one line at 320px (a unit typed that the question isn't in: "In centimetres, please."). */
const ERRORS: Record<Exclude<NumberError, "unit">, string> = {
  empty: "Type a number first.",
  zero: "Has to be more than zero.",
  negative: "No negatives. It's above zero.",
  text: "That doesn't read as a number.",
};
const errorText = (error: NumberError, unit: string) => (error === "unit" ? askFor(unit) : ERRORS[error]);

const focusGuess = () => document.querySelector<HTMLInputElement>('[data-testid="fathom-input"]')?.focus();

/** The screen height (CSS px) at or under which a phone gets the compact layout: a small phone, or its keyboard up. */
const SHORT = 600;
/**
 * Whether the screen shows little height on a phone: a small phone, or one with its keyboard up. Android shrinks the
 * page for the keyboard (index.html asks for interactive-widget=resizes-content), but iOS lays the keyboard over it, and
 * only the visual viewport says so; a pinch zoom shrinks that too, so its scale is taken out.
 */
function useShort(): boolean {
  const measure = () => {
    if (typeof window === "undefined") return false;
    const vv = window.visualViewport;
    const height = Math.min(window.innerHeight, vv ? vv.height * vv.scale : Infinity);
    return window.innerWidth < 700 && height <= SHORT;
  };
  const [short, setShort] = useState(measure);
  useEffect(() => {
    const check = () => setShort(measure());
    const vv = window.visualViewport;
    vv?.addEventListener("resize", check);
    window.addEventListener("resize", check);
    return () => {
      vv?.removeEventListener("resize", check);
      window.removeEventListener("resize", check);
    };
  }, []);
  return short;
}

export default function Fathom({ onBack, onHome }: Props) {
  const [bank, setBank] = useState<FathomQuestion[] | null | "missing">(null);
  const [game, setGame] = useState<FathomGame | null>(null);
  const short = useShort();

  useEffect(() => {
    let live = true;
    loadBank().then((b) => {
      if (!live) return;
      if (!b) return setBank("missing");
      // Pick up the game on screen, unfinished or on its results (a reload, the phone dropping the tab); otherwise a
      // new draw.
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
  // From a tap on NEXT, the next question's box takes focus inside the tap itself, so a phone opens its keyboard. The
  // question starts at the top of the screen, whatever the reveal had scrolled to.
  const next = () => {
    flushSync(() => update(nextQuestion(game)));
    scrollTo({ top: 0 });
    focusGuess();
  };
  const again = () => {
    const fresh = startGame(loadFathom(), bank);
    saveFathom(fresh);
    flushSync(() => setGame(fresh.game!));
    scrollTo({ top: 0 });
    focusGuess();
  };

  const question = questions[game.at];
  const shown = phase === "reveal" ? scored[game.at] : undefined;
  // What a screen reader hears as each verdict and the total appear (the line is there before its words change).
  const said = shown
    ? `${bandLabel(shown.band)}, ${shown.points} points. The answer: ${formatAmount(shown.question.answer)} ${shown.question.unit}. ` +
      `Yours was ${timesOff(shown.guess, shown.question.answer)}.`
    : phase === "results"
      ? `Your total: ${totalOf(scored)} out of ${MAX_TOTAL}.`
      : "";
  return (
    <main className="screen fathom" data-testid="fathom" data-phase={phase} data-short={short || undefined}>
      {head}
      <p className="sr-only" role="status">
        {said}
      </p>
      {phase === "results" ? (
        <Results scored={scored} onAgain={again} />
      ) : (
        <>
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
            <Reveal key={question.id} scored={shown!} last={game.at === QUESTIONS_PER_GAME - 1} onNext={next} />
          )}
        </>
      )}
    </main>
  );
}

/**
 * The question on screen: the field with its unit (the number grouped with commas as it's typed), a line for what's
 * wrong or what was read when the field doesn't show it, and LOCK IN.
 */
function Ask({ question, onLock }: { question: FathomQuestion; onLock: (value: number) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<NumberError | null>(null);
  const reading = readNumber(text, question.unit);
  const value = "value" in reading ? reading.value : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value === null) {
      setError("error" in reading ? reading.error : "text");
      focusGuess();
      return;
    }
    onLock(value);
  };

  // Grouped as it's typed ("8800000" shows "8,800,000"), the caret kept after the same digit.
  const edit = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const next = editField(text, el.value, el.selectionStart ?? el.value.length);
    if (next.text !== el.value) {
      el.value = next.text;
      el.setSelectionRange(next.caret, next.caret);
    }
    setText(next.text);
    setError(null);
  };

  // The line under the field: why a guess can't be, or what was read when the field doesn't already show it ("2.5m"
  // is 2.5 million; "0.5m" in centimetres 50 centimetres; "8,800,000" in million people 8.8 million people). Nothing
  // when the field shows the number as it is.
  const converted = "converted" in reading && reading.converted;
  const echo = error
    ? { tone: "error", text: errorText(error, question.unit) }
    : value !== null && Number(text.replace(/,/g, "")) !== value
      ? { tone: "value", text: converted ? `${formatAmount(value)} ${question.unit}` : formatAmount(value) }
      : { tone: "none", text: "" };

  return (
    <form className="panel fathom-ask" data-glass onSubmit={submit} data-testid="fathom-ask">
      <label className="fathom-field">
        <input
          value={text}
          onChange={edit}
          // LOCK IN is off while the field is empty, so Enter there submits nothing: say why instead.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !text.trim()) setError("empty");
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
      <div className="fathom-keys">
        <p className="fathom-echo" id="fathom-echo" role="status" data-testid="fathom-echo" data-tone={echo.tone} data-value={value ?? undefined}>
          {echo.text}
        </p>
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
    <section ref={card} className="panel fathom-reveal enter" data-glass data-testid="fathom-reveal" data-band={band} data-points={points}>
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
          <p className="figure-n gold" data-testid="fathom-answer" data-value={q.answer}>
            <span>{formatAmount(q.answer)}</span> <span className="figure-unit">{q.unit}</span>
          </p>
        </div>
        <div className="figure">
          <p className="label cyan">
            <Mark kind="squid" /> Your guess
          </p>
          <p className="figure-n" data-testid="fathom-guess" data-value={guess}>
            <span>{formatAmount(guess)}</span> <span className="figure-unit">{q.unit}</span>
          </p>
          <p className="figure-off" data-band={band} data-testid="fathom-off">
            {timesOff(guess, q.answer)}
          </p>
          <p className="figure-typical" data-testid="fathom-typical" data-typical={q.typical}>
            {missText(q.typical)}
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
      <button
        ref={nextKey}
        type="button"
        className="key key-pink fathom-next"
        data-testid="fathom-next"
        onClick={onNext}
        // An Enter held down since LOCK IN repeats: only a fresh press moves on.
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.repeat) e.preventDefault();
        }}
      >
        {last ? "Results" : "Next"}
      </button>
    </section>
  );
}

/**
 * The end: the total and what a typical guesser scores, the five bands in a row, NEW QUESTIONS and COPY RESULT, then
 * each question with guess and answer.
 */
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
      <section className="panel results enter fathom-results" data-glass data-testid="fathom-results">
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
        <p className="caption" data-testid="fathom-typical-total" data-total={TYPICAL_TOTAL}>
          a typical guesser scores about {TYPICAL_TOTAL}.
        </p>
        <div className="results-actions">
          <button type="button" className="key key-pink" data-testid="fathom-again" onClick={onAgain}>
            New questions
          </button>
          <button ref={copyKey} type="button" className="key" data-testid="fathom-copy" onClick={copy}>
            <SwapLabel off="Copy result" on="Copied" active={copied} />
          </button>
        </div>
      </section>
      <section className="panel fathom-recap" data-glass aria-label="Your answers">
        <ol>
          {scored.map((s) => (
            <li
              key={s.question.id}
              data-testid="fathom-row"
              data-question={s.question.id}
              data-guess={s.guess}
              data-points={s.points}
              data-band={s.band}
            >
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
