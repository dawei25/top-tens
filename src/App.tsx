import { useEffect, useRef, useState } from "react";
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
import {
  blitzHold,
  blitzHoldouts,
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
import { useSaveVersion } from "./net";
import { PrivacyScreen } from "./components/account";

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
  | { screen: "dailyblitz"; date: string; runs: boolean; run?: number };

function readHash(): Route {
  const h = location.hash;
  if (h === "#archive") return { screen: "archive" };
  if (h === "#stats") return { screen: "stats" };
  if (h === "#privacy") return { screen: "privacy" };
  if (h === "#settings") return { screen: "settings" };
  // The Blitz-only runs screen became Past runs, which lists list games and Blitz rounds together.
  if (h === "#blitz-history") history.replaceState(null, "", "#history");
  if (h === "#history" || h === "#blitz-history") return { screen: "history" };
  // Blitz screens take a sub-view: /runs (past runs open) or /run-<startedAt> (one past run's results).
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
 * a past Blitz run -> that list's Blitz screen with its past runs open; a past list run -> Past runs; an old daily
 * -> the archive; everything else -> home.
 */
function parentOf(hash: string, today: string): string {
  const run = hash.match(/^(#(?:blitz|dailyblitz)-[\w-]+?)\/run-\d+$/);
  if (run) return `${run[1]}/runs`;
  if (/^#p-[\w-]+?\/run-\d+$/.test(hash)) return "#history";
  const daily = hash.match(/^#daily-(\d{4}-\d{2}-\d{2})$/);
  if (daily && daily[1] < today) return "#archive";
  return "";
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
  const replacing = useRef(false);
  /** The category each random game in this tab was rolled in (by its hash), so Roll again rolls in it too. */
  const rolledIn = useRef(new Map<string, string | undefined>());
  /** Bumped by Play again, so the screen it opens starts over even when it's the one on screen (same list). */
  const [replays, setReplays] = useState(0);

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
    const onHash = () => {
      const h = location.hash;
      const t = trail.current;
      if (replacing.current) t[t.length - 1] = h;
      else if (t.length > 1 && t[t.length - 2] === h) t.pop();
      else t.push(h);
      replacing.current = false;
      setRoute(readHash());
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

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
  // today's list or Blitz, a future day's list or Blitz, or `leave` (the list on screen). A category with nothing
  // else left widens to all.
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
  // list or Blitz, or a future day's.
  const openBlitz = (saved = load()) => {
    const held = blitzHoldouts(schedule, index, saved, today);
    return index.filter((m) => m.blitz && !held.has(m.id) && blitzAvailable({ id: m.id, blitz: true }, schedule, localDate(), saved));
  };
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
  /** Roll again on a Blitz: another random open list (in the round's category, if it was rolled in one). */
  const blitzAgain = (id: string, category?: string) =>
    blitzChoices(category, id).open.length > 0 ? () => void blitzRoll(category, id) : undefined;
  // Play again on a past run: a fresh free game on that same list (a roll, but of this list). Never on a list held
  // right now (today's list or Blitz, or a future day's): it's back in free play after its day.
  const replay = (mode: "list" | "blitz", id: string) => {
    if (rollHoldouts(schedule, index, load(), today).has(id)) return undefined;
    const to = mode === "list" ? `#p-${id}` : `#blitz-${id}`;
    return () => {
      save(mode === "list" ? freshList(load(), id) : freshBlitz(load(), id));
      // Not rolled in a category: Roll again after it rolls from every list.
      rolledIn.current.delete(to);
      setReplays((n) => n + 1);
      location.hash = to;
    };
  };
  // Today's Blitz, while it's still there to play (a list's results offer it). Until then its list has no free Blitz.
  const todaysBlitz = blitzOfTheDay(schedule, index, today);
  const dailyBlitzOpen = !!todaysBlitz && !load().blitzDaily?.[today];
  const heldBlitz = dailyBlitzOpen ? todaysBlitz : undefined;
  const current = todayEntry(schedule, today);

  // Today's Blitz list for a date: once played, the list that was played (the pick for an old date can move as the
  // schedule and the lists grow); never a future one.
  const dailyBlitzId = (date: string) =>
    date > today ? undefined : (load().blitzDaily?.[date]?.id ?? blitzOfTheDay(schedule, index, date));

  // The menu, in every screen's header: the screen on show, today's pair, and the same ways there as Home's keys. A
  // roll from it never lands on the list or Blitz on screen.
  const blitzOnScreen = route.screen === "blitz" ? route.id : route.screen === "dailyblitz" ? dailyBlitzId(route.date) : undefined;
  const nav: MenuNav = {
    current: menuScreen(route, today),
    today,
    entry: current,
    hasDailyBlitz: !!todaysBlitz,
    blitzOpen: openBlitz().length,
    blitzOnScreen,
    onDaily: () => current && (location.hash = `#daily-${current.date}`),
    onDailyBlitz: () => (location.hash = `#dailyblitz-${today}`),
    onRoll: () => roll(undefined, route.screen === "game" ? route.id : undefined),
    onBlitz: () => void blitzRoll(undefined, blitzOnScreen),
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
          todaysBlitz={heldBlitz}
          onBack={back}
          onHome={home}
          onRoll={blitzAgain(route.id, rolledIn.current.get(`#blitz-${route.id}`))}
          rolled={rolledIn.current.has(`#blitz-${route.id}`)}
          onReplay={replay("blitz", route.id)}
        />
      );
    }

    if (route.screen === "history") {
      return <History index={index} schedule={schedule} today={today} entry={todayEntry(schedule, today)} onBack={back} onHome={home} />;
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

    if (route.screen === "stats") {
      return <Knowledge index={index} entry={todayEntry(schedule, today)} onBack={back} onHome={home} />;
    }

    if (route.screen === "dailyblitz") {
      // Today's Blitz: one list per date, the same for everyone; never a future one.
      const saved = load();
      const id = dailyBlitzId(route.date);
      if (!id) return <NoList text={`There's no Blitz for ${shortDate(route.date, today)} yet.`} onHome={home} />;
      const n = (entryForDate(schedule, route.date) ?? todayEntry(schedule, route.date))?.n ?? 0;
      return (
        <Blitz
          key={`dailyblitz-${route.date}`}
          id={id}
          meta={index.find((p) => p.id === id)}
          schedule={schedule}
          today={today}
          lexicon={lexicon}
          dailyBlitz={{ date: route.date, n }}
          hold={blitzHold(schedule, route.date, id, saved)}
          base={`#dailyblitz-${route.date}`}
          showRuns={route.runs}
          openRun={route.run}
          onBack={back}
          onHome={home}
          onRoll={blitzAgain(id)}
          onReplay={replay("blitz", id)}
        />
      );
    }

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
          // Roll again on a random list rolls another in the same category (if it was rolled in one); a finished daily
          // offers a plain random list instead.
          onRoll={() => roll(entry ? undefined : rolledIn.current.get(`#p-${id}`), id)}
          rolled={!entry && rolledIn.current.has(`#p-${id}`)}
          onDailyBlitz={dailyBlitzOpen ? () => (location.hash = `#dailyblitz-${today}`) : undefined}
          todaysBlitz={heldBlitz}
        />
      );
    }

    return (
      <Home
        index={index}
        entry={current}
        archiveCount={schedule.filter((e) => e.date <= today).length}
        onDaily={() => current && (location.hash = `#daily-${current.date}`)}
        today={today}
        hasDailyBlitz={!!blitzOfTheDay(schedule, index, today)}
        onDailyBlitz={() => (location.hash = `#dailyblitz-${today}`)}
        onRoll={roll}
        onBlitz={blitzRoll}
        blitzLists={openBlitz()}
        onArchive={() => (location.hash = "#archive")}
      />
    );
  };

  return <MenuContext value={nav}>{screen()}</MenuContext>;
}

/** The menu's tile for the screen on show, if it has one (today's list and Blitz only on today's date). */
function menuScreen(route: Route, today: string): MenuScreen | undefined {
  switch (route.screen) {
    case "daily":
      return route.date === today ? "today-list" : undefined;
    case "dailyblitz":
      return route.date === today ? "today-blitz" : undefined;
    case "archive":
    case "history":
    case "stats":
    case "settings":
    case "privacy":
      return route.screen;
    default:
      return undefined;
  }
}
