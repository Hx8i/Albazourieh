import { notFound } from 'next/navigation';
import * as React from 'react';
import { CitizenWizardForm } from '@/components/citizen/CitizenWizardForm';
import { getDictionary, isLocale } from '@/lib/i18n/dictionaries';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ReportPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return <CitizenWizardForm dict={dict} locale={locale} />;
}
