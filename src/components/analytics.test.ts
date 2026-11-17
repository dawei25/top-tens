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
  it("the page and its ?ref=, without the screen", () => {
    expect(reportedUrl("https://toptentacle.io/?ref=reddit")).toBe("https://toptentacle.io/?ref=reddit");
    expect(reportedUrl("https://toptentacle.io/?ref=reddit#daily-2026-11-17")).toBe("https://toptentacle.io/?ref=reddit");
    expect(reportedUrl("https://toptentacle.io/#fathom")).toBe("https://toptentacle.io/");
    expect(reportedUrl("https://toptentacle.io/")).toBe("https://toptentacle.io/");
  });
  it("keeps utm_ tags too, and nothing else of the query (a sign-in's code, an error)", () => {
    expect(reportedUrl("https://toptentacle.io/?utm_source=x&ref=tiktok&utm_campaign=launch")).toBe(
      "https://toptentacle.io/?utm_source=x&ref=tiktok&utm_campaign=launch",
    );
    expect(reportedUrl("https://toptentacle.io/?code=abc123&sb_flow_id=f1")).toBe("https://toptentacle.io/");
    expect(reportedUrl("https://toptentacle.io/?ref=x&error_description=bad#error=1&access_token=t")).toBe("https://toptentacle.io/?ref=x");
  });
});
