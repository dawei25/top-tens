import { useEffect, useRef, useState } from "react";
import { loadService } from "../../net";
import { GOOGLE_CLIENT_ID } from "../../net/config";
import { GOOGLE_FAILED, prepareGoogle, startGoogle, type GoogleOutcome, type GoogleRequest } from "../../net/google";
// Google's own "G" on its white tile, exactly as Google ships it (Sign in with Google branding assets: Android + Web,
// Light, no text, square, @4x, shown at its 40px size). Never recolored, resized or redrawn.
import gMark from "./google-g.png";

/**
 * The Google key: our keycap, Google's G, "Continue with Google".
 *
 * With a client ID (VITE_GOOGLE_CLIENT_ID), pressing it opens Google's sign-in in a popup on this site's own
 * redirect page (src/net/google.ts), so Google's account chooser names this site; a blocked popup takes the whole tab
 * there and back instead. Each press asks with a fresh state and nonce, made ready before the press so the popup
 * opens straight from it (browsers block a popup opened after waiting). Without a client ID (preview builds), the
 * press goes through Supabase's redirect (`onSupabase`).
 */
export default function GoogleSignIn({
  disabled,
  signingIn,
  onOutcome,
  onSupabase,
}: {
  /** Another sign-in is running. */
  disabled: boolean;
  /** Supabase is trading Google's token (or, without a client ID, its redirect is starting). */
  signingIn: boolean;
  onOutcome: (o: GoogleOutcome) => void;
  onSupabase: () => void;
}) {
  const ready = useRef<GoogleRequest | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const prepare = () => {
    ready.current = null;
    const next = prepareGoogle(GOOGLE_CLIENT_ID, location.href);
    next.then(
      (r) => (ready.current = r),
      () => {},
    );
    return next;
  };
  useEffect(() => {
    if (GOOGLE_CLIENT_ID) void prepare().catch(() => {});
    // Back from Google's page with the browser's back button (the page restored as it was): the key works again.
    const shown = (e: PageTransitionEvent) => e.persisted && setLeaving(false);
    addEventListener("pageshow", shown);
    return () => removeEventListener("pageshow", shown);
  }, []);

  const go = (req: GoogleRequest) => {
    const how = startGoogle(req, (o) => {
      setWaiting(false);
      onOutcome(o);
    });
    // The next press asks afresh.
    void prepare().catch(() => {});
    if (how === "redirect") return setLeaving(true);
    setWaiting(true);
    // Supabase's client, ready for the token. Started, it also hears a sign-in finished in another window of this
    // site (a popup that had no way back here signs in on its own), and this tab signs in with it.
    loadService()
      ?.then((s) => s.start())
      .catch(() => {});
  };
  const press = () => {
    if (!GOOGLE_CLIENT_ID) return onSupabase();
    if (ready.current) return go(ready.current);
    // Pressed within a few milliseconds of the sheet opening: once it's ready (a popup may then be blocked, and the
    // tab goes to Google instead).
    prepareGoogle(GOOGLE_CLIENT_ID, location.href).then(go, () => onOutcome({ kind: "error", message: GOOGLE_FAILED }));
  };

  const label = leaving ? "Opening Google" : signingIn ? (GOOGLE_CLIENT_ID ? "Signing in" : "Opening Google") : "Continue with Google";
  return (
    <>
      <button
        type="button"
        className="key google-key"
        data-testid="sign-in-google"
        data-flow={GOOGLE_CLIENT_ID ? "google" : "supabase"}
        disabled={disabled || leaving}
        onClick={press}
      >
        <img className="google-g" src={gMark} alt="" width={40} height={40} draggable={false} />
        <span className="google-key-label">{label}</span>
      </button>
      {waiting && !signingIn && (
        <p className="sheet-note" role="status" data-testid="sign-in-google-waiting">
          finish in the google window.
        </p>
      )}
    </>
  );
}
