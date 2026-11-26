import { useCallback, useState } from "react";
import * as api from "../../api/client";
import type { AdminSession } from "../../api/contracts";

export function useAdministrator() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    try { setSession(await api.getSession()); }
    catch (error) {
      if (error instanceof api.APIError && error.status === 401) setSession(null);
      else setError(error instanceof Error ? error.message : "Session unavailable");
    }
  }, []);
  async function signIn(username: string, password: string) {
    setBusy(true); setError("");
    try { setSession(await api.login(username, password)); return true; }
    catch (error) { setError(error instanceof Error ? error.message : "Sign-in failed"); return false; }
    finally { setBusy(false); }
  }
  async function signOut() {
    if (!session) return;
    setBusy(true); setError("");
    try { await api.logout(session.csrf_token); setSession(null); }
    catch (error) { setError(error instanceof Error ? error.message : "Sign-out failed"); }
    finally { setBusy(false); }
  }
  async function change(id: string, reason?: string) {
    if (!session) throw new Error("Sign in as an administrator first.");
    try {
      if (reason === undefined) await api.restore(id, session.csrf_token);
      else await api.blacklist(id, reason, session.csrf_token);
    } catch (error) {
      if (error instanceof api.APIError && error.status === 401) setSession(null);
      throw error;
    }
  }
  return { session, error, busy, check, signIn, signOut, change };
}
export type Administrator = ReturnType<typeof useAdministrator>;
