import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Home } from "./components/Home";
import { Archive } from "./components/Archive";
import { Blitz } from "./components/Blitz";
import { History } from "./components/History";
import { ListRun } from "./components/ListRun";
import { Knowledge } from "./components/Knowledge";
import { Settings } from "./components/Settings";
import { MenuContext, type MenuNav, type MenuScreen } from "./components/menu";
import { Ocean } from "./components/ocean";
import { Game, Loading } from "./components/Game";
import { shortDate } from "./components/pixel";
import type { Lexicon } from "./game/junk";
import { loadIndex, loadLexicon, pickRandom, randomPuzzleId, type PuzzleMeta } from "./game/puzzles";
import { blitzAvailable, freshBlitz } from "./game/blitz";
import { freshList, lastPlayed } from "./game/history";
import { wantFreshFathom } from "./game/fathom-history";
import { opensPlayedGame, signInToPlay } from "./game/free-games";
import {
  blitzOfTheDay,
  rollHoldouts,
  entryForDate,
  loadSchedule,
  localDate,
  lockLegacyDailies,
  msUntilNextDaily,
  todayEntry,
  type DailyEntry,
} from "./game/daily";
import { load, save } from "./game/storage";
import { useAccount, useSaveVersion } from "./net";
import { FreeWall, PrivacyScreen } from "./components/account";
import { dropAsk, keepAsk, peekAsk, wallOn, type FreeAsk } from "./components/account/wall";
import { wallAlt } from "./components/account/labels";
import { FathomScreen } from "./components/fathom";
import { openBlitzLists, rollableLists } from "./components/freeplay";
import { todayStatus } from "./components/today";

type Route =
  | { screen: "home" }
  | { screen: "archive" }
  | { screen: "daily"; date: string }
  | { screen: "game"; id: string }
  | { screen: "listrun"; id: string; run: number }
  | { screen: "blitz"; id: string; runs: boolean; run?: number }
  | { screen: "history" }
  | { screen: "stats" }
  | { screen: "privacy" }
  | { screen: "settings" }
  | { screen: "fathom"; run?: number }
  /** An old link to a date's Blitz (from before Nov 10, when each day also had one): replaced on arrival, see App. */
  | { screen: "dailyblitz"; date: string; runs: boolean; run?: number };

