import { useEffect, useRef, useState } from "react";
import { GOOGLE_CLIENT_ID } from "../../net/config";
import { googleButton, type GoogleButton } from "../../net/google";

/** How long after a press with the page still in front we say the popup didn't open. */
const NO_WINDOW_MS = 3000;

/**
 * Google's own "Continue with Google" button (Google Identity Services), in a build with VITE_GOOGLE_CLIENT_ID. Its
 * popup opens from this site, so Google's account chooser names this site rather than the Supabase project. Google's
 * script loads when this mounts (the sign-in sheet opened). If it can't load (offline, blocked), `onUnavailable`, and
 * the sheet offers the redirect sign-in instead.
 *
 * Google tells the page nothing when its popup is closed or blocked. Closing it is the player's choice: nothing to say.
 * A press that leaves the page in front for a few seconds (no window took over) gets a hint about pop-ups.
 */
export default function GoogleSignIn({
  disabled,
  onCredential,
  onUnavailable,
}: {
  disabled: boolean;
  onCredential: (token: string, nonce: string) => void;
  onUnavailable: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [noWindow, setNoWindow] = useState(false);
  const handlers = useRef({ onCredential, onUnavailable });
  useEffect(() => {
    handlers.current = { onCredential, onUnavailable };
  }, [onCredential, onUnavailable]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let live = true;
    let button: GoogleButton | undefined;
    let watch: ReturnType<typeof setInterval> | undefined;
    // Pressed: Google's popup should take the front. If the page stays in front, it didn't open.
    const press = () => {
      clearInterval(watch);
      setNoWindow(false);
      const until = Date.now() + NO_WINDOW_MS;
      watch = setInterval(() => {
        if (!document.hasFocus() || document.visibilityState === "hidden") return clearInterval(watch);
        if (Date.now() < until) return;
        clearInterval(watch);
        if (live) setNoWindow(true);
      }, 200);
    };
    googleButton(el, GOOGLE_CLIENT_ID, {
      press,
      credential: (token, nonce) => {
        clearInterval(watch);
        setNoWindow(false);
        handlers.current.onCredential(token, nonce);
        // A next try (if this one is refused) asks with a new nonce.
        void button?.renew();
      },
    }).then(
      (b) => {
        if (!live) return;
        button = b;
        setReady(true);
      },
      () => live && handlers.current.onUnavailable(),
    );
    // Google draws its button at a fixed width: draw it again when the sheet changes width (a phone turned).
    const resized = new ResizeObserver(() => button?.redraw());
    resized.observe(el);
    return () => {
      live = false;
      clearInterval(watch);
      resized.disconnect();
    };
  }, []);

  return (
    <div className="gsi" data-testid="sign-in-google-gis" data-ready={ready} data-disabled={disabled} inert={disabled}>
      {/* Google's iframe goes in here (Google manages its content, React doesn't). */}
      <div ref={box} className="gsi-box" />
      {!ready && (
        <span className="gsi-wait" aria-hidden="true">
          loading google
        </span>
      )}
      {noWindow && (
        <p className="sheet-note" role="status" data-testid="sign-in-google-popup">
          no google window? allow pop-ups for this site, then press it again.
        </p>
      )}
    </div>
  );
}
