import { useEffect, useState } from "react";
import { Home } from "./components/Home";
import { Game } from "./components/Game";
import { dailyPuzzleId, dayNumber, loadIndex, randomPuzzleId, type PuzzleMeta } from "./game/puzzles";
import { load } from "./game/storage";

type Route = { screen: "home" } | { screen: "game"; id: string; daily: boolean };

function readHash(): Route {
  const m = location.hash.match(/^#(daily|p)-([\w-]+)/);
  return m ? { screen: "game", id: m[2], daily: m[1] === "daily" } : { screen: "home" };
}

export default function App() {
  const [index, setIndex] = useState<PuzzleMeta[] | null>(null);
  const [route, setRoute] = useState<Route>(readHash);

  useEffect(() => {
    loadIndex().then(setIndex);
    const onHash = () => setRoute(readHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  if (!index) return <div className="loading">Loading…</div>;

  const go = (id: string, daily = false) => {
    location.hash = `#${daily ? "daily" : "p"}-${id}`;
  };
  const roll = (category?: string) => {
    const played = new Set(Object.keys(load().games));
    go(randomPuzzleId(index, played, category));
  };

  if (route.screen === "game") {
    return (
      <Game
        key={route.id}
        id={route.id}
        meta={index.find((p) => p.id === route.id)}
        daily={route.daily}
        onHome={() => (location.hash = "")}
        onRoll={() => roll()}
      />
    );
  }
  return <Home index={index} onDaily={() => go(dailyPuzzleId(index), true)} onRoll={roll} day={dayNumber()} />;
}
