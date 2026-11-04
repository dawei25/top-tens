import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { submitFeedback } from "../../net";
import { cleanNote, MAX_NOTE, noteLength } from "../../net/feedback";
import type { RatingMode } from "../../net/ratings";

/** The counter shows from here: quiet until the note gets near the limit. */
const COUNT_FROM = MAX_NOTE - 100;

/**
 * Notes typed and not sent, per list and mode, for this page's life only (never stored): leaving the screen by
 * accident and coming back finds the note where it was. Cancel and Escape throw it away.
 */
const drafts = new Map<string, string>();

/**
 * "add a note" under "Good list?": a few words on the list for the improvement loop, before or after rating it. Only in
 * a build with a backend (RateList leaves it out otherwise: nowhere to send it). A tap opens a box in place, which
 * pushes what's below it down (a deliberate tap, not a hover); SEND (or Ctrl/Cmd+Enter) sends it with the rating as it
 * is now, and a dry line takes the key's place. Typing here is never a game shortcut: Enter adds a line, and Escape
 * closes the box instead of going Back.
 */
export function AddNote({ listId, mode, rating }: { listId: string; mode: RatingMode; rating: -1 | 1 | null }) {
  const id = `${mode}:${listId}`;
  const [open, setOpen] = useState(() => drafts.has(id));
  const [text, setText] = useState(() => drafts.get(id) ?? "");
  const [done, setDone] = useState<"sent" | "queued" | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const key = useRef<HTMLButtonElement>(null);
  const said = useRef<HTMLParagraphElement>(null);
  /** Where focus goes once the box has opened or closed (a tap opened it: the box; it closed: the key or the thanks). */
  const focusNext = useRef<"box" | "key" | "said" | null>(null);

  // A layout effect, so the focus lands inside the tap that opened the box (a phone only raises its keyboard then).
  // The whole box comes into view, SEND included: it opens at the foot of the card, often at the screen's edge.
  useLayoutEffect(() => {
    const to = focusNext.current;
    focusNext.current = null;
    if (to === "box") {
      box.current?.focus({ preventScroll: true });
      form.current?.scrollIntoView({ block: "nearest" });
    } else if (to === "key") key.current?.focus({ preventScroll: true });
    else if (to === "said") said.current?.focus({ preventScroll: true });
  }, [open, done]);

  // A phone's keyboard coming up shrinks the screen under the box: keep the box and SEND in view while typing.
  useEffect(() => {
    if (!open) return;
    const keep = () => {
      if (document.activeElement === box.current) form.current?.scrollIntoView({ block: "nearest" });
    };
    const target = window.visualViewport ?? window;
    target.addEventListener("resize", keep);
    return () => target.removeEventListener("resize", keep);
  }, [open]);

  const note = cleanNote(text);
  const n = noteLength(note);
  const canSend = n > 0 && n <= MAX_NOTE;

  const edit = (value: string) => {
    setText(value);
    if (value) drafts.set(id, value);
    else drafts.delete(id);
  };
  const close = () => {
    edit("");
    focusNext.current = "key";
    setOpen(false);
  };
  const send = () => {
    if (!canSend || !submitFeedback(listId, mode, note, rating)) return;
    edit("");
    focusNext.current = "said";
    setOpen(false);
    // Offline it waits in the outbox and goes later: say so rather than "sent".
    setDone(navigator.onLine === false ? "queued" : "sent");
  };
  const onKey = (e: KeyboardEvent) => {
    // Nothing typed here reaches the screen's own keys (Escape-is-Back and the like).
    e.stopPropagation();
    // Mid-composition (an input method for Chinese, Japanese...), Escape and Enter belong to it.
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    // Off: the result card announces itself; the counter shouldn't read out every key near the limit.
    <div className="rate-add" data-testid="note" data-open={open} aria-live="off">
      {open ? (
        <form
          ref={form}
          className="rate-add-form"
          data-testid="note-form"
          onKeyDown={onKey}
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={box}
            className="rate-add-text"
            data-testid="note-text"
            aria-label="A note on this list"
            aria-describedby={`note-hint-${mode}`}
            placeholder="what would make this list better?"
            rows={4}
            maxLength={MAX_NOTE}
            value={text}
            onChange={(e) => edit(e.target.value)}
          />
          <div className="rate-add-actions">
            <button type="submit" className="key key-pink key-sm" data-testid="note-send" disabled={!canSend}>
              Send
            </button>
            <button type="button" className="text-btn" data-testid="note-cancel" onClick={close}>
              cancel
            </button>
            <span className="rate-add-count" id={`note-hint-${mode}`} data-testid="note-count" data-over={n > MAX_NOTE} hidden={n < COUNT_FROM}>
              {n}/{MAX_NOTE}
            </span>
          </div>
        </form>
      ) : done ? (
        <p ref={said} className="rate-add-done" data-testid="note-sent" data-state={done} role="status" tabIndex={-1}>
          {done === "sent" ? "sent. thanks." : "saved. it sends when you're online."}
        </p>
      ) : (
        <button
          ref={key}
          type="button"
          className="text-btn rate-add-key"
          data-testid="note-open"
          onClick={() => {
            focusNext.current = "box";
            setOpen(true);
          }}
        >
          add a note
        </button>
      )}
    </div>
  );
}
