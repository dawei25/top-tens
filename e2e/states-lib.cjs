// Machinery for e2e/states.e2e.cjs: measure the layout of a whole screen, then hover, press and keyboard-focus each
// interactive element and report everything that moved or resized.
//
// Layout boxes are untransformed (offsetLeft/offsetTop summed up the offsetParent chain, offsetWidth/offsetHeight), so
// a lift or a press sink (transform) never counts, and sticky boxes are read as unstuck, so the page's scroll (hovering
// something lower down scrolls to it) never counts either. Transitions and animations are cut to 0 s while checking,
// so a layout change shows at once. An element that appears (or vanishes) out of flow, absolutely or fixed positioned,
// is a popover: it floats over the page, and only what moves around it counts.

/** Runs in the page (installed once per document by `install`). */
function pageLib() {
  if (window.__states) return;
  const INTERACTIVE = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    '[tabindex]:not([tabindex="-1"])',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="checkbox"]',
  ].join(", ");
  const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT"]);
  const QUALIFIERS = ["rank", "date", "mode", "category", "kind", "list"];
  const SLACK = 0.5;

  const style = document.createElement("style");
  style.dataset.states = "";
  style.textContent = `
    *, *::before, *::after {
      transition-duration: 0s !important; transition-delay: 0s !important;
      animation-duration: 0s !important; animation-delay: 0s !important; scroll-behavior: auto !important;
    }
    [data-states-unstick] { position: relative !important; inset: auto !important; }
    [data-states-sentinel] { position: fixed !important; top: 0; left: 0; width: 1px; height: 1px; opacity: 0; }
    /* While measuring only: a transform or filter makes an element the offsetParent of what's inside it, and offsets
       are whole pixels, so a press sink would shift the rounded sums by a pixel without anything having moved. */
    html[data-states-measuring] *, html[data-states-measuring] *::before, html[data-states-measuring] *::after {
      transform: none !important; translate: none !important; scale: none !important; rotate: none !important;
      filter: none !important; backdrop-filter: none !important; perspective: none !important;
      will-change: auto !important;
    }
  `;
  document.head.append(style);

  /** The ocean is decoration behind everything (fixed, aria-hidden, never takes a pointer): not part of the layout. */
  const ocean = () => document.querySelector('[data-testid="ocean"]');
  const isEl = (el) => el instanceof HTMLElement && !SKIP.has(el.tagName) && !el.hasAttribute("data-states-sentinel");
  function elements(root = document.body) {
    const skip = ocean();
    return [...root.querySelectorAll("*")].filter((el) => isEl(el) && !(skip && skip.contains(el)));
  }

  function measure() {
    const els = elements();
    const styles = new Map(els.map((el) => [el, getComputedStyle(el)]));
    const stuck = els.filter((el) => styles.get(el).position === "sticky");
    for (const el of stuck) el.setAttribute("data-states-unstick", "");
    document.documentElement.setAttribute("data-states-measuring", "");
    const memo = new Map();
    const at = (el) => {
      let p = memo.get(el);
      if (!p) {
        const parent = el.offsetParent;
        const base = parent ? at(parent) : { x: 0, y: 0 };
        p = { x: base.x + el.offsetLeft, y: base.y + el.offsetTop };
        memo.set(el, p);
      }
      return p;
    };
    const boxes = new Map();
    for (const el of els) {
      if (!el.getClientRects().length) {
        boxes.set(el, null);
        continue;
      }
      const { x, y } = at(el);
      boxes.set(el, { x, y, w: el.offsetWidth, h: el.offsetHeight, position: styles.get(el).position });
    }
    const doc = document.documentElement;
    const size = { sw: doc.scrollWidth, sh: doc.scrollHeight };
    doc.removeAttribute("data-states-measuring");
    for (const el of stuck) el.removeAttribute("data-states-unstick");
    return { boxes, ...size };
  }

  function label(el) {
    const id = el.getAttribute("data-testid");
    const q = QUALIFIERS.filter((k) => el.dataset[k] !== undefined).map((k) => `${k}=${el.dataset[k]}`);
    if (id) return `[${[id, ...q].join(" ")}]`;
    const cls = [...el.classList].slice(0, 3).map((c) => `.${c}`).join("");
    const words = el.getAttribute("aria-label") || (el.matches(INTERACTIVE) || !el.children.length ? el.textContent : "");
    const text = (words || "").trim().replace(/\s+/g, " ");
    const near = el.parentElement?.closest("[data-testid]");
    return (
      `${el.tagName.toLowerCase()}${cls}` +
      (text ? ` "${text.length > 30 ? `${text.slice(0, 28)}..` : text}"` : "") +
      (near ? ` in [${near.getAttribute("data-testid")}]` : "")
    );
  }

  /**
   * Whether `el`, shown in `here` but not in `there`, floats: it, or the ancestor whose appearance brought it, is
   * absolutely or fixed positioned (a popover), so it takes no room from anything else.
   */
  function floats(el, here, there) {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      if (there.boxes.get(e)) return false;
      const b = here.boxes.get(e);
      if (b && (b.position === "absolute" || b.position === "fixed")) return true;
    }
    return false;
  }

  const off = (a, b) => Math.abs(a - b) > SLACK;
  function diff(a, b) {
    const out = [];
    for (const [el, before] of a.boxes) {
      const after = b.boxes.has(el) ? b.boxes.get(el) : undefined;
      if (before && after) {
        if (off(before.x, after.x) || off(before.y, after.y) || off(before.w, after.w) || off(before.h, after.h))
          out.push({ el, before, after });
      } else if (before && !after) {
        if (!floats(el, a, b)) out.push({ el, before, after: null, removed: after === undefined });
      } else if (!before && after) {
        if (!floats(el, b, a)) out.push({ el, before: null, after });
      }
    }
    for (const [el, after] of b.boxes) {
      if (!a.boxes.has(el) && after && !floats(el, b, a)) out.push({ el, before: null, after });
    }
    return out;
  }

  const fmt = (b) => `${b.w}x${b.h} at ${b.x},${b.y}`;
  /**
   * Named elements (a data-testid, or interactive) are listed with their boxes before and after, and so is anything
   * that changed size; the rest that only moved are counted.
   */
  function report(changes, a, b) {
    const docChanged = a.sw !== b.sw || a.sh !== b.sh;
    if (!changes.length && !docChanged) return null;
    const named = (el) => el.hasAttribute("data-testid") || el.matches(INTERACTIVE);
    const resized = (c) => !c.before || !c.after || c.before.w !== c.after.w || c.before.h !== c.after.h;
    const listed = changes.filter((c) => named(c.el) || resized(c));
    return {
      total: changes.length,
      doc: docChanged ? `page scroll size ${a.sw}x${a.sh} -> ${b.sw}x${b.sh}` : null,
      lines: listed.map(
        (c) =>
          `${label(c.el)}: ${c.before ? fmt(c.before) : "not shown"} -> ${c.after ? fmt(c.after) : c.removed ? "removed" : "not shown"}`,
      ),
      moved: changes.length - listed.length,
    };
  }

  const clickable = (el) => {
    const c = getComputedStyle(el).cursor;
    return c === "pointer" || c === "help";
  };
  const visible = (el) => {
    if (!el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  const enabled = (el) => !el.matches(":disabled") && el.getAttribute("aria-disabled") !== "true";

  let rest = null;
  let restFocus = null;
  let targets = [];
  const seen = new Set();
  /** How many of each kind of element were checked in the current pass (see `kind`). */
  let kinds = new Map();
  let perKind = 2;
  /**
   * Elements of one kind (tag, classes, test id, state, and their container's classes: the nine empty rows of a
   * board, the archive's rows) share their styles: `perKind` of each are checked, not all of them.
   */
  const classes = (el) => (el ? [...el.classList].sort().join(".") : "");
  const kind = (el) =>
    [el.tagName, classes(el), el.dataset.testid, el.dataset.state, el.getAttribute("type"), classes(el.parentElement)].join("|");
  const take = (el) => {
    const k = kind(el);
    const n = kinds.get(k) ?? 0;
    if (n >= perKind) return false;
    kinds.set(k, n + 1);
    return true;
  };

  function neutral() {
    const spots = [
      [1, 1],
      [innerWidth - 2, 1],
      [1, innerHeight - 2],
      [innerWidth - 2, innerHeight - 2],
      [1, Math.round(innerHeight / 2)],
    ];
    for (const [x, y] of spots) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || (!hit.closest(INTERACTIVE) && !clickable(hit))) return { x, y };
    }
    return { x: 1, y: 1 };
  }

  window.__states = {
    /** A new screen: its rest focus is what has focus now (`keepFocus`, an open picker), or nothing. */
    begin(keepFocus) {
      const a = document.activeElement;
      restFocus = keepFocus && a && a !== document.body ? a : null;
    },
    /** Back to the screen's rest: its own focus (or none), scrolled to the top. Returns a spot where the mouse rests. */
    prepare() {
      this.restore();
      scrollTo(0, 0);
      return neutral();
    },
    /**
     * Records the rest layout and the elements to act on (in `scope`, a selector, if given; `all` for every one of
     * each kind). Returns their labels and how many were left out as more of a kind already checked.
     */
    setRest(scope, all) {
      rest = measure();
      perKind = all ? Infinity : 2;
      kinds = new Map();
      const root = scope ? document.querySelector(scope) : document.body;
      const candidates = root
        ? elements(root).filter((el) => {
            if (!el.matches(INTERACTIVE)) {
              // A clickable row or card without a button of its own: the top of its pointer cursor.
              if (!clickable(el) || (el.parentElement && clickable(el.parentElement)) || el.closest(INTERACTIVE)) return false;
            }
            return enabled(el) && visible(el);
          })
        : [];
      targets = candidates.filter(take);
      kinds = new Map();
      return { labels: targets.map(label), same: candidates.length - targets.length, boxes: rest.boxes.size };
    },
    /** Focus back where it was at rest (or nowhere). */
    restore() {
      const a = document.activeElement;
      if (restFocus?.isConnected) {
        if (a !== restFocus) restFocus.focus({ preventScroll: true });
      } else if (a && a !== document.body) a.blur();
    },
    /** A point on target `i` that really hits it (scrolled into view first), and a free spot to move away to. */
    point(i) {
      const el = targets[i];
      if (!el?.isConnected) return null;
      let r = el.getBoundingClientRect();
      if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) {
        el.scrollIntoView({ block: "center", inline: "center" });
        r = el.getBoundingClientRect();
      }
      const fractions = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7], [0.12, 0.5], [0.88, 0.5]];
      for (const [fx, fy] of fractions) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x, y, away: neutral() };
      }
      return null;
    },
    /** The changes from rest right now, or null. */
    check() {
      const now = measure();
      return report(diff(rest, now), rest, now);
    },
    /** The screen as it is now becomes the rest (after a change that didn't undo itself, already reported). */
    rebase() {
      rest = measure();
    },
    /** Keeps clicks (and link drags) from doing anything while pressing: a press is pointer down only. */
    guard(on) {
      const stop = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (on && !this._stop) {
        this._stop = stop;
        for (const t of ["click", "auxclick", "dragstart"]) addEventListener(t, stop, true);
      } else if (!on && this._stop) {
        for (const t of ["click", "auxclick", "dragstart"]) removeEventListener(t, this._stop, true);
        this._stop = null;
      }
    },
    /** Starts a Tab walk: from the top of the page, or (in a scope) from its first interactive element. */
    focusStart(scope) {
      seen.clear();
      kinds = new Map();
      if (scope) {
        const first = targets.find((el) => el.matches(INTERACTIVE));
        first?.focus({ preventScroll: true });
        return !!first;
      }
      let s = document.querySelector("[data-states-sentinel]");
      if (!s) {
        s = document.createElement("span");
        s.setAttribute("data-states-sentinel", "");
        s.tabIndex = -1;
        document.body.prepend(s);
      }
      s.focus({ preventScroll: true });
      return true;
    },
    /** After a Tab: what has focus, and the changes from rest; done once focus leaves the page, the scope or repeats. */
    focusStep(scope) {
      const el = document.activeElement;
      if (!el || el === document.body || el.hasAttribute("data-states-sentinel")) return { done: true };
      // Leaving a scope can close it (a picker closes when focus leaves it): gone counts as left.
      const root = scope && document.querySelector(scope);
      if (scope && !root?.contains(el)) return { done: true, outside: label(el) };
      if (seen.has(el)) return { done: true };
      seen.add(el);
      // More of a kind already checked in this walk: Tab on past it.
      if (!take(el)) return { skipped: true };
      return { label: label(el), changes: this.check() };
    },
    /** Checks the state now (after hovering target `i`) and gets the point for target `next`, in one round trip. */
    hoverStep(next) {
      const changes = this.check();
      this.restore();
      return { changes, next: next === null ? null : this.point(next) };
    },
    focusEnd() {
      document.querySelector("[data-states-sentinel]")?.remove();
      this.restore();
    },
  };
}

