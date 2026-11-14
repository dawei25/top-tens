import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  amountText,
  bandLabel,
  bandOf,
  editField,
  figureParts,
  finished,
  formatAmount,
  formatColumn,
  guessError,
  loadFathom,
  lockIn,
  MAX_TOTAL,
  missText,
  nextQuestion,
  phaseOf,
  playersLine,
  QUESTIONS_PER_GAME,
  readGuess,
  resumable,
  roundOf,
  saveFathom,
  scoreFor,
  scoreGame,
  shareLines,
  shareText,
  startGame,
  totalOf,
  unitShown,
  type Band,
  type FathomGame,
  type FathomQuestion,
  type FathomSave,
  type NumberError,
  type Scored,
} from "../../game/fathom";
import { dayFor, readSchedule, type FathomDailyEntry } from "../../game/fathom-daily";
import {
  dailyRun,
  findRun,
  loadDailyLocal,
  noteDraw,
  recentIds,
  recordRun,
  runTotal,
  saveDailyLocal,
  type DailyLocal,
  type FathomDay,
  type FathomRun,
} from "../../game/fathom-history";
import { localDate } from "../../game/daily";
import { FATHOM_TODAY, fathomDayLine } from "../copy";
import { Countdown } from "../Countdown";
import { load, save } from "../../game/storage";
import {
  asOfText,
  bestAnswers,
  nameLine,
  nameListIds,
  readFullBank,
  readList,
  readName,
  type NameList,
  type NameRead,
} from "../../game/fathom-name";
import type { Lexicon } from "../../game/junk";
import { loadLexicon } from "../../game/puzzles";
import { compareRound, reportFathom, reportFathomDaily, submitFathomGuess, useFathomCrowd, useFathomDay } from "../../net";
import { dayCounts, dayStanding, expectedTotal, FATHOM_BIN, simulatedCounts, totalBin } from "../../game/fathom-crowd";
import { blendAverage } from "../../net/crowd";
import { ParHistogram } from "../par";
import { Loading } from "../Game";
import { pasteable } from "../share";
import { CountUp } from "../motion/effects";
import { END_FOCUS_MS, reducedMotion, ScreenHead, SwapLabel } from "../pixel";
import { playFathom } from "../sound/fathom";
import { Gauge } from "./Gauge";
import { BUOY, placed, SQUID } from "./sprites";
import "./fathom.css";

/**
 * Fathom: five questions: estimates in a unit that keeps them short ("kilometres", "million people"), a percent, a
 * year, and a name-it round ("Name a country with about 50 million people", read with the game's matcher over its
 * list). Type a guess, lock it in, see how close it was on a sonar, and NEXT; five of those and the results. No timer,
 * no lives, no scoring line (How to play explains it); a running score in the question card's header.
 *
 * Two ways to play (owner, Nov 14: "id like fathom to have a today's fathom- remove the unlimited fathom play for now-
 * keep access to it via a hidden url"):
 * - `daily` (#fathom, Home's key under Today's list and the menu): Today's Fathom, the same five for everyone
 *   (fathom-daily.ts), one try: a finished one reopens on its results, on any of the player's devices.
 * - `endless` (#fathom-endless, linked nowhere): new questions after every game, as before.
 * The game under way is kept in this browser; each finished game goes into the player's save (Past runs, Stats, and
 * the account's sync: fathom-history.ts). With a backend, each guess is also sent, and a reveal says how real players
 * guessed once there are enough of them. App loads this screen as its own chunk.
 *
 * With `run` (#fathom/run-<startedAt>, from Past runs), it shows that finished game's results instead.
 */

export type FathomMode = "daily" | "endless";

interface Props {
  onBack: () => void;
  onHome: () => void;
  /** A finished game to show (its startedAt), from Past runs. */
  run?: number;
  mode?: FathomMode;
  /** The player's local date: Today's Fathom's day. */
  today?: string;
}

/** Fathom #1's date, for a day the schedule file doesn't cover when there is no file at all. */
const DAY_ONE = "2026-11-14";
const SCHEDULE_URL = `${import.meta.env.BASE_URL}fathom/daily.json`;

