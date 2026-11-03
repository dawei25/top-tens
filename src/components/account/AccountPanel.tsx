import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { loadService, useAccount } from "../../net";
import { cleanName, syncLabel } from "./labels";
import "./account.css";

const SignInSheet = lazy(() => import("./SignInSheet"));

/** "just now", "4 min ago", "2 h ago", "Oct 29". */
function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The account on the knowledge page. Signed out: a way in. Signed in: the name (editable), how it signed in, the
 * sync state, sign out, and delete account with an inline confirm (like reset all progress on Home).
 */
export default function AccountPanel() {
  const account = useAccount();
  const [signIn, setSignIn] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"name" | "out" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const signInKey = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  // The confirm disarms itself, like reset all progress.
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);
  useEffect(() => {
    if (editing) nameInput.current?.focus();
  }, [editing]);

  if (account.status === "off" || account.status === "loading") return null;

  const service = async () => {
    const s = await loadService();
    if (!s) throw new Error("no backend");
    return s;
  };

  if (account.status !== "in" || !account.user) {
    return (
      <section data-glass className="panel account" aria-labelledby="account-title" data-testid="account-panel" data-signed-in="false">
        <div className="account-head">
          <h2 id="account-title" className="label cyan">
            Account
          </h2>
        </div>
        <p className="caption">
          {deleted ? "account deleted. this device kept its games." : "sign in to keep your games on every device."}
        </p>
        <div className="account-actions">
          <button ref={signInKey} type="button" className="key key-sm" data-testid="account-sign-in" onClick={() => setSignIn(true)}>
            Sign in
          </button>
          <a className="text-btn" href="#privacy">
            what we keep
          </a>
        </div>
        {signIn && (
          <Suspense fallback={null}>
            <SignInSheet
              onClose={() => {
                setSignIn(false);
                signInKey.current?.focus();
              }}
            />
          </Suspense>
        )}
      </section>
    );
  }

  const user = account.user;
  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = cleanName(name);
    if (!clean) return setError("names are 1 to 24 characters.");
    if (clean === user.name) return setEditing(false);
    setBusy("name");
    setError(null);
    try {
      const err = await (await service()).rename(clean);
      if (err) setError(err);
      else setEditing(false);
    } catch {
      setError("couldn't reach the server. check your connection.");
    } finally {
      setBusy(null);
    }
  };
  const signOut = async () => {
    setBusy("out");
    try {
      await (await service()).signOut();
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!confirm) return setConfirm(true);
    setConfirm(false);
    setBusy("delete");
    setError(null);
    try {
      const err = await (await service()).deleteAccount();
      if (err) setError(err);
      else setDeleted(true);
    } catch {
      setError("couldn't reach the server. check your connection.");
    } finally {
      setBusy(null);
    }
  };
  const syncNow = async () => {
    try {
      await (await service()).syncNow();
    } catch {
      // The status line says how it went.
    }
  };

  return (
    <section data-glass className="panel account" aria-labelledby="account-title" data-testid="account-panel" data-signed-in="true">
      <div className="account-head">
        <h2 id="account-title" className="label cyan">
          Account
        </h2>
        <span className={`account-sync ${account.sync}`} data-testid="account-sync" data-sync={account.sync} role="status">
          {syncLabel(account)}
          {account.sync === "synced" && account.syncedAt ? ` ${ago(account.syncedAt)}` : ""}
        </span>
      </div>

      {editing ? (
        <form className="account-name-form" onSubmit={saveName}>
          <label className="sheet-field">
            <span className="label">Name</span>
            <input
              ref={nameInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoComplete="nickname"
              data-testid="account-name-input"
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                // Cancel the edit, not the screen.
                e.preventDefault();
                setEditing(false);
              }}
            />
          </label>
          <div className="account-actions">
            <button className="key key-sm key-pink" type="submit" disabled={busy === "name"} data-testid="account-name-save">
              {busy === "name" ? "Saving" : "Save"}
            </button>
            <button className="key key-sm" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="account-who">
          <p className="account-name" data-testid="account-name">
            {user.name}
          </p>
          <button
            type="button"
            className="text-btn"
            data-testid="account-rename"
            onClick={() => {
              setName(user.name);
              setError(null);
              setEditing(true);
            }}
          >
            change name
          </button>
        </div>
      )}
      <p className="caption">
        {user.google ? "signed in with google" : "signed in by email"}
        {user.email ? ` as ${user.email}` : ""}.
        {account.sync === "offline" && " games saved here sync when you're back online."}
        {account.sync === "error" && (
          <>
            {" "}
            <button type="button" className="text-btn" onClick={syncNow}>
              try again
            </button>
          </>
        )}
      </p>

      <div className="account-actions">
        <button type="button" className="key key-sm" data-testid="account-sign-out" disabled={!!busy} onClick={signOut}>
          {busy === "out" ? "Signing out" : "Sign out"}
        </button>
        <button
          type="button"
          className={`text-btn ${confirm ? "danger" : ""}`}
          data-testid="account-delete"
          disabled={busy === "delete"}
          onClick={remove}
          onBlur={() => setConfirm(false)}
        >
          {busy === "delete" ? "deleting" : confirm ? "sure? this can't be undone" : "delete account"}
        </button>
      </div>
      <p className="account-fine">
        signing out clears this device; your games stay in the account. deleting the account removes its save, its scores
        and the sign-in. this device keeps its games.
      </p>
      {error && (
        <p className="sheet-error" role="alert" data-testid="account-error">
          {error}
        </p>
      )}
    </section>
  );
}
