import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * A label that explains itself: a dotted label with a note that floats over the page, never growing the panel it
 * sits in (UX 9). It opens on a tap or click, on mouse hover and on keyboard focus; a second tap or click closes it,
 * as do Escape and a press anywhere else. Phones have no hover, so a tap always does what hover does (UX 12).
 *
 * The note keeps to the screen: it shifts left or right to stay inside it, and opens upward when there's no room
 * below. `id` names the note (aria-controls), so callers and tests can find it.
 */
export function FloatNote({ label, note, id, testId }: { label: string; note: string; id: string; testId?: string }) {
  /** Opened by a tap, click or Enter: stays until a second one, Escape or a press elsewhere. */
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = pinned || hover || focused;
  const wrap = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const close = () => {
    setPinned(false);
    setHover(false);
    setFocused(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Marked, so the screen's Escape-is-Back leaves it alone.
      e.preventDefault();
      close();
    };
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    // Capture phase, so it runs before the header's Escape-is-Back listener.
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  // Keep it on screen: shift it sideways if it would run off an edge, and open it upward if there's no room below.
  useLayoutEffect(() => {
    const el = bubble.current;
    const anchor = wrap.current?.getBoundingClientRect();
    if (!open || !el || !anchor) return;
    const pad = 8;
    el.style.setProperty("--shift", "0px");
    el.dataset.up = "false";
    const r = el.getBoundingClientRect();
    let shift = 0;
    if (r.right > innerWidth - pad) shift = innerWidth - pad - r.right;
    if (r.left + shift < pad) shift = pad - r.left;
    el.style.setProperty("--shift", `${Math.round(shift)}px`);
    el.dataset.up = String(r.bottom > innerHeight - pad && anchor.top - r.height - pad > 0);
  }, [open]);

  return (
    <span
      ref={wrap}
      className="note"
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
    >
      <button
        type="button"
        className="note-key"
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={id}
        data-testid={testId}
        // A tap or click opens it (or keeps it open, if hover or focus already did); the next one closes it.
        onClick={() => (pinned ? close() : setPinned(true))}
        // Keyboard focus opens it; a tap's or click's focus doesn't (the click does that), so it never opens and shuts
        // in one press.
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
      >
        {label}
      </button>
      <span ref={bubble} id={id} className="note-bubble" data-testid={testId && `${testId}-note`} hidden={!open}>
        {note}
      </span>
    </span>
  );
}
