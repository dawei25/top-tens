/**
 * The ocean behind every screen: a fixed, full-viewport, aria-hidden layer under the whole app, with the roaming
 * glow squid in it. Mounted once (App). The squid is the same Squid component as on the results panel; what it
 * shows comes from the screen on top (see store.ts), so a reload shows the right limbs at once.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Squid } from "../squid/Squid";
import { startOcean, type Ocean as Engine } from "./engine";
import { getOceanSquid, subscribeOceanSquid } from "./store";
import "./ocean.css";

export function Ocean() {
  const s = useSyncExternalStore(subscribeOceanSquid, getOceanSquid, getOceanSquid);
  const root = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);
  const squid = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);

  useEffect(() => {
    if (!root.current || !back.current || !front.current || !squid.current) return;
    const e = startOcean({ root: root.current, back: back.current, front: front.current, squid: squid.current });
    e.setState(getOceanSquid());
    engine.current = e;
    return () => {
      e.stop();
      engine.current = null;
    };
  }, []);

  useEffect(() => engine.current?.setState(s), [s]);

  return (
    <div className="ocean" ref={root} aria-hidden="true" data-testid="ocean">
      <canvas className="ocean-back" ref={back} />
      <div className="ocean-squid" ref={squid}>
        <Squid
          key={s.session}
          roam
          mode={s.mode === "blitz" ? "blitz" : "classic"}
          lit={s.lit}
          mood={s.mood}
          heat={s.heat}
          flare={s.flare}
        />
      </div>
      <canvas className="ocean-front" ref={front} />
    </div>
  );
}
