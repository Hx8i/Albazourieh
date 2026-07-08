/**
 * Client-side session store for municipality staff. The JWT lives in
 * localStorage; every dashboard API call attaches it as a Bearer token
 * and a 401 anywhere clears it (see lib/api.ts).
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
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StaffSession;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function setStaffSession(session: StaffSession): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearStaffSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
