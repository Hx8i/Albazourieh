/**
 * Hidden municipality portal path. Citizens are never linked here; the
 * old /dashboard path is hard-404'd in middleware. Rotating this slug
 * only requires renaming app/[locale]/(portal segment) + this constant.
 */
export const ADMIN_PATH = 'admin-portal-x7b2';
