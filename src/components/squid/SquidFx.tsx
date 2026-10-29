/**
 * One-off squid effects over the classic game screen, in a fixed, aria-hidden, pointer-transparent layer:
 * - The tentacle grab: on a find, a pixel tentacle reaches from the row down to the guess box, grabs the word and
 *   pulls it up into its row. #1 and #2 strain before they come loose. The row itself is already revealed in the DOM;
 *   this only plays over it (the row's name is kept transparent until the word lands).
 * - Ink: a life lost (a costly miss or a hint) squirts an ink cloud from that sac that dims the screen for a beat.
 *   The last life goes in a bigger cloud from the squid itself.
 * Everything is built on the spot, animated with the Web Animations API and removed when done. Nothing runs with
 * reduced motion, and nothing here touches game state or focus.
 */
import { useEffect, useRef } from "react";
import { onPlay } from "../../game/events";
import { reducedMotion } from "../pixel";

const SVG = "http://www.w3.org/2000/svg";
/** The tentacle's pixel size, in CSS px. */
const G = 4;

type P = { x: number; y: number };

export function SquidFx() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      onPlay((e) => {
        const layer = ref.current;
        if (!layer || reducedMotion() || typeof layer.animate !== "function") return;
        const scope: ParentNode = layer.closest("main") ?? document;
        if (e.kind === "found") grab(layer, scope, e.rank);
        else if ((e.kind === "miss" && e.lifeLost) || e.kind === "hint") ink(layer, scope);
        else if (e.kind === "end" && e.status === "won") fireworks(layer, scope);
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

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent.appendChild(n);
  return n;
}

const square = (x: number, y: number, s = G) => `M${x} ${y}h${s}v${s}h${-s}z`;

/** Remove a node once its longest animation is over (or after `ms`, whichever the caller knows). */
const removeAfter = (n: Element, ms: number) => setTimeout(() => n.remove(), ms + 50);

/* ---------------------------------------------------------------- grab */

function cubic(p0: P, p1: P, p2: P, p3: P, t: number): P {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/**
 * The arm as pixel rows: one point per G px row from base to tip, at the curve's x on that row, snapped to the grid.
 * The curve only ever runs downward, so every row is crossed once and the arm comes out solid, with no gaps.
 */
function rowsOf(p0: P, p1: P, p2: P, p3: P): P[] {
  const steps = Math.max(60, Math.ceil(Math.abs(p3.y - p0.y)) * 2);
  const xs = new Map<number, number[]>();
  for (let i = 0; i <= steps; i++) {
    const p = cubic(p0, p1, p2, p3, i / steps);
    const row = Math.round(p.y / G);
    (xs.get(row) ?? xs.set(row, []).get(row)!).push(p.x);
  }
  return [...xs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, list]) => ({ x: Math.round(list.reduce((s, x) => s + x, 0) / list.length / G) * G, y: row * G }));
}

