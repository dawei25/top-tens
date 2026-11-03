import { useSound } from "./useSound";

/** Builds a crisp SVG path from a pixel map ("#" = on). */
function pixels(rows: string[]): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") d += `M${x} ${y}h1v1h-1z`;
  });
  return d;
}

const SPEAKER_ON = pixels([
  "...#...#..",
  "..##.#..#.",
  "####..#..#",
  "####..#..#",
  "####..#..#",
  "..##.#..#.",
  "...#...#..",
]);
const SPEAKER_OFF = pixels([
  "...#......",
  "..##......",
  "####.#..#.",
  "####..##..",
  "####..##..",
  "..##.#..#.",
  "...#......",
]);

/**
 * The speaker key, in every screen's header: sound on or off for the whole game (useSound), remembered on this
 * device. Turning it on is the gesture that starts audio, and answers with a soft blip.
 */
export function SoundToggle({ className = "" }: { className?: string }) {
  const [on, toggle] = useSound();
  return (
    <button
      type="button"
      className={`key key-icon sound-toggle ${on ? "on" : ""} ${className}`}
      onClick={toggle}
      aria-pressed={on}
      aria-label="Sound"
      title={on ? "Sound on" : "Sound off"}
      data-testid="sound-toggle"
    >
      <svg className="pixel-icon" viewBox="0 0 10 7" shapeRendering="crispEdges" aria-hidden="true">
        <path d={on ? SPEAKER_ON : SPEAKER_OFF} fill="currentColor" />
      </svg>
    </button>
  );
}
