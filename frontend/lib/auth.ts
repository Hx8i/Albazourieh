/**
 * Client-side session store for municipality staff. Every dashboard API
 * call attaches the JWT as a Bearer token and a 401 anywhere clears it
 * (see lib/api.ts).
 *
 * "Remember Me" decides where the session lives:
 * - checked   → localStorage (survives browser restarts; the 7-day JWT
 *               is the real expiry authority, enforced server-side)
 * - unchecked → sessionStorage (gone when the tab/browser closes; the
 *               token itself expires after 12h)
 */

export interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  role: 'SUPER_ADMIN' | 'STAFF_MEMBER';
  municipalityName: string;
}

export interface StaffSession {
  accessToken: string;
  user: StaffUser;
}

const STORAGE_KEY = 'albazourieh.staff-session';

export function getStaffSession(): StaffSession | null {
  if (typeof window === 'undefined') return null;
  const raw =
    window.sessionStorage.getItem(STORAGE_KEY) ??
    window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StaffSession;
  } catch {
    clearStaffSession();
    return null;
  }
}

export function setStaffSession(session: StaffSession, remember: boolean): void {
  // Never leave a stale copy in the other store.
  clearStaffSession();
  const store = remember ? window.localStorage : window.sessionStorage;
  store.setItem(STORAGE_KEY, JSON.stringify(session));
}

/** Logout: wipes the session from both stores. */
export function clearStaffSession(): void {
  window.sessionStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(STORAGE_KEY);
}
