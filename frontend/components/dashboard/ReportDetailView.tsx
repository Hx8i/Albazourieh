"use client";

import * as React from "react";
import Link from "next/link";
import Map, { Marker } from "react-map-gl/maplibre";
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
  Pencil,
  Trash2,
  Save,
  X,
  Plus,
} from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ADMIN_PATH } from "@/lib/constants";
import { Dictionary, Locale } from "@/lib/i18n/dictionaries";
import { toApiError } from "@/lib/query-client";
import {
  useReportQuery,
  useUpdateReportStatusMutation,
  useAdminEditReportMutation,
  useDeleteAttachmentMutation,
  useAddAttachmentMutation,
} from "@/lib/queries";
import {
  DamageSeverity,
  ReportListItem,
  ReportStatus,
  AdminEditPayload,
} from "@/lib/schemas/damage-report.schema";
import { LIGHT_MAP_STYLE } from "@/components/map/map-config";
import { LocationPickerMap } from "@/components/map/LocationPickerMap";

const NEXT_STATUS: Partial<Record<ReportStatus, ReportStatus>> = {
  PENDING: "UNDER_REVIEW",
  UNDER_REVIEW: "VERIFIED",
  VERIFIED: "APPROVED",
};

type Attachment = ReportListItem["attachments"][number];

/** Files are never pooled: each label belongs to exactly one section. */
const IDENTITY_LABELS: readonly string[] = ["NATIONAL_ID"];
const OWNERSHIP_LABELS: readonly string[] = [
  "PROPERTY_DEED",
  "RENTAL_CONTRACT",
  "VEHICLE_REGISTRATION",
  "RESIDENCY_PROOF",
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
    } else if (
      attachment.label &&
      OWNERSHIP_LABELS.includes(attachment.label)
    ) {
      groups.ownership.push(attachment);
    } else {
      groups.damage.push(attachment);
    }
  }
  return groups;
}

function isPdf(attachment: Attachment): boolean {
  return (
    attachment.mimeType === "application/pdf" ||
    attachment.url.toLowerCase().endsWith(".pdf")
  );
}

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

