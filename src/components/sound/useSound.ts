import { useSyncExternalStore } from "react";
import { audio } from "./engine";
import { renderOn } from "./cues";
import { soundPref } from "./pref";

/**
 * Sound on or off for the whole game, remembered on this device. Turning it on is the gesture that starts audio, and
 * answers with a soft blip. The header's speaker key and the switch in Settings share it.
 */
export function useSound(): [on: boolean, toggle: () => void] {
  const on = useSyncExternalStore(soundPref.subscribe, soundPref.get, () => false);
  const toggle = () => {
    const next = !on;
    soundPref.set(next);
    if (next && audio()) renderOn();
  };
  return [on, toggle];
}
