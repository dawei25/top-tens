import { lazy, Suspense } from "react";
import { Loading } from "../Game";

/**
 * Fathom, the estimation game: Today's Fathom (#fathom), endless (#fathom-endless, hidden), one finished game
 * (#fathom/run-<startedAt>). Its own chunk (with its styles), downloaded only when it is opened, so the main bundle
 * stays as it was.
 */
const Fathom = lazy(() => import("./Fathom"));

export function FathomScreen({
  onBack,
  onHome,
  run,
  mode,
  today,
}: {
  onBack: () => void;
  onHome: () => void;
  run?: number;
  mode: "daily" | "endless";
  today: string;
}) {
  return (
    <Suspense fallback={<Loading />}>
      {/* Each its own screen, from its own save; Today's Fathom starts over at midnight. */}
      <Fathom key={run ?? `${mode}:${mode === "daily" ? today : ""}`} onBack={onBack} onHome={onHome} run={run} mode={mode} today={today} />
    </Suspense>
  );
}
