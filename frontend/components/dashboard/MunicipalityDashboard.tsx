'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  ImageOff,
  Loader2,
  Mic,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getReportsSummary,
  getSpatialData,
  listDamageReports,
  logExportEvent,
  updateReportStatus,
} from '@/lib/api';
import { ADMIN_PATH } from '@/lib/constants';
import { Dictionary, Locale, fill } from '@/lib/i18n/dictionaries';
import { invalidateCached, useCached } from '@/lib/use-cached';
import {
  DamageSeverity,
  ReportListItem,
  ReportStatus,
  SpatialPoint,
  StatusSummary,
} from '@/lib/schemas/damage-report.schema';
import { DamageMapPanel } from './DamageMapPanel';

const ALL = 'ALL';

const STATUS_OPTIONS: readonly ReportStatus[] = [
  'PENDING',
  'UNDER_REVIEW',
  'VERIFIED',
  'APPROVED',
  'REJECTED',
];
const SEVERITY_OPTIONS: readonly DamageSeverity[] = ['TOTAL', 'PARTIAL', 'MINOR'];

const NEXT_STATUS: Partial<Record<ReportStatus, ReportStatus>> = {
  PENDING: 'UNDER_REVIEW',
  UNDER_REVIEW: 'VERIFIED',
  VERIFIED: 'APPROVED',
};

function statusBadgeVariant(
  status: ReportStatus,
): 'default' | 'secondary' | 'destructive' | 'success' | 'warning' {
  switch (status) {
    case 'PENDING':
      return 'secondary';
    case 'UNDER_REVIEW':
      return 'warning';
    case 'VERIFIED':
      return 'default';
    case 'APPROVED':
      return 'success';
    case 'REJECTED':
      return 'destructive';
  }
}

function severityBadgeVariant(
  severity: DamageSeverity,
): 'destructive' | 'warning' | 'secondary' {
  switch (severity) {
    case 'TOTAL':
      return 'destructive';
    case 'PARTIAL':
      return 'warning';
    case 'MINOR':
      return 'secondary';
  }
}

