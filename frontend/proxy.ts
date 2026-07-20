import { NextRequest, NextResponse } from 'next/server';
import { locales } from './lib/i18n/dictionaries';

/**
 * - Arabic-first locale routing: every path gets an /ar or /en prefix,
 *   defaulting to Arabic unless the browser explicitly prefers English.
 * - Route isolation: the admin dashboards live under `/admin`
 *   (`/admin/war-damages`, `/admin/lebanese`, `/admin/syrian`), each gated
 *   by the staff login. The old predictable "/dashboard" and
 *   "/municipality" first segments stay sealed with a hard 404 — not a
 *   401 — so probing them reveals nothing. Only the *first* (non-locale)
 *   segment is checked, so `/admin/*` resolves normally.
 * - Legacy redirects: the pre-restructure routes (/…/syrian/dashboard,
 *   /…/lebanese/dashboard, /…/admin-portal-x7b2/**) 307 → their new
 *   /admin/* homes, so stale tabs, bookmarks and cached prefetches never
 *   land on a 404.
 */

const SEALED_SEGMENTS = ['dashboard', 'municipality'];

function isSealedPath(pathname: string): boolean {
  const segments = pathname.toLowerCase().split('/').filter(Boolean);
  const first = (locales as readonly string[]).includes(segments[0] ?? '')
    ? segments[1]
    : segments[0];
  return first !== undefined && SEALED_SEGMENTS.includes(first);
}

/**
 * Legacy → current path map, applied so any stale bookmark, still-open tab
 * or cached prefetch of a pre-restructure URL resolves gracefully instead
 * of 404ing. Keys are matched as a whole segment prefix (with or without a
 * trailing sub-path); the sub-path and query string are preserved.
 */
const LEGACY_PATH_MAP: ReadonlyArray<readonly [string, string]> = [
  ['syrian/dashboard', 'admin/syrian'],
  ['lebanese/dashboard', 'admin/lebanese'],
  ['admin-portal-x7b2', 'admin/war-damages'],
];

/**
 * Returns the rewritten path for a legacy URL (locale preserved), or null
 * when the path is not legacy. Operates on the locale-prefixed pathname the
 * browser actually sends (e.g. "/en/lebanese/dashboard").
 */
function legacyRewrite(pathname: string): string | null {
  const localeMatch = pathname.match(/^\/([^/]+)\/(.*)$/);
  if (!localeMatch) return null;
  const [, locale, rest] = localeMatch;
  if (!(locales as readonly string[]).includes(locale)) return null;

  for (const [from, to] of LEGACY_PATH_MAP) {
    if (rest === from || rest.startsWith(`${from}/`)) {
      return `/${locale}/${to}${rest.slice(from.length)}`;
    }
  }
  return null;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Redirect retired routes to their new /admin/* homes before anything
  // else, so old links never fall through to a 404.
  const rewritten = legacyRewrite(pathname);
  if (rewritten) {
    const url = request.nextUrl.clone();
    url.pathname = rewritten;
    return NextResponse.redirect(url);
  }

  if (isSealedPath(pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  const hasLocale = locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasLocale) return NextResponse.next();

  // Arabic is the default for every visitor; users switch to English
  // explicitly via the header toggle.
  const url = request.nextUrl.clone();
  url.pathname = `/ar${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)'],
};