function grab(layer: HTMLElement, scope: ParentNode, rank: number) {
  const input = scope.querySelector<HTMLInputElement>(".guess-row input");
  const row = scope.querySelector<HTMLElement>(`[data-testid="slot"][data-rank="${rank}"]`);
  const name = row?.querySelector<HTMLElement>(".name");
  const text = input?.value.trim();
  if (!input || !row || !name || !text) return;
  const ir = input.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const nr = name.getBoundingClientRect();
  // A row scrolled out of view has nothing to pull into.
  if (rr.top < 0 || rr.bottom > ir.top) return;

  const cs = getComputedStyle(input);
  const fromSize = parseFloat(cs.fontSize) || 28;
  const toSize = parseFloat(getComputedStyle(name).fontSize) || 24;
  const from: P = { x: ir.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), y: ir.top + ir.height / 2 };
  // The name's first line: the row is padded, and a long fact or wrapped name can make it taller.
  const to: P = { x: nr.left, y: nr.top + Math.min(nr.height, toSize * 1.15) / 2 };

  const strain = rank <= 2;
  const gold = rank === 1;
  // Timeline (ms): reach, grip (a tug-of-war for the big ones), pull, land.
  const REACH = 110;
  const GRIP = strain ? 190 : 50;
  const PULL = strain ? 220 : 250;
  const LAND = REACH + GRIP + PULL;
  const TOTAL = LAND + 110;

  // The tentacle runs from just left of the name (its base) down to just left of the typed word (its tip).
  const base: P = { x: to.x - 10, y: to.y };
  const tip: P = { x: Math.max(G, from.x - 12), y: from.y };
  const dy = tip.y - base.y;
  if (dy < G * 4) return;
  const pts = rowsOf(
    base,
    { x: Math.max(G, base.x - 34), y: base.y + dy * 0.35 },
    { x: Math.max(G, tip.x + 30), y: tip.y - dy * 0.4 },
    tip,
  );
  const n = pts.length;

  const fx = el("div", `grab${gold ? " gold" : ""}`, layer);
  const svg = svgEl("svg", { class: "grab-arm", width: innerWidth, height: innerHeight, "shape-rendering": "crispEdges" }, fx);

  // Segments, base to tip: each one appears as the arm reaches, and goes as the word is pulled back past it.
  const SEGS = 8;
  const segAt = (i: number) => Math.min(SEGS - 1, Math.floor((i / n) * SEGS));
  const paths = Array.from({ length: SEGS }, () => ({ hi: "", main: "", shade: "", sucker: "" }));
  pts.forEach((p, i) => {
    const t = i / (n - 1);
    // Thick at the root, tapering; a lit left edge and a shaded right one, like the squid's own limbs.
    const width = t < 0.3 ? 4 : t < 0.7 ? 3 : 2;
    const seg = paths[segAt(i)];
    const left = p.x - Math.floor(width / 2) * G;
    for (let k = 0; k < width; k++) {
      const x = left + k * G;
      if (k === 0) seg.hi += square(x, p.y);
      else if (k < width - 1) seg.main += square(x, p.y);
      else if (i % 4 === 2 && t > 0.15) seg.sucker += square(x, p.y);
      else seg.shade += square(x, p.y);
    }
  });
  const groups = paths.map((p) => {
    const g = svgEl("g", { opacity: 0 }, svg);
    if (p.hi) svgEl("path", { class: "arm-hi", d: p.hi }, g);
    if (p.main) svgEl("path", { class: "arm-main", d: p.main }, g);
    if (p.shade) svgEl("path", { class: "arm-shade", d: p.shade }, g);
    if (p.sucker) svgEl("path", { class: "arm-sucker", d: p.sucker }, g);
    return g;
  });
  groups.forEach((g, j) => {
    const on = ((j + 1) / SEGS) * REACH;
    const off = REACH + GRIP + ((SEGS - j) / SEGS) * PULL;
    g.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 0, offset: on / TOTAL },
        { opacity: 1, offset: Math.min(1, on / TOTAL + 0.001) },
        { opacity: 1, offset: off / TOTAL },
        { opacity: 0, offset: Math.min(1, off / TOTAL + 0.001) },
        { opacity: 0, offset: 1 },
      ],
      { duration: TOTAL, fill: "both" },
    );
  });

  // The word, lifted out of the box, with the club clamped round its front.
  const word = el("div", "grab-word", fx);
  const label = el("span", "grab-text", word);
  label.textContent = text;
  label.style.fontSize = `${fromSize}px`;
  const claw = svgEl("svg", { class: "grab-claw", width: 24, height: 40, viewBox: "-20 -20 24 40", "shape-rendering": "crispEdges" }, word);
  svgEl("path", { class: "arm-main", d: square(-16, -16) + square(-16, -12) + square(-16, 8) + square(-16, 12) + square(-12, -16) + square(-8, -16) + square(-12, 12) + square(-8, 12) }, claw);
  svgEl("path", { class: "arm-shade", d: square(-16, -8) + square(-16, 4) + square(-4, -16) + square(-4, 12) }, claw);
  svgEl("path", { class: "arm-sucker", d: square(-12, -4) + square(-12, 0) }, claw);
  svgEl("path", { class: "arm-main", d: square(-16, -4) + square(-16, 0) }, claw);
  claw.animate(
    [{ opacity: 0 }, { opacity: 0, offset: REACH / TOTAL }, { opacity: 1, offset: REACH / TOTAL + 0.001 }, { opacity: 1, offset: LAND / TOTAL }, { opacity: 0, offset: (LAND + 40) / TOTAL }, { opacity: 0 }],
    { duration: TOTAL, fill: "both" },
  );

  // Word path: sits in the box while the arm reaches, shakes while gripped, then rides the arm back up.
  const at = (p: P, extra = "") => `translate(${p.x}px, ${p.y}px)${extra}`;
  const frames: Keyframe[] = [{ transform: at(from), offset: 0 }, { transform: at(from), offset: REACH / TOTAL }];
  const tugs = strain ? 6 : 1;
  for (let k = 1; k <= tugs; k++) {
    const t = REACH + (GRIP * k) / (tugs + 1);
    const jx = strain ? (k % 2 ? -3 : 3) : 0;
    const jy = strain ? -2 - k : -2;
    frames.push({ transform: at({ x: from.x + jx, y: from.y + jy }), offset: t / TOTAL });
  }
  const pull0 = REACH + GRIP;
  for (let j = SEGS - 1; j >= 0; j--) {
    const i = Math.round((j / SEGS) * (n - 1));
    const p = pts[i];
    const t = pull0 + ((SEGS - j) / SEGS) * PULL;
    // Hold the word's front at the club, which sits 12 px left of the text.
    frames.push({ transform: at({ x: p.x + 12, y: p.y }), offset: t / TOTAL });
  }
  const scale = ` scale(${toSize / fromSize})`;
  // A small overshoot past the name, then it settles and hands over to the real row.
  frames.push({ transform: at({ x: to.x + 4, y: to.y - 2 }, scale), offset: (LAND + 30) / TOTAL });
  frames.push({ transform: at(to, scale), offset: (LAND + 60) / TOTAL, opacity: 1 });
  frames.push({ transform: at(to, scale), offset: 1, opacity: 0 });
  // Dedupe offsets that collided (very short arms), keeping them increasing.
  let lastOff = -1;
  for (const f of frames) {
    f.offset = Math.min(1, Math.max(lastOff + 0.0001, f.offset as number));
    lastOff = f.offset;
  }
  word.animate(frames, { duration: TOTAL, fill: "both", easing: "linear" });

  // The real name waits for the word to land.
  name.animate([{ opacity: 0 }, { opacity: 0, offset: (LAND + 50) / TOTAL }, { opacity: 1 }], { duration: TOTAL });

  // Landing: a splash of light across the row and a few pixels thrown off the front of the word.
  const splash = el("div", `grab-splash${gold ? " gold" : ""}`, fx);
  Object.assign(splash.style, { left: `${rr.left}px`, top: `${rr.top}px`, width: `${rr.width}px`, height: `${rr.height}px` });
  splash.animate([{ opacity: 0 }, { opacity: 0, offset: LAND / (TOTAL + 260) }, { opacity: 1, offset: (LAND + 20) / (TOTAL + 260) }, { opacity: 0 }], {
    duration: TOTAL + 260,
    fill: "both",
    easing: "steps(8, end)",
  });
  for (let k = 0; k < (strain ? 8 : 5); k++) {
    const bit = el("i", "grab-bit", fx);
    const a = -Math.PI / 2 + (k / ((strain ? 8 : 5) - 1) - 0.5) * Math.PI * 1.4;
    const r = (strain ? 30 : 20) + (k % 2) * 8;
    bit.animate(
      [
        { transform: at({ x: to.x - 6, y: to.y }), opacity: 0 },
        { transform: at({ x: to.x - 6, y: to.y }), opacity: 1, offset: LAND / (TOTAL + 200) },
        { transform: at({ x: to.x - 6 + Math.cos(a) * r, y: to.y + Math.sin(a) * r }), opacity: 0 },
      ],
      { duration: TOTAL + 200, fill: "both", easing: "steps(10, end)" },
    );
  }
  removeAfter(fx, TOTAL + 260);
}

