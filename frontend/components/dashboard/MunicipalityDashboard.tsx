"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ColumnDef, PaginationState, SortingState } from "@tanstack/react-table";
import { Download, FileText, ImageOff, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, DataTableLabels } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReportSortField, SortDirection } from "@/lib/api";
import { ADMIN_PATH } from "@/lib/constants";
import { Dictionary, Locale, fill } from "@/lib/i18n/dictionaries";
import { toApiError } from "@/lib/query-client";
import {
  queryKeys,
  useLogExportMutation,
  useReportsQuery,
  useReportsSummaryQuery,
  useSpatialQuery,
  useUpdateReportStatusMutation,
} from "@/lib/queries";
import {
  DamageSeverity,
  ReportListItem,
  ReportStatus,
} from "@/lib/schemas/damage-report.schema";
import { DamageMapPanel } from "./DamageMapPanel";
import { RejectReasonDialog } from "./RejectReasonDialog";

const ALL = "ALL";
const CELL_PADDING = "py-3";

const STATUS_OPTIONS: readonly ReportStatus[] = [
  "PENDING",
  "UNDER_REVIEW",
  "VERIFIED",
  "APPROVED",
  "REJECTED",
];
const SEVERITY_OPTIONS: readonly DamageSeverity[] = [
  "TOTAL",
  "PARTIAL",
  "MINOR",
];

const NEXT_STATUS: Partial<Record<ReportStatus, ReportStatus>> = {
  PENDING: "UNDER_REVIEW",
  UNDER_REVIEW: "VERIFIED",
  VERIFIED: "APPROVED",
};

function statusBadgeVariant(
  status: ReportStatus,
): "default" | "secondary" | "destructive" | "success" | "warning" {
  switch (status) {
    case "PENDING":
      return "secondary";
    case "UNDER_REVIEW":
      return "warning";
    case "VERIFIED":
      return "default";
    case "APPROVED":
      return "success";
    case "REJECTED":
      return "destructive";
  }
}

function severityBadgeVariant(
  severity: DamageSeverity,
): "destructive" | "warning" | "secondary" {
  switch (severity) {
    case "TOTAL":
      return "destructive";
    case "PARTIAL":
      return "warning";
    case "MINOR":
      return "secondary";
  }
}

/** CSV cell escaping per RFC 4180. */
function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

interface MunicipalityDashboardProps {
  dict: Dictionary;
  locale: Locale;
}

