import { notFound } from 'next/navigation';
import * as React from 'react';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { getDictionary, isLocale } from '@/lib/i18n/dictionaries';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** SUPER_ADMIN-only staff management workspace (backend re-enforces). */
export default async function ManagementPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return <DashboardShell dict={dict} locale={locale} view="management" />;
}
