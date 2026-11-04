import { useEffect, useRef, type ReactNode } from "react";
import "./account.css";

/**
 * A sheet over the screen (the sign-in sheet, your account): from the bottom edge on a phone, centred on wider
 * screens. Escape, its close key or a press outside closes it (Escape before any screen's Escape-is-Back); Tab stays
 * inside while it's open. Focus goes to its first control (`focus: "first"`, skipping the close key), or to the sheet
 * itself (`focus: "sheet"`: then a second press of the key that opened it presses nothing inside).
 */
export function Sheet({
  labelledBy,
  testId,
  onClose,
  focus = "first",
  children,
}: {
  labelledBy: string;
  /** The sheet's test id (`<name>-sheet`); its backdrop's is `<name>-backdrop`. */
  testId: string;
  onClose: () => void;
  focus?: "first" | "sheet";
  children: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  /** Where focus goes on opening (read once). */
  const initial = useRef(focus);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const el = sheet.current;
    if (initial.current === "sheet") el?.focus();
    else el?.querySelector<HTMLElement>("input, button:not([data-close])")?.focus();
    const onKey = (e: KeyboardEvent) => {
      // A field with an Escape of its own inside (data-escape="local": the rename box cancels the rename) keeps it.
      if (e.key === "Escape" && (e.target as Element | null)?.closest?.('[data-escape="local"]')) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>("button:not(:disabled), input, a[href]")];
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // Once, on opening.
  }, []);

  return (
    <div
      className="sheet-backdrop"
      data-testid={`${testId.replace(/-sheet$/, "")}-backdrop`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={sheet} className="panel sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} data-testid={testId} data-glass>
        {children}
      </div>
    </div>
  );
}
