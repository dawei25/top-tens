import { useEffect, useId, useRef, useState } from "react";
import { BACKEND, GOOGLE_CLIENT_ID, PRIVACY_CONTACT } from "../../net/config";
import { loadService, useAccount } from "../../net";
import { setAccount } from "../../net/store";
import GoogleSignIn from "./GoogleSignIn";
import "./account.css";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase's default minimum; a project set stricter says so itself. */
const MIN_PASSWORD = 6;

type Busy = "google" | "email" | "code" | "password" | null;
type Service = NonNullable<Awaited<ReturnType<typeof loadService>>>;

/**
 * Sign in with the methods this build offers (VITE_SIGN_IN): Google; an email and password (sign in or create an
 * account, nothing emailed); a link (and a code, for opening it on another device) by email. A sheet over the screen:
 * Escape, the close key or a press outside closes it; focus stays inside while it's open.
 *
 * Google: Google's own button and popup when the build has a client ID (VITE_GOOGLE_CLIENT_ID), so Google's account
 * chooser names this site; else (or if Google's script can't load) our key, which goes through Supabase's redirect.
 */
export default function SignInSheet({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const methods = BACKEND?.signIn ?? [];
  const hasPassword = methods.includes("password");
  const hasLink = methods.includes("email");
  const hasGoogle = methods.includes("google");
  // Google's script didn't load (offline, blocked): fall back to the redirect.
  const [gisFailed, setGisFailed] = useState(false);
  const gis = hasGoogle && !!GOOGLE_CLIENT_ID && !gisFailed;
  const [view, setView] = useState<"password" | "link">(hasPassword ? "password" : "link");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [confirmTo, setConfirmTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const pwId = useId();
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  // Focus the first control; with Google's button first (it's in Google's frame), the sheet itself, so no keyboard
  // pops up on a phone. Escape closes (before any screen's Escape-is-Back); Tab stays in the sheet.
  useEffect(() => {
    const el = sheet.current;
    if (el?.querySelector("[data-testid=sign-in-google-gis]")) el.focus();
    else el?.querySelector<HTMLElement>("input, button:not([data-close])")?.focus();
    const onKey = (e: KeyboardEvent) => {
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
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // Signed in (a password, a code typed here, or another tab finished the link): done.
  useEffect(() => {
    if (account.status === "in") close.current();
  }, [account.status]);

  const run = async (kind: Busy, fn: (s: Service) => Promise<string | null>) => {
    setBusy(kind);
    setError(null);
    setAccount({ notice: undefined });
    try {
      const svc = await loadService();
      if (!svc) return false;
      svc.start();
      const err = await fn(svc);
      if (err) setError(err);
      return !err;
    } catch {
      setError("couldn't reach the server. check your connection.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const google = () => void run("google", (s) => s.signInWithGoogle());
  const googleToken = (token: string, nonce: string) => void run("google", (s) => s.signInWithGoogleToken(token, nonce));
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const to = email.trim();
    if (!EMAIL.test(to)) return setError("that doesn't look like an email address.");
    if (await run("email", (s) => s.sendEmailLink(to))) setSentTo(to);
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = code.replace(/\s/g, "");
    if (!/^\d{6,10}$/.test(token)) return setError("the code is the 6 digits in the email.");
    if (sentTo) await run("code", (s) => s.verifyEmailCode(sentTo, token));
  };
  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const to = email.trim();
    if (!EMAIL.test(to)) return setError("that doesn't look like an email address.");
    if (!password) return setError("type your password.");
    if (mode === "in") return void (await run("password", (s) => s.signInWithPassword(to, password)));
    if (password.length < MIN_PASSWORD) return setError(`use at least ${MIN_PASSWORD} characters.`);
    let confirm = false;
    const ok = await run("password", async (s) => {
      const r = await s.signUpWithPassword(to, password);
      confirm = r.confirm;
      return r.error;
    });
    // The project asks new accounts to confirm their email first: once that's done, they sign in here.
    if (ok && confirm) {
      setConfirmTo(to);
      setMode("in");
      setPassword("");
    }
  };
  const switchTo = (next: { view?: "password" | "link"; mode?: "in" | "up" }) => {
    if (next.view) setView(next.view);
    if (next.mode) setMode(next.mode);
    setError(null);
    setConfirmTo(null);
  };

  const passwordForm = (
    <form className="sheet-form" onSubmit={submitPassword} noValidate data-testid="sign-in-password-form" data-mode={mode}>
      {confirmTo && (
        <p className="sheet-note" role="status" data-testid="sign-in-confirm">
          check your email to confirm: the link went to <b>{confirmTo}</b>. then sign in here.
        </p>
      )}
      <label className="sheet-field">
        <span className="label">Email</span>
        <input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="off"
          spellCheck={false}
          data-testid="sign-in-pw-email"
        />
      </label>
      <div className="sheet-field">
        <span className="sheet-field-head">
          <label className="label" htmlFor={pwId}>
            Password
          </label>
          <button
            type="button"
            className="text-btn"
            aria-controls={pwId}
            aria-pressed={show}
            data-testid="sign-in-show-password"
            onClick={() => setShow((s) => !s)}
          >
            {show ? "hide" : "show"}
          </button>
        </span>
        <input
          id={pwId}
          type={show ? "text" : "password"}
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "up" ? `${MIN_PASSWORD} or more characters` : undefined}
          autoComplete={mode === "up" ? "new-password" : "current-password"}
          autoCapitalize="off"
          spellCheck={false}
          data-testid="sign-in-password"
        />
      </div>
      <button className="key key-pink sheet-wide" type="submit" disabled={!!busy || !email.trim() || !password} data-testid="sign-in-password-submit">
        {mode === "up" ? (busy === "password" ? "Creating" : "Create account") : busy === "password" ? "Signing in" : "Sign in"}
      </button>
      <button type="button" className="text-btn" data-testid="sign-in-mode" onClick={() => switchTo({ mode: mode === "in" ? "up" : "in" })}>
        {mode === "in" ? "new here? create an account" : "have an account? sign in"}
      </button>
      {mode === "in" && PRIVACY_CONTACT && (
        <p className="sheet-note" data-testid="sign-in-forgot">
          forgot your password? ask us at <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>.
        </p>
      )}
    </form>
  );

  const linkForm = !sentTo ? (
    <form className="sheet-form" onSubmit={send} noValidate>
      <label className="sheet-field">
        <span className="label">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="off"
          spellCheck={false}
          data-testid="sign-in-email"
        />
      </label>
      <button className="key key-pink sheet-wide" type="submit" disabled={!!busy || !email.trim()} data-testid="sign-in-send">
        {busy === "email" ? "Sending" : "Email me a link"}
      </button>
    </form>
  ) : (
    <form className="sheet-form" onSubmit={verify} noValidate>
      <p className="sheet-note" role="status" data-testid="sign-in-sent">
        link sent to <b>{sentTo}</b>. open it in this browser, or type the code from the email here.
      </p>
      <label className="sheet-field">
        <span className="label">Code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={12}
          data-testid="sign-in-code"
        />
      </label>
      <button className="key key-pink sheet-wide" type="submit" disabled={!!busy || !code.trim()} data-testid="sign-in-verify">
        {busy === "code" ? "Checking" : "Sign in"}
      </button>
      <button
        type="button"
        className="text-btn"
        onClick={() => {
          setSentTo(null);
          setCode("");
          setError(null);
        }}
      >
        use another email
      </button>
    </form>
  );

  const showPassword = hasPassword && (view === "password" || !hasLink);
  const showLink = hasLink && !showPassword;

  return (
    <div
      className="sheet-backdrop"
      data-testid="sign-in-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        className="panel sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-title"
        tabIndex={-1}
        data-testid="sign-in-sheet"
        data-glass
      >
        <div className="sheet-head">
          <h2 id="sign-in-title" className="label cyan">
            Sign in
          </h2>
          <button type="button" className="key key-xs" data-close onClick={onClose} data-testid="sign-in-close">
            Close
          </button>
        </div>
        <p className="caption">keep your games, streaks and bests on every device.{hasPassword ? "" : " no password."}</p>
        {account.notice && (
          <p className="sheet-error" role="alert">
            {account.notice}
          </p>
        )}

        {gis && <GoogleSignIn disabled={!!busy} onCredential={googleToken} onUnavailable={() => setGisFailed(true)} />}
        {gis && busy === "google" && (
          <p className="sheet-note" role="status" data-testid="sign-in-google-busy">
            signing in with google.
          </p>
        )}
        {hasGoogle && !gis && (
          <button type="button" className="key sheet-wide" data-testid="sign-in-google" disabled={!!busy} onClick={google}>
            {busy === "google" ? "Opening Google" : "Continue with Google"}
          </button>
        )}
        {hasGoogle && (hasPassword || hasLink) && <p className="sheet-or">or</p>}

        {showPassword && passwordForm}
        {showLink && linkForm}
        {hasPassword && hasLink && (
          <button
            type="button"
            className="text-btn sheet-switch"
            data-testid="sign-in-switch"
            onClick={() => switchTo({ view: showPassword ? "link" : "password" })}
          >
            {showPassword ? "no password? email me a link" : "use a password instead"}
          </button>
        )}

        {error && (
          <p className="sheet-error" role="alert" data-testid="sign-in-error">
            {error}
          </p>
        )}
        <p className="sheet-note">
          your games so far come with you. <a href="#privacy" onClick={onClose}>what we keep</a>
        </p>
      </div>
    </div>
  );
}
