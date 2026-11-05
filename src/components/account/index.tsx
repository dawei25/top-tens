import { lazy, Suspense } from "react";
import { blitzStanding, formatCount } from "../../net/crowd";
import { accountsOn, backendOn, useListStats } from "../../net";
import { percentileLabel } from "../../game/par";
import type { PuzzleMeta } from "../../game/puzzles";
import AccountKey from "./AccountKey";

/**
 * The backend's pieces of the screens. Each renders nothing in a build without a backend (no env), and the bigger
 * ones (the sign-in and account sheets, the comparison with players, the privacy page) are separate chunks, downloaded
 * only when shown. The account lives on Home (./AccountKey): a key in its header opens both sheets.
 */

const CrowdPanel = lazy(() => import("./CrowdPanel"));
const Privacy = lazy(() => import("./Privacy"));

/** Home's account key: signed in or not at a glance, and the way to sign in or to your account. */
export function HomeAccountKey() {
  if (!accountsOn) return null;
  return <AccountKey />;
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

/**
 * A Blitz round's place among real players: a line on the results. Blitz has no estimate to blend with, so the line
 * waits for ESTIMATE_WEIGHT players (net/crowd), where a list's line stops saying "(estimated)".
 */
export function BlitzCrowdLine({ id, score }: { id: string; score: number }) {
  const s = blitzStanding(useListStats(backendOn ? id : undefined, "blitz"), score);
  if (!s) return null;
  return (
    <p data-testid="blitz-crowd" data-n={s.n}>
      {percentileLabel(s.p)} of {formatCount(s.n)} players
    </p>
  );
}