const install = (page) => page.evaluate(pageLib);

/**
 * Hovers (if `hover`), presses and Tab-focuses every visible enabled interactive element on the screen in front of
 * `page` (two of each kind; STATES_ALL=1 for every one), comparing the layout with the screen at rest.
 * `screen.scope` limits the elements acted on (all of the page is still measured); `screen.keepFocus` keeps the element
 * focused at rest focused (an open picker closes on blur). Returns { failures, counts }.
 */
async function checkScreen(page, screen, { hover }) {
  await install(page);
  await page.waitForTimeout(30);
  const failures = [];
  const fail = (state, what, r) => failures.push({ screen: screen.name, state, what, ...r });
  const counts = { hover: 0, press: 0, focus: 0, covered: [] };
  const settle = async () => {
    const spot = await page.evaluate(() => window.__states.prepare());
    await page.mouse.move(spot.x, spot.y);
  };
  /**
   * After a state that changed the layout: if the screen doesn't come back to its rest once the state is undone, that
   * is reported too, and the screen as it is now becomes the rest, so one lasting change isn't blamed on everything
   * after it.
   */
  const recover = async (state, what) => {
    await settle();
    const r = await page.evaluate(() => window.__states.check());
    if (!r) return;
    fail(state, `${what}, then undone: the screen did not come back to rest`, r);
    await page.evaluate(() => window.__states.rebase());
  };

  await page.evaluate((keep) => window.__states.begin(keep), !!screen.keepFocus);
  await settle();
  const { labels, same } = await page.evaluate(
    ([scope, all]) => window.__states.setRest(scope, all),
    [screen.scope ?? null, !!process.env.STATES_ALL],
  );
  counts.same = same;
  const pointAt = (n) => (n === null ? null : page.evaluate((i) => window.__states.point(i), n));

  if (hover && labels.length) {
    let pt = await pointAt(0);
    for (let i = 0; i < labels.length; i++) {
      const next = i + 1 < labels.length ? i + 1 : null;
      if (!pt) {
        counts.covered.push(labels[i]);
        pt = await pointAt(next);
        continue;
      }
      await page.mouse.move(pt.x, pt.y);
      // Checks this hover, undoes any focus it moved (hovering a Today key focuses it, so Enter means that key: part
      // of its hover state), and finds the next point, in one round trip.
      const r = await page.evaluate((n) => window.__states.hoverStep(n), next);
      counts.hover += 1;
      pt = r.next;
      if (r.changes) {
        fail("hover", labels[i], r.changes);
        await recover("hover", labels[i]);
        pt = await pointAt(next);
      }
    }
    await recover("hover", "(the hover pass)");
  }

  await page.evaluate(() => window.__states.guard(true));
  try {
    for (let i = 0; i < labels.length; i++) {
      const pt = await page.evaluate((n) => {
        window.__states.restore();
        return window.__states.point(n);
      }, i);
      if (!pt) continue;
      await page.mouse.move(pt.x, pt.y);
      await page.mouse.down();
      let r;
      try {
        r = await page.evaluate(() => window.__states.check());
      } finally {
        // Away first, then up: released outside, so no click fires (the guard stops any that would).
        await page.mouse.move(pt.away.x, pt.away.y);
        await page.mouse.up();
      }
      counts.press += 1;
      if (r) {
        fail("press", labels[i], r);
        await recover("press", labels[i]);
      }
    }
  } finally {
    await page.evaluate(() => window.__states.guard(false));
  }
  await recover("press", "(the press pass)");

  await settle();
  if (await page.evaluate((scope) => window.__states.focusStart(scope), screen.scope ?? null)) {
    // In a scope, start one step before it, so its first element is reached by Tab too.
    if (screen.scope) await page.keyboard.press("Shift+Tab");
    for (let step = 0; step < labels.length + 60; step++) {
      await page.keyboard.press("Tab");
      const r = await page.evaluate((scope) => window.__states.focusStep(scope), screen.scope ?? null);
      if (r.done) break;
      if (r.skipped) continue;
      counts.focus += 1;
      if (r.changes) fail("focus", r.label, r.changes);
    }
  }
  await page.evaluate(() => window.__states.focusEnd());
  await recover("focus", "(the Tab walk)");
  return { failures, counts };
}

/** One readable block per failure: where, which state on which element, then each element that moved or resized. */
function formatFailures(width, failures) {
  return failures
    .map((f) => {
      const head = `${f.screen} @ ${width}px, ${f.state} ${f.what}: ${f.total} element${f.total === 1 ? "" : "s"} moved or resized`;
      const lines = [...(f.doc ? [f.doc] : []), ...f.lines, ...(f.moved ? [`(+ ${f.moved} more elements moved with them)`] : [])];
      return [head, ...lines.map((l) => `    ${l}`)].join("\n");
    })
    .join("\n");
}

module.exports = { checkScreen, formatFailures };
