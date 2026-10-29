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
            You have <b>5 lives</b>. A real answer that isn't in the top 10 costs one, and you'll see where it
            ranks.
          </li>
          <li>
            <b>Typos are free.</b> Close spellings count, and if a guess could be two things you pick which.
          </li>
          <li>
            Anything that isn't a recognized answer for the list costs nothing.
          </li>
        </ul>
        <button className="btn btn-primary" onClick={close}>
          Let's go
        </button>
      </div>
    </div>
  );
}