/** The schedule of Today's Fathom ([] when it isn't there: each day is then seeded by its date). */
async function loadDays(): Promise<FathomDailyEntry[]> {
  try {
    const res = await fetch(SCHEDULE_URL);
    return res.ok ? readSchedule(await res.json()) : [];
  } catch {
    return [];
  }
}

/** A day's game under way, as the screen plays it. */
const fromLocal = (l: DailyLocal): FathomGame => ({ ids: l.ids, guesses: l.guesses, at: l.at, startedAt: l.startedAt, ...(l.picks && { picks: l.picks }) });

/** The share text's link: Fathom itself. */
const fathomUrl = () => `${location.origin}${location.pathname}#fathom`;

/**
 * The questions the next draw holds back: the last games drawn on any of the player's devices (the save), or this
 * browser's own memory from before they were kept there.
 */
const recentOf = (local: FathomSave): string[][] => {
  const synced = recentIds(load().fathom);
  return synced.length ? synced : local.recent;
};

/** A fresh game, drawn now: kept in this browser, and its draw in the player's save. */
function freshGame(bank: readonly FathomQuestion[]): FathomGame {
  const local = loadFathom();
  const next = startGame({ ...local, recent: recentOf(local) }, bank);
  saveFathom(next);
  const game = next.game!;
  save({ ...load(), fathom: noteDraw(load().fathom, { startedAt: game.startedAt!, ids: game.ids }) });
  return game;
}

/**
 * A game whose last guess is in, recorded in the player's save (once: Past runs, Stats, the sync), with each question's
 * points as scored now. A game from before games were dated gets its date first.
 */
function recordFinished(game: FathomGame, bank: readonly FathomQuestion[], day?: FathomDay): void {
  if (!finished(game) || game.startedAt === undefined) return;
  const scored = scoreGame(game, bank);
  if (scored.length !== game.ids.length) return;
  const run: FathomRun = {
    startedAt: game.startedAt,
    finishedAt: Date.now(),
    ids: game.ids,
    guesses: game.guesses,
    ...(game.picks && { picks: game.picks }),
    points: scored.map((x) => x.points),
    ...(day && { daily: day }),
  };
  const before = load();
  // A game from before a reset made on another device stays out (the sync would only prune it again).
  const resetAt = (before as { resetAt?: number }).resetAt;
  if (resetAt && run.startedAt < resetAt) return;
  const fathom = recordRun(before.fathom, run);
  if (fathom === before.fathom) return;
  save({ ...before, fathom });
  reportFathom();
  // Today's Fathom joins the day's players (with a backend), once: the run is recorded once.
  if (day) reportFathomDaily(day.date, runTotal(run));
}

const BANK_URL = `${import.meta.env.BASE_URL}fathom/questions.json`;
const listUrl = (id: string) => `${import.meta.env.BASE_URL}fathom/lists/${id}.json`;

/** A name-it round's list, or null when its file isn't there (or isn't that list). */
async function loadList(id: string): Promise<NameList | null> {
  try {
    const res = await fetch(listUrl(id));
    if (!res.ok) return null;
    const list = readList(await res.json());
    return list?.id === id ? list : null;
  } catch {
    return null;
  }
}

interface Loaded {
  bank: FathomQuestion[];
  /** The name-it rounds' lists, by id: each other one tells a thing of another kind (a city on a country question). */
  lists: Map<string, NameList>;
}

/**
 * The questions, with the lists the name-it questions use, or null when the bank isn't there (or isn't a bank, or holds
 * too few for a game). A name-it question whose list didn't load is left out, and the draw plays an estimate.
 */
