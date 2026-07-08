import { Injectable } from '@nestjs/common';
import { ReportStatus } from '@prisma/client';
import { AuditLogService } from '../audit/audit-log.service';
import { TtlCacheService } from '../common/cache/ttl-cache.service';
import {
  DescriptionRequiredError,
  InvalidStatusTransitionError,
  MissingRequiredFileError,
  RejectionReasonRequiredError,
  ReportNotFoundError,
  UntrustedAttachmentUrlError,
} from '../common/errors/domain.errors';
import { SupabaseStorageService } from '../uploads/supabase-storage.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  AttachmentLabel,
  CreateDamageReportDto,
  ListReportsQueryDto,
  MultipartPayloadDto,
  PropertyNumberAvailabilityDto,
  SpatialQueryDto,
  UpdateReportStatusDto,
} from './damage-report.dto';
import {
  DamageReportRepository,
  DamageReportWithRelations,
  PaginatedReports,
  PersistReportInput,
  SpatialPoint,
  StatusSummary,
} from './damage-report.repository';

/**
 * The review lifecycle. A report only ever moves forward (or gets
 * rejected); APPROVED and REJECTED are terminal states.
 */
const ALLOWED_TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  PENDING: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: [],
};

/** Aggregate dashboard queries stay cached this long (cache-busted on writes). */
const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_PREFIX = 'reports:';