/* ---------------------------------------------------------------- 10/10 */

/**
 * A perfect 10: pixel fireworks from the squid, then two more over the board. They live in the fixed layer because
 * the page scrolls down to the results at the same moment, taking the header squid out of view.
 */
function fireworks(layer: HTMLElement, scope: ParentNode) {
  const squid = scope.querySelector<HTMLElement>('[data-testid="squid"]')?.getBoundingClientRect();
  const origins: P[] = [
    squid ? { x: squid.left + squid.width / 2, y: squid.top + squid.height / 2 } : { x: innerWidth / 2, y: innerHeight * 0.2 },
    { x: innerWidth * 0.3, y: innerHeight * 0.38 },
    { x: innerWidth * 0.7, y: innerHeight * 0.3 },
  ];
  const fx = el("div", "fireworks", layer);
  const COLORS = ["cyan", "gold", "pink", "white"];
  const SPARKS = 18;
  origins.forEach((o, b) => {
    const delay = b * 180;
    const r = b === 0 ? 70 : 54 + Math.min(40, innerWidth / 30);
    for (let k = 0; k < SPARKS; k++) {
      const s = el("i", `spark ${COLORS[(k + b) % COLORS.length]}`, fx);
      const a = (k / SPARKS) * Math.PI * 2 + b;
      const d = r * (k % 3 === 0 ? 1 : k % 3 === 1 ? 0.72 : 0.45);
      s.animate(
        [
          { transform: `translate(${o.x}px, ${o.y}px)`, opacity: 0 },
          { transform: `translate(${o.x}px, ${o.y}px)`, opacity: 1, offset: 0.01 },
          { transform: `translate(${o.x + Math.cos(a) * d}px, ${o.y + Math.sin(a) * d}px)`, opacity: 1, offset: 0.6 },
          { transform: `translate(${o.x + Math.cos(a) * d * 1.1}px, ${o.y + Math.sin(a) * d * 1.1 + 18}px)`, opacity: 0 },
        ],
        { duration: 900, delay, fill: "both", easing: "steps(10, end)" },
      );
    }
  });
  removeAfter(fx, 900 + 2 * 180);
}

