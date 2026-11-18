// Vercel Web Analytics (SiteAnalytics.tsx): where it loads, and what a pageview reports. Marketing links posts as
// https://toptentacle.io/?ref=<channel>, sometimes with a screen (#daily-2026-11-17): the pageview keeps the channel.
import { describe, expect, it } from "vitest";
import { analyticsHost, reportedUrl } from "./analytics";

describe("where analytics loads", () => {
  it("on the live site and Vercel's own deployment URLs", () => {
    expect(analyticsHost("toptentacle.io")).toBe(true);
    expect(analyticsHost("www.toptentacle.io")).toBe(true);
    expect(analyticsHost("toptentacle.vercel.app")).toBe(true);
    expect(analyticsHost("top-tens-git-main-team.vercel.app")).toBe(true);
  });
  it("nowhere else: local dev, the e2e builds, look-alike hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "192.168.1.20", "toptentacle.io.example.com", "vercel.app", "eviltoptentacle.io"]) {
      expect(analyticsHost(host), host).toBe(false);
    }
  });
});

describe("what a pageview reports", () => {
  it("a ?ref= as its own path, so the dashboard shows one row per post; never the screen", () => {
    expect(reportedUrl("https://toptentacle.io/?ref=reddit")).toBe("https://toptentacle.io/ref/reddit");
    expect(reportedUrl("https://toptentacle.io/?ref=rWebGames#daily-2026-11-17")).toBe("https://toptentacle.io/ref/rwebgames");
    expect(reportedUrl("https://toptentacle.io/#fathom")).toBe("https://toptentacle.io/");
    expect(reportedUrl("https://toptentacle.io/")).toBe("https://toptentacle.io/");
  });
  it("drops everything else in the query (utm tags, a sign-in's code, an error) and odd characters in the ref", () => {
    expect(reportedUrl("https://toptentacle.io/?utm_source=x&ref=tiktok&utm_campaign=launch")).toBe("https://toptentacle.io/ref/tiktok");
    expect(reportedUrl("https://toptentacle.io/?utm_source=x")).toBe("https://toptentacle.io/");
    expect(reportedUrl("https://toptentacle.io/?code=abc123&sb_flow_id=f1")).toBe("https://toptentacle.io/");
    expect(reportedUrl("https://toptentacle.io/?ref=x&error_description=bad#error=1&access_token=t")).toBe("https://toptentacle.io/ref/x");
    expect(reportedUrl("https://toptentacle.io/?ref=<script>")).toBe("https://toptentacle.io/ref/script");
    expect(reportedUrl("https://toptentacle.io/?ref=%20%20")).toBe("https://toptentacle.io/");
  });
});
