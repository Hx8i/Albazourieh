'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Eye,
  FileText,
  Loader2,
  Pencil,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DocumentViewerDialog } from '@/components/DocumentViewerDialog';
import {
  DisplacedAudience,
  DisplacedStatus,
  LebaneseDisplacedItem,
  MAX_ID_DOCUMENTS_PER_REGISTRATION,
  SHELTER_WITHOUT_CONTACT,
  SyrianDisplacedItem,
} from '@/lib/schemas/displaced.schema';
import {
  useDeleteDisplacedIdDocumentMutation,
  useDisplacedDetailQuery,
  useLogDisplacedViewMutation,
  useUploadDisplacedIdDocumentsMutation,
} from '@/lib/queries';
import { toApiError } from '@/lib/query-client';
import { Dictionary, Locale, fill } from '@/lib/i18n/dictionaries';
import { DisplacedEditDialog } from './DisplacedEditDialog';

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

interface DisplacedDetailViewProps {
  dict: Dictionary;
  locale: Locale;
  audience: DisplacedAudience;
  id: string;
}

/**
 * Full-page case file for one registration — the displaced counterpart
 * of the war-damages ReportDetailView. Shows every submitted field
 * grouped like the intake wizard, manages identity documents in place
 * (add / preview / delete), and hosts the edit dialog so all record
 * changes happen from this page. Opening it writes a bilingual
 * VIEW_DISPLACED_RECORD entry to the audit trail.
 */
