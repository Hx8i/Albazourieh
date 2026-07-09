'use client';

import * as React from 'react';
import Link from 'next/link';
import Map, { Marker } from 'react-map-gl/maplibre';
import {
  ArrowLeft,
  BadgeCheck,
  Camera,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Phone,
  TriangleAlert,
  User,
} from 'lucide-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ADMIN_PATH } from '@/lib/constants';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import { toApiError } from '@/lib/query-client';
import { useReportQuery, useUpdateReportStatusMutation } from '@/lib/queries';
import {
  DamageSeverity,
  ReportListItem,
  ReportStatus,
} from '@/lib/schemas/damage-report.schema';
import { LIGHT_MAP_STYLE } from '@/components/map/map-config';

const NEXT_STATUS: Partial<Record<ReportStatus, ReportStatus>> = {
  PENDING: 'UNDER_REVIEW',
  UNDER_REVIEW: 'VERIFIED',
  VERIFIED: 'APPROVED',
};

type Attachment = ReportListItem['attachments'][number];

/** Files are never pooled: each label belongs to exactly one section. */
const IDENTITY_LABELS: readonly string[] = ['NATIONAL_ID'];
const OWNERSHIP_LABELS: readonly string[] = [
  'PROPERTY_DEED',
  'RENTAL_CONTRACT',
  'VEHICLE_REGISTRATION',
  'RESIDENCY_PROOF',
];

interface AttachmentGroups {
  identity: Attachment[];
  ownership: Attachment[];
  damage: Attachment[];
}

function groupAttachments(attachments: Attachment[]): AttachmentGroups {
  const groups: AttachmentGroups = { identity: [], ownership: [], damage: [] };
  for (const attachment of attachments) {
    if (attachment.label && IDENTITY_LABELS.includes(attachment.label)) {
      groups.identity.push(attachment);
    } else if (attachment.label && OWNERSHIP_LABELS.includes(attachment.label)) {
      groups.ownership.push(attachment);
    } else {
      groups.damage.push(attachment);
    }
  }
  return groups;
}

function isPdf(attachment: Attachment): boolean {
  return (
    attachment.mimeType === 'application/pdf' ||
    attachment.url.toLowerCase().endsWith('.pdf')
  );
}

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

interface ReportDetailViewProps {
  dict: Dictionary;
  locale: Locale;
  reportId: string;
}

/**
 * Split-pane auditing workspace for municipality engineers: citizen
 * data, description and voice note on one side; evidence, documents and
 * an exact-location mini-map on the other; a sticky action footer with
 * the review-lifecycle transitions underneath.
 */
