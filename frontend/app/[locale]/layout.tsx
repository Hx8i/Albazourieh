import Header from "@/components/Header";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { isLocale, Locale, locales } from "@/lib/i18n/dictionaries";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import * as React from "react";
import "../globals.css";

export const metadata: Metadata = {
  title: "Albazourieh Recovery Platform",
  description:
    "Post-war damage assessment and recovery platform for Lebanese municipalities",
};

export function generateStaticParams(): Array<{ locale: Locale }> {
  return locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: Locale }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body className="min-h-screen bg-muted/30 font-sans antialiased">
        <Header locale={locale} />
        <main className="container py-8">
          <QueryProvider>{children}</QueryProvider>
        </main>
      </body>
    </html>
  );
}