export function DisplacedDetailView({
  dict,
  locale,
  audience,
  id,
}: DisplacedDetailViewProps): React.JSX.Element {
  const t = dict.displaced;
  const tForm = t.form;
  const tEdit = t.dashboard.editDialog;
  const tView = t.dashboard.viewDialog;
  const tAudience = audience === 'syrian' ? t.syrian : t.lebanese;
  const backHref = `/${locale}/admin/${audience}`;

  const detailQuery = useDisplacedDetailQuery(audience, id);
  const uploadIdMutation = useUploadDisplacedIdDocumentsMutation(audience);
  const deleteIdMutation = useDeleteDisplacedIdDocumentMutation(audience);
  const logView = useLogDisplacedViewMutation(audience);
  const addDocumentInputRef = React.useRef<HTMLInputElement>(null);

  const [editing, setEditing] = React.useState(false);
  const [docError, setDocError] = React.useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = React.useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = React.useState('');

  const isPending = uploadIdMutation.isPending || deleteIdMutation.isPending;

  // One bilingual trail entry per opened case file (fire-and-forget).
  React.useEffect(() => {
    logView.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        {dict.common.loading}
      </div>
    );
  }

  const item = detailQuery.data;
  if (!item) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border bg-card p-12 text-center">
        <TriangleAlert className="h-10 w-10 text-destructive" />
        <p className="font-medium text-muted-foreground">{tView.notFound}</p>
        <Button asChild variant="outline">
          <Link href={backHref}>
            <ArrowRight className="h-4 w-4 ltr:rotate-180" />
            {dict.detail.backToDashboard}
          </Link>
        </Button>
      </div>
    );
  }

  const syrian = audience === 'syrian' ? (item as SyrianDisplacedItem) : null;
  const lebanese =
    audience === 'lebanese' ? (item as LebaneseDisplacedItem) : null;
  const shelterContactLabels =
    item.shelterType !== SHELTER_WITHOUT_CONTACT
      ? t.shelterContact[item.shelterType]
      : null;

  const dateFormatter = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar-LB' : 'en-GB',
    { dateStyle: 'medium' },
  );
  const formatDay = (iso: string): string =>
    dateFormatter.format(new Date(iso.slice(0, 10)));

  const openViewer = (url: string, title: string): void => {
    setViewerTitle(title);
    setViewerUrl(url);
  };

  const handleUploadFiles = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setDocError(null);
    try {
      await uploadIdMutation.mutateAsync({ id: item.id, files });
    } catch (error) {
      setDocError(toApiError(error).message || tEdit.error);
    }
  };

  const handleDeleteFile = async (url: string): Promise<void> => {
    if (!window.confirm(tEdit.confirmDeleteId)) return;
    setDocError(null);
    try {
      await deleteIdMutation.mutateAsync({ id: item.id, url });
    } catch (error) {
      setDocError(toApiError(error).message || tEdit.error);
    }
  };

  const field = (
    label: string,
    value: React.ReactNode,
    options?: { dir?: 'ltr' },
  ): React.JSX.Element => (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {/* A <div>, not a <p>: values may hold <Badge> (which renders a
          <div>), and a block element inside a <p> is invalid HTML and
          triggers a React hydration error. */}
      <div className="text-sm font-medium" dir={options?.dir}>
        {value === null || value === undefined || value === '' ? (
          <span className="text-muted-foreground">{tView.notProvided}</span>
        ) : (
          value
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Page header — mirrors the war-damages case file. */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm" className="-ms-2">
            <Link href={backHref}>
              <ArrowRight className="h-4 w-4 ltr:rotate-180" />
              {dict.detail.backToDashboard}
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{item.fullName}</h1>
            <Badge variant={statusBadgeVariant(item.status)}>
              {t.status[item.status]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {tView.title} — {formatDay(item.createdAt)}
          </p>
        </div>
        <Button onClick={() => setEditing(true)}>
          <Pencil className="h-4 w-4" />
          {tView.edit}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Identity & contact */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tForm.identitySection}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {field(tForm.fullNameLabel, item.fullName)}
            {field(tForm.phoneLabel, item.phone, { dir: 'ltr' })}
            {field(tForm.alternatePhoneLabel, item.alternatePhone, {
              dir: 'ltr',
            })}
            {field(t.dashboard.table.date, formatDay(item.createdAt))}
          </CardContent>
        </Card>

        {/* Household */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tForm.householdSection}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {field(tForm.familyMembersLabel, item.familyMembersCount)}
              {field(
                tForm.vulnerabilityLabel,
                item.vulnerabilityStatus.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {item.vulnerabilityStatus.map((flag) => (
                      <Badge key={flag} variant="secondary">
                        {t.vulnerabilities[flag]}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  ''
                ),
              )}
            </div>
            {field(tForm.familyMembersNamesLabel, item.familyMembersNames)}
          </CardContent>
        </Card>

        {/* Housing & location */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tForm.locationSection}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {field(tForm.neighborhoodLabel, item.neighborhoodName)}
            {field(tForm.buildingLabel, item.buildingName)}
            {field(tForm.shelterTypeLabel, t.shelterTypes[item.shelterType])}
            {field(
              tAudience.originLabel,
              syrian?.originalCity ?? lebanese?.originVillage,
            )}
            {shelterContactLabels
              ? field(shelterContactLabels.nameLabel, item.shelterContactName)
              : null}
            {shelterContactLabels
              ? field(
                  shelterContactLabels.phoneLabel,
                  item.shelterContactPhone,
                  { dir: 'ltr' },
                )
              : null}
            {syrian
              ? field(
                  tForm.registrationNumberLabel,
                  syrian.registrationNumber,
                  { dir: 'ltr' },
                )
              : null}
            {lebanese
              ? field(
                  tForm.propertyDamagedLabel,
                  lebanese.isPropertyDamaged ? dict.common.yes : dict.common.no,
                )
              : null}
            {lebanese
              ? field(tForm.incomeLabel, lebanese.primarySourceOfIncome)
              : null}
            {field(
              tAudience.dateLabel,
              formatDay(syrian?.entryDate ?? lebanese?.displacementDate ?? ''),
            )}
          </CardContent>
        </Card>

        {/* Urgent needs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tForm.needsSection}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {item.urgentNeeds.length > 0 ? (
                item.urgentNeeds.map((need) => (
                  <Badge key={need} variant="secondary">
                    {t.needs[need]}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">
                  {tView.notProvided}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Identity documents — preview / add / delete in place */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{tEdit.idDocumentsLabel}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {item.idDocumentUrls.length > 0 ? (
            <ul className="space-y-2">
              {item.idDocumentUrls.map((url, index) => {
                const title = fill(tEdit.documentLabel, { index: index + 1 });
                return (
                  <li
                    key={url}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 rounded-md bg-primary/10 p-2 text-primary">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="truncate text-sm font-medium">
                        {title}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openViewer(url, title)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {tEdit.viewId}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDeleteFile(url)}
                        disabled={isPending}
                        aria-label={tEdit.deleteId}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              {tEdit.noDocumentsYet}
            </p>
          )}
          <input
            ref={addDocumentInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(event) => void handleUploadFiles(event)}
            disabled={isPending}
          />
          {item.idDocumentUrls.length < MAX_ID_DOCUMENTS_PER_REGISTRATION ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={isPending}
              onClick={() => addDocumentInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploadIdMutation.isPending ? tEdit.uploading : tEdit.uploadId}
            </Button>
          ) : null}
          {docError ? (
            <p className="rounded-lg border border-destructive/50 bg-destructive/10 p-2.5 text-sm text-destructive">
              {docError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* In-site document/image lightbox (shadcn Dialog). */}
      <DocumentViewerDialog
        dict={dict}
        url={viewerUrl}
        title={viewerTitle}
        onClose={() => setViewerUrl(null)}
      />

      {/* Editing happens on this page via the existing dialog. */}
      <DisplacedEditDialog
        open={editing}
        audience={audience}
        item={item}
        dict={dict}
        locale={locale}
        onClose={() => setEditing(false)}
      />
    </div>
  );
}