async function loadBank(): Promise<Loaded | null> {
  try {
    const res = await fetch(BANK_URL);
    if (!res.ok) return null;
    const json = await res.json();
    const loaded = await Promise.all(nameListIds(json).map(loadList));
    const lists = new Map(loaded.filter((l): l is NameList => !!l).map((l) => [l.id, l]));
    const bank = readFullBank(json, lists);
    // Malformed questions are left out, not fatal; say so where whoever writes the file will look.
    const dropped = (json?.questions?.length ?? 0) - (bank?.length ?? 0);
    if (bank && dropped > 0) console.warn(`fathom: ${dropped} question(s) in the file left out (malformed, repeated ids, or a name-it list not there)`);
    return bank && bank.length >= QUESTIONS_PER_GAME ? { bank, lists } : null;
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

export default function Fathom({ onBack, onHome, run, mode = "daily", today = localDate() }: Props) {
  const [data, setData] = useState<Loaded | null | "missing">(null);
  const [game, setGame] = useState<FathomGame | null>(null);
  /** Today's Fathom: its day; and its finished game when it was played elsewhere (one try, on any device). */
  const [day, setDay] = useState<FathomDay>();
  const [playedRun, setPlayedRun] = useState<FathomRun>();
  // The matcher's lexicon (TENtacle's, the app already has it cached): what was typed is a real name of its own, so it
  // is never "corrected" into a different one. Optional: without it, a name still reads.
  const [lex, setLex] = useState<Lexicon>();
  // Fetched with the bank, so it is there by the name-it round; a name read before it arrives waits for it.
  const [lexicon] = useState(loadLexicon);
  const short = useShort();

  useEffect(() => {
    let live = true;
    Promise.all([loadBank(), loadDays()]).then(([loaded, schedule]) => {
      if (!live) return;
      if (!loaded) return setData("missing");
      const b = loaded.bank;
      // A past game from Past runs: only its results, nothing drawn.
      if (run !== undefined) {
        // (Nothing to start.)
      } else if (mode === "daily") {
        // Today's Fathom: the day's five; its game under way here, or a new one; once finished anywhere, its results.
        const d = dayFor(schedule, b, today, schedule[0]?.date ?? DAY_ONE);
        const have = new Set(b.map((q) => q.id));
        const local = loadDailyLocal();
        const mine = local && local.day.date === today && local.ids.every((id) => have.has(id)) ? fromLocal(local) : undefined;
        const played = dailyRun(load().fathom, today);
        if (played && !(mine && finished(mine))) setPlayedRun(played);
        else if (mine && local) {
          setDay(local.day);
          setGame(mine);
          recordFinished(mine, b, local.day);
        } else {
          const fresh: FathomGame = { ids: d.ids, guesses: [], at: 0, startedAt: Date.now() };
          saveDailyLocal({ day: { date: d.date, n: d.n }, ids: fresh.ids, guesses: [], at: 0, startedAt: fresh.startedAt! });
          setDay({ date: d.date, n: d.n });
          setGame(fresh);
        }
      } else {
        // Endless: the game on screen, unfinished or on its results (a reload, the phone dropping the tab); otherwise a
        // new draw. A game from before games were dated is dated now, and recorded if it is over.
        const local = loadFathom();
        let resumed = resumable(local, b);
        if (resumed && resumed.startedAt === undefined) {
          resumed = { ...resumed, startedAt: Date.now() };
          saveFathom({ ...local, game: resumed });
        }
        if (resumed) recordFinished(resumed, b);
        setGame(resumed ?? freshGame(b));
      }
      setData(loaded);
      if (loaded.lists.size) lexicon.then((l) => live && setLex(l));
    });
    return () => {
      live = false;
    };
  }, []);

  const number = day?.n ?? playedRun?.daily?.n;
  const head = (
    <ScreenHead onBack={onBack} onHome={onHome}>
      <span className="label mode" data-testid="fathom-mode" data-mode={run !== undefined ? "past" : mode} data-n={number}>
        {mode === "daily" && number && run === undefined ? `Fathom #${number}` : "Fathom"}
      </span>
    </ScreenHead>
  );

  if (data === "missing") {
    return (
      <main className="screen fathom" data-testid="fathom" data-phase="missing">
        {head}
        <section data-glass className="panel prompt" data-testid="fathom-missing">
          <p className="label pink">No questions</p>
          <h1>The questions didn't load.</h1>
          <p className="caption">check your connection and try again.</p>
        </section>
      </main>
    );
  }
  if (data && run !== undefined) return <PastGame head={head} run={run} bank={data.bank} />;
  if (data && playedRun) return <PastGame head={head} run={playedRun.startedAt} bank={data.bank} today />;
  if (!data || !game) return <Loading />;
  const { bank, lists } = data;

  const byId = new Map(bank.map((q) => [q.id, q]));
  const questions = game.ids.map((id) => byId.get(id)!);
  const scored = scoreGame(game, bank);
  const phase = phaseOf(game);

  const update = (next: FathomGame) => {
    setGame(next);
    if (day) saveDailyLocal({ day, ids: next.ids, guesses: next.guesses, at: next.at, startedAt: next.startedAt ?? Date.now(), ...(next.picks && { picks: next.picks }) });
    else saveFathom({ ...loadFathom(), game: next });
    recordFinished(next, bank, day);
  };
  // LOCK IN: a click, the ping and the band's sound (with sound on), the guess sent (with a backend), then the reveal.
  // A name-it round's guess is the figure of the thing named, kept with its name, and that figure is what's sent.
  const lock = (value: number, pick?: string) => {
    playFathom({ kind: "lock" });
    playFathom({ kind: "reveal", band: bandOf(scoreFor(question, value)) });
    submitFathomGuess(question.id, value);
    update(lockIn(game, value, pick));
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
    const fresh = freshGame(bank);
    flushSync(() => setGame(fresh));
    scrollTo({ top: 0 });
    focusGuess();
  };

  const question = questions[game.at];
  const shown = phase === "reveal" ? scored[game.at] : undefined;
  const total = totalOf(scored);
  // What a screen reader hears as each verdict and the total appear (the line is there before its words change).
  const said = shown
    ? `${bandLabel(shown.band)}, ${shown.points} points. ` +
      (roundOf(shown.question) === "name"
        ? `The target: ${amountText(shown.question, shown.question.answer)}. ${shown.pick ?? "Yours"}: ` +
          `${amountText(shown.question, shown.guess)}, ${missText(shown.question, shown.guess)}.`
        : `The answer: ${amountText(shown.question, shown.question.answer)}. Yours was ${missText(shown.question, shown.guess)}.`) +
      (game.at > 0 ? ` Total so far: ${total}.` : "")
    : phase === "results"
      ? `Your total: ${total} out of ${MAX_TOTAL}.`
      : "";
  const list = question?.nameIt ? lists.get(question.nameIt.list) : undefined;
  // No scoring line on the card (the owner, Nov 14: "self intuitive already enough"; How to play explains it).
  const round = question && roundOf(question);
  return (
    <main className="screen fathom" data-testid="fathom" data-phase={phase} data-short={short || undefined}>
      {head}
      <p className="sr-only" role="status">
        {said}
      </p>
      {phase === "results" ? (
        <Results scored={scored} onAgain={day ? undefined : again} n={day?.n} crowd={day ? { date: day.date, questions } : undefined} />
      ) : (
        <>
          <section className="panel prompt fathom-q" data-glass data-testid="fathom-question" data-question={question.id} data-round={round}>
            <div className="prompt-top">
              <span className="label cyan">
                Question {game.at + 1} of {QUESTIONS_PER_GAME}
              </span>
              <Pips bands={scored.map((s) => s.band)} at={game.at} />
            </div>
            <ScoreBar scored={scored} />
            <h1>{question.question}</h1>
            {question.definition && <p className="caption">{question.definition}</p>}
          </section>
          {phase === "question" ? (
            list ? (
              <AskName
                key={question.id}
                question={question}
                list={list}
                others={[...lists.values()]}
                lex={lex}
                lexicon={lexicon}
                onLock={lock}
              />
            ) : (
              <Ask key={question.id} question={question} onLock={lock} />
            )
          ) : (
            <Reveal
              key={question.id}
              scored={shown!}
              list={list}
              total={game.at > 0 ? total : undefined}
              last={game.at === QUESTIONS_PER_GAME - 1}
              onNext={next}
            />
          )}
        </>
      )}
    </main>
  );
}

/**
 * The question on screen: the field with its unit (the number grouped with commas as it's typed; a year as typed), a
 * line for what's wrong or what was read when the field doesn't show it, and LOCK IN. A phone gets a decimal keypad, or
 * for a year a plain number pad.
 */
function Ask({ question, onLock }: { question: FathomQuestion; onLock: (value: number) => void }) {
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
      {/* On a phone an estimate's unit goes under the number, so it never squeezes the field (the review, Nov 9). */}
      <label className="fathom-field" data-stack={round === "estimate" || undefined}>
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
    </form>
  );
}

/** How long a name waits for the lexicon still on its way before it is read without it. */
const LEXICON_WAIT_MS = 1500;

/** The tone of a name-it line: a choice to tap, a name in the box to confirm, or why nothing locked. */
const toneOf = (r: NameRead) => (r.kind === "choose" ? "choose" : r.kind === "confirm" ? "value" : "error");

/**
 * A name-it round on screen: the field for a name (a phone's own keyboard, with its Return key), a line for what was
 * read when it didn't lock, and LOCK IN. Only a name the list knows
 * locks: a misspelling goes in the box to confirm ("France? Lock in to confirm."), several readings are offered to tap
 * (the tap fills the box), and a thing of another kind, an unknown name or a word too many names share says so and
 * costs nothing ("Paris is a city, not a country. Try again.").
 */
function AskName({
  question,
  list,
  others,
  lex,
  lexicon,
  onLock,
}: {
  question: FathomQuestion;
  list: NameList;
  others: NameList[];
  lex?: Lexicon;
  /** The lexicon on its way, if `lex` isn't here yet: a name read before it arrives waits for it (a moment at most). */
  lexicon?: Promise<Lexicon | undefined>;
  onLock: (value: number, pick: string) => void;
}) {
  const [text, setText] = useState("");
  const [read, setRead] = useState<NameRead | null>(null);
  // The names last offered: typing or tapping one of them picks it, even after the line is gone.
  const offered = useRef<string[] | undefined>(undefined);
  const noun = list.noun;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Without the lexicon a real name may read as a misspelling of something on the list ("Dubai"): wait for it.
    const known = lex ?? (lexicon && (await Promise.race([lexicon, new Promise<undefined>((r) => setTimeout(r, LEXICON_WAIT_MS))])));
    const r = readName(text, list, others, { lex: known, offered: offered.current, except: question.nameIt?.except });
    if (r.kind === "answer") return onLock(r.entry.value, r.entry.name);
    if (r.kind === "confirm") setText(r.entry.name);
    if (r.kind === "choose") offered.current = r.names;
    setRead(r);
    focusGuess();
  };
  const fill = (name: string) => {
    setText(name);
    focusGuess();
  };

  return (
    <form className="panel fathom-ask" data-glass onSubmit={submit} data-testid="fathom-ask" data-round="name" data-lexicon={lex ? "" : undefined}>
      <label className="fathom-field" data-round="name">
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // A choice stays to tap while the player edits; anything else said goes as they type.
            if (read && read.kind !== "choose") setRead(null);
          }}
          // LOCK IN is off while the field is empty, so Enter there submits nothing: say why instead.
          onKeyDown={(e) => {
            if (e.key === "Enter" && !text.trim()) setRead({ kind: "empty" });
          }}
          inputMode="text"
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={`your ${noun}`}
          aria-label="Your answer"
          aria-describedby="fathom-echo"
          aria-invalid={read && toneOf(read) === "error" ? true : undefined}
          data-testid="fathom-input"
        />
      </label>
      <div className="fathom-keys">
        <div
          className="fathom-echo"
          id="fathom-echo"
          role="status"
          data-testid="fathom-echo"
          data-round="name"
          data-tone={read ? toneOf(read) : "none"}
          data-read={read?.kind}
        >
          {read && <span>{nameLine(read, list)}</span>}
          {read?.kind === "choose" &&
            read.names.map((name) => (
              <button key={name} type="button" className="suggestion" data-testid="fathom-choice" data-name={name} onClick={() => fill(name)}>
                {name}
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

/** How real players guessed on a number question (with a backend, from 20 of them); nothing until then. */
function Players({ q, guess }: { q: FathomQuestion; guess: number }) {
  const crowd = useFathomCrowd(q.id, guess, q.answer, compareRound(q));
  const players = playersLine(crowd, q.unit, roundOf(q));
  if (!players || !crowd) return null;
  return (
    <p className="fathom-players" data-testid="fathom-players" data-n={crowd.n} data-median={crowd.median ?? undefined} data-further={crowd.furtherOff ?? undefined}>
      {players}
    </p>
  );
}

/**
 * A locked-in question: the band in big type, the points (and the running total from the second question), the answer
 * against the guess, how real players guessed (with a backend, from 20 of them), the sonar with the miss under the
 * squid, the fact and its source, then NEXT. A name-it round shows the target, then what was named with its figure, and
 * after the sonar the best answers on its list with theirs.
 */
function Reveal({ scored, list, total, last, onNext }: { scored: Scored; list?: NameList; total?: number; last: boolean; onNext: () => void }) {
  const { question: q, guess, points, band, pick } = scored;
  const name = roundOf(q) === "name";
  const answer = figureParts(q, q.answer);
  const yours = figureParts(q, guess);
  const best = name && list ? bestAnswers(list, q.answer, q.nameIt?.except) : [];
  // One format for the column: all in words or all in digits ("996,600" beside "1.067 million" read as two scales).
  const column = formatColumn(best.map((e) => e.value));
  const asOf = asOfText(q.nameIt?.asOf);
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
            <Mark kind="buoy" /> {name ? "The target" : "The answer"}
          </p>
          <p className="figure-n gold" data-testid="fathom-answer" data-value={q.answer}>
            <Figure parts={answer} />
          </p>
        </div>
        <div className="figure">
          <p className="label cyan">
            <Mark kind="squid" /> {name ? `Your ${q.nameIt?.noun ?? "answer"}` : "Your guess"}
          </p>
          {name ? (
            <>
              <p className="figure-n figure-name" data-testid="fathom-guess" data-value={guess} data-pick={pick}>
                <span>{pick ?? "?"}</span>
              </p>
              <p className="figure-of" data-testid="fathom-pick-figure">
                <Figure parts={yours} />
              </p>
            </>
          ) : (
            <p className="figure-n" data-testid="fathom-guess" data-value={guess}>
              <Figure parts={yours} />
            </p>
          )}
        </div>
      </div>
      {!name && <Players q={q} guess={guess} />}
      <Gauge guess={guess} answer={q.answer} band={band} round={roundOf(q)} unit={q.unit} nameIt={q.nameIt} />
      {best.length > 0 && (
        <div className="fathom-best" data-testid="fathom-best">
          <p className="label gold">Best answers</p>
          <ol>
            {best.map((e, i) => (
              <li key={e.name} data-testid="fathom-best-row" data-name={e.name} data-value={e.value} data-yours={e.name === pick || undefined}>
                <span className="best-name">{e.name}</span>
                <span className="best-n">{column[i]}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {q.fact && (
        <p className="fathom-fact" data-testid="fathom-fact">
          {q.fact}
        </p>
      )}
      <p className="fathom-source">
        source:{" "}
        <a href={q.source.url} target="_blank" rel="noreferrer" data-testid="fathom-source">
          {q.source.title}
        </a>
        {site && `, ${site}`}
        {asOf && `, ${asOf}`}
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

/** The share text of a game: the total, the five bands, the link to Fathom; lines that keep in a Reddit comment. */
const shareOf = (scored: readonly Scored[], n?: number) => pasteable(shareText(scored, fathomUrl(), n));

/** "played Nov 14, 21:40". */
function playedAt(ms: number): string {
  const when = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `played ${when.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/**
 * A finished game kept in the save: from Past runs (#fathom/run-<startedAt>), or Today's Fathom finished on another of
 * the player's devices (`today`). Its results as they were scored (each question's points kept with the game), the
 * recap of the questions still in the bank, and from Past runs the way to Today's Fathom. A game no longer kept here
 * (another device's, pruned) says so.
 */
function PastGame({ head, run: at, bank, today = false }: { head: ReactNode; run: number; bank: FathomQuestion[]; today?: boolean }) {
  const run = findRun(load().fathom, at);
  const toToday = () => (location.hash = "#fathom");
  if (!run) {
    return (
      <main className="screen fathom" data-testid="fathom" data-phase="gone">
        {head}
        <section data-glass className="panel prompt" data-testid="fathom-gone">
          <p className="label pink">Not here</p>
          <h1>That game isn't kept here.</h1>
          <div className="results-actions">
            <button type="button" className="key key-pink" data-testid="fathom-again" onClick={toToday}>
              {FATHOM_TODAY}
            </button>
          </div>
        </section>
      </main>
    );
  }
  const byId = new Map(bank.map((q) => [q.id, q]));
  const scored: Scored[] = run.ids.flatMap((id, i) => {
    const question = byId.get(id);
    if (!question) return [];
    const pick = run.picks?.[id];
    return [{ question, guess: run.guesses[i], points: run.points[i], band: bandOf(run.points[i]), ...(pick !== undefined && { pick }) }];
  });
  const bands = run.points.map(bandOf);
  const share = pasteable(shareLines(runTotal(run), bands, fathomUrl(), run.daily?.n));
  return (
    <main className="screen fathom" data-testid="fathom" data-phase={today ? "results" : "past"} data-run={run.startedAt}>
      {head}
      <Results
        scored={scored}
        total={runTotal(run)}
        bands={bands}
        share={share}
        crowd={today && run.daily ? { date: run.daily.date, questions: run.ids.flatMap((id) => byId.get(id) ?? []) } : undefined}
        onAgain={today ? undefined : toToday}
        againLabel={FATHOM_TODAY}
        when={today ? undefined : playedAt(run.finishedAt)}
        count={false}
      />
    </main>
  );
}

/**
 * The end: the total and the five bands in a row; NEW QUESTIONS (endless) or the time to the next Fathom (Today's:
 * one try), and SHARE; then each question with guess and answer. A past game passes its own total, bands and share
 * text (a question gone from the bank has no row), when it was played, and its key's label.
 */
function Results({
  scored,
  onAgain,
  n,
  crowd,
  total = totalOf(scored),
  bands = scored.map((s) => s.band),
  share = shareOf(scored, n),
  againLabel = "New questions",
  when,
  count = true,
}: {
  scored: Scored[];
  /** No key for new questions on Today's Fathom: one try a day. */
  onAgain?: () => void;
  /** Today's Fathom's number, for the share text. */
  n?: number;
  /** Today's Fathom: its day and questions, for where the total stands among the day's players. */
  crowd?: { date: string; questions: readonly FathomQuestion[] };
  total?: number;
  bands?: Band[];
  share?: string;
  againLabel?: string;
  when?: string;
  /** The total counts up as it appears (the end of a game), or shows as it is (a past one). */
  count?: boolean;
}) {
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
  // SHARE, as on a list's results and a Blitz's: the phone's share sheet, else a copy and "Copied".
  const shareIt = async () => {
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ text: share });
      else {
        await navigator.clipboard.writeText(share);
        setCopied(true);
      }
    } catch {
      // The share sheet dismissed, or no clipboard here (an insecure page, a refusal): nothing to say.
    }
  };
  return (
    <>
      <section className="panel results enter fathom-results" data-glass data-testid="fathom-results">
        <p className="label cyan">Your total</p>
        <p className="score" data-testid="fathom-total" data-total={total} aria-label={`${total} out of ${MAX_TOTAL}`}>
          <span className="score-n">{count ? <CountUp value={total} /> : total}</span>
          <span className="score-of">/{MAX_TOTAL}</span>
        </p>
        <div className="band-row" role="img" aria-label={bands.map(bandLabel).join(", ")} data-testid="fathom-bands">
          {bands.map((b, i) => (
            <span key={i} className="band-sq" data-band={b} />
          ))}
        </div>
        {when && (
          <p className="caption fathom-when" data-testid="fathom-when">
            {when}
          </p>
        )}
        {crowd && <DayCrowd date={crowd.date} questions={crowd.questions} total={total} />}
        {!onAgain && <Countdown className="fathom-next-day" label="next Fathom in" />}
        <div className="results-actions">
          {onAgain && (
            <button type="button" className="key key-pink" data-testid="fathom-again" onClick={onAgain}>
              {againLabel}
            </button>
          )}
          <button ref={copyKey} type="button" className="key" data-testid="fathom-share" onClick={shareIt}>
            <SwapLabel off="Share" on="Copied" active={copied} />
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
                data-pick={s.pick}
                data-round={roundOf(s.question)}
                data-guess={s.guess}
                data-points={s.points}
                data-band={s.band}
              >
                <span className="band-sq" data-band={s.band} aria-hidden="true" />
                <span className="recap-body">
                  <span className="recap-q">{s.question.question}</span>
                  {roundOf(s.question) === "name" ? (
                    // "you Colombia 52.89 million · target 50 million people"
                    <span className="recap-nums" data-testid="fathom-row-nums">
                      you <b>{s.pick ?? "?"}</b> {formatAmount(s.guess)} · target <b className="gold">{formatAmount(s.question.answer)}</b> {s.question.unit}
                    </span>
                  ) : (
                    <span className="recap-nums" data-testid="fathom-row-nums">
                      you <b>{figureParts(s.question, s.guess).n}</b> · answer <b className="gold">{figureParts(s.question, s.question.answer).n}</b>
                      {unit && ` ${unit}`}
                    </span>
                  )}
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

/**
 * The running score (owner, Nov 14: "add points to a visible counter with some sort of visual that lets u know ur
 * current score some kind of bar at the top ... sleek and minimalistic"): the total out of 500 and a thin pixel bar under
 * the card's header, filled by each round's points in its band's colour. The total counts up as a reveal adds to it
 * (not with reduced motion), and the newest stretch grows in; the row is there from the first question, empty, so
 * nothing moves when points land.
 */
function ScoreBar({ scored }: { scored: Scored[] }) {
  const total = totalOf(scored);
  // The total before the last change, kept from the render before (React's "information from previous renders").
  const [seen, setSeen] = useState({ total, from: total });
  if (seen.total !== total) setSeen({ total, from: seen.total });
  const from = seen.total === total ? seen.from : seen.total;
  return (
    <div className="fathom-score" data-testid="fathom-score" data-total={total}>
      <span className="tally-track" role="img" aria-label={`Score so far: ${total} out of ${MAX_TOTAL}`}>
        {scored.map((s, i) => (
          <span
            key={i}
            className="tally-fill"
            data-band={s.band}
            data-new={i === scored.length - 1 && total !== from ? "" : undefined}
            style={{ width: `${(s.points / MAX_TOTAL) * 100}%` }}
          />
        ))}
      </span>
      {/* As wide as the widest total ("500/500") from the start: a third digit never pushes the track. */}
      <span className="tally-sum" aria-hidden="true">
        <span className="tally-size">
          {MAX_TOTAL}/{MAX_TOTAL}
        </span>
        <span className="tally-now">
          <span key={total} className="tally-n" data-count={total !== from ? "" : undefined} style={{ "--from": from, "--to": total } as React.CSSProperties}>
            <span>{total}</span>
          </span>
          <span className="tally-of">/{MAX_TOTAL}</span>
        </span>
      </span>
    </div>
  );
}

/**
 * Where Today's Fathom's total stands among the day's players (owner, Nov 14: "you did better than xx% of players
 * today with a histogram"): their average, the day's totals in bins of 10 (the player's lit), and the line. A simulated
 * crowd around the day's expected total draws it until real players join (fathom-crowd.ts); never "estimated".
 */
function DayCrowd({ date, questions, total }: { date: string; questions: readonly FathomQuestion[]; total: number }) {
  const real = useFathomDay(date);
  const expected = expectedTotal(questions);
  const counts = dayCounts(expected, real);
  const { p, n } = dayStanding(expected, real, total);
  // The simulated crowd's mean (its bins' middles), joined by the real players' as lists' averages are.
  const sim = simulatedCounts(expected);
  const simAvg = sim.reduce((sum, c, i) => sum + c * (i * FATHOM_BIN + (FATHOM_BIN - 1) / 2), 0) / sim.reduce((a, b) => a + b, 0);
  const avg = Math.round(blendAverage(simAvg, real) ?? simAvg);
  return (
    <div className="par-block fathom-crowd" data-testid="fathom-crowd" data-p={p} data-n={n} data-avg={avg}>
      <div className="par-row">
        <p className="par-stat">
          <span className="label">Players avg</span>
          <b>{avg}</b>
        </p>
        <ParHistogram
          counts={counts}
          par={totalBin(avg)}
          score={totalBin(total)}
          top={MAX_TOTAL}
          label={`How players scored on today's Fathom, 0 to ${MAX_TOTAL}: they average ${avg}, you got ${total}.`}
        />
      </div>
      <p className="par-line" data-testid="fathom-crowd-line">
        {fathomDayLine(p)}
      </p>
    </div>
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