/* ---------------------------------------------------------------- ink */

function ink(layer: HTMLElement, scope: ParentNode) {
  const sacs = scope.querySelectorAll<SVGElement>('[data-testid="lives"] .ink-sac.on');
  // Read before the life goes: the last full sac is the one that empties. On the last life the squid itself bursts.
  const last = sacs.length <= 1;
  const source = last ? scope.querySelector<HTMLElement>('[data-testid="squid"]') : sacs[sacs.length - 1];
  if (!source) return;
  const r = source.getBoundingClientRect();
  const o: P = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  const big = last;
  const DUR = big ? 1500 : 620;

  const fx = el("div", `ink${big ? " big" : ""}`, layer);
  fx.style.setProperty("--ox", `${o.x}px`);
  fx.style.setProperty("--oy", `${o.y}px`);

  // The screen goes dark from the sac outward, holds a beat, and clears.
  const dim = el("div", "ink-dim", fx);
  dim.animate(
    big
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0.85, offset: 0.6 }, { opacity: 0 }],
    { duration: DUR, fill: "both", easing: "steps(10, end)" },
  );

  // Chunky blobs of ink sprayed out (mostly downward, away from the header), swelling as they go. The first ones
  // stay close and big, so the cloud reads as one mass rather than confetti.
  const reach = big ? Math.max(innerWidth, innerHeight) * 0.8 : Math.min(380, innerHeight * 0.5);
  const count = big ? 52 : 26;
  // Aimed at the middle of the screen (the board), from wherever the ink came out.
  const aim = Math.atan2(innerHeight * 0.55 - o.y, innerWidth / 2 - o.x);
  for (let k = 0; k < count; k++) {
    const puff = el("i", `ink-puff${k % 3 === 0 ? " lit" : ""}`, fx);
    const spread = big ? Math.PI * 2 : 1.6;
    const a = aim + (Math.random() - 0.5) * spread;
    const near = k < count / 3;
    const d = reach * (near ? 0.05 + 0.3 * Math.random() : 0.25 + 0.75 * Math.sqrt(Math.random()));
    // Bigger near the source, so the cloud is one mass that thins out; sized to the screen so it stays a mass.
    const unit = Math.min(innerWidth, innerHeight);
    const size = Math.round((unit * (big ? 0.14 : 0.11) + Math.random() * unit * (big ? 0.22 : 0.14) * (1.3 - d / reach)) / 6) * 6;
    const delay = (d / reach) * DUR * 0.15;
    puff.style.width = puff.style.height = `${size}px`;
    puff.style.marginLeft = puff.style.marginTop = `${-size / 2}px`;
    const end = { x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d };
    puff.animate(
      [
        { transform: `translate(${o.x}px, ${o.y}px) scale(0.15)`, opacity: 0 },
        { transform: `translate(${o.x}px, ${o.y}px) scale(0.15)`, opacity: 1, offset: delay / DUR },
        { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1, offset: Math.min(0.6, delay / DUR + 0.3) },
        { transform: `translate(${end.x}px, ${end.y + 10}px) scale(1.15)`, opacity: 0 },
      ],
      { duration: DUR, fill: "both", easing: "steps(12, end)" },
    );
  }
  // The squirt itself: a few fast pink-black droplets.
  for (let k = 0; k < (big ? 10 : 6); k++) {
    const drop = el("i", "ink-drop", fx);
    const a = aim + (k / 5 - 0.5) * (big ? 2.4 : 1.2);
    const d = (big ? 140 : 70) + (k % 3) * 18;
    drop.animate(
      [
        { transform: `translate(${o.x}px, ${o.y}px)`, opacity: 1 },
        { transform: `translate(${o.x + Math.cos(a) * d}px, ${o.y + Math.sin(a) * d}px)`, opacity: 0 },
      ],
      { duration: big ? 520 : 340, fill: "both", easing: "steps(6, end)" },
    );
  }
  removeAfter(fx, DUR);
}
