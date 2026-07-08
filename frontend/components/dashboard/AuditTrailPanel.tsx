'use client';

import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AuditActionType, AuditLogItem, listAuditLogs } from '@/lib/api';
import { Dictionary, Locale, fill } from '@/lib/i18n/dictionaries';
import { cn } from '@/lib/utils';

interface AuditTrailPanelProps {
  dict: Dictionary;
  locale: Locale;
}

const PAGE_SIZE = 10;

const ACTION_BADGE_CLASS: Record<AuditActionType, string> = {
  CREATE_STAFF: 'bg-emerald-500/10 text-emerald-700',
  DELETE_STAFF: 'bg-red-500/10 text-red-700',
  UPDATE_REPORT_STATUS: 'bg-blue-500/10 text-blue-700',
  EXPORT_DATA: 'bg-amber-500/10 text-amber-700',
};

/**
 * "تتبع العمليات" — the SUPER_ADMIN-only administrative audit trail:
 * who did what, to which record, and when. High-contrast, newest first,
 * with standard pagination. Rendering is gated by the caller, but the
 * backend enforces the role on the endpoint regardless.
 */
export function AuditTrailPanel({
  dict,
  locale,
}: AuditTrailPanelProps): React.JSX.Element {
  const t = dict.audit;

  const [items, setItems] = React.useState<AuditLogItem[]>([]);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [totalCount, setTotalCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // Out-of-order guard for fast page flipping.
  const requestIdRef = React.useRef(0);

  const load = React.useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    const result = await listAuditLogs(page, PAGE_SIZE);
    if (requestIdRef.current !== requestId) return;

    if (result.ok) {
      setItems(result.data.items);
      setTotalPages(result.data.totalPages);
      setTotalCount(result.data.totalCount);
    } else {
      setLoadError(result.error.message);
    }
    setLoading(false);
  }, [page]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const timeFormatter = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar-LB' : 'en-GB',
    { dateStyle: 'medium', timeStyle: 'short' },
  );

  const actionLabel = (action: AuditActionType): string => t.actions[action];

  /** Short, readable target reference (reports are UUIDs — clip them). */
  const targetLabel = (item: AuditLogItem): string =>
    item.actionType === 'UPDATE_REPORT_STATUS'
      ? `#${item.targetId.slice(0, 8)}`
      : item.targetId.length > 24
        ? `${item.targetId.slice(0, 24)}…`
        : item.targetId;

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
        <span className="text-sm text-muted-foreground">
          {fill(t.totalEntries, { count: totalCount })}
        </span>
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
      ) : items.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.colAdmin}</TableHead>
                <TableHead>{t.colAction}</TableHead>
                <TableHead>{t.colTarget}</TableHead>
                <TableHead>{t.colDetails}</TableHead>
                <TableHead>{t.colTime}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.adminName}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold',
                        ACTION_BADGE_CLASS[item.actionType],
                      )}
                    >
                      {actionLabel(item.actionType)}
                    </span>
                  </TableCell>
                  <TableCell dir="ltr" className="text-start font-mono text-xs">
                    {targetLabel(item)}
                  </TableCell>
                  <TableCell
                    dir="ltr"
                    className="max-w-[280px] truncate text-start text-sm text-muted-foreground"
                    title={item.details}
                  >
                    {item.details}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {timeFormatter.format(new Date(item.createdAt))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page <= 1}
            onClick={() => setPage((previous) => Math.max(1, previous - 1))}
          >
            <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
            {dict.dashboard.pagination.previous}
          </Button>
          <span className="text-sm font-medium tabular-nums">
            {fill(dict.dashboard.pagination.pageOf, {
              current: page,
              total: totalPages,
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page >= totalPages}
            onClick={() =>
              setPage((previous) => Math.min(totalPages, previous + 1))
            }
          >
            {dict.dashboard.pagination.next}
            <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
