import { Injectable } from "@nestjs/common";
import { AuditLogService } from "../audit/audit-log.service";
import { TtlCacheService } from "../common/cache/ttl-cache.service";
import {
  InvalidStatusTransitionError,
  MissingRequiredFileError,
  ReferenceCodeNotFoundError,
  RejectionReasonRequiredError,
  ReportNotFoundError,
} from "../common/errors/domain.errors";
import { UploadsService } from "../uploads/uploads.service";
import {
  AdminEditReportDto,
  AttachmentLabel,
  ListReportsQueryDto,
  MultipartPayloadDto,
  PropertyNumberAvailabilityDto,
  SpatialQueryDto,
  UpdateReportStatusDto,
} from "./damage-report.dto";
import {
  DamageReportRepository,
  DamageReportWithRelations,
  PaginatedReports,
  PersistReportInput,
  PublicReportStatus,
  SpatialPoint,
  StatusSummary,
} from "./damage-report.repository";
import { ReportStatus } from "../generated/prisma/client";

/**
 * The review lifecycle. A report only ever moves forward (or gets
 * rejected); APPROVED and REJECTED are terminal states.
 */
const ALLOWED_TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  PENDING: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["VERIFIED", "REJECTED"],
  VERIFIED: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
};

/** Aggregate dashboard queries stay cached this long (cache-busted on writes). */
const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_PREFIX = "reports:";

/** Multipart field map produced by FileFieldsInterceptor. */
export interface MultipartFiles {
  damagePhotos?: Express.Multer.File[];
  nationalId?: Express.Multer.File[];
  propertyDeed?: Express.Multer.File[];
  rentalContract?: Express.Multer.File[];
  vehicleRegistration?: Express.Multer.File[];
  residencyProof?: Express.Multer.File[];
}

/** The reviewing staff member (identity from the verified JWT). */
export interface ActingReviewer {
  id: string;
  name: string;
  ipAddress?: string;
}

@Injectable()
export class DamageReportService {
  constructor(
    private readonly repository: DamageReportRepository,
    private readonly uploads: UploadsService,
    private readonly cache: TtlCacheService,
    private readonly audit: AuditLogService,
  ) {}

  // ───────────────────────── Citizen submissions ─────────────────────

