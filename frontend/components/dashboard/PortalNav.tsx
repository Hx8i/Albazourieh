'use client';

import * as React from 'react';
import Link from 'next/link';
import { ClipboardList, LayoutDashboard, Users } from 'lucide-react';
import { ADMIN_PATH } from '@/lib/constants';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import { cn } from '@/lib/utils';

export type PortalSection = 'dashboard' | 'management' | 'history';

interface PortalNavProps {
  dict: Dictionary;
  locale: Locale;
  active: PortalSection;
  /** Management + history tabs are SUPER_ADMIN-only. */
  isSuperAdmin: boolean;
}

/**
 * Sub-route navigation for the isolated admin workspaces: the main
 * dashboard, the staff-management workspace and the audit history —
 * each on its own route for clean separation and lighter pages.
 */
export function PortalNav({
  dict,
  locale,
  active,
  isSuperAdmin,
}: PortalNavProps): React.JSX.Element {
  const t = dict.portalNav;
  const base = `/${locale}/${ADMIN_PATH}`;

  const tabs: Array<{
    key: PortalSection;
    href: string;
    label: string;
    Icon: typeof LayoutDashboard;
  }> = [
    { key: 'dashboard', href: base, label: t.dashboard, Icon: LayoutDashboard },
  ];
  if (isSuperAdmin) {
    tabs.push(
      {
        key: 'management',
        href: `${base}/management`,
        label: t.management,
        Icon: Users,
      },
      {
        key: 'history',
        href: `${base}/history-logs`,
        label: t.history,
        Icon: ClipboardList,
      },
    );
  }

  return (
    <nav
      className="flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1"
      aria-label={t.dashboard}
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
