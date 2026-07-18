import { NextRequest, NextResponse } from 'next/server';
import { locales } from './lib/i18n/dictionaries';

/**
 * - Arabic-first locale routing: every path gets an /ar or /en prefix,
 *   defaulting to Arabic unless the browser explicitly prefers English.
 * - Route isolation: the municipality portal lives on a hidden path
 *   (lib/constants.ts). The predictable "/dashboard" path is sealed with
 *   a hard 404 — not a 401 — so probing it reveals nothing. Only the
 *   *first* (non-locale) segment is sealed: the displaced dashboards
 *   (/syrian/dashboard, /lebanese/dashboard) are intentionally public
 *   routes behind their own JWT login gate.
 */

const SEALED_SEGMENTS = ['dashboard', 'admin', 'municipality'];

function isSealedPath(pathname: string): boolean {
  const segments = pathname.toLowerCase().split('/').filter(Boolean);
  const first = (locales as readonly string[]).includes(segments[0] ?? '')
    ? segments[1]
    : segments[0];
  return first !== undefined && SEALED_SEGMENTS.includes(first);
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

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
