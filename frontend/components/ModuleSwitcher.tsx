'use client';

import * as React from 'react';
import Link from 'next/link';
import { Building2, ClipboardList, Home, Tent, Users } from 'lucide-react';
import { ADMIN_PATH } from '@/lib/constants';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import { cn } from '@/lib/utils';

export type PlatformModule =
  | 'warDamages'
  | 'syrian'
  | 'lebanese'
  | 'management'
  | 'history';

interface ModuleSwitcherProps {
  dict: Dictionary;
  locale: Locale;
  active: PlatformModule;
  /**
   * SUPER_ADMIN only: appends the two management tools (staff management
   * + operations trail) so the admin can reach them from every dashboard
   * view. Staff members never see these tabs; the backend re-enforces
   * the role on every call regardless.
   */
  isSuperAdmin?: boolean;
}

interface ModuleTab {
  key: PlatformModule;
  href: string;
  label: string;
  Icon: typeof Building2;
}

/**
 * Global staff-side navigation bar shared by every dashboard shell: the
 * three isolated workspaces (War Damages, Syrian Displaced, Lebanese
 * Displaced) plus — for the admin role only — the global management
 * tools. Rendered only inside authenticated shells, never in public
 * chrome.
 */
export function ModuleSwitcher({
  dict,
  locale,
  active,
  isSuperAdmin = false,
}: ModuleSwitcherProps): React.JSX.Element {
  const t = dict.modules;

  const moduleTabs: ModuleTab[] = [
    {
      key: 'warDamages',
      href: `/${locale}/${ADMIN_PATH}`,
      label: t.warDamages,
      Icon: Building2,
    },
    {
      key: 'syrian',
      href: `/${locale}/admin/syrian`,
      label: t.syrian,
      Icon: Tent,
    },
    {
      key: 'lebanese',
      href: `/${locale}/admin/lebanese`,
      label: t.lebanese,
      Icon: Home,
    },
  ];

  const adminTabs: ModuleTab[] = isSuperAdmin
    ? [
        {
          key: 'management',
          href: `/${locale}/${ADMIN_PATH}/management`,
          label: dict.portalNav.management,
          Icon: Users,
        },
        {
          key: 'history',
          href: `/${locale}/${ADMIN_PATH}/history-logs`,
          label: dict.portalNav.history,
          Icon: ClipboardList,
        },
      ]
    : [];

  const renderTab = ({ key, href, label, Icon }: ModuleTab): React.JSX.Element => (
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
  );

  return (
    <nav
      className="flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1"
      aria-label={t.title}
    >
      {moduleTabs.map(renderTab)}
      {adminTabs.length > 0 ? (
        <>
          {/* Divider + end-aligned admin tools, visible on every view. */}
          <span className="ms-auto hidden h-6 w-px bg-border sm:block" aria-hidden />
          {adminTabs.map(renderTab)}
        </>
      ) : null}
    </nav>
  );
}
