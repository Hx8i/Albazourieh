'use client';

import * as React from 'react';
import { ColumnDef } from '@tanstack/react-table';
import {
  Loader2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, DataTableLabels } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet } from '@/components/ui/sheet';
import { CreateStaffInput, StaffAccount, StaffRole } from '@/lib/api';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import { toApiError } from '@/lib/query-client';
import {
  useCreateStaffMutation,
  useRemoveStaffMutation,
  useStaffQuery,
} from '@/lib/queries';
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
 * boundary. The staff list is small enough to page/sort/search entirely
 * client-side via the shared DataTable.
 */
export function StaffManagementPanel({
  dict,
  locale,
  currentUserId,
}: StaffManagementPanelProps): React.JSX.Element {
  const t = dict.staff;

  const staffQuery = useStaffQuery();
  const staff = staffQuery.data ?? [];
  const loadErrorMessage = staffQuery.isError
    ? toApiError(staffQuery.error).message
    : null;

  const createStaffMutation = useCreateStaffMutation();
  const removeStaffMutation = useRemoveStaffMutation();

  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [form, setForm] = React.useState<CreateStaffInput>(EMPTY_FORM);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);

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

    setFormError(null);
    try {
      await createStaffMutation.mutateAsync({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
      });
      setSheetOpen(false);
      setForm(EMPTY_FORM);
    } catch (error) {
      setFormError(toApiError(error).message);
    }
  };

  const handleRemove = async (id: string): Promise<void> => {
    try {
      await removeStaffMutation.mutateAsync(id);
    } catch (error) {
      window.alert(toApiError(error).message);
    } finally {
      setConfirmingId(null);
    }
  };

  const dateFormatter = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar-LB' : 'en-GB',
    { dateStyle: 'medium' },
  );

  const roleLabel = (role: StaffRole): string =>
    role === 'SUPER_ADMIN' ? t.roleSuperAdmin : t.roleStaff;

  const dataTableLabels: DataTableLabels = {
    searchAriaLabel: t.searchLabel,
    searchPlaceholder: t.searchPlaceholder,
    clearSearch: dict.dashboard.search.clear,
    empty: t.empty,
    emptySearch: t.emptySearch,
    loadError: `${dict.dashboard.table.loadError} ${loadErrorMessage ?? ''}`.trim(),
    retry: dict.common.retry,
    previous: dict.dashboard.pagination.previous,
    next: dict.dashboard.pagination.next,
    pageOf: dict.dashboard.pagination.pageOf,
    rowsPerPage: dict.dashboard.pagination.rowsPerPage,
    totalRows: t.totalAccounts,
    sortAscending: dict.dashboard.table.sortAscending,
    sortDescending: dict.dashboard.table.sortDescending,
    sortNone: dict.dashboard.table.sortNone,
  };

  const columns = React.useMemo<ColumnDef<StaffAccount>[]>(
    () => [
      {
        id: 'fullName',
        accessorFn: (row) => row.fullName,
        header: t.colName,
        meta: { cellClassName: 'font-medium' },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            {row.original.fullName}
            {row.original.id === currentUserId ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {t.youBadge}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'email',
        accessorFn: (row) => row.email,
        header: t.colEmail,
        cell: ({ row }) => <span dir="ltr">{row.original.email}</span>,
      },
      {
        id: 'role',
        accessorFn: (row) => row.role,
        header: t.colRole,
        cell: ({ row }) => (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
              row.original.role === 'SUPER_ADMIN'
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {row.original.role === 'SUPER_ADMIN' ? (
              <ShieldCheck className="h-3.5 w-3.5" />
            ) : null}
            {roleLabel(row.original.role)}
          </span>
        ),
      },
      {
        id: 'createdAt',
        accessorFn: (row) => row.createdAt,
        header: t.colCreated,
        meta: { cellClassName: 'text-muted-foreground' },
        cell: ({ row }) => dateFormatter.format(new Date(row.original.createdAt)),
      },
      {
        id: 'actions',
        header: t.colActions,
        enableSorting: false,
        meta: { headerClassName: 'text-end', cellClassName: 'text-end' },
        cell: ({ row }) => {
          const member = row.original;
          const isSelf = member.id === currentUserId;
          if (isSelf) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          if (confirmingId === member.id) {
            return (
              <span className="inline-flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={removeStaffMutation.isPending && removeStaffMutation.variables === member.id}
                  onClick={() => void handleRemove(member.id)}
                >
                  {removeStaffMutation.isPending && removeStaffMutation.variables === member.id ? (
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
            );
          }
          return (
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => setConfirmingId(member.id)}
            >
              <Trash2 className="h-4 w-4" />
              {t.remove}
            </Button>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, dict.common.cancel, currentUserId, confirmingId, removeStaffMutation, dateFormatter],
  );

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

      <DataTable
        columns={columns}
        data={staff}
        getRowId={(row) => row.id}
        labels={dataTableLabels}
        loading={staffQuery.isFetching}
        error={loadErrorMessage}
        onRetry={() => void staffQuery.refetch()}
        pageSizeOptions={[10, 20, 50]}
        emptyIcon={<Users className="h-10 w-10 text-muted-foreground/60" />}
      />

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
            disabled={createStaffMutation.isPending}
            onClick={() => void handleCreate()}
          >
            {createStaffMutation.isPending ? (
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
