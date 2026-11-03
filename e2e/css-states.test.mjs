// The state-layout CSS check (npm run lint:css) on small snippets: what it lets through and what it catches.
import { describe, expect, test } from "vitest";
import { checkCss, isLayoutProp, isStateSelector } from "./css-states.mjs";

const check = (css) => checkCss([{ file: "test.css", css }]);
const failing = (css) => check(css).violations.map((v) => `${v.selector}: ${v.props.join(", ")}`);

describe("lint:css state rules", () => {
  test("states change paint only: passes", () => {
    const css = `
      .key:hover:not(:disabled) { background-color: #123; color: red; box-shadow: 0 2px 0 #000; }
      .key:active { transform: translateY(3px); opacity: .8; }
      .key:focus-visible { outline: 3px solid cyan; outline-offset: 2px; }
      .cap { visibility: hidden; }
      .key:hover .cap { visibility: visible; border-color: red; border-left-color: blue; border-radius: 4px; }
      .chip:hover { translate: 0 -2px; scale: 1.02; filter: brightness(1.2); text-decoration: underline; }
    `;
    expect(check(css).violations).toEqual([]);
  });

  test("a rest rule that repeats its size under :hover fails (the Today key bug)", () => {
    const css = `.mode-key.today, .mode-key.today:hover:not(:disabled) { min-height: 116px; padding: 16px 22px 18px; background: pink; }`;
    expect(failing(css)).toEqual([".mode-key.today, .mode-key.today:hover:not(:disabled): min-height, padding"]);
  });

  test("showing something on hover or keyboard focus with display fails (the ENTER cap)", () => {
    const css = `
      @media (pointer: fine) {
        .mode-key.today:hover .enter-hint,
        html[data-modality="keyboard"] .mode-key:focus .enter-hint { display: inline-block; }
      }`;
    expect(failing(css)).toHaveLength(1);
    expect(check(css).violations[0].props).toEqual(["display"]);
  });

  test("every state counts, wherever it sits in the selector", () => {
    for (const sel of [
      ".a:focus-within",
      ".a:has(.b:focus-visible)",
      ".a:not(:hover)",
      ".a:is(:active, .b)",
      "html[data-modality=keyboard] .a",
      ".row[data-hover] .fact",
    ]) {
      expect(isStateSelector(sel), sel).toBe(true);
    }
    for (const sel of [".a[aria-expanded='true']", ".a:disabled", ".a::after", "[title=':hover']", ".hovercard", ".a[data-hovers]"]) {
      expect(isStateSelector(sel), sel).toBe(false);
    }
  });

  test("layout properties: sizes, spacing, border widths, position, type; not colors or radius", () => {
    for (const p of ["width", "max-height", "padding-inline", "margin-top", "border", "border-left", "border-top-width", "border-style", "gap", "top", "inset", "display", "position", "font-size", "font", "line-height", "letter-spacing", "flex-basis", "grid-template-columns", "content", "white-space", "-webkit-line-clamp"]) {
      expect(isLayoutProp(p), p).toBe(true);
    }
    for (const p of ["color", "background", "box-shadow", "opacity", "outline", "outline-offset", "transform", "translate", "border-color", "border-left-color", "border-radius", "visibility", "z-index", "cursor", "--accent"]) {
      expect(isLayoutProp(p), p).toBe(false);
    }
  });

  test("border widths and other spacing under a state fail", () => {
    expect(failing(`.chip:hover { border: 1px solid red; }`)).toHaveLength(1);
    expect(failing(`.chip:focus { margin-left: 2px; }`)).toHaveLength(1);
    expect(failing(`.chip:active { font-weight: 700; letter-spacing: .3em; }`)).toEqual([".chip:active: font-weight, letter-spacing"]);
    expect(failing(`.chip:hover::after { content: " >"; }`)).toHaveLength(1);
  });

  test("nested rules inherit their parent's state", () => {
    expect(failing(`.card:hover { color: red; .title { gap: 4px; } }`)).toEqual([".title: gap"]);
    expect(failing(`.card { &:hover { width: 2px; } }`)).toEqual(["&:hover: width"]);
  });

  test("a custom property that a layout property reads counts as layout", () => {
    expect(failing(`.k { padding: var(--pad); } .k:hover { --pad: 4px; }`)).toEqual([".k:hover: --pad (read by a layout property)"]);
    // Through another custom property too.
    expect(failing(`.k { --inner: var(--pad); width: var(--inner); } .k:hover { --pad: 4px; }`)).toHaveLength(1);
    // A color variable is fine.
    expect(failing(`.k { color: var(--accent); } .k:hover { --accent: red; }`)).toEqual([]);
  });

  test("an animation whose keyframes change layout counts as layout", () => {
    expect(failing(`@keyframes grow { to { width: 10px; } } .k:hover { animation: grow 1s both; }`)).toHaveLength(1);
    expect(failing(`@keyframes glow { to { opacity: .5; transform: scale(1.1); } } .k:hover { animation: glow 1s; }`)).toEqual([]);
  });

  test("an annotated exception passes and is listed; without a reason it still fails", () => {
    const ok = check(`
      /* state-layout-ok: absolutely positioned popover, nothing moves */
      .row[data-hover]:hover .fact { display: block; position: absolute; top: 100%; }
      .tip:hover .note {
        /* state-layout-ok: floats over the page */
        display: block;
      }`);
    expect(ok.violations).toEqual([]);
    expect(ok.exceptions.map((x) => x.reason)).toEqual(["absolutely positioned popover, nothing moves", "floats over the page"]);
    expect(ok.exceptions[0].props).toEqual(["display", "position", "top"]);

    const bare = check(`/* state-layout-ok */ .row:hover .fact { display: block; }`);
    expect(bare.violations).toHaveLength(1);
    expect(bare.violations[0].note).toMatch(/reason/);
  });

  test("an exception comment on a rule that needs none is reported as stale", () => {
    const r = check(`/* state-layout-ok: not needed */ .a:hover { color: red; } /* state-layout-ok: no state */ .b { display: block; }`);
    expect(r.violations).toEqual([]);
    expect(r.stale.map((x) => x.selector)).toEqual([".a:hover", ".b"]);
  });

  test("keyframe steps are not element rules", () => {
    expect(check(`@keyframes pop { 0% { width: 0; } 100% { width: 10px; } }`).violations).toEqual([]);
  });
});
