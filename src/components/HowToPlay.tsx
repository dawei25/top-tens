import { useEffect, useRef } from "react";
import { load, save } from "../game/storage";
import { reducedMotion } from "./pixel";

export function markHelpSeen() {
  const s = load();
  if (!s.seenHelp) save({ ...s, seenHelp: true });
}

/** Inline rules panel, open on the first visit. */
export function HowToPlay({ onClose, scroll }: { onClose: () => void; scroll?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (scroll) ref.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [scroll]);
  const close = () => {
    markHelpSeen();
    onClose();
  };
  return (
    <section ref={ref} className="panel howto" aria-labelledby="howto-title">
      <div className="panel-head">
        <h2 id="howto-title" className="label">
          How to play
        </h2>
        <button className="key key-sm" onClick={close}>
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
            <b className="gold">Typos are free.</b> A close spelling gets corrected in the box; press Enter again to
            guess it.
          </span>
        </li>
        <li>
          <span className="rule-n">4</span>
          <span>Anything that isn't a recognized answer for the list costs nothing.</span>
        </li>
        <li>
          <span className="rule-n">5</span>
          <span>
            Stuck? Tap an empty row to see its <b className="gold">first letter</b> for a life. Not on your last one.
          </span>
        </li>
      </ol>
    </section>
  );
}
