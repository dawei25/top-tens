import { useEffect, useState } from "react";
import { Home } from "./components/Home";
import { Archive } from "./components/Archive";
import { Blitz } from "./components/Blitz";
import { Game, Loading } from "./components/Game";
import type { Lexicon } from "./game/junk";
import { loadIndex, loadLexicon, loadPuzzle, randomPuzzleId, type PuzzleMeta } from "./game/puzzles";
import { blitzAvailable } from "./game/blitz";
import { entryForDate, loadSchedule, localDate, msUntilNextDaily, todayEntry, type DailyEntry } from "./game/daily";
import { load } from "./game/storage";

type Route =
  | { screen: "home" }
  | { screen: "archive" }
  | { screen: "daily"; date: string }
  | { screen: "game"; id: string }
  | { screen: "blitz"; id: string };

function readHash(): Route {
  const h = location.hash;
  if (h === "#archive") return { screen: "archive" };
  const blitz = h.match(/^#blitz-([\w-]+)$/);
  if (blitz) return { screen: "blitz", id: blitz[1] };
  const date = h.match(/^#daily-(\d{4}-\d{2}-\d{2})$/);
  if (date) return { screen: "daily", date: date[1] };
  const m = h.match(/^#(daily|p)-([\w-]+)/);
  if (!m) return { screen: "home" };
  // Old daily links named the list itself: play it as a roll.
  if (m[1] === "daily") history.replaceState(null, "", `#p-${m[2]}`);
  return { screen: "game", id: m[2] };
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
    const played = new Set(Object.keys(load().games));
    location.hash = `#p-${randomPuzzleId(index, played, category)}`;
  };
  const home = () => (location.hash = "");
  // Blitz a random list: unplayed-in-Blitz first. The index may carry the blitz flag; if not, read each puzzle.
  const blitzRoll = async (): Promise<boolean> => {
    const saved = load();
    const shuffled = [...index].sort(() => Math.random() - 0.5);
    const fresh = shuffled.filter((m) => saved.blitzBest?.[m.id] === undefined);
    for (const m of [...fresh, ...shuffled.filter((x) => !fresh.includes(x))]) {
      const flag = (m as PuzzleMeta & { blitz?: boolean }).blitz;
      if (flag === false) continue;
      const p = flag === true ? { id: m.id, blitz: true } : await loadPuzzle(m.id).catch(() => null);
      if (p && blitzAvailable(p, schedule, localDate(), saved)) {
        location.hash = `#blitz-${m.id}`;
        return true;
      }
    }
    return false;
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
      return (
        <main className="screen game">
          <section className="panel error">
            <p className="label pink">No list</p>
            <p>There's no daily for {route.date} yet.</p>
            <button className="key" onClick={home}>
              Home
            </button>
          </section>
        </main>
      );
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
      onRoll={roll}
      onBlitz={blitzRoll}
      onArchive={() => (location.hash = "#archive")}
    />
  );
}
