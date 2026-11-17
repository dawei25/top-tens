import { Analytics } from "@vercel/analytics/react";
import { useEffect, useState } from "react";
import { analyticsOn, beforeSend } from "./analytics";

/** How long after the page's load event analytics waits for a screen before it counts the visit anyway. */
const SCREEN_WAIT_MS = 10_000;

/**
 * Vercel Web Analytics, on the live site only (analytics.ts), once the page has loaded and a screen is drawn (every
 * screen is a <main>; the Loading placeholder isn't): the game comes first, and the script (async, in the head) never
 * holds up a paint.
 */
export default function SiteAnalytics() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!analyticsOn()) return;
    const root = document.getElementById("root")!;
    let timer: number | undefined;
    const observer = new MutationObserver(() => check());
    const stop = () => {
      observer.disconnect();
      removeEventListener("load", onLoad);
      clearTimeout(timer);
    };
    const go = () => {
      stop();
      setReady(true);
    };
    const check = () => document.readyState === "complete" && root.querySelector("main") && go();
    const onLoad = () => {
      timer = window.setTimeout(go, SCREEN_WAIT_MS);
      check();
    };
    observer.observe(root, { childList: true, subtree: true });
    if (document.readyState === "complete") onLoad();
    else addEventListener("load", onLoad);
    return stop;
  }, []);
  return ready ? <Analytics beforeSend={beforeSend} /> : null;
}
