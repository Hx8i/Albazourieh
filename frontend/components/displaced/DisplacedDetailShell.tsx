'use client';

import * as React from 'react';
import { ModuleSwitcher } from '@/components/ModuleSwitcher';
import { StaffGate } from '@/components/dashboard/StaffGate';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import { DisplacedAudience } from '@/lib/schemas/displaced.schema';
import { DisplacedDetailView } from './DisplacedDetailView';

interface DisplacedDetailShellProps {
  dict: Dictionary;
  locale: Locale;
  audience: DisplacedAudience;
  id: string;
}

/**
 * Case-file pages sit behind the same JWT StaffGate + global module nav
 * as the dashboards, so deep links also require a login.
 */
export function DisplacedDetailShell({
  dict,
  locale,
  audience,
  id,
}: DisplacedDetailShellProps): React.JSX.Element {
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
          <DisplacedDetailView
            dict={dict}
            locale={locale}
            audience={audience}
            id={id}
          />
        </div>
      )}
    </StaffGate>
  );
}
