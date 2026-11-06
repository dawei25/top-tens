// Launch audit (Nov 6): the share text pasted into a Reddit comment as one run-on line (Markdown mode and old Reddit
// join lines that don't end in two spaces), and five hollow hearts for 0 lives left read as nothing.
import { describe, expect, it } from "vitest";
import type { BlitzState } from "../game/blitz";
import type { GameState } from "../game/state";
import type { Puzzle } from "../game/types";
import { blitzShare, dailyBlitzShare, listShare, pasteable } from "./share";

const board: Puzzle = {
  id: "t",
  title: "T",
  prompt: "Name the 10 t",
  source: { name: "Wikipedia", url: "u", asOf: "2026-11-01" },
  answers: Array.from({ length: 10 }, (_, i) => ({ rank: i + 1, name: `A${i + 1}`, aliases: [], n: 100 - i })),
  extras: [],
};
const game = (lives: number, found: number[], hints?: number[]): GameState => ({
  puzzleId: "t",
  found,
  lives,
  log: [],
  status: lives ? "won" : "lost",
  ...(hints && { hints }),
});
/** Every line but the last ends in two spaces, so a Markdown paste keeps the line breaks. */
const keepsBreaks = (text: string) => {
  const lines = text.split("\n");
  expect(lines.length).toBeGreaterThan(2);
  for (const l of lines.slice(0, -1)) expect(l, JSON.stringify(l)).toMatch(/\S {2}$/);
  expect(lines[lines.length - 1]).not.toMatch(/\s$/);
};

describe("share text", () => {
  it("ends each line in two spaces, the link line excepted", () => {
    expect(pasteable("a\nb\nc")).toBe("a  \nb  \nc");
    expect(pasteable("a  \nb")).toBe("a  \nb");
  });
  it("a list game: its lines survive a Reddit paste, and the lives left are said in words", () => {
    const lost = listShare(game(0, [1, 2, 3]), board, "https://x/#p-t", 12);
    keepsBreaks(lost);
    expect(lost).not.toMatch(/[♥♡]/);
    expect(lost.split("\n")[1]).toBe("3/10 · 0 lives left  ");
    expect(lost.startsWith("TENtacle #12: T  \n")).toBe(true);
    expect(lost.endsWith("\nhttps://x/#p-t")).toBe(true);
    expect(listShare(game(1, [1, 2], [4]), board, "u").split("\n")[1]).toBe("2/10 · 1 life left · 1 clue  ");
    expect(listShare(game(5, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), board, "u")).toContain("🟨🟦🟦🟦🟦🟦🟦🟦🟦🟦  \n");
  });
  it("a Blitz round: its lines survive a Reddit paste", () => {
    const round: BlitzState = { puzzleId: "t", startedAt: 1, endedAt: 90_001, hits: [{ name: "A1", rank: 1, n: 100, points: 100 }] };
    keepsBreaks(blitzShare(round, board, "u"));
    keepsBreaks(dailyBlitzShare(round, board, "u", 7));
    expect(dailyBlitzShare(round, board, "u", 7).startsWith("TENtacle Blitz #7: T  \n100 pts · 1 answer in 90s  \n")).toBe(true);
  });
});
