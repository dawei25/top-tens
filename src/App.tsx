import { useEffect, useRef, useState } from "react";
import { Home } from "./components/Home";
import { Archive } from "./components/Archive";
import { Blitz } from "./components/Blitz";
import { History } from "./components/History";
import { Game, Loading } from "./components/Game";
import type { Lexicon } from "./game/junk";
import { loadIndex, loadLexicon, pickRandom, randomPuzzleId, type PuzzleMeta } from "./game/puzzles";
import { blitzAvailable, freshBlitz } from "./game/blitz";
import { freshList } from "./game/history";
import {
  blitzOfTheDay,
  dailyHoldouts,
  entryForDate,
  loadSchedule,
  localDate,
  msUntilNextDaily,
  todayEntry,
  type DailyEntry,
} from "./game/daily";
import { load, save } from "./game/storage";

type Route =
  | { screen: "home" }
  | { screen: "archive" }
  | { screen: "daily"; date: string }
  | { screen: "game"; id: string }
  | { screen: "blitz"; id: string; runs: boolean; run?: number }
  | { screen: "history" }
  | { screen: "dailyblitz"; date: string; runs: boolean; run?: number };

function readHash(): Route {
  const h = location.hash;
  if (h === "#archive") return { screen: "archive" };
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
  const m = h.match(/^#(daily|p)-([\w-]+)/);
  if (!m) return { screen: "home" };
  // Old daily links named the list itself: play it as a roll.
  if (m[1] === "daily") history.replaceState(null, "", `#p-${m[2]}`);
  return { screen: "game", id: m[2] };
}

/**
 * One step up from a screen when there's no in-app previous screen to return to (a shared or reloaded link):
 * a past Blitz run -> that list's Blitz screen with its past runs open; an old daily -> the archive;
 * everything else -> home.
 */
function parentOf(hash: string, today: string): string {
  const run = hash.match(/^(#(?:blitz|dailyblitz)-[\w-]+?)\/run-\d+$/);
  if (run) return `${run[1]}/runs`;
  const daily = hash.match(/^#daily-(\d{4}-\d{2}-\d{2})$/);
  if (daily && daily[1] < today) return "#archive";
  return "";
}

function NoList({ text, onHome }: { text: string; onHome: () => void }) {
  return (
    <main className="screen game">
      <section className="panel error">
        <p className="label pink">No list</p>
        <p>{text}</p>
        <button className="key" onClick={onHome}>
          Home
        </button>
      </section>
    </main>
  );
}

export default function App() {
  const [index, setIndex] = useState<PuzzleMeta[] | null>(null);
  const [schedule, setSchedule] = useState<DailyEntry[] | null>(null);
  const [route, setRoute] = useState<Route>(readHash);
  const [lexicon, setLexicon] = useState<Lexicon>();
  /** The player's local date; moves at their midnight so today's list changes without a reload. */
  const [today, setToday] = useState(localDate);

  /**
   * The screens visited in this tab, oldest first, so Back can return to the real previous screen. A hash that
   * equals the one before the current is a step back (Back key or browser back) and pops.
   */
  const trail = useRef<string[]>([location.hash]);
  const replacing = useRef(false);

  useEffect(() => {
    loadIndex().then(setIndex);
    loadSchedule().then(setSchedule);
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
  // today's or a future daily, or on the list already on screen.
  const roll = (category?: string) => {
    const exclude = dailyHoldouts(schedule, today);
    if (route.screen === "game") exclude.add(route.id);
    const id = randomPuzzleId(index, category, exclude);
    save(freshList(load(), id));
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
  // Blitz a random list: a uniformly random open Blitz list, never one of the last few rolled, always a fresh round.
  const blitzRoll = async (): Promise<boolean> => {
    const saved = load();
    const open = index.filter((m) => m.blitz && blitzAvailable({ id: m.id, blitz: true }, schedule, localDate(), saved));
    const id = pickRandom(
      open.map((m) => m.id),
      "blitz",
    );
    if (!id) return false;
    save(freshBlitz(saved, id));
    location.hash = `#blitz-${id}`;
    return true;
  };
  const current = todayEntry(schedule, today);

  if (route.screen === "blitz") {
    return (
      <Blitz
        key={route.id}
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
      />
    );
  }

  if (route.screen === "history") {
    return <History index={index} schedule={schedule} entry={todayEntry(schedule, today)} onBack={back} onHome={home} />;
  }

  if (route.screen === "dailyblitz") {
    // Today's Blitz: one list per date, the same for everyone; never a future one.
    const id = route.date <= today ? blitzOfTheDay(schedule, index, route.date) : undefined;
    if (!id) return <NoList text={`There's no Blitz for ${route.date} yet.`} onHome={home} />;
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
        base={`#dailyblitz-${route.date}`}
        showRuns={route.runs}
        openRun={route.run}
        onBack={back}
        onHome={home}
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
      return <NoList text={`There's no daily for ${route.date} yet.`} onHome={home} />;
    }
    const id = entry ? entry.id : (route as { id: string }).id;
    return (
      <Game
        key={entry ? `daily-${entry.date}` : id}
        id={id}
        meta={index.find((p) => p.id === id)}
        daily={entry}
        today={today}
        schedule={schedule}
        lexicon={lexicon}
        onBack={back}
        onHome={home}
        onRoll={() => roll()}
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
      onArchive={() => (location.hash = "#archive")}
    />
  );
}
