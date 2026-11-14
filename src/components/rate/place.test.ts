// Where the reasons after a thumbs down float (coordinator's review, Nov 14: on Fathom's first question they floated up
// over the question being rated and the Share key). A list's open above its row; a question's below, and above only
// without room below, then above the whole question.
import { describe, expect, it } from "vitest";
import { placeReasons } from "./place";

describe("where the reasons float", () => {
  it("over a list's results: above the row, below only when the screen's top would cut them off", () => {
    expect(placeReasons({ prefer: "above", rowTop: 600, rowBottom: 646, height: 150, limit: 844, ceiling: 0 })).toEqual({ down: false, up: 6 });
    expect(placeReasons({ prefer: "above", rowTop: 100, rowBottom: 146, height: 150, limit: 844, ceiling: 0 }).down).toBe(true);
    // No room either way: above, as before.
    expect(placeReasons({ prefer: "above", rowTop: 100, rowBottom: 146, height: 150, limit: 200, ceiling: 0 }).down).toBe(false);
  });

  it("under a Fathom question: below, over the rows after it, while the page has room", () => {
    // The first question: nine rows below it.
    expect(placeReasons({ prefer: "below", rowTop: 900, rowBottom: 980, height: 200, limit: 2600, ceiling: 0, anchorTop: 800 })).toEqual({ down: true, up: 106 });
  });

  it("near the page's end: above, clear of the question it rates (its row's top)", () => {
    // The last question: the page ends 40px under its rating row.
    const last = placeReasons({ prefer: "below", rowTop: 2480, rowBottom: 2560, height: 200, limit: 2600, ceiling: 0, anchorTop: 2380 });
    expect(last.down).toBe(false);
    // Their bottom 6px above the question's top: 100px of question plus the gap over the rating row.
    expect(last.up).toBe(106);
    expect(2480 - last.up).toBeLessThanOrEqual(2380);
  });

  it("goes below anyway when there is no room above the question either", () => {
    expect(placeReasons({ prefer: "below", rowTop: 150, rowBottom: 230, height: 200, limit: 260, ceiling: 0, anchorTop: 100 }).down).toBe(true);
  });
});
