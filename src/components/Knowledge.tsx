import { dailyGame, type DailyEntry } from "../game/daily";
import { FATHOM_MAX, fathomStats } from "../game/fathom-history";
import { FATHOM_PLAY } from "./copy";
import { firstListRuns } from "../game/history";
import type { ParFile } from "../game/par";
import type { PuzzleMeta } from "../game/puzzles";
import { load } from "../game/storage";
import { signed, usePar } from "./par";
import { ScreenHead } from "./pixel";
import { CrowdSection } from "./account";

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
  /** The player's own average score. */
  avg: number;
  /** The player's score minus the list's players' average (its par), averaged over the games whose list has one. */
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
 * One row: name, games and your average, a bar out from the players' average line (right: above it, left: below),
 * the number. With no rows yet, one placeholder row says what will show there.
 */
function Bars({ title, rows, kind, scale, empty }: { title: string; rows: Group[]; kind: string; scale: number; empty: string }) {
  return (
    <section data-glass className="panel know-list" aria-labelledby={`know-${kind}`}>
      <div className="know-head">
        <h2 id={`know-${kind}`} className="label cyan">
          {title}
        </h2>
        <span className="know-axis" aria-hidden="true">
          <span>below</span>
          <span>avg</span>
          <span>above</span>
        </span>
      </div>
      <ol>
        {rows.map((g) => {
          // Twelve steps each side of the average; at least one when it isn't exactly on it.
          const steps = Math.round((Math.abs(g.vsPar) / scale) * 12);
          const w = `${((g.vsPar === 0 ? 0 : Math.max(1, steps)) * 50) / 12}%`;
          return (
            <li key={g.name} className="know-row" data-testid={`know-${kind}`} data-name={g.name} data-vs-par={g.vsPar.toFixed(1)}>
              <span className="know-name">
                {g.name}
                {/* "your avg": the bare "avg" on this page is the players' average. */}
                <span className="know-sub">
                  {g.games} game{g.games === 1 ? "" : "s"} · your avg {g.avg.toFixed(1)}
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

/** A figure before there is one: a dash on screen, words for a screen reader. */
const NONE = (
  <>
    <span aria-hidden="true">--</span>
    <span className="sr-only">none yet</span>
  </>
);

/**
 * Fathom's own numbers, apart from the lists': games played, the average total and the best, out of 500, over every
 * finished game (on every device the account syncs). Before the first game the same three, as placeholders (UX 10).
 */
function FathomStats() {
  const f = fathomStats(load().fathom);
  return (
    <section data-glass className="panel know-fathom" data-testid="know-fathom" data-empty={f ? undefined : ""} aria-labelledby="know-fathom-title">
      <h2 id="know-fathom-title" className="label cyan">
        Fathom
      </h2>
      <div className={`know-overall ${f ? "" : "know-none"}`}>
        <dl className="know-stats">
          <div>
            <dt>games</dt>
            <dd data-testid="know-fathom-games">{f ? f.played : 0}</dd>
          </div>
          <div>
            <dt>avg / {FATHOM_MAX}</dt>
            <dd data-testid="know-fathom-avg">{f ? Math.round(f.avg) : NONE}</dd>
          </div>
          <div>
            <dt>best / {FATHOM_MAX}</dt>
            <dd data-testid="know-fathom-best">{f ? f.best : NONE}</dd>
          </div>
        </dl>
        {!f && (
          <>
            <p className="know-empty-line">play fathom to see your totals here.</p>
            <a className="key key-sm" href="#fathom" data-testid="know-fathom-play">
              {FATHOM_PLAY}
            </a>
          </>
        )}
      </div>
    </section>
  );
}

/** The overall distance from the players' average, read out in words ("+0.5 vs avg" on screen). */
function vsAvgLabel(v: number): string {
  const n = Math.abs(v).toFixed(1);
  return v > 0.05 ? `${n} above the average per game` : v < -0.05 ? `${n} below the average per game` : "level with the average";
}

/**
 * "Your knowledge" (Home's Stats key): how your finished list games compare with the players' average, overall, by
 * category and by topic, then Fathom's totals. Before the first game the same sections show, with placeholders.
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
        <p className="caption">your list games against the players' average on each list.</p>
        {k && !k.overall && (
          <div className="know-overall know-none" data-testid="knowledge-empty">
            {/* Nothing to compare yet, so no big number: three figures alike, each over its label, in one row
                (UX 8; a 60px dash beside 36px numbers sat lower than them). */}
            <dl className="know-stats">
              <div>
                <dt data-testid="know-figure-label">vs avg</dt>
                <dd data-testid="know-figure">{NONE}</dd>
              </div>
              <div>
                <dt data-testid="know-figure-label">games</dt>
                <dd data-testid="know-figure">0</dd>
              </div>
              <div>
                <dt data-testid="know-figure-label">your avg / 10</dt>
                <dd data-testid="know-figure">{NONE}</dd>
              </div>
            </dl>
            <p className="know-empty-line">play a list to see how you do against the average.</p>
            {dailyOpen && (
              <a className="key key-pink key-sm" href={`#daily-${entry.date}`}>
                Today's list
              </a>
            )}
          </div>
        )}
        {k?.overall && (
          <div className="know-overall">
            <p className="know-headline" data-testid="vs-par" aria-label={vsAvgLabel(k.overall.vsPar)}>
              <span className={`know-big ${k.overall.vsPar > 0.05 ? "over" : k.overall.vsPar < -0.05 ? "under" : ""}`}>
                {signed(k.overall.vsPar, 1)}
              </span>
              <span className="know-big-of">vs avg</span>
            </p>
            <dl className="know-stats">
              <div>
                <dt>games</dt>
                <dd>{k.overall.games}</dd>
              </div>
              <div>
                <dt>your avg / 10</dt>
                <dd>{k.overall.avg.toFixed(1)}</dd>
              </div>
            </dl>
            {k.estimated && <p className="know-est">averages are estimated until enough people have played.</p>}
          </div>
        )}
      </section>

      {k && (
        <>
          <Bars title="By category" rows={k.categories} kind="category" scale={scale} empty="none yet. finish a list." />
          <Bars title="By topic" rows={k.tags} kind="tag" scale={scale} empty="none yet. a topic needs two games." />
          <CrowdSection index={index} />
        </>
      )}
      <FathomStats />
    </main>
  );
}
