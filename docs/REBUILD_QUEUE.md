# Rebuild queue

Changes that need a full `npm run build:puzzles`. Batch them: do the code/data work, tick it here, and run one
rebuild when the batch is ready (then `scripts/validate.ts`, `npm test`, commit `public/puzzles`, republish).

Pure UI or matcher changes don't belong here; they ship without a rebuild.

## Pending

- [ ] **Per-table "as of" date.** Pull each source table's own date where Wikipedia states one (caption or nearby
      text like "as of September 2026", a dated column header such as "2025 estimate", or a footnote) and store it on
      the puzzle, e.g. `source.dataAsOf: "September 2026"`. Fall back to the pull date (`source.asOf`) when the
      table states none. The UI then shows "data as of September 2026" when present, otherwise
      "as of <pull date>". Needs: an optional field in `src/game/types.ts` (coordinator), extraction in
      `scripts/build.ts` (data), display (frontend).
- [ ] **Fun facts.** Facts are written into `scripts/facts/<topic id>.json` and merged by the build; they only reach
      the game after a rebuild.

## Done

(none yet)
