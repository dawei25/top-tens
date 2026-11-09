import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resumeBlitz } from "../../game/blitz";
import { load } from "../../game/storage";
import { PRIVACY_CONTACT } from "../../net/config";
import { HowToPlay } from "../HowToPlay";
import { todayStatus } from "../today";
import { useMenuNav, type MenuNav, type MenuScreen } from "./context";
import { Pixel, type GlyphName } from "./icons";
import "./menu.css";

/**
 * A press on the backdrop or the close key this soon after opening is the second half of a double press on the menu
 * key (on a phone the close key sits right where the menu key was): it leaves the menu open.
 */
const OPEN_GRACE_MS = 500;

/** Where feedback goes: the owner's contact address (VITE_PRIVACY_CONTACT); no Feedback tile without one. */
const FEEDBACK = PRIVACY_CONTACT ? `mailto:${PRIVACY_CONTACT}?subject=${encodeURIComponent("TENtacle feedback")}` : "";

type Layer = "help";

/** Keys that scroll what has focus, or the page when that can't scroll. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/** The guess box of the game or round on screen, if one is under way. */
const guessBox = () => document.querySelector<HTMLInputElement>('main input[aria-label="Your guess"]:not(:disabled)');

/**
 * The menu key, at the left end of every screen's header (on Home, the top left corner). It opens the menu: a
 * panel of large tiles from the left over the dimmed page, every destination one press away. The rules open from it over
 * the page too. Whatever closes, focus comes back to this key, or to the guess box when a game is under way on the
 * screen (back to typing). The account isn't here: it lives on Home (owner, Nov 4), one press away from every screen.
 */
export function MenuKey() {
  const nav = useMenuNav();
  const [open, setOpen] = useState(false);
  const [layer, setLayer] = useState<Layer | null>(null);
  const key = useRef<HTMLButtonElement>(null);
  const refocus = () => (guessBox() ?? key.current)?.focus({ preventScroll: true });
  if (!nav) return null;
  return (
    <>
      <button
        ref={key}
        type="button"
        className="key key-icon menu-key"
        aria-label="Menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Menu"
        data-testid="menu-key"
        onClick={() => setOpen(true)}
      >
        <Pixel name="menu" />
      </button>
      {open &&
        createPortal(
          <MenuPanel
            nav={nav}
            onClosed={(then) => {
              setOpen(false);
              refocus();
              then?.();
            }}
            onLayer={setLayer}
          />,
          document.body,
        )}
      {layer === "help" &&
        createPortal(
          <HowToPlay
            onClose={() => {
              setLayer(null);
              refocus();
            }}
          />,
          document.body,
        )}
    </>
  );
}

interface Tile {
  /** Its test id is menu-<id>. */
  id: string;
  label: string;
  icon: GlyphName;
  tone?: "classic" | "blitz";
  /** Today's list: "new" or the result, as on Home. */
  status?: { text: string; done: boolean };
  /** Takes the whole row (Today's list). */
  wide?: boolean;
  /** The screen it opens, if it opens one: marked while that screen is on show, and then it only closes the menu. */
  screen?: MenuScreen;
  disabled?: boolean;
  /** A link instead of an action (Feedback). */
  href?: string;
  /** Runs once the menu is closed. */
  go?: () => void;
}

/**
 * The panel: a modal dialog sliding in from the right. Focus goes to the panel itself (so a second Enter on the menu
 * key presses nothing) and stays inside; Escape, the close key or a press on the dimmed page closes it. The page
 * behind never moves: nothing in it changes, and a wheel or a drag over the menu never scrolls it.
 */
