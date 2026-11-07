import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  amountText,
  bandLabel,
  bandOf,
  editField,
  figureParts,
  formatAmount,
  guessError,
  loadFathom,
  lockIn,
  MAX_TOTAL,
  missText,
  nextQuestion,
  phaseOf,
  playersLine,
  QUESTIONS_PER_GAME,
  readBank,
  readGuess,
  resumable,
  roundOf,
  ROUNDS,
  ruleFor,
  saveFathom,
  scoreFor,
  scoreGame,
  shareText,
  startGame,
  totalOf,
  unitShown,
  type Band,
  type FathomGame,
  type FathomQuestion,
  type NumberError,
  type Scored,
} from "../../game/fathom";
import { submitFathomGuess, useFathomCrowd } from "../../net";
import { Loading } from "../Game";
import { CountUp } from "../motion/effects";
import { END_FOCUS_MS, reducedMotion, ScreenHead, SwapLabel } from "../pixel";
import { playFathom } from "../sound/fathom";
import { Gauge } from "./Gauge";
import { BUOY, placed, SQUID } from "./sprites";
import "./fathom.css";

/**
 * Fathom (beta, #fathom): five questions that each ask for a number: estimates in a unit that keeps them short
 * ("kilometres", "million people"), a percent and a year. Type a guess, lock it in, see how close it was on a sonar,
 * and NEXT; five of those and the results. One plain scoring rule for each round, stated on the round's first question
 * and again on the results. No timer, no lives, and nothing here touches the rest of the game: its own save, no record
 * or stats. With a backend, each guess is also sent, and a reveal says how real players guessed once there are enough
 * of them. Reached only by its link; App loads this screen as its own chunk.
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
  // LOCK IN: a click, the ping and the band's sound (with sound on), the guess sent (with a backend), then the reveal.
  const lock = (value: number) => {
    playFathom({ kind: "lock" });
    playFathom({ kind: "reveal", band: bandOf(scoreFor(question, value)) });
    submitFathomGuess(question.id, value);
    update(lockIn(game, value));
  };
  // From a tap on NEXT, the next question's box takes focus inside the tap itself, so a phone opens its keyboard. The
  // question starts at the top of the screen, whatever the reveal had scrolled to. After the last one, the results'
  // fanfare.
  const next = () => {
    const after = nextQuestion(game);
    if (phaseOf(after) === "results") playFathom({ kind: "results", total: totalOf(scoreGame(after, bank)) });
    flushSync(() => update(after));
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
  const total = totalOf(scored);
  // What a screen reader hears as each verdict and the total appear (the line is there before its words change).
  const said = shown
    ? `${bandLabel(shown.band)}, ${shown.points} points. The answer: ${amountText(shown.question, shown.question.answer)}. ` +
      `Yours was ${missText(shown.question, shown.guess)}.${game.at > 0 ? ` Total so far: ${total}.` : ""}`
    : phase === "results"
      ? `Your total: ${total} out of ${MAX_TOTAL}.`
      : "";
  // The round's scoring rule, read with the first question of that round, before its first answer (the estimate's on
  // the first estimate, the percent's on the percent). With little height (a small phone, or the keyboard up) it goes
  // under LOCK IN, so the question, the field and LOCK IN still fit.
  const round = question && roundOf(question);
  const firstOfRound = !!question && questions.findIndex((x) => roundOf(x) === round) === game.at;
  const rule = firstOfRound && (
    <p className="fathom-rule" data-testid="fathom-rule" data-round={round}>
      {ruleFor(question)}
    </p>
  );
  const ruleBelow = short && phase === "question";
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
          <section className="panel prompt fathom-q" data-glass data-testid="fathom-question" data-question={question.id} data-round={round}>
            <div className="prompt-top">
              <span className="label cyan">
                Question {game.at + 1} of {QUESTIONS_PER_GAME}
              </span>
              <Pips bands={scored.map((s) => s.band)} at={game.at} />
            </div>
            <h1>{question.question}</h1>
            {question.definition && <p className="caption">{question.definition}</p>}
            {!ruleBelow && rule}
          </section>
          {phase === "question" ? (
            <Ask key={question.id} question={question} onLock={lock} footer={ruleBelow && rule ? rule : undefined} />
          ) : (
            <Reveal key={question.id} scored={shown!} total={game.at > 0 ? total : undefined} last={game.at === QUESTIONS_PER_GAME - 1} onNext={next} />
          )}
        </>
      )}
    </main>
  );
}

/**
 * The question on screen: the field with its unit (the number grouped with commas as it's typed; a year as typed), a
 * line for what's wrong or what was read when the field doesn't show it, LOCK IN, and `footer` under them (the scoring
 * rule, when there's little height). A phone gets a decimal keypad, or for a year a plain number pad.
 */
