import { notFound } from 'next/navigation';
import * as React from 'react';
import { TrackReportView } from '@/components/citizen/TrackReportView';
import { getDictionary, isLocale } from '@/lib/i18n/dictionaries';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function TrackReportPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return <TrackReportView dict={dict} locale={locale} />;
}
