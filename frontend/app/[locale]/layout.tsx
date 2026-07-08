import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import * as React from 'react';
import { getDictionary, isLocale, locales } from '@/lib/i18n/dictionaries';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Albazourieh Recovery Platform',
  description:
    'Post-war damage assessment and recovery platform for Lebanese municipalities',
};

export function generateStaticParams(): Array<{ locale: string }> {
  return locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const dict = getDictionary(locale);

  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body className="min-h-screen bg-muted/30 font-sans antialiased">
        <header className="border-b bg-background">
          <div className="container flex h-14 items-center justify-between">
            <span className="font-bold">{dict.common.appName}</span>
            <a
              href={locale === 'ar' ? '/en' : '/ar'}
              className="text-sm font-medium text-primary hover:underline"
            >
              {dict.landing.switchLanguage}
            </a>
          </div>
        </header>
        <main className="container py-8">{children}</main>
      </body>
    </html>
  );
}