function Ask({ question, onLock, footer }: { question: FathomQuestion; onLock: (value: number) => void; footer?: ReactNode }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<NumberError | null>(null);
  const round = roundOf(question);
  const reading = readGuess(text, question);
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

  // Grouped as it's typed ("8800000" shows "8,800,000"), the caret kept after the same digit; a year never is.
  const edit = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const next = editField(text, el.value, el.selectionStart ?? el.value.length, round);
    if (next.text !== el.value) {
      el.value = next.text;
      el.setSelectionRange(next.caret, next.caret);
    }
    setText(next.text);
    setError(null);
  };

  // The line under the field: why a guess can't be, or what was read when the field doesn't already show it ("2.5m"
  // is 2.5 million; "0.5m" in centimetres 50 centimetres; "8,800,000" in million people 8.8 million people; "AD 2007"
  // 2007). Nothing when the field shows the number as it is ("71%" too).
  const converted = "converted" in reading && reading.converted;
  const bare = text.replace(/,/g, "").replace(/\s*%\s*$/, "");
  const echo = error
    ? { tone: "error", text: guessError(error, question) }
    : value !== null && Number(bare) !== value
      ? { tone: "value", text: converted || round !== "estimate" ? amountText(question, value) : formatAmount(value) }
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
          inputMode={round === "year" ? "numeric" : "decimal"}
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
          {unitShown(question)}
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
      {footer}
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

/**
 * A locked-in question: the band in big type, the points (and the running total from the second question), the answer
 * against the guess, how real players guessed (with a backend, from 20 of them), the sonar with the miss under the
 * squid, the fact and its source, then NEXT.
 */
function Reveal({ scored, total, last, onNext }: { scored: Scored; total?: number; last: boolean; onNext: () => void }) {
  const { question: q, guess, points, band } = scored;
  const crowd = useFathomCrowd(q.id, guess, q.answer);
  const players = playersLine(crowd, q.unit, roundOf(q));
  const answer = figureParts(q, q.answer);
  const yours = figureParts(q, guess);
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
        <BandWord band={band} />
        <div className="reveal-score">
          <p className="reveal-points" data-testid="fathom-points" data-points={points}>
            <b>{points}</b> {points === 1 ? "point" : "points"}
          </p>
          {total !== undefined && (
            <p className="reveal-total" data-testid="fathom-running" data-total={total}>
              total <b>{total}</b>
            </p>
          )}
        </div>
      </div>
      <div className="reveal-figures">
        <div className="figure">
          <p className="label gold">
            <Mark kind="buoy" /> The answer
          </p>
          <p className="figure-n gold" data-testid="fathom-answer" data-value={q.answer}>
            <Figure parts={answer} />
          </p>
        </div>
        <div className="figure">
          <p className="label cyan">
            <Mark kind="squid" /> Your guess
          </p>
          <p className="figure-n" data-testid="fathom-guess" data-value={guess}>
            <Figure parts={yours} />
          </p>
        </div>
      </div>
      {players && crowd && (
        <p className="fathom-players" data-testid="fathom-players" data-n={crowd.n} data-median={crowd.median ?? undefined} data-further={crowd.furtherOff ?? undefined}>
          {players}
        </p>
      )}
      <Gauge guess={guess} answer={q.answer} band={band} round={roundOf(q)} unit={q.unit} nameIt={q.nameIt} />
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

/** A number on the reveal, and its unit beside it when it has one ("330" "metres"; "71%", "2007" have none). */
function Figure({ parts }: { parts: { n: string; unit?: string } }) {
  return (
    <>
      <span>{parts.n}</span>
      {parts.unit && (
        <>
          {" "}
          <span className="figure-unit">{parts.unit}</span>
        </>
      )}
    </>
  );
}

/**
 * The end: the total, the five bands in a row, the scoring rules again (one line for each round played), NEW
 * QUESTIONS and COPY RESULT, then each question with guess and answer.
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
  // Each round's rule once, from the first question of that round (a name-it round's is its list's).
  const played = ROUNDS.flatMap((r) => {
    const first = scored.find((s) => roundOf(s.question) === r);
    return first ? [{ r, rule: ruleFor(first.question) }] : [];
  });
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
        {played.map(({ r, rule }) => (
          <p key={r} className="caption fathom-rule-end" data-testid="fathom-rule" data-round={r}>
            {rule}
          </p>
        ))}
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
          {scored.map((s) => {
            const unit = figureParts(s.question, s.question.answer).unit;
            return (
              <li
                key={s.question.id}
                data-testid="fathom-row"
                data-question={s.question.id}
                data-round={roundOf(s.question)}
                data-guess={s.guess}
                data-points={s.points}
                data-band={s.band}
              >
                <span className="band-sq" data-band={s.band} aria-hidden="true" />
                <span className="recap-body">
                  <span className="recap-q">{s.question.question}</span>
                  <span className="recap-nums" data-testid="fathom-row-nums">
                    you <b>{figureParts(s.question, s.guess).n}</b> · answer <b className="gold">{figureParts(s.question, s.question.answer).n}</b>
                    {unit && ` ${unit}`}
                  </span>
                </span>
                <span className="recap-points" aria-label={`${s.points} points, ${bandLabel(s.band)}`}>
                  {s.points}
                </span>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

/** The verdict in big type: "DEAD ON!", "CLOSE", "NEAR", "FAR", "LOST AT SEA". */
function BandWord({ band }: { band: Band }) {
  return (
    <p className="band-word" data-band={band} data-testid="fathom-band">
      {band === "dead-on" ? `${bandLabel(band)}!` : bandLabel(band)}
    </p>
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