export function ReportDetailView({
  dict,
  locale,
  reportId,
}: ReportDetailViewProps): React.JSX.Element {
  const t = dict.detail;
  const td = dict.dashboard;

  const reportQuery = useReportQuery(reportId);
  const report = reportQuery.data ?? null;
  const loadError = reportQuery.isError
    ? reportQuery.error instanceof Error &&
      toApiError(reportQuery.error).status === 404
      ? t.notFound
      : toApiError(reportQuery.error).message
    : null;

  const [actionError, setActionError] = React.useState<string | null>(null);
  const [rejecting, setRejecting] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState('');

  const updateStatus = useUpdateReportStatusMutation();

  const applyStatus = async (
    status: ReportStatus,
    reason?: string,
  ): Promise<void> => {
    setActionError(null);
    try {
      await updateStatus.mutateAsync({ id: reportId, status, rejectionReason: reason });
      setRejecting(false);
      setRejectReason('');
    } catch (error) {
      setActionError(toApiError(error).message);
    }
  };

  const dateFormatter = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar-LB' : 'en-GB',
    { dateStyle: 'long', timeStyle: 'short' },
  );

  if (reportQuery.isPending) {
    return (
      <div className="flex items-center justify-center gap-2 p-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        {dict.common.loading}
      </div>
    );
  }

  if (loadError || !report) {
    return (
      <div className="flex flex-col items-center gap-4 p-16 text-center">
        <TriangleAlert className="h-10 w-10 text-destructive" />
        <p className="text-destructive">{loadError ?? t.notFound}</p>
        <Button asChild variant="outline">
          <Link href={`/${locale}/${ADMIN_PATH}`}>
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {t.backToDashboard}
          </Link>
        </Button>
      </div>
    );
  }

  const nextStatus = NEXT_STATUS[report.status];
  const isTerminal =
    report.status === 'APPROVED' || report.status === 'REJECTED';

  // Vehicles purge every property-only field from the layout.
  const isVehicleCase =
    report.property.type === 'VEHICLE' ||
    report.property.type === 'CAR' ||
    report.property.type === 'MOTORCYCLE';
  const groups = groupAttachments(report.attachments);

  const vehicleTypeLabel = (): string => {
    const kind = report.property.vehicleType;
    if (!kind) return td.asset[report.property.type];
    if (kind === 'OTHER' && report.property.vehicleTypeOther) {
      return report.property.vehicleTypeOther;
    }
    const known = dict.wizard.vehicleTypes as Record<string, string>;
    return known[kind] ?? kind;
  };

  const attachmentCaption = (attachment: Attachment): string | null => {
    if (!attachment.label) return null;
    const labels = t.attachmentLabels as Record<string, string>;
    return labels[attachment.label] ?? null;
  };

  const attachmentTile = (attachment: Attachment): React.JSX.Element => (
    <a
      key={attachment.id}
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="group block space-y-1"
    >
      <span className="relative block aspect-square overflow-hidden rounded-lg border bg-muted">
        {isPdf(attachment) ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground transition-colors group-hover:text-foreground">
            <FileText className="h-9 w-9" />
            <span className="text-xs">{t.openDocument}</span>
          </span>
        ) : (
          <img
            src={attachment.url}
            alt={attachmentCaption(attachment) ?? ''}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        )}
      </span>
      {attachmentCaption(attachment) ? (
        <span className="block truncate text-center text-xs text-muted-foreground">
          {attachmentCaption(attachment)}
        </span>
      ) : null}
    </a>
  );

  return (
    <div className="space-y-6 pb-28">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${locale}/${ADMIN_PATH}`}>
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              {t.backToDashboard}
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <span
            className="rounded bg-muted px-2 py-1 font-mono text-sm font-semibold tracking-wider"
            dir="ltr"
          >
            {report.referenceCode}
          </span>
        </div>
        <div className="flex gap-2">
          <Badge variant={severityBadgeVariant(report.severity)}>
            {td.severity[report.severity]}
          </Badge>
          <Badge variant={statusBadgeVariant(report.status)}>
            {td.status[report.status]}
          </Badge>
        </div>
      </div>

      {/* Split panes */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: citizen data, description, voice note */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="h-5 w-5" /> {t.citizenSection}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground">{t.reporter}</p>
                  <p className="font-medium">{report.reporter.fullName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t.phone}</p>
                  <p className="inline-flex items-center gap-1 font-medium" dir="ltr">
                    <Phone className="h-3.5 w-3.5" />
                    {report.reporter.phoneNumber}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t.asset}</p>
                  <p className="font-medium">{td.asset[report.property.type]}</p>
                </div>
                {isVehicleCase ? (
                  /* Vehicle case files show only vehicle-relevant data. */
                  <>
                    <div>
                      <p className="text-muted-foreground">{t.vehicleType}</p>
                      <p className="font-medium">{vehicleTypeLabel()}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t.district}</p>
                      <p className="font-medium">
                        {report.property.district ??
                          report.property.neighborhood}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-muted-foreground">{t.realEstateNumber}</p>
                      <p className="font-medium">
                        {report.property.realEstateNumber ?? '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t.street}</p>
                      <p className="font-medium">
                        {report.property.street ?? report.property.neighborhood}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t.floor}</p>
                      <p className="font-medium">{report.property.floor ?? '—'}</p>
                    </div>
                    {report.property.projectName ? (
                      <div>
                        <p className="text-muted-foreground">{t.projectName}</p>
                        <p className="font-medium">
                          {report.property.projectName}
                        </p>
                      </div>
                    ) : null}
                    {report.property.ownershipStatus ? (
                      <div>
                        <p className="text-muted-foreground">{t.ownership}</p>
                        <p className="font-medium">
                          {
                            t.ownershipValues[
                              report.property.ownershipStatus
                            ]
                          }
                        </p>
                      </div>
                    ) : null}
                    {report.property.ownerPhoneNumber ? (
                      <div>
                        <p className="text-muted-foreground">{t.ownerPhone}</p>
                        <p className="font-medium" dir="ltr">
                          {report.property.ownerPhoneNumber}
                        </p>
                      </div>
                    ) : null}
                  </>
                )}
                <div>
                  <p className="text-muted-foreground">{t.submittedOn}</p>
                  <p className="font-medium">
                    {dateFormatter.format(new Date(report.createdAt))}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5" /> {t.descriptionSection}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.description.trim().length > 0 ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {report.description}
                </p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  {t.noDescription}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: evidence + exact location */}
        <div className="space-y-6">
          {/* Isolated document sections — files are never pooled. */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <BadgeCheck className="h-5 w-5" /> {t.identitySection}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {groups.identity.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {groups.identity.map(attachmentTile)}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t.noAttachments}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5" /> {t.ownershipDocsSection}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {groups.ownership.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {groups.ownership.map(attachmentTile)}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t.noAttachments}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Camera className="h-5 w-5" /> {t.damageGallerySection}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {groups.damage.length > 0 ? (
                <div className="columns-2 gap-3 sm:columns-3 [&>a]:mb-3 [&>a]:break-inside-avoid">
                  {groups.damage.map(attachmentTile)}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t.noAttachments}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <MapPin className="h-5 w-5" /> {t.locationSection}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-64 w-full overflow-hidden rounded-xl border">
                <Map
                  initialViewState={{
                    latitude: report.property.latitude,
                    longitude: report.property.longitude,
                    zoom: 15,
                  }}
                  mapStyle={LIGHT_MAP_STYLE}
                  attributionControl={false}
                  style={{ width: '100%', height: '100%' }}
                >
                  <Marker
                    latitude={report.property.latitude}
                    longitude={report.property.longitude}
                    anchor="bottom"
                  >
                    <MapPin className="h-9 w-9 fill-red-500 text-red-700 drop-shadow" />
                  </Marker>
                </Map>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-mono text-muted-foreground" dir="ltr">
                  {report.property.latitude.toFixed(6)},{' '}
                  {report.property.longitude.toFixed(6)}
                </span>
                <a
                  href={`https://www.google.com/maps?q=${report.property.latitude},${report.property.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  {t.openInGoogleMaps}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </CardContent>
          </Card>

          {report.status === 'REJECTED' && report.rejectionReason ? (
            <Card className="border-destructive/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-destructive">
                  {t.rejectionReason}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{report.rejectionReason}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {/* Sticky action footer */}
      {!isTerminal ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur">
          <div className="container flex flex-col gap-3 py-4">
            {rejecting ? (
              <div className="space-y-2">
                <Label htmlFor="reject-reason">{t.rejectReasonLabel}</Label>
                <Textarea
                  id="reject-reason"
                  className="min-h-[70px]"
                  placeholder={t.rejectReasonPlaceholder}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </div>
            ) : null}
            {actionError ? (
              <p className="text-sm font-medium text-destructive">{actionError}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {rejecting ? (
                <>
                  <Button
                    variant="destructive"
                    disabled={updating || rejectReason.trim().length < 5}
                    onClick={() => void applyStatus('REJECTED', rejectReason.trim())}
                  >
                    {updating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {t.confirmReject}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={updating}
                    onClick={() => setRejecting(false)}
                  >
                    {dict.common.cancel}
                  </Button>
                </>
              ) : (
                <>
                  {nextStatus ? (
                    <Button
                      size="lg"
                      disabled={updating}
                      onClick={() => void applyStatus(nextStatus)}
                    >
                      {updating ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {
                        td.nextAction[
                          report.status as keyof typeof td.nextAction
                        ]
                      }
                    </Button>
                  ) : null}
                  <Button
                    size="lg"
                    variant="destructive"
                    disabled={updating}
                    onClick={() => setRejecting(true)}
                  >
                    {td.nextAction.reject}
                  </Button>
                </>
              )}
              <span className="ms-auto hidden text-xs text-muted-foreground sm:block">
                {t.reviewedBy}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
