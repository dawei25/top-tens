import { lazy, Suspense } from "react";
import { blitzPercentile, formatCount, MIN_PLAYERS } from "../../net/crowd";
import { accountsOn, backendOn, useListStats } from "../../net";
import { percentileLabel } from "../../game/par";
import type { PuzzleMeta } from "../../game/puzzles";

/**
 * The backend's pieces of the screens. Each renders nothing in a build without a backend (no env), and the bigger
 * ones (the account panel, the comparison with players, the privacy page) are separate chunks, downloaded only when
 * shown. The sign-in sheet opens from the menu (components/menu) and the account panel.
 */

const AccountPanel = lazy(() => import("./AccountPanel"));
const CrowdPanel = lazy(() => import("./CrowdPanel"));
const Privacy = lazy(() => import("./Privacy"));

/** The knowledge page's account section (sign in, or your name, sync, sign out, delete). */
export function AccountSection() {
  if (!accountsOn) return null;
  return (
    <Suspense fallback={null}>
      <AccountPanel />
    </Suspense>
  );
}

/** The knowledge page's comparison with real players, on lists with enough of them. */
export function CrowdSection({ index }: { index: PuzzleMeta[] }) {
  if (!backendOn) return null;
  return (
    <Suspense fallback={null}>
      <CrowdPanel index={index} />
    </Suspense>
  );
}

/** The #privacy screen. */
export function PrivacyScreen({ onBack, onHome, fallback }: { onBack: () => void; onHome: () => void; fallback: React.ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <Privacy onBack={onBack} onHome={onHome} />
    </Suspense>
  );
}

/** The footer's link to the privacy page (only in builds that send anything anywhere). */
export function PrivacyLink() {
  if (!backendOn) return null;
  return (
    <a className="text-btn" href="#privacy" data-testid="privacy-link">
      privacy
    </a>
  );
}

/** A Blitz round's place among real players: a line on the results, only once MIN_PLAYERS have played the list. */
export function BlitzCrowdLine({ id, score }: { id: string; score: number }) {
  const stats = useListStats(backendOn ? id : undefined, "blitz");
  const p = blitzPercentile(stats, score);
  if (p === null || !stats || stats.n < MIN_PLAYERS) return null;
  return (
    <p data-testid="blitz-crowd" data-n={stats.n}>
      {percentileLabel(p)} of {formatCount(stats.n)} players
    </p>
  );
}
