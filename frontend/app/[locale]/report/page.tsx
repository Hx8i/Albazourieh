import { notFound } from 'next/navigation';
import * as React from 'react';
import { BackToMainLink } from '@/components/BackToMainLink';
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

  return (
    <div className="space-y-4">
      <BackToMainLink dict={dict} locale={locale} />
      <CitizenWizardForm dict={dict} locale={locale} />
    </div>
  );
}
