// Usage: npx tsx scripts/inspect.ts "List of ..." [rows]
// Prints each wikitable's header and first rows, to help write topic entries.
import { fetchPage } from "./wiki";
import { splitHeader, tableGrid, wikitables } from "./table";

const [page, rowsArg] = process.argv.slice(2);
const $ = await fetchPage(page);
wikitables($).forEach((t, i) => {
  const { header, body } = splitHeader(tableGrid($, t));
  const caption = $(t).find("caption").text().trim();
  const heading = $(t).prevAll("h2, h3, div.mw-heading").first().text().trim();
  console.log(`\n[${i}] ${caption || heading} (${body.length} rows)`);
  console.log("  H: " + header.map((h, c) => `${c}:${h}`).join(" | "));
  for (const row of body.slice(0, Number(rowsArg ?? 4))) {
    console.log("    " + row.map((c) => (c?.link ? `${c.text}→${c.link}` : c?.text ?? "").slice(0, 40)).join(" | "));
  }
});
