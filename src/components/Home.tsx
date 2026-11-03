import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PuzzleMeta } from "../game/puzzles";
import { dailyGame as dailyGameOf, streak, type DailyEntry } from "../game/daily";
import { load, save, stats } from "../game/storage";
import { recentPlays } from "../game/history";
import { Countdown } from "./Countdown";
import { HowToPlay } from "./HowToPlay";
import { EnterHint, type Mode } from "./pixel";
import { STREAK_NOTE } from "./copy";
import { FloatNote } from "./Note";
import { SoundToggle } from "./sound/SoundToggle";
import { AccountKey, PrivacyLink } from "./account";
import { noteReset } from "../net";

/**
 * A home key: its status on top (right), the action below. Today's keys carry their mode's accent while unplayed
 * and settle once played; free-play keys stay quiet. The mode shows in the color, not in a tag.
 */
function ModeKey({
  mode,
  title,
  status,
  today = false,
  done = false,
  disabled = false,
  btnRef,
  testId,
  onClick,
}: {
  mode: Mode;
  title: string;
  status: string;
  today?: boolean;
  done?: boolean;
  disabled?: boolean;
  btnRef?: React.Ref<HTMLButtonElement>;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      ref={btnRef}
      className={`key mode-key ${mode} ${today ? "today" : ""} ${done ? "done" : ""}`}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      data-done={done || undefined}
      // Hovering a Today key selects it, so Enter (and the ENTER cap shown on hover) means this key.
      onPointerEnter={today ? (e) => e.pointerType === "mouse" && e.currentTarget.focus({ preventScroll: true }) : undefined}
    >
      <span className="mode-key-top">
        <EnterHint />
        <span className="key-sub" data-testid={`${testId}-status`}>
          {status}
        </span>
      </span>
      <span className="mode-key-main">
        <span className="key-label">{title}</span>
      </span>
    </button>
  );
}

type Pick = "list" | "blitz";

/** A record number before there is one. */
const NONE = (
  <>
    <span aria-hidden="true">--</span>
    <span className="sr-only">none yet</span>
  </>
);

/**
 * The categories `lists` covers, with how many lists each has, in one order for both pickers: the order categories
 * first appear in the full index (the Blitz lists open right now would order them differently).
 */
function countByCategory(index: PuzzleMeta[], lists: PuzzleMeta[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const m of lists) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
  return [...new Set(index.map((m) => m.category))].flatMap((c) => (counts.has(c) ? [[c, counts.get(c)!] as [string, number]] : []));
}

interface Props {
  index: PuzzleMeta[];
  /** The lists open for Blitz right now (the same filter as the Blitz roll). */
  blitzLists: PuzzleMeta[];
  /** Today's daily; missing only if the schedule failed to load. */
  entry?: DailyEntry;
  archiveCount: number;
  onDaily: () => void;
  onRoll: (category?: string) => void;
  /** Goes to a random Blitz-ready list (in the category, if given); false when there is none. */
  onBlitz: (category?: string) => Promise<boolean>;
  onArchive: () => void;
  /** The player's local date. */
  today: string;
  /** Whether today has a Blitz list. */
  hasDailyBlitz: boolean;
  onDailyBlitz: () => void;
}

