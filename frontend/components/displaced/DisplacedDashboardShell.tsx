'use client';

import * as React from 'react';
import { ModuleSwitcher } from '@/components/ModuleSwitcher';
import { StaffGate } from '@/components/dashboard/StaffGate';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import { DisplacedAudience } from '@/lib/schemas/displaced.schema';
import { DisplacedDashboard } from './DisplacedDashboard';

interface DisplacedDashboardShellProps {
  dict: Dictionary;
  locale: Locale;
  audience: DisplacedAudience;
}

/**
 * Both displaced dashboards render behind the same JWT StaffGate as the
 * War Damages portal — the client gate is cosmetic; the backend enforces
 * authentication on every displaced staff endpoint.
 */
export function DisplacedDashboardShell({
  dict,
  locale,
  audience,
}: DisplacedDashboardShellProps): React.JSX.Element {
  return (
    <StaffGate dict={dict}>
      {(session) => (
        <div className="space-y-6">
          <ModuleSwitcher
            dict={dict}
            locale={locale}
            active={audience}
            isSuperAdmin={session.user.role === 'SUPER_ADMIN'}
          />
          <DisplacedDashboard dict={dict} locale={locale} audience={audience} />
        </div>
      )}
    </StaffGate>
  );
}