function readHash(): Route {
  const h = location.hash;
  if (h === "#archive") return { screen: "archive" };
  if (h === "#stats") return { screen: "stats" };
  if (h === "#privacy") return { screen: "privacy" };
  if (h === "#settings") return { screen: "settings" };
  // Fathom, the estimation game (Home's Free play, the menu), and one of its finished games from Past runs.
  if (h === "#fathom") return { screen: "fathom" };
  const fathomRun = h.match(/^#fathom\/run-(\d+)$/);
  if (fathomRun) return { screen: "fathom", run: Number(fathomRun[1]) };
  // The Blitz-only runs screen became Past runs, which lists list games and Blitz rounds together.
  if (h === "#blitz-history") history.replaceState(null, "", "#history");
  if (h === "#history" || h === "#blitz-history") return { screen: "history" };
  // Blitz screens take a sub-view: /runs (past runs open) or /run-<startedAt> (one past run's results). A date's
  // Blitz (#dailyblitz-<date>, retired) takes them too, and becomes its list's #blitz-<id> once the schedule is in.
  const dailyBlitz = h.match(/^#dailyblitz-(\d{4}-\d{2}-\d{2})(\/runs|\/run-(\d+))?$/);
  if (dailyBlitz) {
    return { screen: "dailyblitz", date: dailyBlitz[1], runs: dailyBlitz[2] === "/runs", run: dailyBlitz[3] ? Number(dailyBlitz[3]) : undefined };
  }
  const blitz = h.match(/^#blitz-([\w-]+?)(\/runs|\/run-(\d+))?$/);
  if (blitz) return { screen: "blitz", id: blitz[1], runs: blitz[2] === "/runs", run: blitz[3] ? Number(blitz[3]) : undefined };
  const date = h.match(/^#daily-(\d{4}-\d{2}-\d{2})$/);
  if (date) return { screen: "daily", date: date[1] };
  // One finished list game from Past runs (dailies too): #p-<id>/run-<startedAt>.
  const listRun = h.match(/^#p-([\w-]+?)\/run-(\d+)$/);
  if (listRun) return { screen: "listrun", id: listRun[1], run: Number(listRun[2]) };
  const m = h.match(/^#(daily|p)-([\w-]+)/);
  if (!m) return { screen: "home" };
  // Old daily links named the list itself: play it as a roll.
  if (m[1] === "daily") history.replaceState(null, "", `#p-${m[2]}`);
  return { screen: "game", id: m[2] };
}

/**
 * One step up from a screen when there's no in-app previous screen to return to (a shared or reloaded link):
 * a past Blitz run -> that list's Blitz screen with its past runs open; a past list run or Fathom game -> Past runs; an
 * old daily -> the archive; everything else -> home.
 */
function parentOf(hash: string, today: string): string {
  const run = hash.match(/^(#blitz-[\w-]+?)\/run-\d+$/);
  if (run) return `${run[1]}/runs`;
  if (/^#(?:p-[\w-]+?|fathom)\/run-\d+$/.test(hash)) return "#history";
  const daily = hash.match(/^#daily-(\d{4}-\d{2}-\d{2})$/);
  if (daily && daily[1] < today) return "#archive";
  return "";
}

/**
 * Scrolls to `y` now, and again on each frame while the screen is still too short to get there (a game draws its board
 * once its list has loaded), for at most a second, and never once the player scrolls or presses anything. Returns its
 * stop.
 */
function scrollWhenTall(y: number): () => void {
  scrollTo(0, y);
  if (Math.abs(scrollY - y) < 1) return () => {};
  const until = performance.now() + 1000;
  let frame = 0;
  const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const e of events) removeEventListener(e, stop, true);
  };
  const tick = () => {
    scrollTo(0, y);
    if (Math.abs(scrollY - y) < 1 || performance.now() > until) return stop();
    frame = requestAnimationFrame(tick);
  };
  for (const e of events) addEventListener(e, stop, { capture: true, passive: true });
  frame = requestAnimationFrame(tick);
  return stop;
}

function NoList({ text, onHome }: { text: string; onHome: () => void }) {
  return (
    <main className="screen game">
      <section data-glass className="panel error">
        <p className="label pink">No list</p>
        <p>{text}</p>
        <button className="key" onClick={onHome}>
          Home
        </button>
      </section>
    </main>
  );
}

/** Fathom from Home's key or the menu's tile: new questions if the last game is over, else that game, where it was. */
function openFathom() {
  wantFreshFathom();
  location.hash = "#fathom";
}

/** The deep-sea backdrop and its roaming squid stay put behind every screen (decorative, aria-hidden). */
export default function App() {
  return (
    <>
      <Ocean />
      <Screens />
    </>
  );
}

function Screens() {
  const [index, setIndex] = useState<PuzzleMeta[] | null>(null);
  const [schedule, setSchedule] = useState<DailyEntry[] | null>(null);
  const [route, setRoute] = useState<Route>(readHash);
  const [lexicon, setLexicon] = useState<Lexicon>();
  // Screens read the save as they draw: draw again when a sync brought in games from another device.
  useSaveVersion();
  /** The player's local date; moves at their midnight so today's list changes without a reload. */
  const [today, setToday] = useState(localDate);

  /**
   * The screens visited in this tab, oldest first, so Back can return to the real previous screen. A hash that
   * equals the one before the current is a step back (Back key or browser back) and pops.
   */
  const trail = useRef<string[]>([location.hash]);
  /**
   * The scroll each screen in the trail was left at, so Back returns to the same spot. A new screen opens at its top
   * (launch audit, Nov 6: on a phone, ARCHIVE pressed low on Home opened the archive at Home's offset, partway down).
   */
  const scrolls = useRef<number[]>([0]);
  /** Where to scroll once the screen a hash change asked for is drawn. */
  const pendingScroll = useRef<number | null>(null);
  const replacing = useRef(false);
  /** The category each random game in this tab was rolled in (by its hash), so Roll new list rolls in it too. */
  const rolledIn = useRef(new Map<string, string | undefined>());
  /** Bumped by Play again, so the screen it opens starts over even when it's the one on screen (same list). */
  const [replays, setReplays] = useState(0);
  const account = useAccount();
  /**
   * The free-play game the wall is holding back while it's open over the screen (src/game/free-games.ts: a signed-out
   * player past the free ones). Signing in starts it; closing the wall leaves the player where they were.
   */
  const [wall, setWall] = useState<FreeAsk | null>(null);
  /** A game asked for at the wall before a sign-in that left the page (Google in this tab, Supabase's redirect). */
  const [returning, setReturning] = useState(() => (wallOn ? peekAsk() : null));
  /** Starts a free game asked for (set below, once the lists and the schedule are in). */
  const startAsk = useRef<(a: FreeAsk) => void>(() => {});
  /**
   * The wall's decision for a link (a shared or typed address, Back or forward) to a free game, made once as the
   * route arrives, so a game played on that screen never turns into the wall under the player (a Blitz round's results
   * once its round is recorded).
   */
  const linkGate = useRef<{ route: Route; walled: boolean } | null>(null);

  useEffect(() => {
    loadIndex().then(setIndex);
    loadSchedule().then((s) => {
      // Older saves keep a date's daily result only in the list's game: lock it to its date before any replay can
      // change what the archive shows.
      const saved = load();
      const locked = lockLegacyDailies(saved, s, localDate());
      if (locked !== saved) save(locked);
      setSchedule(s);
    });
    loadLexicon().then(setLexicon);
    // The app keeps each screen's scroll itself: the browser's own restore runs before the screen it returns to is
    // drawn, so it stops at the end of the one being left when that one is shorter.
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const onHash = () => {
      const h = location.hash;
      const t = trail.current;
      const ys = scrolls.current;
      // The screen being left, still on show (no route hash names an element, so nothing scrolled to one).
      ys[t.length - 1] = Math.round(scrollY);
      let y = 0;
      if (replacing.current) t[t.length - 1] = h;
      else if (t.length > 1 && t[t.length - 2] === h) {
        t.pop();
        y = ys[t.length - 1] ?? 0;
      } else t.push(h);
      ys.length = t.length;
      replacing.current = false;
      pendingScroll.current = y;
      // The wall belongs to the screen it opened over: going elsewhere closes it, and the game it held back is let go.
      dropAsk();
      setWall(null);
      setReturning(null);
      setRoute(readHash());
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // After a hash change, once its screen is drawn (before it's painted): a new screen at its top, the one Back
  // returned to where it was left.
  useLayoutEffect(() => {
    const y = pendingScroll.current;
    if (y === null) return;
    pendingScroll.current = null;
    return scrollWhenTall(y);
  }, [route]);

  // An old link to a date's Blitz (a bookmark or a shared link from before Nov 10, when each day also had a Blitz;
  // Past runs rows linked there too) opens that list's free Blitz: the list the player had that day if they played it,
  // else the date's pick, with the same sub-view (/runs, /run-<startedAt>). The address becomes #blitz-<id> in place,
  // before anything is drawn. A date with no list for it (a future one) goes home.
  useLayoutEffect(() => {
    if (route.screen !== "dailyblitz" || !index || !schedule) return;
    const pick = route.date > today ? undefined : (load().blitzDaily?.[route.date]?.id ?? blitzOfTheDay(schedule, index, route.date));
    const id = pick && index.some((m) => m.id === pick) ? pick : undefined;
    const sub = route.runs ? "/runs" : route.run ? `/run-${route.run}` : "";
    history.replaceState(null, "", `${location.pathname}${location.search}${id ? `#blitz-${id}${sub}` : ""}`);
    trail.current[trail.current.length - 1] = location.hash;
    setRoute(readHash());
  }, [route, index, schedule, today]);

  // Back from a sign-in that left the page with a free game asked for: signed in, it starts; signed out (backed out,
  // or it failed), the wall opens again where the player left it, and says why if there was a why.
  useEffect(() => {
    if (!returning || !index || !schedule || account.status === "loading") return;
    dropAsk();
    setReturning(null);
    if (account.status === "in") startAsk.current(returning);
    else setWall(returning);
  }, [returning, index, schedule, account.status]);

  useEffect(() => {
    const check = () => setToday(localDate());
    // Timers sleep with the tab or the laptop, so also check whenever the page comes back.
    const t = setTimeout(check, msUntilNextDaily() + 50);
    addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(t);
      removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [today]);

  if (!index || !schedule) return <Loading />;

  // A roll is always a fresh game, even on a list played before (its result stays in Past runs). It never lands on
  // today's list, a future day's list, or `leave` (the list on screen). A category with nothing else left widens to all.
  const roll = (category?: string, leave?: string) => {
    const exclude = rollHoldouts(schedule, index, load(), today);
    if (leave) exclude.add(leave);
    if (category && !index.some((m) => m.category === category && !exclude.has(m.id))) category = undefined;
    const id = randomPuzzleId(index, category, exclude, lastPlayed(load(), "list"));
    save(freshList(load(), id));
    rolledIn.current.set(`#p-${id}`, category);
    location.hash = `#p-${id}`;
  };
  const home = () => (location.hash = "");
  // Back: the screen we came from in this tab if there is one, else one level up (replacing this entry, so the
  // browser's own back doesn't bounce into the deep link again).
  const back = () => {
    if (trail.current.length > 1) return history.back();
    replacing.current = true;
    location.replace(`${location.pathname}${location.search}${parentOf(location.hash, today) || "#"}`);
  };
  // The lists open for a free Blitz right now (Home's counts and the Blitz roll use the same filter): never today's
  // list or a future day's.
  const openBlitz = (saved = load()) => openBlitzLists(schedule, index, saved, today);
  // Blitz a random list (optionally in a category): a uniformly random open Blitz list, never one of the last few
  // rolled (per category, like the classic roll), never `leave` (the list on screen), always a fresh round. A
  // category with nothing else open widens to all; false when no list is open at all.
  const blitzChoices = (category?: string, leave?: string, saved = load()) => {
    const open = openBlitz(saved).filter((m) => m.id !== leave);
    const inCategory = open.filter((m) => m.category === category);
    return category && inCategory.length ? { open: inCategory, category } : { open, category: undefined };
  };
  const blitzRoll = async (wanted?: string, leave?: string): Promise<boolean> => {
    const saved = load();
    const { open, category } = blitzChoices(wanted, leave, saved);
    const id = pickRandom(
      open.map((m) => m.id),
      category ? `blitz:${category}` : "blitz",
      Math.random,
      lastPlayed(saved, "blitz"),
    );
    if (!id) return false;
    save(freshBlitz(saved, id));
    rolledIn.current.set(`#blitz-${id}`, category);
    location.hash = `#blitz-${id}`;
    return true;
  };
  // Play again on a past run: a fresh free game on that same list (a roll, but of this list). Never on a list held
  // right now (today's list or a future day's): it's back in free play after its day.
  const held = (id: string) => rollHoldouts(schedule, index, load(), today).has(id);
  const replayNow = (mode: "list" | "blitz", id: string) => {
    const to = mode === "list" ? `#p-${id}` : `#blitz-${id}`;
    save(mode === "list" ? freshList(load(), id) : freshBlitz(load(), id));
    // Not rolled in a category: Roll new list after it rolls from every list.
    rolledIn.current.delete(to);
    setReplays((n) => n + 1);
    location.hash = to;
  };
  const current = todayEntry(schedule, today);

  // Free play without an account (src/game/free-games.ts): past the free games, a new one asks the player to sign in.
  // Every way into a new free game comes through here (Home's keys and category chips, the menu's tiles, Roll new list,
  // Play again, Play Blitz); a link to one is checked as it arrives (linkWalled, below). Dailies never are.
  const mustSignIn = (saved = load()) => wallOn && signInToPlay(saved, { schedule, today, signedIn: account.status === "in", accounts: true });
  /** Opens the wall over the screen instead of starting `a`, if it must: true when it did. */
  const askFirst = (a: FreeAsk): boolean => {
    const saved = load();
    // A list's own game under way (or its result) isn't a new game: it opens as it is.
    if (a.kind === "open" && opensPlayedGame(saved, a.mode, a.id)) return false;
    if (!mustSignIn(saved)) return false;
    setWall(a);
    return true;
  };
  /** Starts a free game asked for (after signing in at the wall, too). */
  const start = (a: FreeAsk) => {
    if (a.kind === "roll") return a.mode === "list" ? roll(a.category, a.leave) : void blitzRoll(a.category, a.leave);
    if (a.kind === "replay") return held(a.id) ? undefined : replayNow(a.mode, a.id);
    location.hash = a.mode === "list" ? `#p-${a.id}` : `#blitz-${a.id}`;
  };
  startAsk.current = start;
  const freeRoll = (category?: string, leave?: string) => {
    if (!askFirst({ kind: "roll", mode: "list", category, leave })) roll(category, leave);
  };
  // False only when no list is open for Blitz at all (Home says so); the wall comes after that.
  const freeBlitz = async (category?: string, leave?: string): Promise<boolean> => {
    if (!blitzChoices(category, leave).open.length) return false;
    if (askFirst({ kind: "roll", mode: "blitz", category, leave })) return true;
    return blitzRoll(category, leave);
  };
  /** Roll new list on a Blitz: another random open list (in the round's category, if it was rolled in one). */
  const blitzAgain = (id: string, category?: string) =>
    blitzChoices(category, id).open.length > 0 ? () => void freeBlitz(category, id) : undefined;
  const replay = (mode: "list" | "blitz", id: string) => {
    if (held(id)) return undefined;
    return () => {
      if (!askFirst({ kind: "replay", mode, id })) replayNow(mode, id);
    };
  };
  /** Play Blitz on a list's results (a link): the wall instead, over the results, when a new round must wait. */
  const playBlitz = (id: string) => (e: React.MouseEvent) => {
    if (askFirst({ kind: "open", mode: "blitz", id })) e.preventDefault();
  };

  /**
   * Whether this route is a link to a free game that would start a new one while the player must sign in first:
   * `#p-<id>` (not today's list: that address opens today's own game) or a fresh round at `#blitz-<id>` (a past
   * round's results never). A game under way resumes and a finished list game shows its result, as always.
   */
  const linkWalled = (r: Route, signedIn: boolean): boolean => {
    if (!wallOn || signedIn) return false;
    let mode: "list" | "blitz";
    if (r.screen === "game") mode = "list";
    else if (r.screen === "blitz" && r.run === undefined) mode = "blitz";
    else return false;
    const meta = index.find((m) => m.id === r.id);
    if (!meta || (mode === "list" && r.id === current?.id)) return false;
    const saved = load();
    // A Blitz that's closed (it would spoil a daily) says so on its own screen: no game starts there.
    if (mode === "blitz" && !blitzAvailable({ id: meta.id, blitz: !!meta.blitz }, schedule, today, saved)) return false;
    if (opensPlayedGame(saved, mode, r.id)) return false;
    return signInToPlay(saved, { schedule, today, signedIn: false, accounts: true });
  };
  // Decided once per arrival (see linkGate); while a sign-in is still coming back, the screen waits to know.
  if (linkGate.current?.route !== route && account.status !== "loading") {
    linkGate.current = { route, walled: linkWalled(route, account.status === "in") };
  }
  const linkWall = account.status !== "in" && linkGate.current?.route === route && linkGate.current.walled;
  const linkWait = account.status === "loading" && linkGate.current?.route !== route && linkWalled(route, false);

  // The menu, in every screen's header: the screen on show, today's list, and the same ways there as Home's keys. A
  // roll from it never lands on the list or Blitz on screen.
  const blitzOnScreen = route.screen === "blitz" ? route.id : undefined;
  const nav: MenuNav = {
    current: menuScreen(route, current?.date),
    entry: current,
    blitzOpen: openBlitz().length,
    blitzOnScreen,
    onDaily: () => current && (location.hash = `#daily-${current.date}`),
    onRoll: () => freeRoll(undefined, route.screen === "game" ? route.id : undefined),
    onBlitz: () => void freeBlitz(undefined, blitzOnScreen),
    onFathom: openFathom,
  };

  const screen = (): React.ReactNode => {
    if (route.screen === "blitz") {
      return (
        <Blitz
          key={`${route.id}:${replays}`}
          id={route.id}
          meta={index.find((p) => p.id === route.id)}
          schedule={schedule}
          today={today}
          lexicon={lexicon}
          showRuns={route.runs}
          openRun={route.run}
          base={`#blitz-${route.id}`}
          onBack={back}
          onHome={home}
          onRoll={blitzAgain(route.id, rolledIn.current.get(`#blitz-${route.id}`))}
          rolled={rolledIn.current.has(`#blitz-${route.id}`)}
          onReplay={replay("blitz", route.id)}
        />
      );
    }

    if (route.screen === "history") {
      return <History index={index} today={today} entry={todayEntry(schedule, today)} onBack={back} onHome={home} />;
    }

    if (route.screen === "listrun") {
      return (
        <ListRun
          key={`${route.id}/${route.run}`}
          id={route.id}
          meta={index.find((p) => p.id === route.id)}
          startedAt={route.run}
          onBack={back}
          onHome={home}
          onReplay={replay("list", route.id)}
        />
      );
    }

    if (route.screen === "privacy") return <PrivacyScreen onBack={back} onHome={home} fallback={<Loading />} />;

    if (route.screen === "settings") return <Settings onBack={back} onHome={home} />;

    if (route.screen === "fathom") return <FathomScreen onBack={back} onHome={home} run={route.run} />;

    if (route.screen === "stats") {
      return <Knowledge index={index} entry={todayEntry(schedule, today)} onBack={back} onHome={home} />;
    }

    // An old date's-Blitz link, for the moment before it becomes its list's free Blitz (above).
    if (route.screen === "dailyblitz") return <Loading />;

    if (route.screen === "archive") {
      return <Archive index={index} schedule={schedule} today={today} onBack={back} onHome={home} />;
    }

    if (route.screen === "daily" || route.screen === "game") {
      const entry = route.screen === "daily" ? entryForDate(schedule, route.date) : undefined;
      // A daily from the future (or a date with no list) isn't playable yet.
      if (route.screen === "daily" && (!entry || entry.date > today)) {
        return <NoList text={`There's no daily for ${shortDate(route.date, today)} yet.`} onHome={home} />;
      }
      const id = entry ? entry.id : (route as { id: string }).id;
      return (
        <Game
          key={entry ? `daily-${entry.date}` : `${id}:${replays}`}
          id={id}
          meta={index.find((p) => p.id === id)}
          daily={entry}
          today={today}
          schedule={schedule}
          lexicon={lexicon}
          onBack={back}
          onHome={home}
          // Roll new list on a random list rolls another in the same category (if it was rolled in one); a finished
          // daily offers a plain random list instead.
          onRoll={() => freeRoll(entry ? undefined : rolledIn.current.get(`#p-${id}`), id)}
          rolled={!entry && rolledIn.current.has(`#p-${id}`)}
          onPlayBlitz={playBlitz(id)}
        />
      );
    }

    return (
      <Home
        index={index}
        entry={current}
        archiveCount={schedule.filter((e) => e.date <= today).length}
        onDaily={() => current && (location.hash = `#daily-${current.date}`)}
        onRoll={freeRoll}
        onBlitz={freeBlitz}
        blitzLists={openBlitz()}
        freeLists={rollableLists(schedule, index, load(), today)}
        onArchive={() => (location.hash = "#archive")}
        onFathom={openFathom}
      />
    );
  };

  // The wall's quiet way out: today's list while it waits to be played, else Home (none over Home itself then).
  const alt = (() => {
    const a = wallAlt(!current || todayStatus(load(), current).done);
    if (a.go === "today" && current) return { ...a, hash: `#daily-${current.date}` };
    return route.screen === "home" ? null : { ...a, hash: "" };
  })();
  const closeWall = () => {
    dropAsk();
    setWall(null);
  };

  return (
    <MenuContext value={nav}>
      {/* A link to a free game past the free ones: the wall alone over the ocean (no game behind it), and closing it
          goes back where the player came from (Home, for a link from outside). */}
      {linkWait ? <Loading /> : linkWall ? <main className="screen" data-testid="free-wall-screen" /> : screen()}
      {wall ? (
        <FreeWall
          onClose={closeWall}
          onSignedIn={() => {
            closeWall();
            start(wall);
          }}
          onGoogle={() => keepAsk(wall)}
          onGo={(h) => {
            closeWall();
            location.hash = h;
          }}
          alt={alt}
        />
      ) : (
        // Signed in, the link is no longer walled and its game shows. A sign-in that leaves the page comes back to this
        // same address (Google's way back keeps the screen), so nothing needs keeping.
        linkWall && <FreeWall onClose={back} onSignedIn={() => {}} onGo={(h) => (location.hash = h)} alt={alt} />
      )}
    </MenuContext>
  );
}

/**
 * The menu's tile for the screen on show, if it has one: today's list is the daily its tile opens (`dailyDate`, the
 * latest one up to today).
 */
function menuScreen(route: Route, dailyDate?: string): MenuScreen | undefined {
  switch (route.screen) {
    case "daily":
      return route.date === dailyDate ? "today-list" : undefined;
    case "archive":
    case "history":
    case "stats":
    case "settings":
    case "privacy":
      return route.screen;
    // A game, not a past one (that is Past runs' row).
    case "fathom":
      return route.run === undefined ? "fathom" : undefined;
    default:
      return undefined;
  }
}
