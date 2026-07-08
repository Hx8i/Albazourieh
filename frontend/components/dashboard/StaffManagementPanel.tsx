'use client';

import * as React from 'react';
import {
  Loader2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet } from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  CreateStaffInput,
  StaffAccount,
  StaffRole,
  createStaff,
  listStaff,
  removeStaff,
} from '@/lib/api';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import { cn } from '@/lib/utils';

interface StaffManagementPanelProps {
  dict: Dictionary;
  locale: Locale;
  currentUserId: string;
}

const EMPTY_FORM: CreateStaffInput = {
  fullName: '',
  email: '',
  password: '',
  role: 'STAFF_MEMBER',
};

/**
 * SUPER_ADMIN-only staff administration. Rendered inside the dashboard
 * but guarded by the caller — the backend independently enforces the role
 * on every request, so this panel is a convenience, never the security
 * boundary.
 */
export function StaffManagementPanel({
  dict,
  locale,
  currentUserId,
}: StaffManagementPanelProps): React.JSX.Element {
  const t = dict.staff;

  const [staff, setStaff] = React.useState<StaffAccount[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [form, setForm] = React.useState<CreateStaffInput>(EMPTY_FORM);
  const [creating, setCreating] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    const result = await listStaff();
    if (result.ok) {
      setStaff(result.data);
    } else {
      setLoadError(result.error.message);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const patchForm = (partial: Partial<CreateStaffInput>): void => {
    setForm((previous) => ({ ...previous, ...partial }));
    setFormError(null);
  };

  const handleCreate = async (): Promise<void> => {
    if (form.fullName.trim().length < 2) {
      setFormError(t.errorName);
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
      setFormError(t.errorEmail);
      return;
    }
    if (form.password.length < 8) {
      setFormError(t.errorPassword);
      return;
    }

    setCreating(true);
    setFormError(null);
    const result = await createStaff({
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
    });
    setCreating(false);

    if (result.ok) {
      setSheetOpen(false);
      setForm(EMPTY_FORM);
      await load();
    } else {
      setFormError(result.error.message);
    }
  };

  const handleRemove = async (id: string): Promise<void> => {
    setRemovingId(id);
    const result = await removeStaff(id);
    setRemovingId(null);
    setConfirmingId(null);
    if (result.ok) {
      await load();
    } else {
      window.alert(result.error.message);
    }
  };

  const dateFormatter = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar-LB' : 'en-GB',
    { dateStyle: 'medium' },
  );

  const roleLabel = (role: StaffRole): string =>
    role === 'SUPER_ADMIN' ? t.roleSuperAdmin : t.roleStaff;

  return (
    <section className="space-y-4 rounded-xl border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-xl font-semibold">{t.title}</h2>
            <p className="text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
        </div>
        <Button onClick={() => setSheetOpen(true)}>
          <UserPlus className="h-4 w-4" />
          {t.createButton}
        </Button>
      </div>

      {loading ? (
        <p className="inline-flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {dict.common.loading}
        </p>
      ) : loadError ? (
        <p className="inline-flex items-center gap-2 py-6 text-sm text-destructive">
          <TriangleAlert className="h-4 w-4" />
          {loadError}
        </p>
      ) : staff.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.colName}</TableHead>
                <TableHead>{t.colEmail}</TableHead>
                <TableHead>{t.colRole}</TableHead>
                <TableHead>{t.colCreated}</TableHead>
                <TableHead className="text-end">{t.colActions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((member) => {
                const isSelf = member.id === currentUserId;
                return (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        {member.fullName}
                        {isSelf ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {t.youBadge}
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {member.email}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                          member.role === 'SUPER_ADMIN'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {member.role === 'SUPER_ADMIN' ? (
                          <ShieldCheck className="h-3.5 w-3.5" />
                        ) : null}
                        {roleLabel(member.role)}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateFormatter.format(new Date(member.createdAt))}
                    </TableCell>
                    <TableCell className="text-end">
                      {isSelf ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : confirmingId === member.id ? (
                        <span className="inline-flex items-center gap-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={removingId === member.id}
                            onClick={() => void handleRemove(member.id)}
                          >
                            {removingId === member.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            {t.confirmRemove}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmingId(null)}
                          >
                            {dict.common.cancel}
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                          onClick={() => setConfirmingId(member.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                          {t.remove}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t.createTitle}
        description={t.createSubtitle}
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="staff-name">{t.fullNameLabel}</Label>
            <Input
              id="staff-name"
              value={form.fullName}
              onChange={(event) => patchForm({ fullName: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staff-email">{t.emailLabel}</Label>
            <Input
              id="staff-email"
              type="email"
              dir="ltr"
              autoComplete="off"
              value={form.email}
              onChange={(event) => patchForm({ email: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staff-password">{t.passwordLabel}</Label>
            <Input
              id="staff-password"
              type="text"
              dir="ltr"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => patchForm({ password: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t.passwordHint}</p>
          </div>
          <div className="space-y-2">
            <Label>{t.roleLabel}</Label>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['STAFF_MEMBER', t.roleStaff],
                  ['SUPER_ADMIN', t.roleSuperAdmin],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => patchForm({ role: value })}
                  className={cn(
                    'inline-flex h-12 items-center justify-center gap-2 rounded-lg border-2 text-sm font-medium transition-colors',
                    form.role === value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-input bg-background hover:border-primary/50',
                  )}
                >
                  {value === 'SUPER_ADMIN' ? (
                    <ShieldCheck className="h-4 w-4" />
                  ) : null}
                  {label}
                </button>
              ))}
            </div>
          </div>

          {formError ? (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {formError}
            </p>
          ) : null}

          <Button
            className="w-full"
            size="lg"
            disabled={creating}
            onClick={() => void handleCreate()}
          >
            {creating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {t.submitting}
              </>
            ) : (
              t.submit
            )}
          </Button>
        </div>
      </Sheet>
    </section>
  );
}
