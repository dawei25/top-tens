import { useEffect, useState } from "react";
import { Home } from "./components/Home";
import { Archive } from "./components/Archive";
import { Blitz } from "./components/Blitz";
import { History } from "./components/History";
import { Game, Loading } from "./components/Game";
import type { Lexicon } from "./game/junk";
import { loadIndex, loadLexicon, pickRandom, randomPuzzleId, type PuzzleMeta } from "./game/puzzles";
import { blitzAvailable } from "./game/blitz";
import {
  blitzOfTheDay,
  entryForDate,
  loadSchedule,
  localDate,
  msUntilNextDaily,
  todayEntry,
  type DailyEntry,
} from "./game/daily";
import { load } from "./game/storage";

type Route =
  | { screen: "home" }
  | { screen: "archive" }
  | { screen: "daily"; date: string }
  | { screen: "game"; id: string }
  | { screen: "blitz"; id: string; runs: boolean; run?: number }
  | { screen: "history" }
  | { screen: "dailyblitz"; date: string };

function readHash(): Route {
  const h = location.hash;
  if (h === "#archive") return { screen: "archive" };
  // The Blitz-only runs screen became Past runs, which lists list games and Blitz rounds together.
  if (h === "#blitz-history") history.replaceState(null, "", "#history");
  if (h === "#history" || h === "#blitz-history") return { screen: "history" };
  const dailyBlitz = h.match(/^#dailyblitz-(\d{4}-\d{2}-\d{2})$/);
  if (dailyBlitz) return { screen: "dailyblitz", date: dailyBlitz[1] };
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

  useEffect(() => {
    loadIndex().then(setIndex);
    loadSchedule().then(setSchedule);
    loadLexicon().then(setLexicon);
    const onHash = () => setRoute(readHash());
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

  const roll = (category?: string) => {
    location.hash = `#p-${randomPuzzleId(index, category)}`;
  };
  const home = () => (location.hash = "");
  // Blitz a random list: a uniformly random open Blitz list, never one of the last few rolled.
  const blitzRoll = async (): Promise<boolean> => {
    const saved = load();
    const open = index.filter((m) => m.blitz && blitzAvailable({ id: m.id, blitz: true }, schedule, localDate(), saved));
    const id = pickRandom(
      open.map((m) => m.id),
      "blitz",
    );
    if (!id) return false;
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
        onHome={home}
      />
    );
  }

  if (route.screen === "history") {
    return <History index={index} schedule={schedule} entry={todayEntry(schedule, today)} onHome={home} />;
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
        onHome={home}
      />
    );
  }

  if (route.screen === "archive") {
    return <Archive index={index} schedule={schedule} today={today} onHome={home} />;
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
