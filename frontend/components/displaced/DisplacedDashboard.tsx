'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import {
  FileText,
  ImageOff,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, DataTableLabels } from '@/components/ui/data-table';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DisplacedSortField, SortDirection } from '@/lib/api';
import { Dictionary, Locale, fill } from '@/lib/i18n/dictionaries';
import { toApiError } from '@/lib/query-client';
import {
  queryKeys,
  useDisplacedListQuery,
  useDisplacedSummaryQuery,
} from '@/lib/queries';
import {
  DisplacedAudience,
  DisplacedItem,
  DisplacedStatus,
  LebaneseDisplacedItem,
  SyrianDisplacedItem,
} from '@/lib/schemas/displaced.schema';
import { NeedsBarChart } from './DisplacedCharts';
import { DisplacedEditDialog } from './DisplacedEditDialog';

const ALL = 'ALL';
const CELL_PADDING = 'py-3';

const STATUS_OPTIONS: readonly DisplacedStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
];

function statusBadgeVariant(
  status: DisplacedStatus,
): 'secondary' | 'success' | 'destructive' {
  switch (status) {
    case 'PENDING':
      return 'secondary';
    case 'APPROVED':
      return 'success';
    case 'REJECTED':
      return 'destructive';
  }
}

interface DisplacedDashboardProps {
  dict: Dictionary;
  locale: Locale;
  audience: DisplacedAudience;
}

/**
 * Analytics + triage workspace for one displaced-persons programme.
 * Instantiated once per audience; every query, cache key and endpoint it
 * touches is namespaced to that audience, so Syrian and Lebanese figures
 * can never blend.
 */