interface ReportDetailViewProps {
  dict: Dictionary;
  locale: Locale;
  reportId: string;
}

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
  const [rejectReason, setRejectReason] = React.useState("");
  const [rejectField, setRejectField] = React.useState("");
  const [ownershipDocLabel, setOwnershipDocLabel] = React.useState<string>(OWNERSHIP_LABELS[0] || "PROPERTY_DEED");

  // Edit Mode state
  const [isEditing, setIsEditing] = React.useState(false);
  const [editForm, setEditForm] = React.useState({
    firstName: "",
    middleName: "",
    lastName: "",
    phoneNumber: "",
    street: "",
    projectName: "",
    floor: "",
    unitArea: "",
    propertyNumber: "",
    ownerPhoneNumber: "",
    latitude: "",
    longitude: "",
    description: "",
  });

  const updateStatus = useUpdateReportStatusMutation();
  const editReport = useAdminEditReportMutation();
  const deleteAttachment = useDeleteAttachmentMutation();
  const addAttachment = useAddAttachmentMutation();

  // Populate editForm when report data changes or editing mode is turned on
  const nameParts = report?.reporter.fullName.split(" ") ?? [];
  const initialFirst = nameParts[0] ?? "";
  const initialMiddle = nameParts[1] ?? "";
  const initialLast = nameParts.slice(2).join(" ") || "";

  React.useEffect(() => {
    if (report) {
      setEditForm({
        firstName: initialFirst,
        middleName: initialMiddle,
        lastName: initialLast,
        phoneNumber: report.reporter.phoneNumber,
        street: report.property.street ?? "",
        projectName: report.property.projectName ?? "",
        floor: report.property.floor ?? "",
        unitArea: report.property.unitArea ? String(report.property.unitArea) : "",
        propertyNumber: report.property.realEstateNumber ?? "",
        ownerPhoneNumber: report.property.ownerPhoneNumber ?? "",
        latitude: String(report.property.latitude),
        longitude: String(report.property.longitude),
        description: report.description,
      });
    }
  }, [report]);

  const applyStatus = async (
    status: ReportStatus,
    reason?: string,
  ): Promise<void> => {
    if (status === "REJECTED" && (!reason || !rejectField)) {
      return;
    }
    setActionError(null);
    try {
      await updateStatus.mutateAsync({
        id: reportId,
        status,
        rejectionReason: reason,
        rejectedField: status === "REJECTED" ? rejectField || undefined : undefined,
      });
      setRejecting(false);
      setRejectReason("");
      setRejectField("");
    } catch (error) {
      setActionError(toApiError(error).message);
    }
  };

  const handleSave = async (): Promise<void> => {
    if (!report) return;
    setActionError(null);

    const payload: AdminEditPayload = {};

    if (editForm.firstName.trim() !== initialFirst) {
      payload.firstName = editForm.firstName.trim();
    }
    if (editForm.middleName.trim() !== initialMiddle) {
      payload.middleName = editForm.middleName.trim();
    }
    if (editForm.lastName.trim() !== initialLast) {
      payload.lastName = editForm.lastName.trim();
    }
    if (editForm.phoneNumber.trim() !== report.reporter.phoneNumber) {
      payload.phoneNumber = editForm.phoneNumber.trim();
    }
    if (editForm.description.trim() !== report.description) {
      payload.description = editForm.description.trim();
    }

    const isVehicleCase = report.property.type === "VEHICLE";

    if (!isVehicleCase) {
      if (editForm.street.trim() !== (report.property.street ?? "")) {
        payload.street = editForm.street.trim();
      }
      if (editForm.projectName.trim() !== (report.property.projectName ?? "")) {
        payload.projectName = editForm.projectName.trim();
      }
      if (editForm.floor.trim() !== (report.property.floor ?? "")) {
        payload.floor = editForm.floor.trim();
      }
      const trimmedUnitArea = editForm.unitArea.trim();
      if (trimmedUnitArea !== (report.property.unitArea ? String(report.property.unitArea) : "")) {
        if (trimmedUnitArea === "") {
          payload.unitArea = undefined;
        } else {
          const val = Number(trimmedUnitArea);
          if (Number.isInteger(val) && val > 0) {
            payload.unitArea = val;
          } else {
            setActionError("Unit area must be a positive integer");
            return;
          }
        }
      }
      if (editForm.propertyNumber.trim() !== (report.property.realEstateNumber ?? "")) {
        payload.propertyNumber = editForm.propertyNumber.trim();
      }
      if (editForm.ownerPhoneNumber.trim() !== (report.property.ownerPhoneNumber ?? "")) {
        payload.ownerPhoneNumber = editForm.ownerPhoneNumber.trim();
      }
    } else {
      // Vehicles store neighborhood/district under neighborhood.
      if (editForm.street.trim() !== (report.property.neighborhood ?? "")) {
        payload.street = editForm.street.trim();
      }
    }

    const trimmedLat = editForm.latitude.trim();
    const trimmedLng = editForm.longitude.trim();

    if (trimmedLat !== "" && trimmedLat !== String(report.property.latitude)) {
      const parsedLat = Number(trimmedLat);
      if (Number.isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90) {
        payload.latitude = parsedLat;
      } else {
        setActionError("Latitude must be a valid number between -90 and 90");
        return;
      }
    }
    if (trimmedLng !== "" && trimmedLng !== String(report.property.longitude)) {
      const parsedLng = Number(trimmedLng);
      if (Number.isFinite(parsedLng) && parsedLng >= -180 && parsedLng <= 180) {
        payload.longitude = parsedLng;
      } else {
        setActionError("Longitude must be a valid number between -180 and 180");
        return;
      }
    }

    try {
      await editReport.mutateAsync({
        id: reportId,
        payload,
      });
      setIsEditing(false);
    } catch (error) {
      setActionError(toApiError(error).message);
    }
  };

  const handleDeleteAttachment = async (attachmentId: string): Promise<void> => {
    const confirmationLabel = t.confirmDeleteAttachment ?? "Are you sure you want to delete this attachment?";
    if (!confirm(confirmationLabel)) {
      return;
    }
    setActionError(null);
    try {
      await deleteAttachment.mutateAsync({
        reportId,
        attachmentId,
      });
    } catch (error) {
      setActionError(toApiError(error).message);
    }
  };

  const dateFormatter = new Intl.DateTimeFormat(
    locale === "ar" ? "ar-LB" : "en-GB",
    { dateStyle: "long", timeStyle: "short" },
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
    report.status === "APPROVED" || report.status === "REJECTED";

  const isVehicleCase =
    report.property.type === "VEHICLE" ||
    report.property.type === "CAR" ||
    report.property.type === "MOTORCYCLE";
  const groups = groupAttachments(report.attachments);

  const vehicleTypeLabel = (): string => {
    const kind = report.property.vehicleType;
    if (!kind) return td.asset[report.property.type];
    if (kind === "OTHER" && report.property.vehicleTypeOther) {
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
    <div key={attachment.id} className="group relative space-y-1">
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="block"
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
              alt={attachmentCaption(attachment) ?? ""}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
          )}
        </span>
        {attachmentCaption(attachment) ? (
          <span className="block truncate text-center text-xs text-muted-foreground mt-1">
            {attachmentCaption(attachment)}
          </span>
        ) : null}
      </a>
      {isEditing ? (
        <button
          type="button"
          onClick={() => void handleDeleteAttachment(attachment.id)}
          className="absolute -top-1.5 -end-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-white shadow-md transition-transform hover:scale-110"
          title={t.deleteAttachment ?? "Delete Attachment"}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );

  // Dynamic ViewState mapping coordinates from the input
  const mapLat = parseFloat(editForm.latitude) || report.property.latitude;
  const mapLng = parseFloat(editForm.longitude) || report.property.longitude;

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
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(!isEditing)}
            className="flex items-center gap-1.5 border-primary text-primary hover:bg-primary/5"
          >
            <Pencil className="h-4 w-4" />
            {isEditing ? t.cancelEdit : t.editModeToggle}
          </Button>
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
        {/* Left pane */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="h-5 w-5" /> {t.citizenSection}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {isEditing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label htmlFor="edit-firstname">{dict.wizard.firstNameLabel} *</Label>
                      <Input
                        id="edit-firstname"
                        value={editForm.firstName}
                        onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-middlename">{dict.wizard.middleNameLabel} *</Label>
                      <Input
                        id="edit-middlename"
                        value={editForm.middleName}
                        onChange={(e) => setEditForm({ ...editForm, middleName: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-lastname">{dict.wizard.lastNameLabel} *</Label>
                      <Input
                        id="edit-lastname"
                        value={editForm.lastName}
                        onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-phone">{t.phone} *</Label>
                    <Input
                      id="edit-phone"
                      value={editForm.phoneNumber}
                      onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                    />
                  </div>
                  {isVehicleCase ? (
                    <div className="space-y-1">
                      <Label htmlFor="edit-district">{t.district} *</Label>
                      <Input
                        id="edit-district"
                        value={editForm.street}
                        onChange={(e) => setEditForm({ ...editForm, street: e.target.value })}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="edit-propertynumber">{t.realEstateNumber} *</Label>
                          <Input
                            id="edit-propertynumber"
                            value={editForm.propertyNumber}
                            onChange={(e) => setEditForm({ ...editForm, propertyNumber: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="edit-unitarea">{t.unitArea} *</Label>
                          <Input
                            id="edit-unitarea"
                            value={editForm.unitArea}
                            onChange={(e) => setEditForm({ ...editForm, unitArea: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="edit-street">{t.street} *</Label>
                          <Input
                            id="edit-street"
                            value={editForm.street}
                            onChange={(e) => setEditForm({ ...editForm, street: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="edit-floor">{t.floor} *</Label>
                          <Input
                            id="edit-floor"
                            value={editForm.floor}
                            onChange={(e) => setEditForm({ ...editForm, floor: e.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-projectname">{t.projectName}</Label>
                        <Input
                          id="edit-projectname"
                          value={editForm.projectName}
                          onChange={(e) => setEditForm({ ...editForm, projectName: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-ownerphone">{t.ownerPhone}</Label>
                        <Input
                          id="edit-ownerphone"
                          value={editForm.ownerPhoneNumber}
                          onChange={(e) => setEditForm({ ...editForm, ownerPhoneNumber: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                </div>
              ) : (
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
                    <>
                      <div>
                        <p className="text-muted-foreground">{t.vehicleType}</p>
                        <p className="font-medium">{vehicleTypeLabel()}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t.district}</p>
                        <p className="font-medium">
                          {report.property.district ?? report.property.neighborhood}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="text-muted-foreground">{t.realEstateNumber}</p>
                        <p className="font-medium">{report.property.realEstateNumber ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{t.unitArea}</p>
                        <p className="font-medium">
                          {report.property.unitArea ? `${report.property.unitArea} م²` : "—"}
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
                        <p className="font-medium">{report.property.floor ?? "—"}</p>
                      </div>
                      {report.property.projectName ? (
                        <div>
                          <p className="text-muted-foreground">{t.projectName}</p>
                          <p className="font-medium">{report.property.projectName}</p>
                        </div>
                      ) : null}
                      {report.property.ownershipStatus ? (
                        <div>
                          <p className="text-muted-foreground">{t.ownership}</p>
                          <p className="font-medium">
                            {t.ownershipValues[report.property.ownershipStatus]}
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
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5" /> {t.descriptionSection}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div className="space-y-1">
                  <Label htmlFor="edit-description">{t.descriptionSection} *</Label>
                  <Textarea
                    id="edit-description"
                    className="min-h-[140px]"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>
              ) : report.description.trim().length > 0 ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{report.description}</p>
              ) : (
                <p className="text-sm italic text-muted-foreground">{t.noDescription}</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right pane */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <BadgeCheck className="h-5 w-5" /> {t.identitySection}
              </CardTitle>
              {isEditing ? (
                <div className="relative">
                  <input
                    type="file"
                    id="upload-identity"
                    className="hidden"
                    accept="image/*,application/pdf"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setActionError(null);
                        try {
                          await addAttachment.mutateAsync({
                            reportId,
                            file,
                            label: "NATIONAL_ID",
                          });
                        } catch (err) {
                          setActionError(toApiError(err).message);
                        }
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-1 text-xs h-8"
                    disabled={addAttachment.isPending}
                    onClick={() => document.getElementById("upload-identity")?.click()}
                  >
                    {addAttachment.isPending && addAttachment.variables?.label === "NATIONAL_ID" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    {t.addDocument}
                  </Button>
                </div>
              ) : null}
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
            <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 space-y-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5" /> {t.ownershipDocsSection}
              </CardTitle>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Select
                    value={ownershipDocLabel}
                    onValueChange={setOwnershipDocLabel}
                  >
                    <SelectTrigger className="h-8 w-[160px] text-xs">
                      <SelectValue placeholder={t.attachmentLabels.PROPERTY_DEED} />
                    </SelectTrigger>
                    <SelectContent>
                      {OWNERSHIP_LABELS.map((lbl) => (
                        <SelectItem key={lbl} value={lbl} className="text-xs">
                          {(t.attachmentLabels as Record<string, string>)[lbl] ?? lbl}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <input
                    type="file"
                    id="upload-ownership"
                    className="hidden"
                    accept="image/*,application/pdf"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setActionError(null);
                        try {
                          await addAttachment.mutateAsync({
                            reportId,
                            file,
                            label: ownershipDocLabel,
                          });
                        } catch (err) {
                          setActionError(toApiError(err).message);
                        }
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-1 text-xs h-8"
                    disabled={addAttachment.isPending}
                    onClick={() => document.getElementById("upload-ownership")?.click()}
                  >
                    {addAttachment.isPending && addAttachment.variables?.label === ownershipDocLabel ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    {t.addDocument}
                  </Button>
                </div>
              ) : null}
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
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Camera className="h-5 w-5" /> {t.damageGallerySection}
              </CardTitle>
              {isEditing ? (
                <div className="relative">
                  <input
                    type="file"
                    id="upload-damage"
                    className="hidden"
                    accept="image/*"
                    multiple
                    onChange={async (e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        setActionError(null);
                        try {
                          for (let i = 0; i < files.length; i++) {
                            const file = files[i];
                            if (file) {
                              await addAttachment.mutateAsync({
                                reportId,
                                file,
                                label: "DAMAGE_PHOTO",
                              });
                            }
                          }
                        } catch (err) {
                          setActionError(toApiError(err).message);
                        }
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex items-center gap-1 text-xs h-8"
                    disabled={addAttachment.isPending}
                    onClick={() => document.getElementById("upload-damage")?.click()}
                  >
                    {addAttachment.isPending && addAttachment.variables?.label === "DAMAGE_PHOTO" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    {t.addDocument}
                  </Button>
                </div>
              ) : null}
            </CardHeader>
            <CardContent>
              {groups.damage.length > 0 ? (
                <div className="columns-2 gap-3 sm:columns-3 [&>div]:mb-3 [&>div]:break-inside-avoid">
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
              {isEditing ? (
                <LocationPickerMap
                  latitude={parseFloat(editForm.latitude) || null}
                  longitude={parseFloat(editForm.longitude) || null}
                  onPick={(latitude, longitude) => {
                    setEditForm((prev) => ({
                      ...prev,
                      latitude: String(latitude),
                      longitude: String(longitude),
                    }));
                  }}
                  locale={locale}
                  labels={{
                    landmarkLabel: dict.wizard.locationLandmarkLabel,
                    landmarkPlaceholder: dict.wizard.locationLandmarkPlaceholder,
                    pinHint: dict.wizard.locationPinHint,
                    basemapStreet: dict.wizard.locationBasemapStreet,
                    basemapSatellite: dict.wizard.locationBasemapSatellite,
                    recenter: dict.wizard.locationRecenter,
                  }}
                />
              ) : (
                <div className="h-64 w-full overflow-hidden rounded-xl border">
                  <Map
                    initialViewState={{
                      latitude: mapLat,
                      longitude: mapLng,
                      zoom: 15,
                    }}
                    mapStyle={LIGHT_MAP_STYLE}
                    attributionControl={false}
                    style={{ width: "100%", height: "100%" }}
                  >
                    <Marker latitude={mapLat} longitude={mapLng} anchor="bottom">
                      <MapPin className="h-9 w-9 fill-red-500 text-red-700 drop-shadow" />
                    </Marker>
                  </Map>
                </div>
              )}
              {isEditing ? (
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="space-y-1">
                    <Label htmlFor="edit-latitude">Latitude *</Label>
                    <Input
                      id="edit-latitude"
                      value={editForm.latitude}
                      onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-longitude">Longitude *</Label>
                    <Input
                      id="edit-longitude"
                      value={editForm.longitude}
                      onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono text-muted-foreground" dir="ltr">
                    {report.property.latitude.toFixed(6)}, {report.property.longitude.toFixed(6)}
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
              )}
            </CardContent>
          </Card>

          {report.status === "REJECTED" && report.rejectionReason ? (
            <Card className="border-destructive/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg text-destructive">{t.rejectionReason}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{report.rejectionReason}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {/* Sticky action footer (Review Status OR Edit Mode options) */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur">
        <div className="container flex flex-col gap-3 py-4">
          {isEditing ? (
            <div className="flex items-center gap-3">
              {actionError ? (
                <p className="text-sm font-medium text-destructive me-auto">{actionError}</p>
              ) : null}
              <Button
                size="lg"
                disabled={editReport.isPending}
                onClick={() => void handleSave()}
                className="flex items-center gap-1.5"
              >
                {editReport.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t.saveChanges}
              </Button>
              <Button
                variant="outline"
                size="lg"
                disabled={editReport.isPending}
                onClick={() => setIsEditing(false)}
                className="flex items-center gap-1.5"
              >
                <X className="h-4 w-4" />
                {t.cancelEdit}
              </Button>
            </div>
          ) : (
            <>
              {!isTerminal && (
                <div className="flex flex-col gap-3">
                  {rejecting ? (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor="reject-field">{t.rejectFieldLabel}</Label>
                        <Select
                          value={rejectField}
                          onValueChange={(value: string) => setRejectField(value)}
                          dir={locale === 'ar' ? 'rtl' : 'ltr'}
                        >
                          <SelectTrigger id="reject-field">
                            <SelectValue placeholder={t.rejectFieldPlaceholder} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Name">{t.rejectedFields.Name}</SelectItem>
                            <SelectItem value="Address">{t.rejectedFields.Address}</SelectItem>
                            <SelectItem value="Description">{t.rejectedFields.Description}</SelectItem>
                            <SelectItem value="Media">{t.rejectedFields.Media}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="reject-reason">{t.rejectReasonLabel}</Label>
                        <Textarea
                          id="reject-reason"
                          className="min-h-[70px]"
                          placeholder={t.rejectReasonPlaceholder}
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                        />
                      </div>
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
                          disabled={updateStatus.isPending || rejectReason.trim().length < 5 || !rejectField}
                          onClick={() => {
                            if (rejectReason.trim().length >= 5 && rejectField) {
                              void applyStatus("REJECTED", rejectReason.trim());
                            }
                          }}
                        >
                          {updateStatus.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          {t.confirmReject}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={updateStatus.isPending}
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
                            disabled={updateStatus.isPending}
                            onClick={() => void applyStatus(nextStatus)}
                          >
                            {updateStatus.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : null}
                            {td.nextAction[report.status as keyof typeof td.nextAction]}
                          </Button>
                        ) : null}
                        <Button
                          size="lg"
                          variant="destructive"
                          disabled={updateStatus.isPending}
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
