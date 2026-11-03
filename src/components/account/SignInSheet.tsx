import { useEffect, useRef, useState } from "react";
import { BACKEND } from "../../net/config";
import { loadService, useAccount } from "../../net";
import { setAccount } from "../../net/store";
import "./account.css";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign in: Google, or a link (and a code, for opening it on another device) by email. No passwords. A sheet over the
 * screen: Escape, the close key or a press outside closes it; focus stays inside while it's open.
 */
export default function SignInSheet({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const methods = BACKEND?.signIn ?? [];
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | "code" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Focus the first control; Escape closes (before any screen's Escape-is-Back); Tab stays in the sheet.
  useEffect(() => {
    const el = sheet.current;
    el?.querySelector<HTMLElement>("input, button:not([data-close])")?.focus();
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

  // Signed in (a code typed here, or another tab finished the link): done.
  useEffect(() => {
    if (account.status === "in") close.current();
  }, [account.status]);

  const run = async (kind: "google" | "email" | "code", fn: (s: NonNullable<Awaited<ReturnType<typeof loadService>>>) => Promise<string | null>) => {
    setBusy(kind);
    setError(null);
    setAccount({ notice: undefined });
    try {
      const svc = await loadService();
      if (!svc) return;
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

  return (
    <div
      className="sheet-backdrop"
      data-testid="sign-in-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={sheet} className="panel sheet" role="dialog" aria-modal="true" aria-labelledby="sign-in-title" data-testid="sign-in-sheet" data-glass>
        <div className="sheet-head">
          <h2 id="sign-in-title" className="label cyan">
            Sign in
          </h2>
          <button type="button" className="key key-xs" data-close onClick={onClose} data-testid="sign-in-close">
            Close
          </button>
        </div>
        <p className="caption">keep your games, streaks and bests on every device. no password.</p>
        {account.notice && (
          <p className="sheet-error" role="alert">
            {account.notice}
          </p>
        )}

        {methods.includes("google") && (
          <button type="button" className="key sheet-wide" data-testid="sign-in-google" disabled={!!busy} onClick={google}>
            {busy === "google" ? "Opening Google" : "Continue with Google"}
          </button>
        )}
        {methods.length > 1 && <p className="sheet-or">or</p>}

        {methods.includes("email") &&
          (!sentTo ? (
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
          ))}

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
