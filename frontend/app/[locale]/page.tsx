import { notFound } from 'next/navigation';
import Link from 'next/link';
import * as React from 'react';
import { Building2, ChevronRight, Home, Tent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getDictionary, isLocale } from '@/lib/i18n/dictionaries';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Public landing hub. The three intake forms (war damages, Lebanese
 * displaced, Syrian displaced) are standalone pages reachable ONLY from
 * this selector — there is no form navigation in the global header.
 */
export default async function HomePage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const dict = getDictionary(locale);
  const hub = dict.landing.hub;

  const options: ReadonlyArray<{
    href: string;
    title: string;
    description: string;
    Icon: typeof Building2;
  }> = [
    {
      href: `/${locale}/report`,
      title: hub.warDamagesTitle,
      description: hub.warDamagesDesc,
      Icon: Building2,
    },
    {
      href: `/${locale}/lebanese/form`,
      title: hub.lebaneseTitle,
      description: hub.lebaneseDesc,
      Icon: Home,
    },
    {
      href: `/${locale}/syrian/form`,
      title: hub.syrianTitle,
      description: hub.syrianDesc,
      Icon: Tent,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 py-4">
      <div className="text-center">
        <h1 className="text-3xl font-bold">{hub.title}</h1>
        <p className="mt-2 text-muted-foreground">{hub.subtitle}</p>
      </div>

      <div className="grid gap-4">
        {options.map(({ href, title, description, Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center gap-5 rounded-2xl border bg-card p-6 shadow-sm transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Icon className="h-7 w-7" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-semibold">{title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {description}
              </span>
            </span>
            <ChevronRight className="h-6 w-6 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
          </Link>
        ))}
      </div>

      <div className="text-center">
        <Button asChild variant="outline">
          <Link href={`/${locale}/track-report`}>
            {dict.landing.trackExisting}
          </Link>
        </Button>
      </div>
    </div>
  );
}
