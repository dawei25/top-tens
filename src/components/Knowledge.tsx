import { dailyGame, type DailyEntry } from "../game/daily";
import { firstListRuns } from "../game/history";
import type { ParFile } from "../game/par";
import type { PuzzleMeta } from "../game/puzzles";
import { load } from "../game/storage";
import { Est, signed, usePar } from "./par";
import { ScreenHead } from "./pixel";

interface Props {
  index: PuzzleMeta[];
  /** Today's daily, for the empty state's key. */
  entry?: DailyEntry;
  onBack: () => void;
  onHome: () => void;
}

interface Group {
  name: string;
  games: number;
  avg: number;
  /** Average score minus average par, over the games whose list has a par. */
  vsPar: number;
}

/** Tags shown: those with at least this many games (the By topic placeholder says "two"). */
const MIN_TAG_GAMES = 2;
const MAX_TAGS = 8;

function summarize(name: string, games: { score: number; par: number }[]): Group {
  const n = games.length;
  return {
    name,
    games: n,
    avg: games.reduce((a, g) => a + g.score, 0) / n,
    vsPar: games.reduce((a, g) => a + g.score - g.par, 0) / n,
  };
}

function groupBy(games: { score: number; par: number }[], keys: string[][]): Map<string, { score: number; par: number }[]> {
  const out = new Map<string, { score: number; par: number }[]>();
  games.forEach((g, i) => {
    for (const k of keys[i]) out.set(k, [...(out.get(k) ?? []), g]);
  });
  return out;
}

/** Finished list games with a par, by category and by tag. Blitz has no par yet, so it's left out. */
function knowledge(index: PuzzleMeta[], par: ParFile) {
  // First tries only: replaying a list can't raise the stats.
  const runs = firstListRuns(load()).filter((r) => par[r.id]);
  const games = runs.map((r) => ({ score: r.found.length, par: par[r.id].par }));
  const meta = new Map(index.map((m) => [m.id, m]));
  const categories = [...groupBy(games, runs.map((r) => [meta.get(r.id)?.category ?? "Other"]))]
    .map(([k, g]) => summarize(k, g))
    .sort((a, b) => b.vsPar - a.vsPar || b.games - a.games);
  // Tags that only repeat a category name ("geography") add nothing next to it.
  const catNames = new Set(index.map((m) => m.category.toLowerCase()));
  const tags = [...groupBy(games, runs.map((r) => (par[r.id].tags ?? []).filter((t) => !catNames.has(t.toLowerCase()))))]
    .filter(([, g]) => g.length >= MIN_TAG_GAMES)
    .map(([k, g]) => summarize(k, g))
    .sort((a, b) => b.games - a.games)
    .slice(0, MAX_TAGS)
    .sort((a, b) => b.vsPar - a.vsPar || b.games - a.games);
  return {
    overall: games.length ? summarize("all", games) : null,
    categories,
    tags,
    estimated: runs.some((r) => par[r.id].estimated),
  };
}

/**
 * One row: name and games, a bar out from the par line (right: over par, left: under), the number. With no rows yet,
 * one placeholder row says what will show there.
 */
