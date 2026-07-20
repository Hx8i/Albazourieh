'use client';

import * as React from 'react';
import { ShieldAlert } from 'lucide-react';
import { ModuleSwitcher, PlatformModule } from '@/components/ModuleSwitcher';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import { AuditTrailPanel } from './AuditTrailPanel';
import { MunicipalityDashboard } from './MunicipalityDashboard';
import { ReportDetailView } from './ReportDetailView';
import { StaffGate } from './StaffGate';
import { StaffManagementPanel } from './StaffManagementPanel';

interface DashboardShellProps {
  dict: Dictionary;
  locale: Locale;
  view: 'dashboard' | 'detail' | 'management' | 'history';
  reportId?: string;
}

/**
 * Every municipality view renders behind the same JWT StaffGate, so deep
 * links to case files also require a login. The portal is split into
 * isolated sub-routes: the dashboard (map + reports), the SUPER_ADMIN
 * staff-management workspace, and the SUPER_ADMIN audit history — the
 * client gate is cosmetic; the backend enforces the role on every call.
 */
export function DashboardShell({
  dict,
  locale,
  view,
  reportId,
}: DashboardShellProps): React.JSX.Element {
  const restricted = (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-12 text-center">
      <ShieldAlert className="h-10 w-10 text-destructive" />
      <p className="font-medium text-muted-foreground">
        {dict.portalNav.accessDenied}
      </p>
    </div>
  );

  return (
    <StaffGate dict={dict}>
      {(session) => {
        const isSuperAdmin = session.user.role === 'SUPER_ADMIN';

        if (view === 'detail' && reportId) {
          return (
            <ReportDetailView dict={dict} locale={locale} reportId={reportId} />
          );
        }

        // The management tools live in the global nav bar (admin-only);
        // the tab highlight follows the sub-route being viewed.
        const section: PlatformModule =
          view === 'management'
            ? 'management'
            : view === 'history'
              ? 'history'
              : 'warDamages';

        return (
          <div className="space-y-6">
            <ModuleSwitcher
              dict={dict}
              locale={locale}
              active={section}
              isSuperAdmin={isSuperAdmin}
            />
            {section === 'management' ? (
              isSuperAdmin ? (
                <StaffManagementPanel
                  dict={dict}
                  locale={locale}
                  currentUserId={session.user.id}
                />
              ) : (
                restricted
              )
            ) : section === 'history' ? (
              isSuperAdmin ? (
                <AuditTrailPanel dict={dict} locale={locale} />
              ) : (
                restricted
              )
            ) : (
              <MunicipalityDashboard dict={dict} locale={locale} />
            )}
          </div>
        );
      }}
    </StaffGate>
  );
}
