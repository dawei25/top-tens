import { lazy, Suspense } from "react";
import { Loading } from "../Game";

/**
 * Fathom, the estimation game (#fathom; one finished game: #fathom/run-<startedAt>). Its own chunk (with its styles),
 * downloaded only when it is opened, so the main bundle stays as it was.
 */
const Fathom = lazy(() => import("./Fathom"));

export function FathomScreen({ onBack, onHome, run }: { onBack: () => void; onHome: () => void; run?: number }) {
  return (
    <Suspense fallback={<Loading />}>
      {/* A game and a past game are separate screens: each starts from its own save. */}
      <Fathom key={run ?? "game"} onBack={onBack} onHome={onHome} run={run} />
    </Suspense>
  );
}