export function Home({
  index,
  blitzLists,
  entry,
  archiveCount,
  onDaily,
  onRoll,
  onBlitz,
  onArchive,
  today,
  hasDailyBlitz,
  onDailyBlitz,
}: Props) {
  const [noBlitz, setNoBlitz] = useState(false);
  /** The open "by category" picker, if any (one at a time). */
  const [picker, setPicker] = useState<Pick | null>(null);
  const listStrip = useRef<HTMLButtonElement>(null);
  const blitzStrip = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const saved = load();
  const s = stats(saved);
  const st = streak(saved);
  /** No list game finished yet: the record shows placeholders. */
  const fresh = s.played === 0 && st.best === 0;
  // The rules stay closed until asked for, even on a first visit; they open as a dialog over the page.
  const [help, setHelp] = useState(false);
  const helpKey = useRef<HTMLButtonElement>(null);
  const dailyRef = useRef<HTMLButtonElement>(null);
  const blitzRef = useRef<HTMLButtonElement>(null);
  const dailyGame = entry && dailyGameOf(saved, entry);
  const dailyDone = !!dailyGame && dailyGame.status !== "playing";
  const dailyBlitzDone = saved.blitzDaily?.[today];
  // Keyboard-first: Enter starts today's list, or today's Blitz once the list is done. Focus without scrolling so
  // the title stays in view. The focused today key is the one loud element on the screen.
  // Touch screens have no Enter to press, so they get no auto focus (and no focus ring on a key nobody chose).
  const focusDaily = () => {
    if (typeof matchMedia === "function" && !matchMedia("(pointer: fine)").matches) return;
    (dailyDone && hasDailyBlitz && !dailyBlitzDone ? blitzRef : dailyRef).current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    // Only on arrival.
    focusDaily();
  }, []);
  // Keyboard modality for the ENTER cap: a key press turns it on, any pointer press turns it off. It starts off on
  // arrival, so the auto-focused key doesn't show the cap until the player actually uses the keyboard here.
  useEffect(() => {
    const root = document.documentElement;
    delete root.dataset.modality;
    const onKey = (e: KeyboardEvent) => {
      if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) root.dataset.modality = "keyboard";
    };
    const onPointer = () => delete root.dataset.modality;
    addEventListener("keydown", onKey, true);
    addEventListener("pointerdown", onPointer, true);
    return () => {
      removeEventListener("keydown", onKey, true);
      removeEventListener("pointerdown", onPointer, true);
      delete root.dataset.modality;
    };
  }, []);
  // The dropdown opens upward when it would run off the bottom of the screen and there's more room above; either way
  // it scrolls inside itself rather than past the screen's edge.
  useLayoutEffect(() => {
    const el = pickerRef.current;
    const anchor = el?.parentElement?.getBoundingClientRect();
    if (!picker || !el || !anchor) return;
    const below = innerHeight - anchor.bottom - 12;
    const above = anchor.top - 12;
    const up = el.scrollHeight > below && above > below;
    el.dataset.up = String(up);
    el.style.maxHeight = `${Math.max(160, Math.floor(up ? above : below))}px`;
  }, [picker]);
  // The category picker: focus goes to its first chip on open, back to its strip on close (Escape, a press outside
  // the free-play keys, or a pick).
  useEffect(() => {
    if (!picker) return;
    const strip = picker === "list" ? listStrip : blitzStrip;
    pickerRef.current?.querySelector("button")?.focus({ preventScroll: true });
    const close = () => {
      setPicker(null);
      strip.current?.focus({ preventScroll: true });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
    };
    // A press on either free-play key or strip is left to its own click: closing first would shift the layout
    // under the pointer on phones, where the pickers stack.
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.("[data-picker]")) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [picker]);
  // Inline confirm, like GIVE UP: the first click arms it for 3 s, the second clears everything but seenHelp.
  const [confirmReset, setConfirmReset] = useState(false);
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 3000);
    return () => clearTimeout(t);
  }, [confirmReset]);
  const blitzRuns = Object.values(saved.blitzRuns ?? {}).reduce((k, runs) => k + runs.length, 0);
  const plays = recentPlays(saved, 1000).length;
  const hasProgress =
    plays > 0 ||
    Object.keys(saved.games).length > 0 ||
    Object.keys(saved.daily).length > 0 ||
    blitzRuns > 0 ||
    Object.keys(saved.blitzDaily ?? {}).length > 0 ||
    Object.keys(saved.blitzLive ?? {}).length > 0;
  const resetAll = () => {
    if (!confirmReset) return setConfirmReset(true);
    setConfirmReset(false);
    save({ games: {}, daily: {}, seenHelp: load().seenHelp });
    // Signed in, the reset reaches the account and every device instead of syncing back.
    noteReset();
    setVersion((v) => v + 1);
    focusDaily();
  };
  const listCats = countByCategory(index, index);
  const blitzCats = countByCategory(index, blitzLists);

  const blitzRoll = (category?: string) => {
    setNoBlitz(false);
    onBlitz(category).then((ok) => setNoBlitz(!ok));
  };

  /** A free-play key with its "by category" strip under it, and that mode's category chips when open. */
  const freeKey = (kind: Pick, key: React.ReactNode, cats: [string, number][], strip: React.RefObject<HTMLButtonElement | null>) => {
    const open = picker === kind;
    const name = kind === "list" ? "Random list" : "Random Blitz";
    const id = `${kind}-categories`;
    return (
      <div
        className={`free-key ${kind === "list" ? "classic" : "blitz"}`}
        data-picker={kind}
        // Tabbing out of the open picker closes it (focus goes where Tab took it).
        onBlur={(e) => {
          if (open && !e.currentTarget.contains(e.relatedTarget as Node | null)) setPicker(null);
        }}
      >
        {key}
        {cats.length > 0 && (
          <div className="cat-anchor">
            <button
              ref={strip}
              type="button"
              className="cat-strip"
              data-testid={`random-${kind}-categories`}
              aria-expanded={open}
              aria-controls={id}
              aria-label={`${name} by category`}
              onClick={() => setPicker((p) => (p === kind ? null : kind))}
              onKeyDown={(e) => {
                if (open && e.key === "ArrowDown") {
                  e.preventDefault();
                  pickerRef.current?.querySelector("button")?.focus();
                }
              }}
            >
              by category
            </button>
            {open && categoryMenu(kind, cats, strip, id, name)}
          </div>
        )}
      </div>
    );
  };

  /**
   * The open picker: a dropdown floating under its strip, over the page, so nothing moves (above the strip near the
   * bottom of the screen). Arrow keys move through it.
   */
  const categoryMenu = (
    kind: Pick,
    cats: [string, number][],
    strip: React.RefObject<HTMLButtonElement | null>,
    id: string,
    name: string,
  ) => (
    <div
      ref={pickerRef}
      id={id}
      className="chips cat-picker"
      role="group"
      aria-label={`${name} categories`}
      data-glass
      onKeyDown={(e) => {
        const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        const keys: Record<string, number> = {
          ArrowDown: (i + 1) % items.length,
          ArrowUp: (i - 1 + items.length) % items.length,
          Home: 0,
          End: items.length - 1,
        };
        if (!(e.key in keys)) return;
        e.preventDefault();
        items[keys[e.key]].focus();
      }}
    >
      {cats.map(([c, n]) => (
        <button
          key={c}
          type="button"
          className="chip cat-chip"
          data-testid="category"
          data-mode={kind}
          data-category={c}
          onClick={() => {
            setPicker(null);
            strip.current?.focus({ preventScroll: true });
            if (kind === "list") onRoll(c);
            else blitzRoll(c);
          }}
        >
          {c} <span className="cat-n">{n}</span>
        </button>
      ))}
    </div>
  );

  return (
    <main className="screen home">
      <SoundToggle className="home-sound" />
      <header className="title">
        <h1 className="logo" aria-label="TENtacle">
          <span>TEN</span><span>tacle</span>
        </h1>
        <p className="caption" data-glass>name the top 10. five lives.</p>
      </header>

      {help && (
        <HowToPlay
          onClose={() => {
            setHelp(false);
            helpKey.current?.focus({ preventScroll: true });
          }}
        />
      )}

      <section className="home-group" data-glass data-testid="today-group" aria-labelledby="today-title">
        <div className="group-head">
          <h2 id="today-title" className="label">
            Today{entry ? ` · #${entry.n}` : ""}
          </h2>
          <Countdown />
        </div>
        <div className="today-stack">
          <ModeKey
            mode="classic"
            today
            btnRef={dailyRef}
            testId="today-list"
            title="Today's list"
            status={!entry ? "none yet" : dailyDone ? `${dailyGame.found.length}/10` : dailyGame ? "playing" : "new"}
            done={dailyDone}
            disabled={!entry}
            onClick={onDaily}
          />
          {hasDailyBlitz && (
            <ModeKey
              mode="blitz"
              today
              btnRef={blitzRef}
              testId="today-blitz"
              title="Today's Blitz"
              status={dailyBlitzDone ? `${dailyBlitzDone.score} pts` : "new"}
              done={!!dailyBlitzDone}
              onClick={onDailyBlitz}
            />
          )}
        </div>
      </section>

      {/* Side by side on wide screens: free play takes most of the row, your games the rest. */}
      <div className="home-pair">
        <section className="home-group" data-glass data-testid="free-play" aria-labelledby="free-title">
          <div className="group-head">
            <h2 id="free-title" className="label">
              Free play
            </h2>
          </div>
          {/* Each key rolls at once; the strip under it opens that mode's categories (a chip rolls in that one). */}
          <div className="mode-pair">
            {freeKey(
              "list",
              <ModeKey
                mode="classic"
                testId="random-list"
                title="Random list"
                status={`${index.length} lists`}
                onClick={() => onRoll()}
              />,
              listCats,
              listStrip,
            )}
            {freeKey(
              "blitz",
              <ModeKey
                mode="blitz"
                testId="random-blitz"
                title="Random Blitz"
                status={`${blitzLists.length} lists`}
                onClick={() => blitzRoll()}
              />,
              blitzCats,
              blitzStrip,
            )}
          </div>
          {noBlitz && <p className="caption blitz-none">no lists are open for blitz yet.</p>}
        </section>

        <section className="home-group games-group" data-glass aria-labelledby="games-title">
          <h2 id="games-title" className="label">
            Your games
          </h2>
          <div className="games-row">
            <button className="key key-sm games-key" data-testid="archive-key" onClick={onArchive}>
              Archive <span className="games-n">{archiveCount}</span>
            </button>
            <button
              className="key key-sm games-key"
              data-testid="history-key"
              onClick={() => (location.hash = "#history")}
            >
              Past runs {plays > 0 && <span className="games-n">{plays}</span>}
            </button>
            {/* Always here, even before the first game: the page shows its sections with placeholders until then. */}
            <button
              className="key key-sm games-key"
              data-testid="stats-key"
              onClick={() => (location.hash = "#stats")}
            >
              Stats
            </button>
            <AccountKey />
          </div>
        </section>
      </div>

      {/* Always here: before the first list game every number is a placeholder. */}
      <section
        data-glass
        className="home-group home-stats"
        data-testid="home-record"
        data-empty={fresh || undefined}
        aria-labelledby="stats-title"
      >
        <div className="group-head">
          <h2 id="stats-title" className="label">
            Your record
          </h2>
        </div>
        <dl className="stat-row">
          <div>
            <dt>played</dt>
            <dd>{fresh ? NONE : s.played}</dd>
          </div>
          <div>
            <dt>avg / 10</dt>
            <dd>{s.played ? s.avgFound.toFixed(1) : NONE}</dd>
          </div>
          <div>
            <dt>perfect</dt>
            <dd className="gold">{fresh ? NONE : s.perfect}</dd>
          </div>
          <div>
            <dt>
              <FloatNote label="days in a row" note={STREAK_NOTE} id="home-streak-note" testId="streak-tip" />
            </dt>
            <dd className="pink">{fresh ? NONE : st.current}</dd>
          </div>
          <div>
            <dt>most in a row</dt>
            <dd>{fresh ? NONE : st.best}</dd>
          </div>
        </dl>
      </section>

      <footer className="home-foot" data-glass data-testid="home-foot">
        {/* Stays put while the rules are open (they float over the page). */}
        <button ref={helpKey} type="button" className="key key-sm" data-testid="howto-key" aria-haspopup="dialog" onClick={() => setHelp(true)}>
          How to play
        </button>
        <span className="home-foot-end">
          <span className="caption">data from wikipedia</span>
          <PrivacyLink />
          {hasProgress && (
            // Both words are always laid out, one hidden, so the key keeps its width while it asks (a second tap
            // lands on it).
            <button
              type="button"
              className={`text-btn swap-btn ${confirmReset ? "danger" : ""}`}
              data-testid="reset-all"
              data-armed={confirmReset || undefined}
              onClick={resetAll}
              onBlur={() => setConfirmReset(false)}
            >
              <span data-off={confirmReset || undefined}>reset all progress</span>
              <span data-off={!confirmReset || undefined}>sure?</span>
            </button>
          )}
        </span>
      </footer>
    </main>
  );
}
