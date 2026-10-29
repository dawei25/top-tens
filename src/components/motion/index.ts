/**
 * The motion layer: arcade-style effects on top of the UI, in CSS first (src/motion.css).
 * Imported once from main.tsx, after index.css, so its rules win ties.
 *
 * Two page-level jobs live here:
 * - Boot: the home title powers on like a CRT once per page load. <html data-motion-boot> arms it; the first time
 *   the title's power-on ends (or is cut short by leaving home), the flag is dropped for the rest of the visit.
 * - Phase lock: every infinite arcade blink (animation names starting "motion-blink") is pinned to the wall-clock
 *   second, so the countdown's colons and the ENTER cap blink together, like one cabinet timer.
 */
import "../../motion.css";

const reduce = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function init() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!reduce()) root.dataset.motionBoot = "";

  const bootDone = (e: AnimationEvent) => {
    if (e.animationName !== "motion-crt-sweep") return;
    delete root.dataset.motionBoot;
    document.removeEventListener("animationend", bootDone);
    document.removeEventListener("animationcancel", bootDone);
  };
  document.addEventListener("animationend", bootDone);
  document.addEventListener("animationcancel", bootDone);

  document.addEventListener(
    "animationstart",
    (e) => {
      if (!e.animationName.startsWith("motion-blink") || reduce()) return;
      const el = e.target;
      if (!(el instanceof Element) || typeof el.getAnimations !== "function") return;
      // Timeline time t is wall-clock performance.timeOrigin + t: start each cycle on a whole second.
      const start = -(performance.timeOrigin % 1000);
      for (const a of el.getAnimations()) {
        if (a instanceof CSSAnimation && a.animationName === e.animationName) a.startTime = start;
      }
    },
    true,
  );
}

init();