/** Multipart field map produced by FileFieldsInterceptor. */
export interface MultipartFiles {
  damagePhotos?: Express.Multer.File[];
  voiceNote?: Express.Multer.File[];
  nationalId?: Express.Multer.File[];
  proxyNationalId?: Express.Multer.File[];
  propertyDeed?: Express.Multer.File[];
  rentalContract?: Express.Multer.File[];
  vehicleRegistration?: Express.Multer.File[];
  vehiclePhotos?: Express.Multer.File[];
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
    private readonly storage: SupabaseStorageService,
    private readonly uploads: UploadsService,
    private readonly cache: TtlCacheService,
    private readonly audit: AuditLogService,
  ) {}

  // ───────────────────────── Citizen submissions ─────────────────────

  /** Legacy JSON submission (pre-uploaded evidence URLs). */
  async submitReport(
    dto: CreateDamageReportDto,
  ): Promise<DamageReportWithRelations> {
    this.assertTrustedEvidenceUrls(dto);

    const created = await this.repository.createFromSubmission({
      reporter: dto.reporter,
      property: {
        type: dto.property.type,
        district: dto.property.district,
        neighborhood: dto.property.neighborhood,
        addressLine: dto.property.addressLine,
        latitude: dto.property.latitude,
        longitude: dto.property.longitude,
      },
      report: dto.report,
      attachments: dto.attachments,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX);
    return created;
  }

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

    const attachments: PersistReportInput['attachments'] = [];

    const uploadAll = async (
      fileList: Express.Multer.File[] | undefined,
      kind: 'photo' | 'document',
      label: AttachmentLabel,
    ): Promise<void> => {
      for (const file of fileList ?? []) {
        const url = await this.uploads.uploadEvidence(
          kind,
          file.buffer,
          file.originalname,
          file.mimetype,
        );
        attachments.push({
          url,
          type: kind === 'photo' ? 'PHOTO' : 'DOCUMENT',
          label,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        });
      }
    };

    await uploadAll(files.damagePhotos, 'photo', 'DAMAGE_PHOTO');
    await uploadAll(files.vehiclePhotos, 'photo', 'VEHICLE_PHOTO');
    await uploadAll(files.nationalId, 'document', 'NATIONAL_ID');
    await uploadAll(files.proxyNationalId, 'document', 'PROXY_NATIONAL_ID');
    await uploadAll(files.propertyDeed, 'document', 'PROPERTY_DEED');
    await uploadAll(files.rentalContract, 'document', 'RENTAL_CONTRACT');
    await uploadAll(files.vehicleRegistration, 'document', 'VEHICLE_REGISTRATION');
    await uploadAll(files.residencyProof, 'document', 'RESIDENCY_PROOF');

    let voiceNoteUrl: string | undefined;
    const voiceFile = files.voiceNote?.[0];
    if (voiceFile) {
      voiceNoteUrl = await this.uploads.uploadEvidence(
        'voice',
        voiceFile.buffer,
        voiceFile.originalname,
        voiceFile.mimetype,
      );
    }

    const isVehicle = payload.category === 'VEHICLE';
    const proxy = payload.report.proxy;
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
              payload.property.vehicleType === 'OTHER'
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
        // Voice-only submissions store an empty description (the case
        // file shows the audio player instead).
        description: payload.report.description ?? '',
        severity: payload.report.severity,
        voiceNoteUrl,
        submittedByProxy: payload.report.submittedByProxy,
        proxyName: proxy
          ? joinName(proxy.firstName, proxy.middleName, proxy.lastName)
          : undefined,
        proxyRelation:
          proxy?.relationship === 'OTHER'
            ? proxy.customRelationshipDescription
            : proxy?.relationship,
        proxyPhoneNumber: proxy?.phoneNumber,
      },
      attachments,
      enforceUniquePropertyNumber: !isVehicle,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX);
    return created;
  }

  /**
   * Category-specific mandatory documents, checked before any upload:
   * - Everyone: national ID + at least one damage photo; the written
   *   description is required unless a voice note is attached.
   * - Proxy submissions: the proxy's own national ID photo.
   * - Property owners: proof of residency. Tenants: rental contract
   *   instead (residency proof is not applicable and not collected).
   * - VEHICLE: vehicle papers (أوراق الآلية) + vehicle photos.
   */
  private assertRequiredFiles(
    payload: MultipartPayloadDto,
    files: MultipartFiles,
  ): void {
    if (!files.nationalId?.length) {
      throw new MissingRequiredFileError('nationalId');
    }
    if (!files.damagePhotos?.length) {
      throw new MissingRequiredFileError('damagePhotos');
    }
    if (!payload.report.description && !files.voiceNote?.length) {
      throw new DescriptionRequiredError();
    }
    if (payload.report.submittedByProxy && !files.proxyNationalId?.length) {
      throw new MissingRequiredFileError('proxyNationalId');
    }
    if (payload.category === 'VEHICLE') {
      if (!files.vehicleRegistration?.length) {
        throw new MissingRequiredFileError('vehicleRegistration');
      }
      if (!files.vehiclePhotos?.length) {
        throw new MissingRequiredFileError('vehiclePhotos');
      }
    } else if (payload.property.ownershipStatus === 'TENANT') {
      if (!files.rentalContract?.length) {
        throw new MissingRequiredFileError('rentalContract');
      }
    } else if (!files.residencyProof?.length) {
      throw new MissingRequiredFileError('residencyProof');
    }
  }

  /**
   * Every evidence URL in a JSON submission must come from this
   * platform's own storage buckets, never an arbitrary foreign URL.
   */
  private assertTrustedEvidenceUrls(dto: CreateDamageReportDto): void {
    const trustedPrefixes = this.storage.getTrustedUrlPrefixes();
    if (trustedPrefixes.length === 0) return;

    const urls = [
      dto.report.voiceNoteUrl,
      ...dto.attachments.map((attachment) => attachment.url),
    ].filter((url): url is string => Boolean(url));

    for (const url of urls) {
      if (!trustedPrefixes.some((prefix) => url.startsWith(prefix))) {
        throw new UntrustedAttachmentUrlError();
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

  /** Paginated, filterable inbox (not cached — always fresh). */
  async listReports(query: ListReportsQueryDto): Promise<PaginatedReports> {
    return this.repository.list({
      status: query.status,
      severity: query.severity,
      neighborhood: query.neighborhood,
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
    const key = `${CACHE_PREFIX}spatial:${query.status ?? '*'}:${query.severity ?? '*'}:${query.neighborhood ?? '*'}:${query.limit}`;
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
    if (dto.status === 'REJECTED' && !dto.rejectionReason) {
      throw new RejectionReasonRequiredError();
    }

    await this.repository.updateStatus(
      id,
      dto.status,
      dto.status === 'REJECTED' ? (dto.rejectionReason ?? null) : null,
      reviewer.id,
    );

    // "تتبع العمليات" — every review decision is written to the trail.
    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'UPDATE_REPORT_STATUS',
      targetId: id,
      details:
        dto.status === 'REJECTED'
          ? `${report.status} → ${dto.status} (${dto.rejectionReason ?? ''})`
          : `${report.status} → ${dto.status}`,
      ipAddress: reviewer.ipAddress,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX);
    return this.getReportById(id);
  }
}

/** First + father's + family name, collapsed to one display string. */
function joinName(first: string, middle: string, last: string): string {
  return [first, middle, last].join(' ').replace(/\s+/g, ' ').trim();
}
