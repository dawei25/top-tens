// npm run lint:css: hover, focus and press may change color, background, shadow, opacity, outline and transform only.
// This fails on any rule in src/**/*.css whose selector involves an interaction state and that declares a layout
// property (directly, through a custom property that a layout property reads, or through an animation whose keyframes
// change layout). The live check is e2e/states.e2e.cjs; this one catches the pattern before anything runs.
//
// A state rule that really must touch layout (a popover that floats over the page, so nothing else moves) takes a
// comment right before the rule, or as its first line, with the reason:
//   /* state-layout-ok: absolutely positioned popover, nothing moves */
// Every such exception is listed in the output.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

/** Pointer and focus states, wherever they appear in a selector (also inside :not(), :has(), :is(), :where()). */
const STATE_PSEUDO = /:(?:hover|active|focus(?:-visible|-within)?)(?![\w-])/;
/** Attributes that mirror an interaction state set from script (data-hover on a fact row, keyboard modality). */
const STATE_ATTR = /^\[\s*data-(?:hover|hovered|focus|focused|press|pressed|active|modality)(?![\w-])/;

/** Properties that change the size or position of something: what a state rule may never declare. */
const LAYOUT = [
  /^(?:min-|max-)?(?:width|height|inline-size|block-size)$/,
  /^(?:padding|margin)(?:-.+)?$/,
  // Border widths and styles (a style change turns a width on or off); colors, radius and images are fine.
  /^border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?(?:-(?:width|style))?$/,
  /^(?:inset(?:-.+)?|top|right|bottom|left)$/,
  /^(?:display|position|float|clear|box-sizing|aspect-ratio|zoom|contain|container(?:-type)?|content-visibility)$/,
  /^overflow(?:-.+)?$/,
  /^(?:row-|column-|grid-(?:row-|column-)?)?gap$/,
  /^(?:flex(?:-.+)?|order|align-(?:content|items|self)|justify-(?:content|items|self)|place-(?:content|items|self))$/,
  /^grid(?:-.+)?$/,
  /^font(?:-(?:size|family|weight|style|stretch|variant.*|feature-settings|variation-settings|size-adjust))?$/,
  /^(?:line-height|letter-spacing|word-spacing|text-transform|text-indent|text-align|vertical-align)$/,
  /^(?:white-space(?:-collapse)?|text-wrap(?:-mode)?|word-break|overflow-wrap|word-wrap|hyphens|tab-size)$/,
  /^(?:writing-mode|direction|text-orientation)$/,
  /^(?:list-style(?:-position|-type)?|content|columns|column-(?:count|width|span|fill))$/,
  /^(?:table-layout|border-spacing|border-collapse|caption-side|appearance|field-sizing|scrollbar-gutter|scrollbar-width)$/,
  /^(?:line-clamp|box-orient)$/,
];

const bare = (prop) => prop.toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, "");
export const isLayoutProp = (prop) => !prop.startsWith("--") && LAYOUT.some((re) => re.test(bare(prop)));

/** Whether one selector (no top-level commas) depends on a hover, focus or press state. */
export function isStateSelector(selector) {
  // Attributes first (their values may hold anything), then the pseudo-classes outside attributes and strings.
  for (const attr of selector.match(/\[[^\]]*\]/g) ?? []) if (STATE_ATTR.test(attr)) return true;
  const plain = selector.replace(/\[[^\]]*\]/g, "[]").replace(/"[^"]*"|'[^']*'/g, '""');
  return STATE_PSEUDO.test(plain);
}

const EXCEPTION = /^\s*state-layout-ok\b\s*:?\s*([\s\S]*?)\s*$/;
const HOVER_EXCEPTION = /^\s*hover-ok\b\s*:?\s*([\s\S]*?)\s*$/;

/** The exception comment on a rule, if any: the comment right before it, or its first child. Returns the reason. */
function exceptionOf(rule, pattern = EXCEPTION) {
  const prev = rule.prev();
  const first = rule.first;
  for (const node of [prev, first]) {
    if (node?.type !== "comment") continue;
    const m = node.text.match(pattern);
    if (m) return { reason: m[1], node };
  }
  return null;
}

