// Draws the link-preview images in public/ from the app itself, so they stay in its own look (docs/UX.md 17): the
// VT323 logo with its pink and cyan fringe, and the real board of "Most populous countries" (daily #1, long past) with
// its top three typed in and the rest still hidden, over the deep-sea backdrop.
//   public/og.png                1200x630, the og:image / twitter:image of index.html
//   public/apple-touch-icon.png  180x180, the tab icon's pixel heart on the page's navy (opaque: iOS fills black)
//   public/favicon.ico           32x32, the same heart, for whatever asks /favicon.ico
// Run against a server of this checkout (a dev server or `npx vite preview`), then look at the images:
//   E2E_URL=http://localhost:<port>/ node e2e/share-image.cjs
// e2e/share.e2e.cjs checks the tags and the files' sizes.
const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { chromium, open, guess } = require("./helpers.cjs");

const PUBLIC = process.env.OUT_DIR || path.join(__dirname, "..", "public");
const LIST = "countries-population";
const FOUND = 3;

/** The tab icon from index.html: a 9x8 pixel heart, pink on the page's navy. */
function heartSvg() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const href = html.match(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)"/)?.[1];
  if (!href) throw new Error("index.html has no SVG tab icon");
  return decodeURIComponent(href);
}

/** An ICO file holding one PNG (Vista and later read PNG entries; every browser does). */
function ico(pngBytes, size) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); // reserved
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(1, 4); // one image
  head.writeUInt8(size % 256, 6);
  head.writeUInt8(size % 256, 7);
  head.writeUInt8(0, 8); // no palette
  head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); // planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(pngBytes.length, 14);
  head.writeUInt32LE(22, 18); // offset of the image
  return Buffer.concat([head, pngBytes]);
}

/** Re-encodes a screenshot at full zlib effort, without the alpha channel when it is all opaque. */
function squeeze(bytes) {
  const img = PNG.sync.read(bytes);
  let opaque = true;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) opaque = false;
  return PNG.sync.write(img, { colorType: opaque ? 2 : 6, deflateLevel: 9, filterType: -1 });
}

async function shareImage(browser) {
  const vp = { viewport: { width: 1200, height: 630 } };
  const { ctx, page } = await open(browser, vp, `#p-${LIST}`, undefined, { reducedMotion: "reduce" });
  await page.getByLabel("Your guess").waitFor();
  const puzzle = await page.evaluate(async (id) => (await fetch(`puzzles/${id}.json`)).json(), LIST);
  for (const a of puzzle.answers.slice(0, FOUND)) await guess(page, a.name);
  await page.locator(".slot.found").nth(FOUND - 1).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const board = document.querySelector("section.board").cloneNode(true);
    board.querySelector(".board-foot")?.remove();
    for (const b of board.querySelectorAll("button")) b.tabIndex = -1;
    const title = document.querySelector('[data-testid="title-card"]');
    const card = document.createElement("section");
    card.className = "panel prompt";
    card.setAttribute("data-glass", "");
    card.innerHTML = `<span class="label cyan">${title.querySelector(".label").textContent}</span><h1>${title.querySelector("h1").textContent}</h1>`;
    const art = document.createElement("div");
    art.id = "share-art";
    art.innerHTML = `
      <div class="share-brand">
        <h1 class="logo"><span>TEN</span><span>tacle</span></h1>
        <p class="caption share-caption">name the top 10.<br>five lives.<br>typos are free.</p>
      </div>
      <div class="share-board"></div>`;
    art.querySelector(".share-board").append(card, board);
    document.querySelector("main").style.visibility = "hidden";
    document.body.append(art);
    const style = document.createElement("style");
    style.textContent = `
      #share-art {
        position: fixed; inset: 0; z-index: 50;
        display: grid; grid-template-columns: 500px 600px; gap: 36px;
        align-items: center; justify-content: center;
        padding: 0 32px;
      }
      #share-art .share-brand { display: flex; flex-direction: column; gap: 26px; align-items: flex-start; }
      #share-art .logo { font-size: 124px; margin: 0; }
      #share-art .share-caption { font-size: 30px; line-height: 1.3; color: var(--label); }
      #share-art .share-board { display: flex; flex-direction: column; gap: 12px; }
      #share-art .prompt { padding: 14px 20px 16px; }
      #share-art .prompt h1 { font-size: 34px; margin-top: 4px; }
      #share-art .board .slot { padding-block: 0; }
      * { caret-color: transparent !important; }
    `;
    document.head.append(style);
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const bytes = await page.screenshot({ animations: "disabled", caret: "hide" });
  await ctx.close();
  return squeeze(bytes);
}

/**
 * The tab icon's heart, square, at `unit` pixels per art pixel (whole pixels, so its edges stay crisp), centred on the
 * page's navy gradient. The heart spans art pixels 1-8 across and 1-7 down (its centre is 4.5, 4).
 */
async function heartIcon(page, size, unit) {
  const svg = heartSvg();
  const heart = svg.match(/<path fill='([^']+)' d='([^']+)'/);
  if (!heart) throw new Error("the tab icon has no heart path");
  const side = size / unit;
  await page.setContent(`<!doctype html><html><body style="margin:0">
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${4.5 - side / 2} ${4 - side / 2} ${side} ${side}"
      shape-rendering="crispEdges" style="display:block;background:linear-gradient(#0d1e38,#050a14)">
      <path fill="${heart[1]}" d="${heart[2]}"/>
    </svg></body></html>`);
  return squeeze(await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } }));
}

async function heartIcons(browser) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 400 } });
  const page = await ctx.newPage();
  // iOS rounds the corners itself; the heart keeps clear of them.
  const touch = await heartIcon(page, 180, 18);
  const fav = await heartIcon(page, 32, 4);
  await ctx.close();
  return { touch, fav };
}

(async () => {
  const browser = await chromium.launch();
  const { touch, fav } = await heartIcons(browser);
  const og = await shareImage(browser);
  fs.writeFileSync(path.join(PUBLIC, "og.png"), og);
  fs.writeFileSync(path.join(PUBLIC, "apple-touch-icon.png"), touch);
  fs.writeFileSync(path.join(PUBLIC, "favicon.ico"), ico(fav, 32));
  await browser.close();
  console.log(`og.png ${Math.round(og.length / 1024)} KB, apple-touch-icon.png ${Math.round(touch.length / 1024)} KB, favicon.ico`);
})();