function Bars({ title, rows, kind, scale, empty }: { title: string; rows: Group[]; kind: string; scale: number; empty: string }) {
  return (
    <section data-glass className="panel know-list" aria-labelledby={`know-${kind}`}>
      <div className="know-head">
        <h2 id={`know-${kind}`} className="label cyan">
          {title}
        </h2>
        <span className="know-axis" aria-hidden="true">
          <span>under</span>
          <span>par</span>
          <span>over</span>
        </span>
      </div>
      <ol>
        {rows.map((g) => {
          // Twelve steps each side of par; at least one when it isn't exactly at par.
          const steps = Math.round((Math.abs(g.vsPar) / scale) * 12);
          const w = `${((g.vsPar === 0 ? 0 : Math.max(1, steps)) * 50) / 12}%`;
          return (
            <li key={g.name} className="know-row" data-testid={`know-${kind}`} data-name={g.name} data-vs-par={g.vsPar.toFixed(1)}>
              <span className="know-name">
                {g.name}
                <span className="know-sub">
                  {g.games} game{g.games === 1 ? "" : "s"} · avg {g.avg.toFixed(1)}
                </span>
              </span>
              <span className="know-bar" aria-hidden="true">
                <span className={`know-fill ${g.vsPar >= 0 ? "over" : "under"}`} style={{ width: w }} />
              </span>
              <span className={`know-vs ${g.vsPar > 0.05 ? "over" : g.vsPar < -0.05 ? "under" : ""}`}>{signed(g.vsPar, 1)}</span>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="know-row know-placeholder" data-testid={`know-${kind}-empty`}>
            <span className="know-name">{empty}</span>
            <span className="know-bar" aria-hidden="true" />
            <span className="know-vs" aria-hidden="true">
              --
            </span>
          </li>
        )}
      </ol>
    </section>
  );
}

/**
 * "Your knowledge" (Home's Stats key): how your finished list games compare with par, overall, by category and by
 * topic. Before the first game the same sections show, with placeholders.
 */
export function Knowledge({ index, entry, onBack, onHome }: Props) {
  const par = usePar();
  const k = par ? knowledge(index, par) : null;
  const scale = k ? Math.max(3, ...[...k.categories, ...k.tags].map((g) => Math.abs(g.vsPar))) : 3;
  const daily = entry && dailyGame(load(), entry);
  const dailyOpen = !!entry && (!daily || daily.status === "playing");

  return (
    <main className="screen archive knowledge" data-testid="knowledge">
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode">Stats</span>
      </ScreenHead>

      <section data-glass className="panel prompt know-top">
        <h1>Your knowledge</h1>
        <p className="caption">your list games against par: what a typical player gets on each list.</p>
        {k && !k.overall && (
          <div className="know-overall know-none" data-testid="knowledge-empty">
            <p className="know-headline" aria-label="no games against par yet">
              <span className="know-big none" aria-hidden="true">
                --
              </span>
              <span className="know-big-of" aria-hidden="true">
                vs par
              </span>
            </p>
            <dl className="know-stats">
              <div>
                <dt>games</dt>
                <dd>0</dd>
              </div>
              <div>
                <dt>avg / 10</dt>
                <dd>--</dd>
              </div>
            </dl>
            <p className="know-empty-line">play a list to see how you do against par.</p>
            {dailyOpen && (
              <a className="key key-pink key-sm" href={`#daily-${entry.date}`}>
                Today's list
              </a>
            )}
          </div>
        )}
        {k?.overall && (
          <div className="know-overall">
            <p className="know-headline" data-testid="vs-par" aria-label={`${signed(k.overall.vsPar, 1)} vs par on average`}>
              <span className={`know-big ${k.overall.vsPar > 0.05 ? "over" : k.overall.vsPar < -0.05 ? "under" : ""}`}>
                {signed(k.overall.vsPar, 1)}
              </span>
              <span className="know-big-of">
                {k.overall.vsPar > 0.05 ? "over par" : k.overall.vsPar < -0.05 ? "under par" : "at par"}
              </span>
            </p>
            <dl className="know-stats">
              <div>
                <dt>games</dt>
                <dd>{k.overall.games}</dd>
              </div>
              <div>
                <dt>avg / 10</dt>
                <dd>{k.overall.avg.toFixed(1)}</dd>
              </div>
            </dl>
            {k.estimated && (
              <p className="par-line know-est">
                par <Est />
              </p>
            )}
          </div>
        )}
      </section>

      {k && (
        <>
          <Bars title="By category" rows={k.categories} kind="category" scale={scale} empty="none yet. finish a list." />
          <Bars title="By topic" rows={k.tags} kind="tag" scale={scale} empty="none yet. a topic needs two games." />
        </>
      )}
    </main>
  );
}
