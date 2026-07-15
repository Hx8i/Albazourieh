'use client';

import * as React from 'react';
import { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { ClipboardList } from 'lucide-react';
import { DataTable, DataTableLabels } from '@/components/ui/data-table';
import { AuditActionType, AuditLogItem, AuditSortField, SortDirection } from '@/lib/api';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import { toApiError } from '@/lib/query-client';
import { useAuditLogsQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface AuditTrailPanelProps {
  dict: Dictionary;
  locale: Locale;
}

const ACTION_BADGE_CLASS: Record<AuditActionType, string> = {
  CREATE_STAFF: 'bg-emerald-500/10 text-emerald-700',
  DELETE_STAFF: 'bg-red-500/10 text-red-700',
  UPDATE_REPORT_STATUS: 'bg-blue-500/10 text-blue-700',
  EDIT_REPORT_DATA: 'bg-purple-500/10 text-purple-700',
  EXPORT_DATA: 'bg-amber-500/10 text-amber-700',
};

/**
 * "تتبع العمليات" — the SUPER_ADMIN-only administrative audit trail:
 * who did what, to which record, and when. Server-driven pagination,
 * search and sorting via the shared DataTable. Rendering is gated by
 * the caller, but the backend enforces the role on the endpoint anyway.
 */
export function AuditTrailPanel({
  dict,
  locale,
}: AuditTrailPanelProps): React.JSX.Element {
  const t = dict.audit;

  const [search, setSearch] = React.useState('');
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'createdAt', desc: true },
  ]);
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const sort = sorting[0];
  const sortBy: AuditSortField = (sort?.id as AuditSortField) ?? 'createdAt';
  const sortDir: SortDirection = sort ? (sort.desc ? 'desc' : 'asc') : 'desc';

  const auditQuery = useAuditLogsQuery({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search.trim() || undefined,
    sortBy,
    sortDir,
  });

  const items = auditQuery.data?.items ?? [];
  const totalCount = auditQuery.data?.totalCount ?? 0;
  const loadErrorMessage = auditQuery.isError
    ? toApiError(auditQuery.error).message
    : null;

  const timeFormatter = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar-LB' : 'en-GB',
    { dateStyle: 'medium', timeStyle: 'short' },
  );

  const actionLabel = (action: AuditActionType): string => t.actions[action];

  /** Short, readable target reference (reports are UUIDs — clip them). */
  const targetLabel = (item: AuditLogItem): string =>
    item.actionType === 'UPDATE_REPORT_STATUS' || item.actionType === 'EDIT_REPORT_DATA'
      ? `#${item.targetId.slice(0, 8)}`
      : item.targetId.length > 24
        ? `${item.targetId.slice(0, 24)}…`
        : item.targetId;

  const dataTableLabels: DataTableLabels = {
    searchAriaLabel: t.search.label,
    searchPlaceholder: t.search.placeholder,
    clearSearch: t.search.clear,
    empty: t.empty,
    emptySearch: t.emptySearch,
    loadError: `${dict.dashboard.table.loadError} ${loadErrorMessage ?? ''}`.trim(),
    retry: dict.common.retry,
    previous: dict.dashboard.pagination.previous,
    next: dict.dashboard.pagination.next,
    pageOf: dict.dashboard.pagination.pageOf,
    rowsPerPage: dict.dashboard.pagination.rowsPerPage,
    totalRows: t.totalEntries,
    sortAscending: dict.dashboard.table.sortAscending,
    sortDescending: dict.dashboard.table.sortDescending,
    sortNone: dict.dashboard.table.sortNone,
  };

  const columns = React.useMemo<ColumnDef<AuditLogItem>[]>(
    () => [
      {
        id: 'adminName',
        accessorFn: (row) => row.adminName,
        header: t.colAdmin,
        meta: { cellClassName: 'font-medium' },
      },
      {
        id: 'actionType',
        accessorFn: (row) => row.actionType,
        header: t.colAction,
        cell: ({ row }) => (
          <span
            className={cn(
              'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold',
              ACTION_BADGE_CLASS[row.original.actionType],
            )}
          >
            {actionLabel(row.original.actionType)}
          </span>
        ),
      },
      {
        id: 'target',
        header: t.colTarget,
        enableSorting: false,
        meta: { cellClassName: 'font-mono text-xs' },
        cell: ({ row }) => (
          <span dir="ltr">{targetLabel(row.original)}</span>
        ),
      },
      {
        id: 'details',
        header: t.colDetails,
        enableSorting: false,
        meta: { cellClassName: 'max-w-[280px] text-sm text-muted-foreground' },
        cell: ({ row }) => {
          const displayDetails = locale === 'ar' && row.original.detailsAr ? row.original.detailsAr : row.original.details;
          return (
            <span dir="auto" className="block truncate" title={displayDetails}>
              {displayDetails}
            </span>
          );
        },
      },
      {
        id: 'createdAt',
        accessorFn: (row) => row.createdAt,
        header: t.colTime,
        meta: { headerClassName: 'w-[180px]', cellClassName: 'text-sm text-muted-foreground' },
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {timeFormatter.format(new Date(row.original.createdAt))}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, timeFormatter],
  );

  return (
    <section className="space-y-4 rounded-xl border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-xl font-semibold">{t.title}</h2>
            <p className="text-sm text-muted-foreground">{t.subtitle}</p>
          </div>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(row) => row.id}
        labels={dataTableLabels}
        manual
        pageCount={Math.max(1, Math.ceil(totalCount / pagination.pageSize))}
        totalRowCount={totalCount}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        searchValue={search}
        onSearchChange={setSearch}
        loading={auditQuery.isFetching}
        error={loadErrorMessage}
        onRetry={() => void auditQuery.refetch()}
        emptyIcon={<ClipboardList className="h-10 w-10 text-muted-foreground/60" />}
      />
    </section>
  );
}
