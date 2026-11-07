// Shared by the Fathom specs (fathom.e2e.cjs, fathom-name.e2e.cjs).

/**
 * Every visible control's reach (e2e/touch.e2e.cjs has the same check for the other screens): the points 22px above
 * and below its middle (and beside it, if it's narrower than 44px) must press it, unless another control is there.
 */
const shortReach = (page) =>
  page.evaluate(() => {
    const CONTROL = 'a[href], button, input, [role="button"], [role="switch"]';
    const out = [];
    for (const el of document.querySelectorAll(`main ${CONTROL.split(", ").join(", main ")}`)) {
      if (el.disabled || !el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true, opacityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.top < 30 || r.bottom > innerHeight - 30 || r.left < 0 || r.right > innerWidth) continue;
      // A link inside a sentence is as tall as its line (WCAG 2.5.8 leaves those out).
      if (el.matches("a") && getComputedStyle(el).display === "inline") continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const sideways = r.width < 44 && !(innerWidth < 360 && el.closest(".game-head"));
      const spots = [[cx, cy - 21.5], [cx, cy + 21.5], ...(sideways ? [[cx - 21.5, cy], [cx + 21.5, cy]] : [])];
      for (const [x, y] of spots) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || el.contains(hit) || hit.closest(CONTROL)) continue;
        // The field's box is the input's own reach (a tap on it focuses the input).
        if (el.matches("input") && hit.closest("label")?.contains(el)) continue;
        out.push(`${el.tagName.toLowerCase()} ${el.dataset.testid ?? el.getAttribute("aria-label") ?? ""} ${Math.round(r.width)}x${Math.round(r.height)}: misses ${Math.round(x - cx)},${Math.round(y - cy)}`);
        break;
      }
    }
    return out;
  });

/** How many lines an element's text takes, and whether it is cut (wider than its box). */
const textLines = (locator) =>
  locator.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const tops = [...r.getClientRects()].filter((b) => b.width > 0).map((b) => Math.round(b.top));
    return { lines: new Set(tops).size, cut: el.scrollWidth > el.clientWidth + 0.5, text: el.textContent, tone: el.dataset.tone };
  });

module.exports = { shortReach, textLines };