function MenuPanel({ nav, onClosed, onLayer }: { nav: MenuNav; onClosed: (then?: () => void) => void; onLayer: (l: Layer) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const openedAt = useRef(0);
  const closed = useRef(false);
  const pressedBackdrop = useRef(false);

  /** Closes the menu (out of the top layer at once, so the menu key can take focus), then runs `then`. */
  const close = (then?: () => void) => {
    if (closed.current) return;
    closed.current = true;
    ref.current?.close();
    onClosed(then);
  };
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  /** Past the double-press grace (see OPEN_GRACE_MS). */
  function settled() {
    return performance.now() - openedAt.current > OPEN_GRACE_MS;
  }
  /** Whether the menu is taller than the screen (it scrolls inside itself). */
  function scrolls() {
    const b = body.current;
    return !!b && b.scrollHeight > b.clientHeight;
  }

  useEffect(() => {
    const d = ref.current;
    // No cleanup that closes it: the dialog leaves the top layer when it unmounts (and StrictMode re-runs this).
    if (!d || d.open) return;
    d.showModal();
    openedAt.current = performance.now();
    d.focus();
  }, []);

  // Escape closes the menu (and nothing else: not the screen's Escape-is-Back). Tab and Shift+Tab go round the
  // menu's own keys. Window capture, so this runs before any screen's own key handling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        latest.current();
        return;
      }
      // Scroll keys scroll the menu, if anything; never the page behind. (Space only with no key focused: on a key it
      // presses it.) A menu taller than the screen is scrolled here: with focus on the panel itself, the browser's own
      // scroll went to the page behind (a phone's menu grew past its screen with the Fathom tile, Nov 9).
      if (SCROLL_KEYS.has(e.key) && (e.key !== " " || document.activeElement === d)) {
        e.preventDefault();
        const b = body.current;
        if (b && scrolls()) {
          const page = b.clientHeight * 0.85;
          const by: Record<string, number> = { ArrowDown: 40, ArrowUp: -40, PageDown: page, PageUp: -page, " ": e.shiftKey ? -page : page };
          if (e.key === "Home") b.scrollTo({ top: 0 });
          else if (e.key === "End") b.scrollTo({ top: b.scrollHeight });
          else b.scrollBy({ top: by[e.key] });
        }
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...d.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i < 0 || i === items.length - 1 ? 0 : i + 1;
      items[next].focus();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, []);

  // The page behind never scrolls: a wheel or a drag over the dimmed page, or over a menu that has nothing to scroll,
  // goes nowhere (a menu taller than the screen scrolls inside itself, and stops at its ends). On the window: a
  // listener on the dialog doesn't cover its backdrop, which the browser then scrolls without asking.
  useEffect(() => {
    const hold = (e: Event) => {
      const b = body.current;
      if (!(b && e.target instanceof Node && b.contains(e.target) && scrolls())) e.preventDefault();
    };
    const opts = { passive: false, capture: true };
    addEventListener("wheel", hold, opts);
    addEventListener("touchmove", hold, opts);
    return () => {
      removeEventListener("wheel", hold, opts);
      removeEventListener("touchmove", hold, opts);
    };
  }, []);

  const saved = load();
  const today = todayStatus(saved, nav.entry);
  // A Blitz round under way keeps its clock while the menu is open: said at the top, where it can't be missed.
  const live = nav.blitzOnScreen ? resumeBlitz(saved, nav.blitzOnScreen) : undefined;
  const clockRuns = !!live && !live.over;
  // The one daily first, across the row (as on Home: the main thing gets the most room), then free play's three.
  const play: Tile[] = [
    {
      id: "today-list",
      label: "Today's list",
      icon: "list",
      tone: "classic",
      status: { text: today.status, done: today.done },
      screen: "today-list",
      disabled: !nav.entry,
      wide: true,
      go: nav.onDaily,
    },
    { id: "random-list", label: "Random list", icon: "dice", tone: "classic", go: nav.onRoll },
    { id: "random-blitz", label: "Random Blitz", icon: "dice", tone: "blitz", disabled: nav.blitzOpen === 0, go: nav.onBlitz },
    { id: "fathom", label: "Fathom", icon: "sonar", screen: "fathom", go: () => (location.hash = "#fathom") },
  ];
  const hash = (h: string) => () => (location.hash = h);
  const yours: Tile[] = [
    { id: "archive", label: "Archive", icon: "archive", screen: "archive", go: hash("#archive") },
    { id: "history", label: "Past runs", icon: "history", screen: "history", go: hash("#history") },
    { id: "stats", label: "Stats", icon: "stats", screen: "stats", go: hash("#stats") },
  ];
  const more: Tile[] = [
    { id: "settings", label: "Settings", icon: "settings", screen: "settings", go: hash("#settings") },
    { id: "howto", label: "How to play", icon: "help", go: () => onLayer("help") },
    ...(FEEDBACK ? [{ id: "feedback", label: "Feedback", icon: "mail", href: FEEDBACK } satisfies Tile] : []),
    { id: "privacy", label: "Privacy", icon: "lock", screen: "privacy", go: hash("#privacy") },
  ];

  const choose = (t: Tile) => {
    if (t.screen && t.screen === nav.current) return close();
    close(t.go);
  };

  const tile = (t: Tile) => {
    const current = !!t.screen && t.screen === nav.current;
    const inner = (
      <>
        <span className="menu-tile-top">
          <Pixel name={t.icon} unit={3} className={`menu-tile-icon ${t.tone ?? ""}`} />
          {t.status && (
            <span className={`key-sub menu-tile-status ${t.status.done ? "done" : t.tone}`} data-testid={`menu-${t.id}-status`}>
              {t.status.text}
            </span>
          )}
        </span>
        <span className="menu-tile-label">{t.label}</span>
      </>
    );
    if (t.href) {
      // The mail app opens; the menu closes behind it.
      return (
        <a key={t.id} className="key menu-tile" href={t.href} data-testid={`menu-${t.id}`} onClick={() => close()}>
          {inner}
        </a>
      );
    }
    return (
      <button
        key={t.id}
        type="button"
        className={`key menu-tile${t.wide ? " wide" : ""}`}
        data-testid={`menu-${t.id}`}
        aria-current={current ? "page" : undefined}
        disabled={t.disabled}
        onClick={() => choose(t)}
      >
        {inner}
      </button>
    );
  };
  const group = (id: string, label: string, tiles: Tile[]) => (
    <section className="menu-group" aria-labelledby={`menu-${id}-label`} data-testid={`menu-${id}`}>
      <h3 id={`menu-${id}-label`} className="label">
        {label}
      </h3>
      <div className="menu-grid">{tiles.map(tile)}</div>
    </section>
  );

  return (
    <dialog
      ref={ref}
      className="menu"
      data-testid="menu"
      aria-labelledby="menu-title"
      tabIndex={-1}
      // Android's back gesture and the like close the dialog themselves.
      onClose={() => close()}
      // The panel's body fills the dialog, so a press whose target is the dialog itself is on the dimmed page.
      onPointerDown={(e) => (pressedBackdrop.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedBackdrop.current && settled()) close();
      }}
    >
      <div ref={body} className="menu-body">
        <div className="menu-head">
          <div className="menu-titles">
            <p className="menu-brand">
              <span>TEN</span>
              <span>tacle</span>
            </p>
            <h2 id="menu-title" className="menu-title">
              Menu
            </h2>
          </div>
          <button
            type="button"
            className="key key-icon menu-close"
            aria-label="Close menu"
            title="Close (Esc)"
            data-testid="menu-close"
            onClick={() => settled() && close()}
          >
            <Pixel name="close" />
          </button>
        </div>
        {clockRuns && (
          <p className="menu-note" data-testid="menu-clock-note">
            <Pixel name="bolt" unit={2} className="menu-note-icon" />
            the clock keeps running.
          </p>
        )}
        {group("play", "Play", play)}
        {group("yours", "Yours", yours)}
        {group("more", "More", more)}
      </div>
    </dialog>
  );
}
