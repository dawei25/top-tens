import { useEffect, useRef } from "react";
import { BLITZ_SECONDS } from "../game/blitz";
import { load, save } from "../game/storage";
import { ClueIcon } from "./pixel";

function markHelpSeen() {
  const s = load();
  if (!s.seenHelp) save({ ...s, seenHelp: true });
}

/** A press on the backdrop this soon after opening is the second half of a double press: it leaves the rules open. */
const OPEN_GRACE_MS = 600;

/**
 * The rules, floating over Home as a modal dialog (closed until asked for, even on a first visit). Nothing behind it
 * moves, and nothing behind it takes a press while it's open, so a double press on the key lands on the rules. Focus
 * goes to the dialog itself (a second Enter presses nothing); Got it, Escape or a press outside closes it.
 */
export function HowToPlay({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const openedAt = useRef(0);
  useEffect(() => {
    const d = ref.current;
    // No cleanup that closes it: the dialog leaves the top layer when it unmounts (and StrictMode re-runs this).
    if (!d || d.open) return;
    d.showModal();
    openedAt.current = performance.now();
    d.focus();
  }, []);
  const close = () => ref.current?.close();
  return (
    <dialog
      ref={ref}
      className="panel howto"
      data-testid="howto"
      aria-labelledby="howto-title"
      tabIndex={-1}
      // Every way out (Got it, Escape, the backdrop) ends here.
      onClose={() => {
        markHelpSeen();
        onClose();
      }}
      // The dialog box is all padding-free content, so a click whose target is the dialog itself hit the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget && performance.now() - openedAt.current > OPEN_GRACE_MS) close();
      }}
    >
      <div className="howto-body">
        <div className="panel-head">
          <h2 id="howto-title" className="label">
            How to play
          </h2>
          <button type="button" className="key key-sm" data-testid="howto-close" onClick={close}>
            Got it
          </button>
        </div>
        <ol className="rules">
          <li>
            <span className="rule-n">1</span>
            <span>
              Name everything in the <b>top 10</b> of the list. Order doesn't matter.
            </span>
          </li>
          <li>
            <span className="rule-n">2</span>
            <span>
              You have <b className="pink">5 lives</b>. A real answer that isn't in the top 10 costs one, and you'll see
              where it ranks.
            </span>
          </li>
          <li>
            <span className="rule-n">3</span>
            <span>
              <b className="gold">Typos are free.</b> A close spelling gets corrected in the box; guess again to
              confirm.
            </span>
          </li>
          <li>
            <span className="rule-n">4</span>
            <span>Anything that isn't a recognized answer for the list costs nothing.</span>
          </li>
          <li>
            <span className="rule-n">5</span>
            <span>
              Stuck? Tap the{" "}
              <span className="clue clue-inline" role="img" aria-label="magnifying glass">
                <ClueIcon />
              </span>{" "}
              on an empty row to see its <b className="gold">first letter</b> for a life, and again for the next. Not on
              your last one.
            </span>
          </li>
          <li data-testid="howto-blitz">
            <span className="rule-n">6</span>
            <span>
              <b className="gold">Blitz:</b> {BLITZ_SECONDS} seconds, no lives. Name as many as you can; the higher up
              the list, the more points.
            </span>
          </li>
        </ol>
      </div>
    </dialog>
  );
}