export function DisplacedDashboard({
  dict,
  locale,
  audience,
}: DisplacedDashboardProps): React.JSX.Element {
  const t = dict.displaced;
  const tDash = t.dashboard;
  const tAudience = audience === 'syrian' ? t.syrian : t.lebanese;
  const queryClient = useQueryClient();

  const [editingItem, setEditingItem] = React.useState<DisplacedItem | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<string>(ALL);
  const [search, setSearch] = React.useState('');
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'createdAt', desc: true },
  ]);
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  React.useEffect(() => {
    setPagination((previous) =>
      previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
    );
  }, [statusFilter]);

  const sort = sorting[0];
  const sortBy: DisplacedSortField =
    (sort?.id as DisplacedSortField) ?? 'createdAt';
  const sortDir: SortDirection = sort ? (sort.desc ? 'desc' : 'asc') : 'desc';

  const listParams = React.useMemo(
    () => ({
      status:
        statusFilter === ALL ? undefined : (statusFilter as DisplacedStatus),
      search: search.trim() || undefined,
      sortBy,
      sortDir,
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
    }),
    [statusFilter, search, sortBy, sortDir, pagination],
  );

  const listQuery = useDisplacedListQuery(audience, listParams);
  const summaryQuery = useDisplacedSummaryQuery(audience);

  const rows = listQuery.data?.items ?? [];
  const totalCount = listQuery.data?.totalCount ?? 0;
  const summary = summaryQuery.data;

  const refreshEverything = (): void => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.displaced.all(audience),
    });
  };

  const counters: Array<{ label: string; value: number; accent: string }> = [
    {
      label: tDash.counters.total,
      value: summary?.total ?? 0,
      accent: 'text-foreground',
    },
    {
      label: tDash.counters.familyMembers,
      value: summary?.totalFamilyMembers ?? 0,
      accent: 'text-blue-600',
    },
    {
      label: tDash.counters.urgent,
      value: summary?.urgentCases ?? 0,
      accent: 'text-red-600',
    },
    {
      label: tDash.counters.pending,
      value: summary?.byStatus.PENDING ?? 0,
      accent: 'text-amber-600',
    },
  ];

  const dateFormatter = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar-LB' : 'en-GB',
    { dateStyle: 'medium' },
  );

  const loadErrorMessage = listQuery.isError
    ? toApiError(listQuery.error).message
    : null;

  const dataTableLabels: DataTableLabels = {
    searchAriaLabel: tDash.search.label,
    searchPlaceholder: tDash.search.placeholder,
    clearSearch: tDash.search.clear,
    empty: tDash.table.empty,
    emptySearch: tDash.table.emptySearch,
    loadError: `${tDash.table.loadError} ${loadErrorMessage ?? ''}`.trim(),
    retry: dict.common.retry,
    previous: tDash.pagination.previous,
    next: tDash.pagination.next,
    pageOf: tDash.pagination.pageOf,
    rowsPerPage: tDash.pagination.rowsPerPage,
    totalRows: tDash.pagination.totalRows,
    sortAscending: tDash.table.sortAscending,
    sortDescending: tDash.table.sortDescending,
    sortNone: tDash.table.sortNone,
  };

  const columns = React.useMemo<ColumnDef<DisplacedItem>[]>(
    () => [
      {
        id: 'fullName',
        accessorFn: (row) => row.fullName,
        header: tDash.table.name,
        meta: { headerClassName: 'min-w-[180px]', cellClassName: CELL_PADDING },
        cell: ({ row }) => (
          <div>
            <p className="max-w-[220px] truncate font-medium leading-tight">
              {row.original.fullName}
            </p>
            <p className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              {row.original.phone}
            </p>
          </div>
        ),
      },
      {
        id: 'familyMembersCount',
        accessorFn: (row) => row.familyMembersCount,
        header: tDash.table.family,
        meta: { headerClassName: 'w-[110px]', cellClassName: CELL_PADDING },
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm">
            {fill(tDash.table.membersShort, {
              count: row.original.familyMembersCount,
            })}
          </span>
        ),
      },
      {
        id: 'origin',
        header: tDash.table.origin,
        enableSorting: false,
        meta: { headerClassName: 'min-w-[180px]', cellClassName: CELL_PADDING },
        cell: ({ row }) => {
          const origin =
            audience === 'syrian'
              ? (row.original as SyrianDisplacedItem).originalCity
              : (row.original as LebaneseDisplacedItem).originVillage;
          return (
            <div>
              <p className="font-medium">{origin}</p>
              <p className="max-w-[170px] truncate text-xs text-muted-foreground" title={row.original.familyMembersNames}>
                {row.original.familyMembersNames}
              </p>
            </div>
          );
        },
      },
      audience === 'syrian'
        ? {
            id: 'shelter',
            header: tDash.table.shelter,
            enableSorting: false,
            meta: {
              headerClassName: 'min-w-[150px]',
              cellClassName: CELL_PADDING,
            },
            cell: ({ row }) => {
              const item = row.original as SyrianDisplacedItem;
              return (
                <div>
                  <p>{t.shelterTypes[item.shelterType]}</p>
                  <p
                    className="text-xs tabular-nums text-muted-foreground"
                    dir="ltr"
                  >
                    {item.registrationNumber
                      ? `${tDash.table.registrationNumber} ${item.registrationNumber}`
                      : tDash.table.unregistered}
                  </p>
                </div>
              );
            },
          }
        : {
            id: 'property',
            header: tDash.table.propertyDamaged,
            enableSorting: false,
            meta: {
              headerClassName: 'min-w-[150px]',
              cellClassName: CELL_PADDING,
            },
            cell: ({ row }) => {
              const item = row.original as LebaneseDisplacedItem;
              return (
                <div className="space-y-1">
                  <Badge
                    variant={item.isPropertyDamaged ? 'warning' : 'outline'}
                  >
                    {item.isPropertyDamaged
                      ? tDash.table.propertyDamaged
                      : tDash.table.propertyIntact}
                  </Badge>
                  {item.primarySourceOfIncome ? (
                    <p className="max-w-[170px] truncate text-xs text-muted-foreground">
                      {tDash.table.income}: {item.primarySourceOfIncome}
                    </p>
                  ) : null}
                </div>
              );
            },
          },
      {
        id: 'needs',
        header: tDash.table.needs,
        enableSorting: false,
        meta: { headerClassName: 'min-w-[160px]', cellClassName: CELL_PADDING },
        cell: ({ row }) =>
          row.original.urgentNeeds.length > 0 ? (
            <div className="flex max-w-[200px] flex-wrap gap-1">
              {row.original.urgentNeeds.map((need) => (
                <Badge key={need} variant="secondary">
                  {t.needs[need]}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {tDash.table.noNeeds}
            </span>
          ),
      },
      {
        id: 'idDocument',
        header: tDash.table.idDocument,
        enableSorting: false,
        meta: { headerClassName: 'w-[110px]', cellClassName: CELL_PADDING },
        cell: ({ row }) =>
          row.original.idDocumentUrl ? (
            <Button asChild variant="outline" size="sm">
              <a
                href={row.original.idDocumentUrl}
                target="_blank"
                rel="noreferrer"
              >
                <FileText className="h-3.5 w-3.5" />
                {tDash.table.viewId}
              </a>
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <ImageOff className="h-3.5 w-3.5" />
              {tDash.table.noId}
            </span>
          ),
      },
      {
        id: 'status',
        accessorFn: (row) => row.status,
        header: tDash.table.status,
        meta: { headerClassName: 'w-[110px]', cellClassName: CELL_PADDING },
        cell: ({ row }) => (
          <Badge variant={statusBadgeVariant(row.original.status)}>
            {t.status[row.original.status]}
          </Badge>
        ),
      },
      {
        id: 'createdAt',
        accessorFn: (row) => row.createdAt,
        header: tDash.table.date,
        meta: { headerClassName: 'w-[120px]', cellClassName: CELL_PADDING },
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {dateFormatter.format(new Date(row.original.createdAt))}
          </span>
        ),
      },
      {
        id: 'actions',
        header: tDash.table.actions,
        enableSorting: false,
        meta: { headerClassName: 'w-[100px]', cellClassName: CELL_PADDING },
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditingItem(item)}
              >
                <FileText className="h-3.5 w-3.5" />
                {tDash.table.edit}
              </Button>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tDash, audience, dateFormatter],
  );

  const isRefreshing = listQuery.isFetching || summaryQuery.isFetching;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{tAudience.dashboardTitle}</h1>
          <p className="text-muted-foreground">{tAudience.dashboardSubtitle}</p>
        </div>
        <Button
          variant="outline"
          onClick={refreshEverything}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
          />
          {tDash.refresh}
        </Button>
      </div>

      {/* Summary metric cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {counters.map((counter) => (
          <Card key={counter.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{counter.label}</p>
              <p className={`text-3xl font-bold ${counter.accent}`}>
                {counter.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div>
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {tDash.charts.needsTitle}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {tDash.charts.needsSubtitle}
            </p>
          </CardHeader>
          <CardContent>
            <NeedsBarChart
              dict={dict}
              needs={
                summary?.needs ?? { FOOD: 0, MEDICAL: 0, SHELTER: 0, CASH: 0 }
              }
            />
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{tDash.filters.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 items-end gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>{tDash.filters.status}</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{tDash.filters.all}</SelectItem>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t.status[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1" />
          <Button
            variant="ghost"
            onClick={() => {
              setStatusFilter(ALL);
              setSearch('');
            }}
          >
            {tDash.filters.clear}
          </Button>
        </CardContent>
      </Card>

      {/* Registrations table */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-lg">{tDash.table.title}</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <DataTable
            columns={columns}
            data={rows}
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
            loading={listQuery.isFetching}
            error={loadErrorMessage}
            onRetry={() => void listQuery.refetch()}
          />
        </CardContent>
      </Card>

      <DisplacedEditDialog
        open={editingItem !== null}
        audience={audience}
        item={editingItem}
        dict={dict}
        onClose={() => setEditingItem(null)}
      />
    </div>
  );
}