export function MunicipalityDashboard({
  dict,
  locale,
}: MunicipalityDashboardProps): React.JSX.Element {
  const t = dict.dashboard;
  const queryClient = useQueryClient();

  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  // Report awaiting a rejection reason in the modal (null = modal closed).
  const [rejectTarget, setRejectTarget] =
    React.useState<ReportListItem | null>(null);
  const [rejectError, setRejectError] = React.useState<string | null>(null);

  const [statusFilter, setStatusFilter] = React.useState<string>(ALL);
  const [severityFilter, setSeverityFilter] = React.useState<string>(ALL);
  const [neighborhood, setNeighborhood] = React.useState("");
  const [debouncedNeighborhood, setDebouncedNeighborhood] = React.useState("");

  // Global search (name, phone, property №, reference code), sorting and
  // pagination are all owned by the DataTable — this panel only holds the
  // *committed* values so they can be sent to the paginated API.
  const [search, setSearch] = React.useState("");
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  React.useEffect(() => {
    const handle = setTimeout(
      () => setDebouncedNeighborhood(neighborhood),
      400,
    );
    return () => clearTimeout(handle);
  }, [neighborhood]);

  React.useEffect(() => {
    setPagination((previous) =>
      previous.pageIndex === 0 ? previous : { ...previous, pageIndex: 0 },
    );
  }, [statusFilter, severityFilter, debouncedNeighborhood]);

  const filters = React.useMemo(
    () => ({
      status: statusFilter === ALL ? undefined : (statusFilter as ReportStatus),
      severity:
        severityFilter === ALL ? undefined : (severityFilter as DamageSeverity),
      neighborhood: debouncedNeighborhood.trim() || undefined,
    }),
    [statusFilter, severityFilter, debouncedNeighborhood],
  );

  const sort = sorting[0];
  const sortBy: ReportSortField = (sort?.id as ReportSortField) ?? "createdAt";
  const sortDir: SortDirection = sort ? (sort.desc ? "desc" : "asc") : "desc";

  const listParams = React.useMemo(
    () => ({
      ...filters,
      search: search.trim() || undefined,
      sortBy,
      sortDir,
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
    }),
    [filters, search, sortBy, sortDir, pagination],
  );

  const reportsQuery = useReportsQuery(listParams);
  const summaryQuery = useReportsSummaryQuery();
  const spatialQuery = useSpatialQuery(filters);

  const reports = reportsQuery.data?.items ?? [];
  const totalCount = reportsQuery.data?.totalCount ?? 0;
  const summary = summaryQuery.data;
  const spatialPoints = spatialQuery.data ?? [];

  const updateStatus = useUpdateReportStatusMutation();
  const logExport = useLogExportMutation();

  const refreshEverything = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
  };

  /** Forward lifecycle transitions (start review / verify / approve). */
  const changeStatus = async (
    report: ReportListItem,
    nextStatus: ReportStatus,
  ): Promise<void> => {
    setUpdatingId(report.id);
    try {
      await updateStatus.mutateAsync({ id: report.id, status: nextStatus });
    } catch (error) {
      window.alert(toApiError(error).message);
    } finally {
      setUpdatingId(null);
    }
  };

  const closeRejectDialog = (): void => {
    setRejectTarget(null);
    setRejectError(null);
  };

  /** Reject with a mandatory reason collected by the modal. */
  const confirmReject = async (reason: string): Promise<void> => {
    if (!rejectTarget) return;
    setRejectError(null);
    setUpdatingId(rejectTarget.id);
    try {
      await updateStatus.mutateAsync({
        id: rejectTarget.id,
        status: "REJECTED",
        rejectionReason: reason,
      });
      closeRejectDialog();
    } catch (error) {
      setRejectError(toApiError(error).message);
    } finally {
      setUpdatingId(null);
    }
  };

  const exportCsv = (): void => {
    const header = [
      t.table.reference,
      t.table.reporter,
      dict.wizard.phoneLabel,
      t.table.asset,
      t.table.propertyNumber,
      t.table.neighborhood,
      t.table.severity,
      t.table.status,
      "latitude",
      "longitude",
      t.table.date,
    ];
    const rows = reports.map((report) => [
      csvCell(report.referenceCode),
      csvCell(report.reporter.fullName),
      csvCell(report.reporter.phoneNumber),
      csvCell(t.asset[report.property.type]),
      csvCell(report.property.realEstateNumber),
      csvCell(report.property.neighborhood),
      csvCell(t.severity[report.severity]),
      csvCell(t.status[report.status]),
      csvCell(report.property.latitude),
      csvCell(report.property.longitude),
      csvCell(new Date(report.createdAt).toISOString()),
    ]);
    // BOM so Excel renders Arabic correctly.
    const csv =
      "﻿" +
      [header.map(csvCell), ...rows].map((row) => row.join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `damage-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    // Record the export in the audit trail (fire-and-forget).
    logExport.mutate(reports.length);
  };

  const counters: Array<{ label: string; value: number; accent: string }> = [
    {
      label: t.counters.total,
      value: summary?.total ?? 0,
      accent: "text-foreground",
    },
    {
      label: t.counters.pending,
      value: summary?.byStatus.PENDING ?? 0,
      accent: "text-slate-500",
    },
    {
      label: t.counters.underReview,
      value: summary?.byStatus.UNDER_REVIEW ?? 0,
      accent: "text-amber-600",
    },
    {
      label: t.counters.verified,
      value: summary?.byStatus.VERIFIED ?? 0,
      accent: "text-blue-600",
    },
    {
      label: t.counters.approved,
      value: summary?.byStatus.APPROVED ?? 0,
      accent: "text-emerald-600",
    },
    {
      label: t.counters.rejected,
      value: summary?.byStatus.REJECTED ?? 0,
      accent: "text-red-600",
    },
  ];

  const dateFormatter = new Intl.DateTimeFormat(
    locale === "ar" ? "ar-LB" : "en-GB",
    { dateStyle: "medium" },
  );

  const clearAllCriteria = (): void => {
    setStatusFilter(ALL);
    setSeverityFilter(ALL);
    setNeighborhood("");
    setSearch("");
  };

  const loadErrorMessage = reportsQuery.isError
    ? toApiError(reportsQuery.error).message
    : null;

  const dataTableLabels: DataTableLabels = {
    searchAriaLabel: t.search.label,
    searchPlaceholder: t.search.placeholder,
    clearSearch: t.search.clear,
    empty: t.table.empty,
    emptySearch: t.table.emptySearch,
    loadError: `${t.table.loadError} ${loadErrorMessage ?? ""}`.trim(),
    retry: dict.common.retry,
    previous: t.pagination.previous,
    next: t.pagination.next,
    pageOf: t.pagination.pageOf,
    rowsPerPage: t.pagination.rowsPerPage,
    totalRows: t.pagination.totalReports,
    sortAscending: t.table.sortAscending,
    sortDescending: t.table.sortDescending,
    sortNone: t.table.sortNone,
  };

  const columns = React.useMemo<ColumnDef<ReportListItem>[]>(
    () => [
      {
        id: "referenceCode",
        accessorFn: (row) => row.referenceCode,
        header: t.table.reference,
        meta: { headerClassName: "w-[110px]", cellClassName: CELL_PADDING },
        cell: ({ row }) => (
          <span
            className="rounded bg-muted px-2 py-1 font-mono text-xs font-semibold tracking-wider"
            dir="ltr"
          >
            {row.original.referenceCode}
          </span>
        ),
      },
      {
        id: "reporterName",
        accessorFn: (row) => row.reporter.fullName,
        header: t.table.reporter,
        meta: { headerClassName: "min-w-[180px]", cellClassName: CELL_PADDING },
        cell: ({ row }) => (
          <div>
            <p className="max-w-[220px] truncate font-medium leading-tight">
              {row.original.reporter.fullName}
            </p>
            <p className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              {row.original.reporter.phoneNumber}
            </p>
          </div>
        ),
      },
      {
        id: "asset",
        accessorFn: (row) => row.property.type,
        header: t.table.asset,
        enableSorting: false,
        meta: { headerClassName: "w-[110px]", cellClassName: CELL_PADDING },
        cell: ({ row }) => (
          <div>
            <p>{t.asset[row.original.property.type]}</p>
            {row.original.property.realEstateNumber ? (
              <p
                className="text-xs tabular-nums text-muted-foreground"
                dir="ltr"
              >
                #{row.original.property.realEstateNumber}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        id: "neighborhood",
        accessorFn: (row) => row.property.neighborhood,
        header: t.table.neighborhood,
        meta: { headerClassName: "min-w-[130px]", cellClassName: CELL_PADDING },
        cell: ({ row }) => (
          <span className="block max-w-[180px] truncate">
            {row.original.property.neighborhood}
          </span>
        ),
      },
      {
        id: "severity",
        accessorFn: (row) => row.severity,
        header: t.table.severity,
        meta: { headerClassName: "w-[100px]", cellClassName: CELL_PADDING },
        cell: ({ row }) => (
          <Badge variant={severityBadgeVariant(row.original.severity)}>
            {t.severity[row.original.severity]}
          </Badge>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: t.table.status,
        meta: { headerClassName: "w-[120px]", cellClassName: CELL_PADDING },
        cell: ({ row }) => (
          <Badge variant={statusBadgeVariant(row.original.status)}>
            {t.status[row.original.status]}
          </Badge>
        ),
      },
      {
        id: "createdAt",
        accessorFn: (row) => row.createdAt,
        header: t.table.date,
        meta: { headerClassName: "w-[120px]", cellClassName: CELL_PADDING },
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {dateFormatter.format(new Date(row.original.createdAt))}
          </span>
        ),
      },
      {
        id: "media",
        header: t.table.media,
        enableSorting: false,
        meta: { headerClassName: "w-[110px]", cellClassName: CELL_PADDING },
        cell: ({ row }) =>
          row.original.attachments.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              aria-expanded={row.getIsExpanded()}
              onClick={() => row.toggleExpanded()}
            >
              {fill(t.table.photoCount, {
                count: row.original.attachments.length,
              })}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <ImageOff className="h-3.5 w-3.5" />
              {t.table.noMedia}
            </span>
          ),
      },
      {
        id: "actions",
        header: t.table.actions,
        enableSorting: false,
        meta: { headerClassName: "min-w-[220px]", cellClassName: CELL_PADDING },
        cell: ({ row }) => {
          const report = row.original;
          const nextStatus = NEXT_STATUS[report.status];
          const isUpdating = updatingId === report.id;
          return (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/${locale}/${ADMIN_PATH}/reports/${report.id}`}>
                  <FileText className="h-3.5 w-3.5" />
                  {t.table.viewCase}
                </Link>
              </Button>
              {nextStatus ? (
                <Button
                  size="sm"
                  disabled={isUpdating}
                  onClick={() => void changeStatus(report, nextStatus)}
                >
                  {isUpdating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t.nextAction[report.status as keyof typeof t.nextAction]
                  )}
                </Button>
              ) : null}
              {report.status !== "APPROVED" && report.status !== "REJECTED" ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={isUpdating}
                  onClick={() => setRejectTarget(report)}
                >
                  {t.nextAction.reject}
                </Button>
              ) : null}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, locale, updatingId, dateFormatter],
  );

  const isRefreshing =
    reportsQuery.isFetching || summaryQuery.isFetching || spatialQuery.isFetching;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t.title}</h1>
          <p className="text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refreshEverything} disabled={isRefreshing}>
            <RefreshCw
              className={isRefreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            />
            {t.refresh}
          </Button>
          <Button onClick={exportCsv} disabled={reports.length === 0}>
            <Download className="h-4 w-4" />
            {t.exportCsv}
          </Button>
        </div>
      </div>

      {/* Status counters */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
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

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{t.filters.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>{t.filters.status}</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t.filters.all}</SelectItem>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t.status[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t.filters.severity}</Label>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t.filters.all}</SelectItem>
                {SEVERITY_OPTIONS.map((severity) => (
                  <SelectItem key={severity} value={severity}>
                    {t.severity[severity]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t.filters.neighborhood}</Label>
            <Input
              className="h-10"
              placeholder={t.filters.neighborhoodPlaceholder}
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
            />
          </div>
          <Button variant="ghost" onClick={clearAllCriteria}>
            {t.filters.clear}
          </Button>
        </CardContent>
      </Card>

      {/* deck.gl damage map */}
      <DamageMapPanel
        dict={dict}
        locale={locale}
        points={spatialPoints}
        loading={spatialQuery.isFetching}
      />

      {/* Global search, sort, paginate + reports table */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-lg">{t.table.title}</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <DataTable
            columns={columns}
            data={reports}
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
            loading={reportsQuery.isFetching}
            error={loadErrorMessage}
            onRetry={() => void reportsQuery.refetch()}
            renderSubRow={(row) => (
              <div className="flex flex-wrap gap-3 py-2">
                {row.original.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    title={t.table.openFullSize}
                    className="block h-24 w-24 overflow-hidden rounded-md border bg-background"
                  >
                    <img
                      src={attachment.url}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            )}
            getRowCanExpand={(row) => row.original.attachments.length > 0}
          />
        </CardContent>
      </Card>

      {/* Rejection-reason module (replaces the native window.prompt) */}
      <RejectReasonDialog
        open={rejectTarget !== null}
        pending={updateStatus.isPending}
        error={rejectError}
        labels={{
          title: t.rejectDialog.title,
          subtitle: fill(t.rejectDialog.subtitle, {
            reference: rejectTarget?.referenceCode ?? "",
          }),
          reasonLabel: t.rejectDialog.reasonLabel,
          placeholder: t.rejectDialog.placeholder,
          minLengthHint: t.rejectDialog.minLengthHint,
          confirm: t.rejectDialog.confirm,
          cancel: t.rejectDialog.cancel,
          close: t.rejectDialog.close,
        }}
        onConfirm={(reason) => void confirmReject(reason)}
        onClose={closeRejectDialog}
      />
    </div>
  );
}
