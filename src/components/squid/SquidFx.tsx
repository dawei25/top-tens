/**
 * One-off squid effects over the classic game screen, in a fixed, aria-hidden, pointer-transparent layer:
 * - Ink: a life lost (a costly miss or a hint) inks in the ocean, behind the glass; in front, the screen dims around
 *   the squid for a beat. The last life dims it nearly to black. (The heart that goes flashes and cracks: motion.css.)
 * (A find is the ocean squid's: its limb flashes and it hops, in components/ocean.)
 * Everything is built on the spot, animated with the Web Animations API and removed when done. Nothing runs with
 * reduced motion, and nothing here touches game state or focus.
 */
import { useEffect, useRef } from "react";
import { onPlay } from "../../game/events";
import { squidAt } from "../ocean/store";
import { reducedMotion } from "../pixel";

type P = { x: number; y: number };

export function SquidFx() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      onPlay((e) => {
        const layer = ref.current;
        if (!layer || reducedMotion() || typeof layer.animate !== "function") return;
        const scope: ParentNode = layer.closest("main") ?? document;
        if ((e.kind === "miss" && e.lifeLost) || e.kind === "hint") ink(layer, scope);
      }),
    [],
  );
  return <div ref={ref} className="squid-fx" aria-hidden="true" />;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: Element): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  parent.appendChild(n);
  return n;
}

/** Remove a node once its longest animation is over. */
const removeAfter = (n: Element, ms: number) => setTimeout(() => n.remove(), ms + 50);

/* ---------------------------------------------------------------- ink */

/**
 * A life lost: the squid inks where it is, out in the ocean behind the glass (components/ocean draws the cloud).
 * In front, only what the player needs to read it on a phone, where the board covers most of the ocean: the screen
 * dims a little around the squid for a beat (nearly black for the last life).
 */
function ink(layer: HTMLElement, scope: ParentNode) {
  // Read before the life goes: on the last life the squid bursts.
  const big = scope.querySelectorAll('[data-testid="lives"] .life.on').length <= 1;
  const o: P = squidAt.live ? { x: squidAt.x, y: squidAt.y } : { x: innerWidth / 2, y: innerHeight / 2 };
  const DUR = big ? 1600 : 700;

  const fx = el("div", `ink${big ? " big" : ""}`, layer);
  fx.style.setProperty("--ox", `${o.x}px`);
  fx.style.setProperty("--oy", `${o.y}px`);
  const dim = el("div", "ink-dim", fx);
  dim.animate(
    big
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0.8, offset: 0.6 }, { opacity: 0 }],
    { duration: DUR, fill: "both", easing: "steps(8, end)" },
  );
  removeAfter(fx, DUR);
}