/** CSV cell escaping per RFC 4180. */
function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? '' : String(value);
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

  const [reports, setReports] = React.useState<ReportListItem[]>([]);
  const [totalPages, setTotalPages] = React.useState(1);
  const [totalCount, setTotalCount] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const [statusFilter, setStatusFilter] = React.useState<string>(ALL);
  const [severityFilter, setSeverityFilter] = React.useState<string>(ALL);
  const [neighborhood, setNeighborhood] = React.useState('');
  const [debouncedNeighborhood, setDebouncedNeighborhood] = React.useState('');

  // Debounce the free-text filter so each keystroke doesn't fire a
  // request against a backend that can be slow to respond.
  React.useEffect(() => {
    const handle = setTimeout(() => setDebouncedNeighborhood(neighborhood), 400);
    return () => clearTimeout(handle);
  }, [neighborhood]);

  // Any filter change restarts from the first page.
  React.useEffect(() => {
    setPage(1);
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

  // Aggregates ride the stale-while-revalidate cache: instant screen
  // switches, background refresh, busted after every status change.
  const summaryCache = useCached<StatusSummary>('reports:summary', () =>
    getReportsSummary(),
  );
  const summary = summaryCache.data;

  const spatialKey = `reports:spatial:${filters.status ?? '*'}:${filters.severity ?? '*'}:${filters.neighborhood ?? '*'}`;
  const spatialCache = useCached<SpatialPoint[]>(spatialKey, () =>
    getSpatialData(filters),
  );
  const spatialPoints = spatialCache.data ?? [];

  // Guards against out-of-order responses: if filters change again
  // before a slow request resolves, only the latest request's result
  // is allowed to land.
  const requestIdRef = React.useRef(0);

  const load = React.useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);

    const listResult = await listDamageReports({
      ...filters,
      page,
      pageSize: 20,
    });

    if (requestIdRef.current !== requestId) return;

    if (listResult.ok) {
      setReports(listResult.data.items);
      setTotalPages(listResult.data.totalPages);
      setTotalCount(listResult.data.totalCount);
    } else {
      setLoadError(listResult.error.message);
    }
    setLoading(false);
  }, [filters, page]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const refreshEverything = React.useCallback(async (): Promise<void> => {
    invalidateCached('reports:');
    await Promise.all([load(), summaryCache.refresh(), spatialCache.refresh()]);
  }, [load, summaryCache, spatialCache]);

  const changeStatus = async (
    report: ReportListItem,
    nextStatus: ReportStatus,
  ): Promise<void> => {
    let rejectionReason: string | undefined;
    if (nextStatus === 'REJECTED') {
      const reason = window.prompt(t.table.rejectPrompt);
      if (!reason || reason.trim().length < 5) return;
      rejectionReason = reason.trim();
    }
    setUpdatingId(report.id);
    const result = await updateReportStatus(report.id, nextStatus, rejectionReason);
    setUpdatingId(null);
    if (result.ok) {
      await refreshEverything();
    } else {
      window.alert(result.error.message);
    }
  };

  const exportCsv = (): void => {
    const header = [
      'id',
      t.table.reporter,
      dict.wizard.phoneLabel,
      t.table.asset,
      t.table.neighborhood,
      t.table.severity,
      t.table.status,
      t.table.proxy,
      'latitude',
      'longitude',
      t.table.date,
    ];
    const rows = reports.map((report) => [
      csvCell(report.id),
      csvCell(report.reporter.fullName),
      csvCell(report.reporter.phoneNumber),
      csvCell(t.asset[report.property.type]),
      csvCell(report.property.neighborhood),
      csvCell(t.severity[report.severity]),
      csvCell(t.status[report.status]),
      csvCell(report.submittedByProxy ? dict.common.yes : dict.common.no),
      csvCell(report.property.latitude),
      csvCell(report.property.longitude),
      csvCell(new Date(report.createdAt).toISOString()),
    ]);
    // BOM so Excel renders Arabic correctly.
    const csv =
      '\uFEFF' +
      [header.map(csvCell), ...rows].map((row) => row.join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `damage-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    // Record the export in the audit trail (fire-and-forget).
    void logExportEvent(reports.length);
  };

  const counters: Array<{ label: string; value: number; accent: string }> = [
    { label: t.counters.total, value: summary?.total ?? 0, accent: 'text-foreground' },
    { label: t.counters.pending, value: summary?.byStatus.PENDING ?? 0, accent: 'text-slate-500' },
    { label: t.counters.underReview, value: summary?.byStatus.UNDER_REVIEW ?? 0, accent: 'text-amber-600' },
    { label: t.counters.verified, value: summary?.byStatus.VERIFIED ?? 0, accent: 'text-blue-600' },
    { label: t.counters.approved, value: summary?.byStatus.APPROVED ?? 0, accent: 'text-emerald-600' },
    { label: t.counters.rejected, value: summary?.byStatus.REJECTED ?? 0, accent: 'text-red-600' },
  ];

  const dateFormatter = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar-LB' : 'en-GB',
    { dateStyle: 'medium' },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t.title}</h1>
          <p className="text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void refreshEverything()}
            disabled={loading}
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
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
          <Button
            variant="ghost"
            onClick={() => {
              setStatusFilter(ALL);
              setSeverityFilter(ALL);
              setNeighborhood('');
            }}
          >
            {t.filters.clear}
          </Button>
        </CardContent>
      </Card>

      {/* deck.gl damage map */}
      <DamageMapPanel
        dict={dict}
        locale={locale}
        points={spatialPoints}
        loading={spatialCache.loading}
      />

      {/* Reports table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {dict.common.loading}
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 p-12 text-center">
              <TriangleAlert className="h-8 w-8 text-destructive" />
              <p className="text-destructive">
                {t.table.loadError} {loadError}
              </p>
              <Button variant="outline" onClick={() => void load()}>
                {dict.common.retry}
              </Button>
            </div>
          ) : reports.length === 0 ? (
            <p className="p-12 text-center text-muted-foreground">
              {t.table.empty}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.table.reporter}</TableHead>
                  <TableHead>{t.table.asset}</TableHead>
                  <TableHead>{t.table.neighborhood}</TableHead>
                  <TableHead>{t.table.severity}</TableHead>
                  <TableHead>{t.table.status}</TableHead>
                  <TableHead>{t.table.date}</TableHead>
                  <TableHead>{t.table.media}</TableHead>
                  <TableHead>{t.table.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => {
                  const nextStatus = NEXT_STATUS[report.status];
                  const isUpdating = updatingId === report.id;
                  const hasMedia =
                    report.attachments.length > 0 || Boolean(report.voiceNoteUrl);
                  const isExpanded = expandedId === report.id;
                  return (
                    <React.Fragment key={report.id}>
                      <TableRow>
                        <TableCell>
                          <p className="font-medium">{report.reporter.fullName}</p>
                          <p className="text-xs text-muted-foreground" dir="ltr">
                            {report.reporter.phoneNumber}
                          </p>
                          {report.submittedByProxy ? (
                            <Badge variant="outline" className="mt-1">
                              {t.table.proxy}: {report.proxyName ?? '—'}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>{t.asset[report.property.type]}</TableCell>
                        <TableCell>{report.property.neighborhood}</TableCell>
                        <TableCell>
                          <Badge variant={severityBadgeVariant(report.severity)}>
                            {t.severity[report.severity]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(report.status)}>
                            {t.status[report.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {dateFormatter.format(new Date(report.createdAt))}
                        </TableCell>
                        <TableCell>
                          {hasMedia ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setExpandedId(isExpanded ? null : report.id)
                              }
                            >
                              {report.attachments.length > 0
                                ? fill(t.table.photoCount, {
                                    count: report.attachments.length,
                                  })
                                : t.table.voiceNote}
                              {isExpanded ? (
                                <ChevronUp className="h-3 w-3" />
                              ) : (
                                <ChevronDown className="h-3 w-3" />
                              )}
                            </Button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                              <ImageOff className="h-3.5 w-3.5" />
                              {t.table.noMedia}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button asChild variant="outline" size="sm">
                              <Link
                                href={`/${locale}/${ADMIN_PATH}/reports/${report.id}`}
                              >
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
                                  t.nextAction[
                                    report.status as keyof typeof t.nextAction
                                  ]
                                )}
                              </Button>
                            ) : null}
                            {report.status !== 'APPROVED' &&
                            report.status !== 'REJECTED' ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={isUpdating}
                                onClick={() => void changeStatus(report, 'REJECTED')}
                              >
                                {t.nextAction.reject}
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded ? (
                        <TableRow>
                          <TableCell colSpan={8} className="bg-muted/30">
                            <div className="flex flex-col gap-4 py-2">
                              {report.voiceNoteUrl ? (
                                <div className="flex items-center gap-3">
                                  <Mic className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <audio
                                    controls
                                    src={report.voiceNoteUrl}
                                    className="h-9 max-w-sm"
                                  />
                                </div>
                              ) : null}
                              {report.attachments.length > 0 ? (
                                <div className="flex flex-wrap gap-3">
                                  {report.attachments.map((attachment) => (
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
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Server-side pagination */}
      {totalPages > 1 || totalCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {fill(t.pagination.totalReports, { count: totalCount })}
          </span>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || page <= 1}
              onClick={() => setPage((previous) => Math.max(1, previous - 1))}
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              {t.pagination.previous}
            </Button>
            <span className="text-sm font-medium tabular-nums">
              {fill(t.pagination.pageOf, { current: page, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || page >= totalPages}
              onClick={() =>
                setPage((previous) => Math.min(totalPages, previous + 1))
              }
            >
              {t.pagination.next}
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
