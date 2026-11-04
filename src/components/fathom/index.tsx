import { lazy, Suspense } from "react";
import { Loading } from "../Game";

/**
 * Fathom, the estimation beta (#fathom). Hidden: nothing links to it, and it is its own chunk (with its styles),
 * downloaded only when the link is opened, so the main bundle stays as it was.
 */
const Fathom = lazy(() => import("./Fathom"));

export function FathomScreen({ onBack, onHome }: { onBack: () => void; onHome: () => void }) {
  return (
    <Suspense fallback={<Loading />}>
      <Fathom onBack={onBack} onHome={onHome} />
    </Suspense>
  );
}
