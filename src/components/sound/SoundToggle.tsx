import { useSyncExternalStore } from "react";
import { audio } from "./engine";
import { renderOn } from "./cues";
import { soundPref } from "./pref";

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
 * The speaker key: sound on or off for the whole game, remembered on this device. Turning it on is the gesture
 * that starts audio, and answers with a soft blip.
 */
export function SoundToggle({ className = "" }: { className?: string }) {
  const on = useSyncExternalStore(soundPref.subscribe, soundPref.get, () => false);
  const toggle = () => {
    const next = !on;
    soundPref.set(next);
    if (next && audio()) renderOn();
  };
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
