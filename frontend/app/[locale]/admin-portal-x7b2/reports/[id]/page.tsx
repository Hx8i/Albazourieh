import { notFound } from 'next/navigation';
import * as React from 'react';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { getDictionary, isLocale } from '@/lib/i18n/dictionaries';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function ReportDetailPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <DashboardShell dict={dict} locale={locale} view="detail" reportId={id} />
  );
}
