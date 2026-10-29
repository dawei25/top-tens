/**
 * A perfect 10: pixel fireworks from the results squid, then two more beside it. In a fixed, aria-hidden layer of
 * their own (styles in squid.css), so they can spill past the panel, removed when done. Decorative only; the caller
 * skips it with reduced motion.
 */
type P = { x: number; y: number };

const COLORS = ["cyan", "gold", "pink", "white"];
const SPARKS = 18;
const DUR = 900;
const STAGGER = 180;

export function fireworksFrom(source: Element) {
  const r = source.getBoundingClientRect();
  const c: P = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const origins: P[] = [c, { x: Math.max(40, c.x - Math.min(160, innerWidth * 0.35)), y: c.y + 10 }, { x: c.x - 60, y: c.y - 40 }];
  const layer = document.createElement("div");
  layer.className = "squid-fx";
  layer.setAttribute("aria-hidden", "true");
  const fx = document.createElement("div");
  fx.className = "fireworks";
  layer.appendChild(fx);
  document.body.appendChild(layer);
  origins.forEach((o, b) => {
    const reach = b === 0 ? 70 : 54 + Math.min(40, innerWidth / 30);
    for (let k = 0; k < SPARKS; k++) {
      const s = document.createElement("i");
      s.className = `spark ${COLORS[(k + b) % COLORS.length]}`;
      fx.appendChild(s);
      const a = (k / SPARKS) * Math.PI * 2 + b;
      const d = reach * (k % 3 === 0 ? 1 : k % 3 === 1 ? 0.72 : 0.45);
      s.animate(
        [
          { transform: `translate(${o.x}px, ${o.y}px)`, opacity: 0 },
          { transform: `translate(${o.x}px, ${o.y}px)`, opacity: 1, offset: 0.01 },
          { transform: `translate(${o.x + Math.cos(a) * d}px, ${o.y + Math.sin(a) * d}px)`, opacity: 1, offset: 0.6 },
          { transform: `translate(${o.x + Math.cos(a) * d * 1.1}px, ${o.y + Math.sin(a) * d * 1.1 + 18}px)`, opacity: 0 },
        ],
        { duration: DUR, delay: b * STAGGER, fill: "both", easing: "steps(10, end)" },
      );
    }
  });
  setTimeout(() => layer.remove(), DUR + 2 * STAGGER + 50);
}
