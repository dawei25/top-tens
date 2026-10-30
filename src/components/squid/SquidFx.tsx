/**
 * One-off squid effects over the classic game screen, in a fixed, aria-hidden, pointer-transparent layer:
 * - Ink: a life lost (a costly miss or a hint) inks in the ocean, behind the glass; in front, the screen dims around
 *   the squid for a beat and the emptied sac drips. The last life dims it nearly to black.
 * (The grab, the squid reaching through the glass for a found word, is the ocean's: components/ocean/grab.ts.)
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
 * dims a little around the squid for a beat (nearly black for the last life), and ink drips from the emptied sac.
 */
function ink(layer: HTMLElement, scope: ParentNode) {
  const sacs = scope.querySelectorAll<SVGElement>('[data-testid="lives"] .ink-sac.on');
  // Read before the life goes: the last full sac is the one that empties. On the last life the squid bursts.
  const big = sacs.length <= 1;
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

  // Ink drips from the sac that just emptied (on the last life, the squid bursts instead).
  const sac = !big ? sacs[sacs.length - 1]?.getBoundingClientRect() : null;
  if (sac) {
    for (let k = 0; k < 4; k++) {
      const drop = el("i", "ink-drop", fx);
      const x = sac.left + sac.width / 2 + (k - 1.5) * 5;
      const y = sac.top + sac.height * 0.7;
      drop.animate(
        [
          { transform: `translate(${x}px, ${y}px)`, opacity: 1 },
          { transform: `translate(${x + (k - 1.5) * 6}px, ${y + 36 + (k % 2) * 14}px)`, opacity: 0 },
        ],
        { duration: 420, delay: k * 40, fill: "both", easing: "steps(6, end)" },
      );
    }
  }
  removeAfter(fx, DUR);
}
