// Vercel Web Analytics (its <Analytics /> is in SiteAnalytics.tsx, mounted in src/main.tsx). The package alone loads
// its script on any host (a debug script from va.vercel-scripts.com in development, /_vercel/insights/script.js in any
// production build), so the game mounts it only on the live site. Its script sends one pageview per page load and none
// for hash changes (it counts a new page only when the path changes, and the game's screens are all hashes): first
// load is all marketing needs. Marketing links posts as https://toptentacle.io/?ref=<channel>, sometimes with a screen
// (#daily-<date>).
import type { BeforeSendEvent } from "@vercel/analytics/react";

const LIVE = new Set(["toptentacle.io", "www.toptentacle.io"]);

/** Where Vercel serves the game: the live domain, or a deployment's own *.vercel.app address. */
export function analyticsHost(hostname: string): boolean {
  return LIVE.has(hostname) || hostname.endsWith(".vercel.app");
}

/** Analytics runs in a production build on the live site only: never in dev, the e2e builds or a copy elsewhere. */
export function analyticsOn(): boolean {
  return import.meta.env.PROD && typeof location !== "undefined" && analyticsHost(location.hostname);
}

/** Query parameters a pageview keeps: where the visit came from. */
const KEPT = (name: string) => name === "ref" || name.startsWith("utm_");

/**
 * The address a pageview reports: the page with its ?ref= (and utm_ tags), never the screen (#hash) or anything else
 * in the query (a sign-in's code or error on its way back).
 */
export function reportedUrl(href: string): string {
  const url = new URL(href);
  const kept = new URLSearchParams([...url.searchParams].filter(([name]) => KEPT(name)));
  const query = kept.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

export const beforeSend = (event: BeforeSendEvent): BeforeSendEvent => ({ ...event, url: reportedUrl(event.url) });
