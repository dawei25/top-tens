import { useEffect, useState } from "react";
import { formatCountdown, msUntilNextDaily } from "../game/daily";
import { BlinkColons } from "./motion/effects";

/**
 * "new list in 05:12:09", ticking on the second. Only this line re-renders. One wording everywhere (Home, a daily's
 * results): at midnight Today's list changes, the one daily (until Nov 10 there were two, and it said "new lists").
 */
export function Countdown({ className = "", label = "new list in" }: { className?: string; label?: string }) {
  const [ms, setMs] = useState(msUntilNextDaily);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setMs(msUntilNextDaily());
      // Land just after each wall-clock second so no second is skipped or shown twice.
      t = setTimeout(tick, 1000 - (Date.now() % 1000) + 15);
    };
    tick();
    return () => clearTimeout(t);
  }, []);
  return (
    <p className={`countdown ${className}`}>
      {label} <b>
        <BlinkColons text={formatCountdown(ms)} />
      </b>
    </p>
  );
}
