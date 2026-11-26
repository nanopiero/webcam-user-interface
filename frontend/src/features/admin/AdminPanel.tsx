import { useEffect, useState } from "react";
import { getBlacklist } from "../../api/client";
import type { BlacklistEntry } from "../../api/contracts";
import { utc } from "../../shared/format";
import type { Administrator } from "./useAdministrator";

export default function AdminPanel({ administrator, revision, onChanged, onClose }: {
  administrator: Administrator; revision: number; onChanged: () => void; onClose: () => void;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [items, setItems] = useState<BlacklistEntry[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { session, check } = administrator;
  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    if (!session) return;
    let current = true;
    setLoading(true); setError("");
    getBlacklist().then(result => { if (current) setItems(result.items); })
      .catch(error => { if (current) setError(error.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [session, revision]);
  return <aside className="detail-panel admin-panel" aria-label="Administration">
    <div className="panel-heading"><div><span className="eyebrow">Administration</span><h2>Hidden webcams</h2></div><button className="icon-button" aria-label="Close administration" onClick={onClose}>×</button></div>
    {administrator.error && <p className="error" role="alert">{administrator.error}</p>}
    {!session ? <form className="login-form" onSubmit={async event => {
      event.preventDefault(); if (await administrator.signIn(username, password)) setPassword("");
    }}>
      <p>Sign in to hide webcams from this map or restore them.</p>
      <label>Username<input autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="primary" disabled={administrator.busy} type="submit">{administrator.busy ? "Signing in…" : "Sign in"}</button>
    </form> : <>
      <div className="admin-session"><span>Signed in as <strong>{session.username}</strong></span><button disabled={administrator.busy} onClick={administrator.signOut}>Sign out</button></div>
      <p className="muted small">Select a webcam on the map to hide it. Its observations will continue to be collected and kept.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading hidden webcams…</p> : !items.length ? <p className="empty">No hidden webcams.</p> : <ul className="blacklist">
        {items.map(item => <li key={item.processing_stream_id}><strong>{item.name}</strong><p>{item.reason || "No reason supplied"}</p><small>{utc(item.updated_at)} · {item.updated_by}</small>
          <button disabled={pending !== null} onClick={async () => {
            setPending(item.processing_stream_id); setError("");
            try { await administrator.change(item.processing_stream_id); onChanged(); }
            catch (error) { setError(error instanceof Error ? error.message : "Restore failed"); }
            finally { setPending(null); }
          }}>{pending === item.processing_stream_id ? "Restoring…" : "Restore to map"}</button></li>)}
      </ul>}
    </>}
  </aside>;
}
