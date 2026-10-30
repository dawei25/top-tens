/**
 * One-off squid effects over the classic game screen, in a fixed, aria-hidden, pointer-transparent layer:
 * - The tentacle grab: on a find, a pixel tentacle reaches from the row down to the guess box, grabs the word and
 *   pulls it up into its row. #1 and #2 strain before they come loose. The row itself is already revealed in the DOM;
 *   this only plays over it (the row's name is kept transparent until the word lands).
 * - Ink: a life lost (a costly miss or a hint) inks in the ocean, behind the glass; in front, the screen dims around
 *   the squid for a beat and the emptied sac drips. The last life dims it nearly to black.
 * Everything is built on the spot, animated with the Web Animations API and removed when done. Nothing runs with
 * reduced motion, and nothing here touches game state or focus.
 */
import { useEffect, useRef } from "react";
import { onPlay } from "../../game/events";
import { squidAt } from "../ocean/store";
import { reducedMotion } from "../pixel";

const SVG = "http://www.w3.org/2000/svg";
/** The tentacle's pixel size, in CSS px. */
const G = 4;
/** How far left of the word's text the club clamps it (clear of the word's tile; see .grab-claw). */
const CLUB = 20;

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
  const tip: P = { x: Math.max(G, from.x - CLUB), y: from.y };
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
  const ring = gold ? "var(--gold)" : "var(--cyan-edge)";
  // A tile cut out of the guess box: it covers the feedback line as it passes, then melts into the row.
  label.animate(
    [
      { backgroundColor: "var(--well)", boxShadow: `0 0 0 2px ${ring}` },
      { backgroundColor: "var(--well)", boxShadow: `0 0 0 2px ${ring}`, offset: (REACH + GRIP + PULL * 0.6) / TOTAL },
      { backgroundColor: "transparent", boxShadow: "0 0 0 2px transparent", offset: LAND / TOTAL },
      { backgroundColor: "transparent", boxShadow: "0 0 0 2px transparent" },
    ],
    { duration: TOTAL, fill: "both", easing: "steps(12, end)" },
  );
  // The box's placeholder would show through where the word was: keep it hidden until the word is gone.
  input.dataset.grabbing = "";
  setTimeout(() => delete input.dataset.grabbing, REACH + GRIP + 120);
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
    // The tug stays inside the guess box (clear of the feedback line above it): a sideways shake, barely lifting.
    const jx = strain ? (k % 2 ? -4 : 4) : 0;
    const jy = strain ? -1 - (k % 3) : -2;
    frames.push({ transform: at({ x: from.x + jx, y: from.y + jy }), offset: t / TOTAL });
  }
  const pull0 = REACH + GRIP;
  for (let j = SEGS - 1; j >= 0; j--) {
    const i = Math.round((j / SEGS) * (n - 1));
    const p = pts[i];
    const t = pull0 + ((SEGS - j) / SEGS) * PULL;
    // Hold the word's front at the club, which sits CLUB px left of the text.
    frames.push({ transform: at({ x: p.x + CLUB, y: p.y }), offset: t / TOTAL });
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
