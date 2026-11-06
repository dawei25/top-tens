// A link to the game shows a preview card (Reddit, iMessage, Slack, Discord, X): the built index.html carries the Open
// Graph and Twitter tags with absolute URLs, and every image they and the icon links name is served at its size: the
// 1200x630 share image (small enough for the crawlers, about 300 KB at most), the 180x180 apple-touch-icon, and a
// favicon that also answers /favicon.ico (what crawlers and older browsers ask for). Launch audit, Nov 6: a Reddit link
// post showed no thumbnail; the tags were missing and /og.png and /apple-touch-icon.png were 404s.
// The images are drawn by e2e/share-image.cjs from the app's own font, colours and board.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");

const URL = process.env.E2E_URL || "http://localhost:5101/";
const SITE = "https://toptentacle.vercel.app/";

/** The content of every <meta> in the page, by its property or name. */
function metas(html) {
  const out = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/g)) {
    const key = tag.match(/\b(?:property|name)="([^"]+)"/)?.[1];
    const content = tag.match(/\bcontent="([^"]*)"/)?.[1];
    if (key && content !== undefined) out[key] = content;
  }
  return out;
}

/** Every <link> in the page: rel, href, sizes, type. */
function links(html) {
  return [...html.matchAll(/<link\b[^>]*>/g)].map(([tag]) => {
    const attr = (a) => tag.match(new RegExp(`\\b${a}="([^"]*)"`))?.[1];
    return { rel: attr("rel"), href: attr("href"), sizes: attr("sizes"), type: attr("type") };
  });
}

/** A file from the local build, by its path on the live site (absolute URLs are read from the build at that path). */
async function served(href) {
  const path = new globalThis.URL(href, SITE).pathname;
  const res = await fetch(new globalThis.URL(path.replace(/^\//, ""), URL));
  assert.equal(res.status, 200, `${path} is served`);
  return { path, type: res.headers.get("content-type") ?? "", body: Buffer.from(await res.arrayBuffer()) };
}

const png = (file) => {
  assert.match(file.type, /image\/png/, `${file.path} is a PNG`);
  return PNG.sync.read(file.body);
};

test("the built page carries the share card's tags, with absolute URLs", async () => {
  const html = await (await fetch(URL)).text();
  const m = metas(html);
  assert.equal(m["og:title"], "TENtacle");
  assert.equal(m["og:type"], "website");
  assert.equal(m["og:url"], SITE);
  assert.ok(m["og:description"], "og:description");
  assert.equal(m["og:description"], m.description, "the share card says what the page's description says");
  assert.match(m["og:image"] ?? "", /^https:\/\/toptentacle\.vercel\.app\/[\w.-]+\.png$/, "og:image is an absolute URL");
  assert.equal(m["og:image:width"], "1200");
  assert.equal(m["og:image:height"], "630");
  assert.ok(m["og:image:alt"], "og:image:alt");
  assert.equal(m["twitter:card"], "summary_large_image");
  assert.equal(m["twitter:image"], m["og:image"]);
  assert.ok(links(html).some((l) => l.rel === "canonical" && l.href === SITE), "canonical link");
});

test("the share image is 1200x630 and small; the apple-touch-icon is 180x180; the favicon answers", async () => {
  const html = await (await fetch(URL)).text();
  const og = await served(metas(html)["og:image"]);
  const image = png(og);
  assert.deepEqual([image.width, image.height], [1200, 630], "share image size");
  assert.ok(og.body.length <= 300 * 1024, `share image is ${Math.round(og.body.length / 1024)} KB (at most 300)`);

  const touch = links(html).find((l) => l.rel === "apple-touch-icon");
  assert.ok(touch, "apple-touch-icon link");
  const icon = png(await served(touch.href));
  assert.deepEqual([icon.width, icon.height], [180, 180], "apple-touch-icon size");
  // iOS draws a transparent icon on black: the icon is opaque.
  for (let i = 3; i < icon.data.length; i += 4) assert.equal(icon.data[i], 255, "apple-touch-icon is opaque");

  // The tab icon (an inline SVG), and a file for everything that only asks /favicon.ico.
  const icons = links(html).filter((l) => l.rel === "icon");
  assert.ok(icons.some((l) => l.type === "image/svg+xml" && l.href.startsWith("data:image/svg+xml,")), "the SVG tab icon");
  const ico = await served("/favicon.ico");
  assert.ok(ico.body.length > 0 && ico.body.readUInt16LE(2) === 1, "/favicon.ico is an icon file");
  assert.ok(icons.some((l) => l.href.replace(/^\.?\//, "") === "favicon.ico"), "a link to /favicon.ico");
});
