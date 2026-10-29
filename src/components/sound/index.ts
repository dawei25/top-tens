/**
 * The sound layer: chiptune cues for play events, synthesized with Web Audio. Off by default; the player turns it
 * on with the speaker key (SoundToggle). Imported once from main.tsx.
 *
 * Browsers only let audio start from a user gesture, so the AudioContext is created (or resumed, for iOS Safari)
 * in a capture listener on the first pointer or key press after sound is on. Play events come from those same
 * presses (Enter submits a guess), so the context is ready by the time a cue plays. A cue with no context yet is
 * skipped: creating one outside a gesture would only start suspended.
 */
import { onPlay } from "../../game/events";
import { audio, existingAudio, suspendAudio } from "./engine";
import { react, render, START } from "./cues";
import { soundPref } from "./pref";

function init() {
  if (typeof window === "undefined") return;
  const wake = () => {
    if (soundPref.get()) audio();
  };
  for (const type of ["pointerdown", "keydown", "touchend"]) addEventListener(type, wake, { capture: true, passive: true });

  let state = START;
  onPlay((e) => {
    // The state follows every event (Blitz momentum, the fanfare flag), heard or not.
    const [next, cues] = react(e, state, performance.now());
    state = next;
    if (!soundPref.get() || cues.length === 0) return;
    const c = existingAudio();
    if (!c) return;
    if (c.state !== "running") void c.resume().catch(() => {});
    for (const cue of cues) render(cue);
  });

  soundPref.subscribe(() => {
    if (!soundPref.get()) suspendAudio();
  });
}

init();