  /**
   * Multipart submission: payload JSON + raw files arrive together in
   * one request. Category-specific document requirements are enforced
   * here, every file is content-sniffed and streamed to Supabase
   * Storage, then the report is persisted atomically.
   */
  async submitMultipart(
    payload: MultipartPayloadDto,
    files: MultipartFiles,
  ): Promise<DamageReportWithRelations> {
    this.assertRequiredFiles(payload, files);

    // Every file upload is a separate round-trip to Supabase Storage in
    // Tokyo, and citizen submissions can carry 7+ files (10 photos +
    // documents). Uploading them one at a time serialized total wall-clock
    // time past Vercel's serverless function timeout on slower (mobile)
    // connections. Uploading concurrently keeps the whole request within
    // the timeout regardless of file count.
    const uploadOne = async (
      file: Express.Multer.File,
      kind: "photo" | "document",
      label: AttachmentLabel,
    ): Promise<PersistReportInput["attachments"][number]> => {
      const url = await this.uploads.uploadEvidence(
        kind,
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      return {
        url,
        type: kind === "photo" ? "PHOTO" : "DOCUMENT",
        label,
        mimeType: file.mimetype,
        sizeBytes: file.size,
      };
    };

    const uploadAll = (
      fileList: Express.Multer.File[] | undefined,
      kind: "photo" | "document",
      label: AttachmentLabel,
    ): Array<Promise<PersistReportInput["attachments"][number]>> =>
      (fileList ?? []).map((file) => uploadOne(file, kind, label));

    const attachments = await Promise.all([
      ...uploadAll(files.damagePhotos, "photo", "DAMAGE_PHOTO"),
      ...uploadAll(files.nationalId, "document", "NATIONAL_ID"),
      ...uploadAll(files.propertyDeed, "document", "PROPERTY_DEED"),
      ...uploadAll(files.rentalContract, "document", "RENTAL_CONTRACT"),
      ...uploadAll(
        files.vehicleRegistration,
        "document",
        "VEHICLE_REGISTRATION",
      ),
      ...uploadAll(files.residencyProof, "document", "RESIDENCY_PROOF"),
    ]);

    const isVehicle = payload.category === "VEHICLE";
    const created = await this.repository.createFromSubmission({
      reporter: {
        fullName: joinName(
          payload.reporter.firstName,
          payload.reporter.middleName,
          payload.reporter.lastName,
        ),
        phoneNumber: payload.reporter.phoneNumber,
        preferredLanguage: payload.reporter.preferredLanguage,
      },
      property: isVehicle
        ? {
            type: payload.category,
            vehicleType: payload.property.vehicleType,
            vehicleTypeOther:
              payload.property.vehicleType === "OTHER"
                ? payload.property.customVehicleTypeDescription
                : undefined,
            district: payload.location.district,
            // Vehicles have no street — the district doubles as the
            // coarse "neighborhood" for dashboard filters and the map.
            neighborhood: payload.location.district,
            latitude: payload.location.latitude,
            longitude: payload.location.longitude,
          }
        : {
            // The category IS the property type (HOUSE/SHOP/APARTMENT).
            type: payload.category,
            ownershipStatus: payload.property.ownershipStatus,
            realEstateNumber: payload.property.propertyNumber,
            ownerPhoneNumber: payload.property.ownerPhoneNumber,
            district: payload.location.district,
            // The street doubles as the coarse "neighborhood".
            neighborhood: payload.location.street,
            street: payload.location.street,
            projectName: payload.location.projectName,
            floor: payload.location.floor,
            unitArea: payload.location.unitArea,
            additionalDirections: payload.location.additionalDirections,
            latitude: payload.location.latitude,
            longitude: payload.location.longitude,
          },
      report: {
        description: payload.report.description,
        severity: payload.report.severity,
      },
      attachments,
      enforceUniquePropertyNumber: !isVehicle,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX);
    return created;
  }

  /**
   * Category-specific mandatory documents, checked before any upload:
   * - Everyone: national ID + at least one damage photo + a written
   *   description (enforced by the payload schema).
   * - Property owners: proof of residency. Tenants: rental contract
   *   instead (residency proof is not applicable and not collected).
   * - VEHICLE: vehicle papers (أوراق الآلية) are optional — uploaded
   *   when available.
   */
  private assertRequiredFiles(
    payload: MultipartPayloadDto,
    files: MultipartFiles,
  ): void {
    if (!files.nationalId?.length) {
      throw new MissingRequiredFileError("nationalId");
    }
    if (!files.damagePhotos?.length) {
      throw new MissingRequiredFileError("damagePhotos");
    }
    if (payload.category !== "VEHICLE") {
      if (payload.property.ownershipStatus === "TENANT") {
        if (!files.rentalContract?.length) {
          throw new MissingRequiredFileError("rentalContract");
        }
      } else if (!files.residencyProof?.length) {
        throw new MissingRequiredFileError("residencyProof");
      }
    }
  }

  // ────────────────── Property-number onBlur check ───────────────────

  async checkPropertyNumber(
    number: string,
  ): Promise<PropertyNumberAvailabilityDto> {
    const exists = await this.repository.propertyNumberExists(number);
    return { available: !exists };
  }

  // ───────────────────────── Municipality reads ──────────────────────

  /** Paginated, filterable, searchable, sortable inbox (not cached — always fresh). */
  async listReports(query: ListReportsQueryDto): Promise<PaginatedReports> {
    return this.repository.list({
      status: query.status,
      severity: query.severity,
      neighborhood: query.neighborhood,
      search: query.search,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /** Dashboard counters — cached, cache-busted on every write. */
  async getSummary(): Promise<StatusSummary> {
    return this.cache.getOrSet(
      `${CACHE_PREFIX}summary`,
      DASHBOARD_CACHE_TTL_MS,
      () => this.repository.summarize(),
    );
  }

  /** deck.gl point slice — cached per filter combination. */
  async getSpatialData(query: SpatialQueryDto): Promise<SpatialPoint[]> {
    const key = `${CACHE_PREFIX}spatial:${query.status ?? "*"}:${query.severity ?? "*"}:${query.neighborhood ?? "*"}:${query.limit}`;
    return this.cache.getOrSet(key, DASHBOARD_CACHE_TTL_MS, () =>
      this.repository.spatial({
        status: query.status,
        severity: query.severity,
        neighborhood: query.neighborhood,
        limit: query.limit,
      }),
    );
  }

  async getReportById(id: string): Promise<DamageReportWithRelations> {
    const report = await this.repository.findById(id);
    if (!report) {
      throw new ReportNotFoundError(id);
    }
    return report;
  }

  /**
   * Public, unauthenticated status lookup for the citizen tracking page.
   * The repository already scrubs the payload to status/category/timestamp
   * only; here we just enforce existence with a bilingual 404.
   */
  async getPublicStatus(referenceCode: string): Promise<PublicReportStatus> {
    const status = await this.repository.findPublicByCode(referenceCode);
    if (!status) {
      throw new ReferenceCodeNotFoundError(referenceCode);
    }
    return status;
  }

  // ───────────────────────── Review lifecycle ────────────────────────

  /**
   * Advance a report through the review lifecycle. The acting staff
   * member (from the verified JWT) is recorded for the audit trail, and
   * the dashboard cache is busted instantly so counters never go stale.
   */
  async updateStatus(
    id: string,
    dto: UpdateReportStatusDto,
    reviewer: ActingReviewer,
  ): Promise<DamageReportWithRelations> {
    const report = await this.getReportById(id);

    if (!ALLOWED_TRANSITIONS[report.status].includes(dto.status)) {
      throw new InvalidStatusTransitionError(report.status, dto.status);
    }
    if (dto.status === "REJECTED" && !dto.rejectionReason) {
      throw new RejectionReasonRequiredError();
    }

    await this.repository.updateStatus(
      id,
      dto.status,
      dto.status === "REJECTED" ? (dto.rejectionReason ?? null) : null,
      dto.status === "REJECTED" ? (dto.rejectedField ?? null) : null,
      reviewer.id,
    );

    // "تتبع العمليات" — every review decision is written to the trail.
    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: "UPDATE_REPORT_STATUS",
      targetId: report.referenceCode,
      details:
        dto.status === "REJECTED"
          ? `${report.status} → ${dto.status} (Reason: ${dto.rejectionReason ?? ""}, Field: ${dto.rejectedField ?? ""})`
          : `${report.status} → ${dto.status}`,
      detailsAr:
        dto.status === "REJECTED"
          ? `تغيير الحالة: ${report.status} → ${dto.status} (السبب: ${dto.rejectionReason ?? ""}, الحقل: ${dto.rejectedField ?? ""})`
          : `تغيير الحالة: ${report.status} → ${dto.status}`,
      ipAddress: reviewer.ipAddress,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX);
    return this.getReportById(id);
  }

  // ─────────────────────── Admin data editing ─────────────────────────

  /**
   * Full admin override: compares the incoming flat DTO against the stored
   * record, builds dual-language audit fragments, persists the deltas,
   * and records an immutable audit trail entry.
   */
  async adminEditReport(
    id: string,
    dto: AdminEditReportDto,
    reviewer: ActingReviewer,
  ): Promise<DamageReportWithRelations> {
    const report = await this.getReportById(id);

    // ── Split fullName into parts for diff comparison ──
    const nameParts = report.reporter.fullName.split(' ');
    const currentFirst = nameParts[0] ?? '';
    const currentMiddle = nameParts[1] ?? '';
    const currentLast = nameParts.slice(2).join(' ') || '';

    const diffs: DiffFragment[] = [];

    // Reporter diffs
    const reporterUpdates: Partial<{ fullName: string; phoneNumber: string }> = {};
    const newFirst = dto.firstName ?? currentFirst;
    const newMiddle = dto.middleName ?? currentMiddle;
    const newLast = dto.lastName ?? currentLast;

    if (dto.firstName !== undefined) {
      const d = buildFieldDiff('firstName', currentFirst, newFirst);
      if (d) diffs.push(d);
    }
    if (dto.middleName !== undefined) {
      const d = buildFieldDiff('middleName', currentMiddle, newMiddle);
      if (d) diffs.push(d);
    }
    if (dto.lastName !== undefined) {
      const d = buildFieldDiff('lastName', currentLast, newLast);
      if (d) diffs.push(d);
    }
    if (dto.firstName !== undefined || dto.middleName !== undefined || dto.lastName !== undefined) {
      const assembled = joinName(newFirst, newMiddle, newLast);
      if (assembled !== report.reporter.fullName) {
        reporterUpdates.fullName = assembled;
      }
    }
    if (dto.phoneNumber !== undefined) {
      const d = buildFieldDiff('phoneNumber', report.reporter.phoneNumber, dto.phoneNumber);
      if (d) { diffs.push(d); reporterUpdates.phoneNumber = dto.phoneNumber; }
    }

    // Property diffs
    const propertyUpdates: Record<string, unknown> = {};
    const propFields: Array<{
      dtoKey: keyof AdminEditReportDto;
      dbKey: string;
      reportVal: unknown;
    }> = [
      { dtoKey: 'street', dbKey: 'street', reportVal: report.property.street },
      { dtoKey: 'projectName', dbKey: 'projectName', reportVal: report.property.projectName },
      { dtoKey: 'floor', dbKey: 'floor', reportVal: report.property.floor },
      { dtoKey: 'unitArea', dbKey: 'unitArea', reportVal: report.property.unitArea },
      { dtoKey: 'additionalDirections', dbKey: 'additionalDirections', reportVal: report.property.additionalDirections },
      { dtoKey: 'propertyNumber', dbKey: 'realEstateNumber', reportVal: report.property.realEstateNumber },
      { dtoKey: 'ownerPhoneNumber', dbKey: 'ownerPhoneNumber', reportVal: report.property.ownerPhoneNumber },
      { dtoKey: 'latitude', dbKey: 'latitude', reportVal: report.property.latitude },
      { dtoKey: 'longitude', dbKey: 'longitude', reportVal: report.property.longitude },
    ];
    for (const { dtoKey, dbKey, reportVal } of propFields) {
      const incomingVal = dto[dtoKey];
      if (incomingVal !== undefined) {
        const d = buildFieldDiff(dtoKey, reportVal as string | number | null, incomingVal as string | number);
        if (d) { diffs.push(d); propertyUpdates[dbKey] = incomingVal; }
      }
    }

    // Report-level diffs
    const reportUpdates: Partial<{ description: string }> = {};
    if (dto.description !== undefined) {
      const d = buildFieldDiff('description', report.description, dto.description);
      if (d) { diffs.push(d); reportUpdates.description = dto.description; }
    }

    // ── Persist & audit ──
    const { detailsEn, detailsAr } = buildAuditDetails(reviewer.name, diffs, []);

    await this.repository.updateReportData(
      id,
      reporterUpdates,
      propertyUpdates as Parameters<typeof this.repository.updateReportData>[2],
      reportUpdates,
    );

    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'EDIT_REPORT_DATA',
      targetId: report.referenceCode,
      details: detailsEn,
      detailsAr,
      ipAddress: reviewer.ipAddress,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX);
    return this.getReportById(id);
  }

  /** Remove a specific attachment from a report (admin override). */
  async deleteReportAttachment(
    reportId: string,
    attachmentId: string,
    reviewer: ActingReviewer,
  ): Promise<void> {
    const report = await this.getReportById(reportId);
    const attachment = report.attachments.find((a) => a.id === attachmentId);
    if (!attachment) {
      throw new ReportNotFoundError(attachmentId);
    }

    await this.repository.deleteAttachment(attachmentId);

    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'EDIT_REPORT_DATA',
      targetId: report.referenceCode,
      details: `Deleted attachment (${attachment.label ?? 'unlabelled'})`,
      detailsAr: `حذف المرفق (${attachment.label ?? 'بدون تسمية'})`,
      ipAddress: reviewer.ipAddress,
    });
  }
}

/** First + father's + family name, collapsed to one display string. */
function joinName(first: string, middle: string, last: string): string {
  return [first, middle, last].join(' ').replace(/\s+/g, ' ').trim();
}

// ────────────────── Dual-language diff engine ──────────────────

/** Human-readable field labels for the audit trail (EN / AR). */
const FIELD_LABELS: Record<string, { en: string; ar: string }> = {
  firstName: { en: 'First Name', ar: 'الاسم الأول' },
  middleName: { en: "Father's Name", ar: 'اسم الأب' },
  lastName: { en: 'Family Name', ar: 'اسم العائلة' },
  phoneNumber: { en: 'Phone Number', ar: 'رقم الهاتف' },
  street: { en: 'Street', ar: 'الشارع' },
  projectName: { en: 'Project / Building', ar: 'اسم المشروع / المبنى' },
  floor: { en: 'Floor', ar: 'الطابق' },
  unitArea: { en: 'Unit Area', ar: 'مساحة الوحدة السكنية' },
  additionalDirections: { en: 'Additional Directions', ar: 'دلالات إضافية' },
  propertyNumber: { en: 'Property Number', ar: 'رقم العقار' },
  ownerPhoneNumber: { en: "Owner's Phone", ar: 'هاتف مالك العقار' },
  latitude: { en: 'Latitude', ar: 'خط العرض' },
  longitude: { en: 'Longitude', ar: 'خط الطول' },
  description: { en: 'Damage Description', ar: 'وصف الضرر' },
};

interface DiffFragment {
  en: string;
  ar: string;
}

function buildFieldDiff(
  fieldKey: string,
  oldValue: string | number | null | undefined,
  newValue: string | number | null | undefined,
): DiffFragment | null {
  const oldStr = String(oldValue ?? '');
  const newStr = String(newValue ?? '');
  if (oldStr === newStr) return null;

  const labels = FIELD_LABELS[fieldKey];
  if (!labels) return null;

  const unit = fieldKey === 'unitArea' ? ' sqm' : '';
  const unitAr = fieldKey === 'unitArea' ? ' م²' : '';

  return {
    en: `updated ${labels.en} from '${oldStr}${unit}' to '${newStr}${unit}'`,
    ar: `عدّل ${labels.ar} من '${oldStr}${unitAr}' إلى '${newStr}${unitAr}'`,
  };
}

function buildAuditDetails(
  adminName: string,
  fragments: DiffFragment[],
  assetFragments: DiffFragment[],
): { detailsEn: string; detailsAr: string } {
  const all = [...fragments, ...assetFragments];
  if (all.length === 0) {
    return {
      detailsEn: `Staff ${adminName} opened edit mode but made no changes.`,
      detailsAr: `فتح الموظف ${adminName} وضع التعديل ولكن لم يُجرِ تغييرات.`,
    };
  }

  const enParts = all.map((f) => f.en).join(' and ');
  const arParts = all.map((f) => f.ar).join(' و');

  return {
    detailsEn: `Staff ${adminName} ${enParts}.`,
    detailsAr: `قام الموظف ${adminName} ب${arParts}.`,
  };
}
