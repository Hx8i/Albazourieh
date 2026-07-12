import { notFound } from 'next/navigation';
import Link from 'next/link';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { CitizenWizardForm } from '@/components/citizen/CitizenWizardForm';
import { getDictionary, isLocale } from '@/lib/i18n/dictionaries';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * The public root IS the reporting wizard — citizens land straight on
 * step 1 with zero navigation to any administrative tooling.
 */
export default async function HomePage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold">{dict.landing.title}</h1>
        <p className="mt-1 text-muted-foreground">{dict.landing.subtitle}</p>
      </div>
      <CitizenWizardForm dict={dict} locale={locale} />
      <div className="text-center pt-4">
        <Button asChild variant="outline">
          <Link href={`/${locale}/track-report`}>
            {dict.landing.trackExisting}
          </Link>
        </Button>
      </div>
    </div>
  );
}
