import { lazy, Suspense, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "../../net";
import { setAccount } from "../../net/store";
import { Pixel } from "../menu/icons";
import { accountAlert, accountKeyLabel } from "./labels";

const SignInSheet = lazy(() => import("./SignInSheet"));
const AccountSheet = lazy(() => import("./AccountSheet"));

/**
 * Home's account key, in the header's right-hand group left of the sound key (only in a build with accounts): where
 * the player stands, at a glance, in one keycap (owner: "a small icon ... that just shows, in a useful manner, whether
 * or not you're signed in"). A pixel player:
 * - signed out: hollow and quiet; pressing it opens the sign-in sheet (which also creates accounts);
 * - signed in: lit cyan; pressing it opens the account sheet (name, sync state, sign out, delete account);
 * - something to look at (offline, couldn't sync, or a sign-in that came back and didn't finish): a pink dot by its
 *   head, and the sheet says what (a sign-in's dot goes once its sheet has said why);
 * - signing in (a sign-in coming back to the page): hollow, tinted cyan, the key waiting.
 * Its name and title say the same in words ("Account: signed in as Dana"), never an email address. Whatever closes a
 * sheet, focus comes back to the key.
 */
export default function AccountKey() {
  const account = useAccount();
  const [open, setOpen] = useState<"sign-in" | "account" | null>(null);
  const key = useRef<HTMLButtonElement>(null);
  if (account.status === "off") return null;
  const user = account.status === "in" ? account.user : undefined;
  const state = user ? "in" : account.status === "loading" ? "loading" : "out";
  const label = accountKeyLabel(account);
  const alert = accountAlert(account);

  const close = () => {
    setOpen(null);
    // A sign-in that didn't finish was said in the sheet: seen, the dot goes.
    if (open === "sign-in" && account.notice) setAccount({ notice: undefined });
    // After the next render (signing in or out redraws the key).
    requestAnimationFrame(() => key.current?.focus({ preventScroll: true }));
  };

  return (
    <>
      <button
        ref={key}
        type="button"
        className="key key-icon account-key"
        data-testid="account-key"
        data-state={state}
        data-sync={user ? account.sync : undefined}
        data-alert={alert || undefined}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        disabled={state === "loading"}
        onClick={() => setOpen(user ? "account" : "sign-in")}
      >
        <Pixel name={user ? "user" : "userOut"} unit={2} className="account-icon" />
        {alert && <span className="account-dot" data-testid="account-dot" aria-hidden="true" />}
      </button>
      {/* Over the whole page, outside Home's header (whose glass and motion must not hold a fixed layer). */}
      {open &&
        createPortal(
          <Suspense fallback={null}>
            {open === "account" ? <AccountSheet onClose={close} /> : <SignInSheet start="in" onClose={close} />}
          </Suspense>,
          document.body,
        )}
    </>
  );
}
