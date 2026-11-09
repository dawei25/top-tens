import { useEffect, useState } from "react";
import { clearFathomGame } from "../game/fathom-history";
import { recentPlays } from "../game/history";
import { load, save, type Saved } from "../game/storage";
import { noteReset, useAccount } from "../net";
import { ScreenHead, SwapLabel } from "./pixel";
import { useSound } from "./sound/useSound";
import "./settings.css";

interface Props {
  onBack: () => void;
  onHome: () => void;
}

/** Whether there is anything to reset: a game, a daily, a Blitz round (finished or under way). */
function hasProgress(saved: Saved): boolean {
  return (
    recentPlays(saved, 1).length > 0 ||
    Object.keys(saved.games).length > 0 ||
    Object.keys(saved.daily).length > 0 ||
    Object.values(saved.blitzRuns ?? {}).some((runs) => runs.length > 0) ||
    Object.keys(saved.blitzDaily ?? {}).length > 0 ||
    Object.keys(saved.blitzLive ?? {}).length > 0 ||
    (saved.fathom?.recent?.length ?? 0) > 0
  );
}

/**
 * Settings (#settings, from the menu): sound on or off (the header's speaker key does the same), and reset all
 * progress, with the inline confirm it had on Home: the first press asks (SURE?) for 3 s, the second clears every
 * game but the rules' seen flag.
 */
export function Settings({ onBack, onHome }: Props) {
  const [sound, toggleSound] = useSound();
  const account = useAccount();
  const [confirm, setConfirm] = useState(false);
  const [cleared, setCleared] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);
  const progress = hasProgress(load());
  const reset = () => {
    if (!confirm) return setConfirm(true);
    setConfirm(false);
    save({ games: {}, daily: {}, seenHelp: load().seenHelp });
    // Fathom's game on screen goes too (its finished games and draws were in the save).
    clearFathomGame();
    // Signed in, the reset reaches the account and every device instead of syncing back.
    noteReset();
    setCleared(true);
  };
  const signedIn = account.status === "in";

  return (
    <main className="screen archive settings" data-testid="settings">
      <ScreenHead onBack={onBack} onHome={onHome}>
        <span className="label mode">Settings</span>
      </ScreenHead>

      <section data-glass className="panel prompt">
        <h1>Settings</h1>
        <p className="caption">kept in this browser.</p>
      </section>

      <section data-glass className="panel settings-part" aria-labelledby="set-sound">
        <div className="setting-text">
          <h2 id="set-sound" className="label cyan">
            Sound
          </h2>
          <p className="caption">a note for each answer found. off until you turn it on.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={sound}
          aria-labelledby="set-sound"
          className={`key key-sm setting-switch ${sound ? "on" : ""}`}
          data-testid="settings-sound"
          onClick={toggleSound}
        >
          <span className="switch-light" aria-hidden="true" />
          {/* Both words laid out in one spot, so the key keeps its width; the switch's state is aria-checked. */}
          <span aria-hidden="true">
            <SwapLabel off="Off" on="On" active={sound} />
          </span>
        </button>
      </section>

      <section data-glass className="panel settings-part" aria-labelledby="set-progress">
        <div className="setting-text">
          <h2 id="set-progress" className="label cyan">
            Progress
          </h2>
          <p className="caption" role="status" data-testid="reset-status">
            {cleared && !progress
              ? "all progress cleared."
              : progress
                ? signedIn
                  ? "clears every game, here and in your account."
                  : "clears every game, streak and best in this browser."
                : "nothing to reset yet."}
          </p>
        </div>
        {/* Both words are always laid out, one hidden, so the key keeps its width while it asks (a second press lands
            on it). */}
        <button
          type="button"
          className={`key key-sm ${confirm ? "key-danger" : ""}`}
          data-testid="reset-all"
          data-armed={confirm || undefined}
          disabled={!progress}
          onClick={reset}
          onBlur={() => setConfirm(false)}
        >
          <SwapLabel off="Reset all progress" on="Sure?" active={confirm} />
        </button>
      </section>
    </main>
  );
}
