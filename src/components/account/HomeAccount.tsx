import { lazy, Suspense, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "../../net";
import { Pixel } from "../menu/icons";
import { homeName, homeNote } from "./labels";

const SignInSheet = lazy(() => import("./SignInSheet"));
const AccountSheet = lazy(() => import("./AccountSheet"));

type Open = "in" | "up" | "account" | null;

/**
 * Home's account card, right under Today (only in a build with accounts): whether you're signed in, at a glance. A
 * pixel player, hollow and faint while signed out, lit cyan once signed in.
 * - Signed out: "not signed in", where the games are kept (this device only), SIGN IN and CREATE ACCOUNT, each
 *   opening the sign-in sheet in its own mode. A sign-in that came back and failed says why in the same line.
 * - Signed in: "signed in as <name>" (the display name, else the email's part before the @, never the address), the
 *   sync state in plain words, and ACCOUNT: the account sheet (name, sign out, delete account, what we keep).
 * - Finding out (a sign-in coming back to the page): "signing in", the keys waiting.
 * Whatever closes a sheet, focus comes back to the key that opened it, or to the one that took its place.
 */
export default function HomeAccount() {
  const account = useAccount();
  const [open, setOpen] = useState<Open>(null);
  const card = useRef<HTMLElement>(null);
  if (account.status === "off") return null;
  const user = account.status === "in" ? account.user : undefined;
  const state = user ? "in" : account.status === "loading" ? "loading" : "out";

  const close = (was: Open) => {
    setOpen(null);
    // After the next render: signing in or out swaps the keys.
    requestAnimationFrame(() => {
      const key = (id: string) => card.current?.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
      const want = was === "up" ? "home-create-account" : was === "in" ? "home-sign-in" : "home-account-key";
      (key(want) ?? key("home-account-key") ?? key("home-sign-in"))?.focus({ preventScroll: true });
    });
  };

  return (
    <section
      ref={card}
      className="home-group home-account"
      data-glass
      data-testid="home-account"
      data-state={state}
      aria-labelledby="home-account-status"
    >
      <Pixel name={user ? "user" : "userOut"} unit={3} className="home-account-icon" />
      <div className="home-account-text">
        <h2 id="home-account-status" className="home-account-status" data-testid="home-account-status">
          {user ? (
            <>
              signed in as{" "}
              <b className="home-account-name" data-testid="home-account-name">
                {homeName(user)}
              </b>
            </>
          ) : state === "loading" ? (
            "signing in"
          ) : (
            "not signed in"
          )}
        </h2>
        <p
          className={`home-account-note ${account.notice && !user ? "notice" : ""}`}
          data-testid="home-account-note"
          data-sync={user ? account.sync : undefined}
        >
          {homeNote(account)}
        </p>
      </div>
      <div className="home-account-keys">
        {user ? (
          <button type="button" className="key key-sm" data-testid="home-account-key" aria-haspopup="dialog" onClick={() => setOpen("account")}>
            Account
          </button>
        ) : (
          <>
            <button
              type="button"
              className="key key-sm"
              data-testid="home-sign-in"
              aria-haspopup="dialog"
              disabled={state === "loading"}
              onClick={() => setOpen("in")}
            >
              Sign in
            </button>
            <button
              type="button"
              className="key key-sm key-account-new"
              data-testid="home-create-account"
              aria-haspopup="dialog"
              disabled={state === "loading"}
              onClick={() => setOpen("up")}
            >
              Create account
            </button>
          </>
        )}
      </div>
      {/* Over the whole page, outside the card (whose glass and motion must not hold a fixed layer). */}
      {open &&
        createPortal(
          <Suspense fallback={null}>
            {open === "account" ? <AccountSheet onClose={() => close("account")} /> : <SignInSheet start={open} onClose={() => close(open)} />}
          </Suspense>,
          document.body,
        )}
    </section>
  );
}
