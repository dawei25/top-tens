// Ink shows on the very frame it is squirted. The cloud's blobs come out over a moment (each waits a random delay, up to
// an eighth of a second for a puff), and the first frame drew none of them when every delay came out long: the browser
// suite's check that the ink is there as the squid darts off failed once in a loaded run (Nov 14). The cloud's core
// now comes out at once, whatever the dice say.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Fx } from "./fx";

/** A stand-in 2D context that counts the pixels filled in each colour (fx draws whole-pixel rects only). */
function fakeCtx() {
  const filled: Record<string, number> = {};
  const ctx = {
    fillStyle: "" as unknown,
    globalAlpha: 1,
    fillRect(_x: number, _y: number, w: number, h: number) {
      const key = String(ctx.fillStyle);
      filled[key] = (filled[key] ?? 0) + w * h;
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, filled };
}

const INK = ["#1a0f36", "#2a1650", "#0d0720"];
const inkPixels = (filled: Record<string, number>) => INK.reduce((n, c) => n + (filled[c] ?? 0), 0);

afterEach(() => vi.restoreAllMocks());

describe("ink shows on the frame it is squirted", () => {
  for (const dice of [0.999, 0.5, 0.001]) {
    for (const [what, size, big, n] of [
      ["the tap trick's puff", 18, false, 7],
      ["a lost life's cloud", 45, false, undefined],
      ["the last life's cloud", 112, true, undefined],
    ] as const) {
      it(`${what}, every random draw ${dice}`, () => {
        vi.spyOn(Math, "random").mockReturnValue(dice);
        const fx = new Fx();
        fx.ink(100, 100, size, big, n);
        // The frame it comes out on: one 30 fps step.
        fx.step(1 / 30);
        const { ctx, filled } = fakeCtx();
        fx.drawFront(ctx);
        expect(inkPixels(filled), "no ink drawn on the first frame").toBeGreaterThan(0);
      });
    }
  }
});
