import { useEffect, useRef, useState } from "react";
import { loadService, useAccount } from "../../net";
import { ago, cleanName, syncLabel } from "./labels";
import { Sheet } from "./Sheet";

/**
 * Your account, a sheet over Home (from its account key, signed in): the name (editable), how it signed in, the sync
 * state (with try again when it failed), sign out, and delete account with an inline confirm (like reset all progress),
 * and what we keep. Signing out closes it (Home's key then goes hollow); after a delete it stays to say so.
 */
export default function AccountSheet({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"name" | "out" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const signedIn = account.status === "in" && !!account.user;

  // The confirm disarms itself, like reset all progress.
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);
  // Into the name box when editing starts; back to "change name" when it ends (saved, cancelled or Escape).
  const renameKey = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) nameInput.current?.focus();
    else if (wasEditing.current) renameKey.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  // Signed out (here, or in another tab): nothing left to show, unless it's to say the account was deleted.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!signedIn && !deleted && busy !== "delete") closeRef.current();
  }, [signedIn, deleted, busy]);

  const service = async () => {
    const s = await loadService();
    if (!s) throw new Error("no backend");
    return s;
  };

  const head = (
    <div className="sheet-head">
      <h2 id="account-title" className="label cyan">
        Account
      </h2>
      <button type="button" className="key key-xs" data-close onClick={onClose} data-testid="account-close">
        Close
      </button>
    </div>
  );

  if (!signedIn || !account.user) {
    return (
      <Sheet labelledBy="account-title" testId="account-sheet" onClose={onClose} focus="sheet">
        {head}
        <p className="caption" role="status" data-testid="account-deleted">
          {deleted ? "account deleted. this device kept its games." : "signed out."}
        </p>
      </Sheet>
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
    setError(null);
    try {
      await (await service()).signOut();
    } catch {
      setError("couldn't reach the server. check your connection.");
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
    <Sheet labelledBy="account-title" testId="account-sheet" onClose={onClose} focus="sheet">
      {head}
      <div className="account" data-testid="account-panel" data-signed-in="true">
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
                data-escape="local"
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  // Cancel the edit, not the sheet.
                  e.preventDefault();
                  e.stopPropagation();
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
              ref={renameKey}
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
          {user.email ? <> as <span className="account-email">{user.email}</span></> : ""}.
        </p>
        <p className={`account-sync ${account.sync}`} data-testid="account-sync" data-sync={account.sync} role="status">
          {syncLabel(account)}
          {account.sync === "synced" && account.syncedAt ? ` ${ago(account.syncedAt)}` : ""}
          {account.sync === "offline" && ". games saved here sync when you're back online."}
          {account.sync === "error" && (
            <>
              {". "}
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
          and the sign-in. this device keeps its games.{" "}
          <a href="#privacy" onClick={onClose}>
            what we keep
          </a>
        </p>
        {error && (
          <p className="sheet-error" role="alert" data-testid="account-error">
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}
