/**
 * The ocean behind every screen: a fixed, full-viewport, aria-hidden layer under the whole app, with the roaming
 * glow squid in it, drawn on canvas. Mounted once (App). What the squid shows comes from the screen on top (see
 * store.ts), so a reload shows the right limbs at once. Its state is also kept in the DOM, on an invisible stand-in
 * (data-testid="squid": data-lit, data-mood, one [data-limb] per limb), for tests and tools.
 *
 * Above the UI, a second fixed, aria-hidden, pointer-transparent layer: the limb that reaches through the glass to
 * grab a found word (a canvas), and the word tiles it carries.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { startOcean, type Ocean as Engine } from "./engine";
import { getOceanSquid, subscribeOceanSquid } from "./store";
import "./ocean.css";

const LIMBS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function Ocean() {
  const s = useSyncExternalStore(subscribeOceanSquid, getOceanSquid, getOceanSquid);
  const root = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const tiles = useRef<HTMLDivElement>(null);
  const squid = useRef<HTMLSpanElement>(null);
  const engine = useRef<Engine | null>(null);

  useEffect(() => {
    if (!root.current || !back.current || !front.current || !overlay.current || !tiles.current || !squid.current) return;
    const e = startOcean({
      root: root.current,
      back: back.current,
      front: front.current,
      overlay: overlay.current,
      tiles: tiles.current,
      squid: squid.current,
    });
    e.setState(getOceanSquid());
    engine.current = e;
    return () => {
      e.stop();
      engine.current = null;
    };
  }, []);

  useEffect(() => engine.current?.setState(s), [s]);

  const lit = new Set(s.lit.filter((r) => r >= 1 && r <= 10));
  return (
    <>
      <div className="ocean" ref={root} aria-hidden="true" data-testid="ocean">
        <canvas className="ocean-back" ref={back} />
        <canvas className="ocean-front" ref={front} />
        <span
          className="ocean-squid-state"
          ref={squid}
          data-testid="squid"
          data-mode={s.mode === "blitz" ? "blitz" : "classic"}
          data-lit={lit.size}
          data-mood={s.mood}
          data-heat={s.heat}
        >
          {LIMBS.map((id) => (
            <i key={id} data-limb={id} data-on={lit.has(id)} />
          ))}
        </span>
      </div>
      <div className="ocean-over" aria-hidden="true">
        <canvas className="ocean-overlay" ref={overlay} />
        <div className="ocean-tiles" ref={tiles} />
      </div>
    </>
  );
}
