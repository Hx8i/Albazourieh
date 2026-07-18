import { notFound } from 'next/navigation';
import Link from 'next/link';
import * as React from 'react';
import { ChevronRight, Home, Tent } from 'lucide-react';
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

      {/* Displaced-persons programmes — each links to its own intake form. */}
      <section className="mx-auto w-full max-w-2xl space-y-4 pt-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold">
            {dict.landing.displacedHeading}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {dict.landing.displacedHint}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              {
                href: `/${locale}/syrian/form`,
                label: dict.modules.syrian,
                description: dict.displaced.syrian.formSubtitle,
                Icon: Tent,
              },
              {
                href: `/${locale}/lebanese/form`,
                label: dict.modules.lebanese,
                description: dict.displaced.lebanese.formSubtitle,
                Icon: Home,
              },
            ] as const
          ).map(({ href, label, description, Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-4 rounded-xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{label}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {description}
                </span>
              </span>
              <ChevronRight className="ms-auto h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
            </Link>
          ))}
        </div>
      </section>

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
