import { useEffect, useRef, useState } from "react";
import { loadService, useAccount } from "../../net";
import type { GoogleOutcome } from "../../net/google";
import { setAccount } from "../../net/store";
import GoogleSignIn from "./GoogleSignIn";
import { WALL_LINE, WALL_TITLE } from "./labels";
import { Sheet } from "./Sheet";

type Service = NonNullable<Awaited<ReturnType<typeof loadService>>>;

export interface WallProps {
  /** Close it, leaving the player where they were (Escape, the close key, a press outside). */
  onClose: () => void;
  /** Signed in while it was open: the game the player asked for starts. */
  onSignedIn: () => void;
  /** The Google key was pressed: the sign-in may leave the page (and come back to the game asked for). */
  onGoogle?: () => void;
  /** Go to a screen (today's list, Home, the privacy page): the wall is done. */
  onGo: (hash: string) => void;
  /** The quiet way out: today's list while it waits, else Home (none on Home itself once today's list is played). */
  alt?: { go: "today" | "home"; label: string; hash: string } | null;
}

/**
 * The free-play wall (owner, Nov 14: "after a user plays more than once in free play, they have to sign in with google
 * to continue playing -> encourages user signups!"): the sheet a signed-out player meets when a free-play game past the
 * free ones (src/game/free-games.ts) would start. The sign-in sheet's look and its Google key (./GoogleSignIn), a plain
 * heading, one dry line, and a quiet key to today's list (never walled), or Home once it's played. Signing in starts the
 * game the player asked for; closing it leaves them where they were. Nothing in the save changes: signing in syncs it
 * as it always does (the device's games go to the account).
 *
 * Focus goes to the Google key (no keyboard pops up on a phone) and comes back to whatever opened the wall.
 */
export default function FreePlayWall({ onClose, onSignedIn, onGoogle, onGo, alt }: WallProps) {
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opener] = useState(() => document.activeElement);
  const signedIn = useRef(onSignedIn);
  useEffect(() => {
    signedIn.current = onSignedIn;
  }, [onSignedIn]);

  // Signed in (here, or in another tab of this site): the game asked for starts.
  useEffect(() => {
    if (account.status === "in") signedIn.current();
  }, [account.status]);

  // Whatever closes it, focus goes back to the key that opened it (if it's still on the screen).
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        if (opener instanceof HTMLElement && opener.isConnected && document.activeElement === document.body) opener.focus({ preventScroll: true });
      });
    },
    [opener],
  );

  const close = () => {
    // A sign-in that came back and didn't finish was said here: seen.
    if (account.notice) setAccount({ notice: undefined });
    onClose();
  };

  const run = async (fn: (s: Service) => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setAccount({ notice: undefined });
    try {
      const svc = await loadService();
      if (!svc) return;
      svc.start();
      const err = await fn(svc);
      if (err) setError(err);
    } catch {
      setError("couldn't reach the server. check your connection.");
    } finally {
      setBusy(false);
    }
  };
  // How a Google try ended: a token for Supabase, a short word on what went wrong, or (backed out) nothing.
  const googleDone = (o: GoogleOutcome) => {
    if (o.kind === "token") return void run((s) => s.signInWithGoogleToken(o.token, o.nonce));
    setError(o.kind === "error" ? o.message : null);
  };

  return (
    <Sheet labelledBy="free-wall-title" testId="free-wall-sheet" onClose={close}>
      <div className="sheet-head">
        <h2 id="free-wall-title" className="label cyan" data-testid="free-wall-title">
          {WALL_TITLE}
        </h2>
        <button type="button" className="key key-xs" data-close onClick={close} data-testid="free-wall-close">
          Close
        </button>
      </div>
      <p className="caption" data-testid="free-wall-line">
        {WALL_LINE}
      </p>
      {account.notice && (
        <p className="sheet-error" role="alert">
          {account.notice}
        </p>
      )}
      {/* Pressed: the game asked for is kept, in case the sign-in takes the whole tab to Google and back. */}
      <div className="wall-google" onClickCapture={onGoogle}>
        <GoogleSignIn disabled={busy} signingIn={busy} onOutcome={googleDone} onSupabase={() => void run((s) => s.signInWithGoogle())} />
      </div>
      {alt && (
        <button type="button" className="key key-sm wall-alt" data-testid="free-wall-alt" data-go={alt.go} onClick={() => onGo(alt.hash)}>
          {alt.label}
        </button>
      )}
      {error && (
        <p className="sheet-error" role="alert" data-testid="free-wall-error">
          {error}
        </p>
      )}
      <p className="sheet-note">
        your games so far come with you.{" "}
        <a
          href="#privacy"
          onClick={(e) => {
            e.preventDefault();
            onGo("#privacy");
          }}
        >
          what we keep
        </a>
      </p>
    </Sheet>
  );
}
