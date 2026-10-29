import { load, save } from "../game/storage";

export function HowToPlay({ onClose }: { onClose: () => void }) {
  const close = () => {
    const s = load();
    save({ ...s, seenHelp: true });
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" role="dialog" aria-label="How to play" onClick={(e) => e.stopPropagation()}>
        <h2>How to play</h2>
        <ul className="rules">
          <li>
            Name everything in the <b>top 10</b> of the list. Order doesn't matter.
          </li>
          <li>
            You have <b>5 lives</b>. A wrong answer costs one.
          </li>
          <li>
            Real answers ranked <b>#11 or lower</b> also cost a life, but you'll see where they rank.
          </li>
          <li>
            <b>Typos are free.</b> Close spellings count, and anything unclear asks you to check instead of
            taking a life.
          </li>
        </ul>
        <button className="btn btn-primary" onClick={close}>
          Let's go
        </button>
      </div>
    </div>
  );
}
