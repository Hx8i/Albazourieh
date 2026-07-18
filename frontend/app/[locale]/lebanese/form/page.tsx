import { notFound } from 'next/navigation';
import * as React from 'react';
import { DisplacedIntakeForm } from '@/components/displaced/DisplacedIntakeForm';
import { getDictionary, isLocale } from '@/lib/i18n/dictionaries';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Public intake form for the Lebanese displaced programme (نازحين). */
export default async function LebaneseFormPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">
          {dict.displaced.lebanese.formTitle}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {dict.displaced.lebanese.formSubtitle}
        </p>
      </div>
      <DisplacedIntakeForm dict={dict} locale={locale} audience="lebanese" />
    </div>
  );
}
