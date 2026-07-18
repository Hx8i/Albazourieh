'use client';

import * as React from 'react';
import Link from 'next/link';
import { Building2, Home, Tent } from 'lucide-react';
import { ADMIN_PATH } from '@/lib/constants';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import { cn } from '@/lib/utils';

export type PlatformModule = 'warDamages' | 'syrian' | 'lebanese';

interface ModuleSwitcherProps {
  dict: Dictionary;
  locale: Locale;
  active: PlatformModule;
}

/**
 * Staff-side context switcher between the three isolated workspaces:
 * War Damages, Syrian Displaced and Lebanese Displaced. Rendered only
 * inside authenticated dashboard shells — it links to the hidden
 * War-Damages portal path, which must never appear in public chrome.
 */
export function ModuleSwitcher({
  dict,
  locale,
  active,
}: ModuleSwitcherProps): React.JSX.Element {
  const t = dict.modules;

  const tabs: Array<{
    key: PlatformModule;
    href: string;
    label: string;
    Icon: typeof Building2;
  }> = [
    {
      key: 'warDamages',
      href: `/${locale}/${ADMIN_PATH}`,
      label: t.warDamages,
      Icon: Building2,
    },
    {
      key: 'syrian',
      href: `/${locale}/syrian/dashboard`,
      label: t.syrian,
      Icon: Tent,
    },
    {
      key: 'lebanese',
      href: `/${locale}/lebanese/dashboard`,
      label: t.lebanese,
      Icon: Home,
    },
  ];

  return (
    <nav
      className="flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1"
      aria-label={t.title}
    >
      {tabs.map(({ key, href, label, Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? 'page' : undefined}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            active === key
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
