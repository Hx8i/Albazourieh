import { Injectable } from "@nestjs/common";
import { AuditLogService } from "../audit/audit-log.service";
import { TtlCacheService } from "../common/cache/ttl-cache.service";
import {
  InvalidStatusTransitionError,
  MissingRequiredFileError,
  RejectionReasonRequiredError,
  ReportNotFoundError,
} from "../common/errors/domain.errors";
import { UploadsService } from "../uploads/uploads.service";
import {
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
          ? `${report.status} → ${dto.status} (${dto.rejectionReason ?? ""})`
          : `${report.status} → ${dto.status}`,
      ipAddress: reviewer.ipAddress,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX);
    return this.getReportById(id);
  }
}

/** First + father's + family name, collapsed to one display string. */
function joinName(first: string, middle: string, last: string): string {
  return [first, middle, last].join(" ").replace(/\s+/g, " ").trim();
}
