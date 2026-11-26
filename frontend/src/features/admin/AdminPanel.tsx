import { usePresentation } from "../../shared/usePresentation";
import { useI18n } from "../../i18n/I18nProvider";
import { useEffect, useState } from "react";
import { getBlacklist } from "../../api/client";
import type { BlacklistEntry } from "../../api/contracts";

import type { Administrator } from "./useAdministrator";

export default function AdminPanel({ administrator, revision, onChanged, onClose }: {
  administrator: Administrator; revision: number; onChanged: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const { utc } = usePresentation();
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
  return <aside className="detail-panel admin-panel" aria-label={t("Administration")}>
    <div className="panel-heading"><div><span className="eyebrow">{t("Administration")}</span><h2>{t("Hidden webcams")}</h2></div><button className="icon-button" aria-label={t("Close administration")} onClick={onClose}>×</button></div>
    {administrator.error && <p className="error" role="alert">{t(administrator.error)}</p>}
    {!session ? <form className="login-form" onSubmit={async event => {
      event.preventDefault(); if (await administrator.signIn(username, password)) setPassword("");
    }}>
      <p>{t("Sign in to hide webcams from this map or restore them.")}</p>
      <label>{t("Username")}<input autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)} /></label>
      <label>{t("Password")}<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button className="primary" disabled={administrator.busy} type="submit">{administrator.busy ? t("Signing in…") : t("Sign in")}</button>
    </form> : <>
      <div className="admin-session"><span>{t("Signed in as")}{" "}<strong>{session.username}</strong></span><button disabled={administrator.busy} onClick={administrator.signOut}>{t("Sign out")}</button></div>
      <p className="muted small">{t("Select a webcam on the map to hide it. Its observations will continue to be collected and kept.")}</p>
      {error && <p className="error" role="alert">{t(error)}</p>}
      {loading ? <p role="status">{t("Loading hidden webcams…")}</p> : !items.length ? <p className="empty">{t("No hidden webcams.")}</p> : <ul className="blacklist">
        {items.map(item => <li key={item.processing_stream_id}><strong>{item.name}</strong><p>{item.reason || t("No reason supplied")}</p><small>{utc(item.updated_at)} · {item.updated_by}</small>
          <button disabled={pending !== null} onClick={async () => {
            setPending(item.processing_stream_id); setError("");
            try { await administrator.change(item.processing_stream_id); onChanged(); }
            catch (error) { setError(error instanceof Error ? error.message : "Restore failed"); }
            finally { setPending(null); }
          }}>{pending === item.processing_stream_id ? t("Restoring…") : t("Restore to map")}</button></li>)}
      </ul>}
    </>}
  </aside>;
}
