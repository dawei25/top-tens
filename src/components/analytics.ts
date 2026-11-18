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

/** A ref as the dashboard shows it: lowercase letters, digits, - and _, at most 40 of them. */
function cleanRef(ref: string | null): string {
  return (ref ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
}

/**
 * The address a pageview reports. Vercel's Hobby dashboard groups pages by path and drops the query (marketing, Nov
 * 18), so a post's ?ref=<channel> is reported as its own path, /ref/<channel>: one row per post. Without a ref, the
 * page alone. Never the screen (#hash) or anything else in the query (a sign-in's code or error on its way back).
 */
export function reportedUrl(href: string): string {
  const url = new URL(href);
  const ref = cleanRef(url.searchParams.get("ref"));
  return ref ? `${url.origin}/ref/${ref}` : `${url.origin}${url.pathname}`;
}

export const beforeSend = (event: BeforeSendEvent): BeforeSendEvent => ({ ...event, url: reportedUrl(event.url) });
