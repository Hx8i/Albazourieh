import { NextRequest, NextResponse } from 'next/server';
import { locales } from './lib/i18n/dictionaries';

/**
 * - Arabic-first locale routing: every path gets an /ar or /en prefix,
 *   defaulting to Arabic unless the browser explicitly prefers English.
 * - Route isolation: the municipality portal lives on a hidden path
 *   (lib/constants.ts). The predictable "/dashboard" path is sealed with
 *   a hard 404 — not a 401 — so probing it reveals nothing.
 */

const SEALED_SEGMENTS = ['dashboard', 'admin', 'municipality'];

function isSealedPath(pathname: string): boolean {
  const segments = pathname.toLowerCase().split('/').filter(Boolean);
  return segments.some((segment) => SEALED_SEGMENTS.includes(segment));
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (isSealedPath(pathname)) {
    return new NextResponse(null, { status: 404 });
  }

  const hasLocale = locales.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
  if (hasLocale) return NextResponse.next();

  const acceptLanguage = request.headers.get('accept-language') ?? '';
  const preferred = acceptLanguage.toLowerCase().startsWith('en') ? 'en' : 'ar';

  const url = request.nextUrl.clone();
  url.pathname = `/${preferred}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|.*\\..*).*)'],
};
