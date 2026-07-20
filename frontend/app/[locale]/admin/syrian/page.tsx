import { notFound } from 'next/navigation';
import * as React from 'react';
import { DisplacedDashboardShell } from '@/components/displaced/DisplacedDashboardShell';
import { getDictionary, isLocale } from '@/lib/i18n/dictionaries';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Staff analytics dashboard for the Syrian displaced programme. */
export default async function SyrianDashboardPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <DisplacedDashboardShell dict={dict} locale={locale} audience="syrian" />
  );
}
