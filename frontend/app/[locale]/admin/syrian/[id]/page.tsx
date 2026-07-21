import { notFound } from 'next/navigation';
import * as React from 'react';
import { DisplacedDetailShell } from '@/components/displaced/DisplacedDetailShell';
import { getDictionary, isLocale } from '@/lib/i18n/dictionaries';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

/** Staff case file for one Syrian displaced registration. */
export default async function SyrianDetailPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <DisplacedDetailShell dict={dict} locale={locale} audience="syrian" id={id} />
  );
}
