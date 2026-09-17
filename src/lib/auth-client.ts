const STORAGE_KEY = "lms-session";

export type Session = { token: string; expiresAt: number };

export function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (typeof parsed.token !== "string" || typeof parsed.expiresAt !== "number") return null;
    if (parsed.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: Session): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}

export function getStoredToken(): string | null {
  return readSession()?.token ?? null;
}

/** Fired when the server rejects our token so the app can force a re-lock. */
export const AUTH_EXPIRED_EVENT = "lms:auth-expired";

export function emitAuthExpired(): void {
  if (typeof window === "undefined") return;
  clearSession();
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}