/** :hover itself (not a data-hover attribute, set from script for a mouse only). */
const HOVER = /:hover(?![\w-])/;
const hasHover = (selector) => HOVER.test(selector.replace(/\[[^\]]*\]/g, "[]").replace(/"[^"]*"|'[^']*'/g, '""'));
/** Media where there is a real hover: the primary pointer hovers, or is a mouse. */
const HOVER_MEDIA = /\(\s*hover\s*:\s*hover\s*\)|\(\s*pointer\s*:\s*fine\s*\)/;
function inHoverMedia(rule) {
  for (let n = rule.parent; n; n = n.parent) if (n.type === "atrule" && n.name === "media" && HOVER_MEDIA.test(n.params)) return true;
  return false;
}
/** `.a:hover:not(:disabled)` listed beside `.a`: the hover only keeps the rest look, so nothing can stick. */
function keepsRest(selector, list) {
  const rest = selector.replace(/:hover(:not\(:disabled\))?(?![\w-])/g, "").trim();
  return rest !== selector.trim() && list.some((s) => s.trim() === rest);
}

/** The selectors in force for a rule: its own list, combined with every rule it is nested in. */
function selectorChain(rule) {
  const chain = [];
  for (let n = rule; n; n = n.parent) if (n.type === "rule") chain.push(n.selectors);
  return chain;
}

/** var(--name) references in a value. */
const varsIn = (value) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]);

/**
 * Checks one or more CSS sources. `files` is [{ file, css }]. Returns the violations (state rules that change layout),
 * the annotated exceptions, and stale exception comments (on rules that don't need one).
 */
export function checkCss(files) {
  const roots = files.map(({ file, css }) => ({ file, root: postcss.parse(css, { from: file }) }));

  // Custom properties that end up in a layout property (directly, or through other custom properties).
  const uses = new Map(); // --prop -> custom properties its value reads
  const layoutVars = new Set();
  for (const { root } of roots) {
    root.walkDecls((d) => {
      if (d.prop.startsWith("--")) uses.set(d.prop, [...(uses.get(d.prop) ?? []), ...varsIn(d.value)]);
      else if (isLayoutProp(d.prop)) varsIn(d.value).forEach((v) => layoutVars.add(v));
    });
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const [prop, read] of uses) {
      if (!layoutVars.has(prop)) continue;
      for (const v of read) {
        if (layoutVars.has(v)) continue;
        layoutVars.add(v);
        grew = true;
      }
    }
  }

  // Keyframes that animate a layout property.
  const layoutKeyframes = new Set();
  for (const { root } of roots) {
    root.walkAtRules(/keyframes$/i, (at) => {
      at.walkDecls((d) => {
        if (isLayoutProp(d.prop) || layoutVars.has(d.prop)) layoutKeyframes.add(at.params.trim());
      });
    });
  }
  const animatesLayout = (d) => {
    const p = bare(d.prop);
    if (p !== "animation" && p !== "animation-name") return false;
    return d.value.split(",").some((part) => part.trim().split(/\s+/).some((word) => layoutKeyframes.has(word)));
  };

  const violations = [];
  const exceptions = [];
  const stale = [];
  /** Hover looks outside a hover media query: on a phone they stick to whatever was last tapped. */
  const stickyHover = [];
  const hoverExceptions = [];
  let rules = 0;
  for (const { file, root } of roots) {
    root.walkRules((rule) => {
      // Keyframe selectors (from, to, 50%) are not rules about elements.
      if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
      rules += 1;
      const hovering = selectorChain(rule).some((list) => list.some((s) => hasHover(s) && !keepsRest(s, list)));
      if (hovering && !inHoverMedia(rule)) {
        const where = { file, line: rule.source?.start?.line ?? 0, selector: rule.selector.replace(/\s+/g, " ") };
        const ok = exceptionOf(rule, HOVER_EXCEPTION);
        if (ok?.reason) hoverExceptions.push({ ...where, reason: ok.reason });
        else stickyHover.push(where);
      }
      const chain = selectorChain(rule);
      const states = chain.flat().filter(isStateSelector);
      const exception = exceptionOf(rule);
      const where = { file, line: rule.source?.start?.line ?? 0, selector: rule.selector.replace(/\s+/g, " ") };
      if (!states.length) {
        if (exception) stale.push({ ...where, reason: exception.reason });
        return;
      }
      const props = [];
      rule.each((d) => {
        if (d.type !== "decl") return;
        if (isLayoutProp(d.prop)) props.push(d.prop);
        else if (d.prop.startsWith("--") && layoutVars.has(d.prop)) props.push(`${d.prop} (read by a layout property)`);
        else if (animatesLayout(d)) props.push(`${d.prop} (keyframes change layout)`);
      });
      if (!props.length) {
        if (exception) stale.push({ ...where, reason: exception.reason });
        return;
      }
      if (exception && exception.reason) exceptions.push({ ...where, states, props, reason: exception.reason });
      else violations.push({ ...where, states, props, ...(exception && { note: "state-layout-ok needs a reason" }) });
    });
  }
  return { violations, exceptions, stale, rules, stickyHover, hoverExceptions };
}

function cssFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return cssFiles(path);
    return e.name.endsWith(".css") ? [path] : [];
  });
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = cssFiles(join(root, "src"))
    .sort()
    .map((path) => ({ file: relative(root, path), css: readFileSync(path, "utf8") }));
  const { violations, exceptions, stale, rules, stickyHover, hoverExceptions } = checkCss(files);
  const at = (x) => `${x.file}:${x.line}`;

  console.log(`lint:css: ${rules} rules in ${files.map((f) => f.file).join(", ")}.`);
  console.log("Rule: hover, focus and press change color, background, shadow, opacity, outline and transform only.");
  if (exceptions.length) {
    console.log(`\n${exceptions.length} annotated exception(s) (state-layout-ok):`);
    for (const x of exceptions) console.log(`  ${at(x)}  ${x.selector}\n    ${x.props.join(", ")}\n    reason: ${x.reason}`);
  }
  if (stale.length) {
    console.log(`\n${stale.length} state-layout-ok comment(s) on rules that change no layout under a state (remove them):`);
    for (const x of stale) console.log(`  ${at(x)}  ${x.selector}`);
  }
  if (violations.length) {
    console.log(`\nFAILED: ${violations.length} state rule(s) change layout:`);
    for (const x of violations) {
      console.log(`  ${at(x)}  ${x.selector}`);
      console.log(`    state: ${x.states.join(" | ")}`);
      console.log(`    layout: ${x.props.join(", ")}${x.note ? ` (${x.note})` : ""}`);
    }
    console.log(
      "\nMove the layout declarations to a rule without the state (the size lives on the element alone), or, for a" +
        "\npopover that floats over the page so nothing moves, annotate the rule: /* state-layout-ok: <reason> */",
    );
    process.exitCode = 1;
  }
  console.log("\nRule: a hover look lives inside @media (hover: hover) (or (pointer: fine)), where there is a hover.");
  if (hoverExceptions.length) {
    console.log(`${hoverExceptions.length} annotated hover exception(s) (hover-ok):`);
    for (const x of hoverExceptions) console.log(`  ${at(x)}  ${x.selector}\n    reason: ${x.reason}`);
  }
  if (stickyHover.length) {
    console.log(`\nFAILED: ${stickyHover.length} hover rule(s) outside a hover media query (on a phone they stick after a tap):`);
    for (const x of stickyHover) console.log(`  ${at(x)}  ${x.selector}`);
    console.log("\nMove them into @media (hover: hover) { ... }, or annotate a rule that must stay: /* hover-ok: <reason> */");
    process.exitCode = 1;
  }
  if (!process.exitCode) console.log("\nlint:css: passed.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
