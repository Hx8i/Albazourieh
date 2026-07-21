import { notFound } from 'next/navigation';
import * as React from 'react';
import { BackToMainLink } from '@/components/BackToMainLink';
import { DisplacedIntakeForm } from '@/components/displaced/DisplacedIntakeForm';
import { getDictionary, isLocale } from '@/lib/i18n/dictionaries';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Public intake form for the Syrian displaced programme (لاجئين). */
export default async function SyrianFormPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <div className="space-y-4">
      <BackToMainLink dict={dict} locale={locale} />
      <div className="text-center">
        <h1 className="text-3xl font-bold">{dict.displaced.syrian.formTitle}</h1>
        <p className="mt-1 text-muted-foreground">
          {dict.displaced.syrian.formSubtitle}
        </p>
      </div>
      <DisplacedIntakeForm dict={dict} locale={locale} audience="syrian" />
    </div>
  );
}
