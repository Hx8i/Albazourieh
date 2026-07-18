import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { TtlCacheService } from '../common/cache/ttl-cache.service';
import { DisplacedRegistrationNotFoundError } from '../common/errors/domain.errors';
import { UploadsService } from '../uploads/uploads.service';
import { LebaneseDisplaced, Prisma, SyrianDisplaced } from '../generated/prisma/client';
import {
  CreateLebaneseDisplacedDto,
  CreateSyrianDisplacedDto,
  DisplacedStatus,
  ListDisplacedQueryDto,
  UpdateDisplacedStatusDto,
  UpdateSyrianDisplacedDto,
  UpdateLebaneseDisplacedDto,
} from './displaced.dto';
import {
  DisplacedAudience,
  DisplacedRepository,
  DisplacedSummary,
  PaginatedDisplaced,
} from './displaced.repository';

/** Aggregate dashboard queries stay cached this long (cache-busted on writes). */
const SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;

/** Per-audience cache prefixes so busting one programme never touches the other. */
const CACHE_PREFIX: Record<DisplacedAudience, string> = {
  SYRIAN: 'displaced:syrian:',
  LEBANESE: 'displaced:lebanese:',
};

const AUDIENCE_LABEL: Record<DisplacedAudience, { en: string; ar: string }> = {
  SYRIAN: { en: 'Syrian displaced', ar: 'لاجئ سوري' },
  LEBANESE: { en: 'Lebanese displaced', ar: 'نازح لبناني' },
};

/** The reviewing staff member (identity from the verified JWT). */
export interface ActingReviewer {
  id: string;
  name: string;
  ipAddress?: string;
}

@Injectable()
export class DisplacedService {
  constructor(
    private readonly repository: DisplacedRepository,
    private readonly uploads: UploadsService,
    private readonly cache: TtlCacheService,
    private readonly audit: AuditLogService,
  ) {}

  // ───────────────────────── Public intake ─────────────────────────

  async submitSyrian(
    payload: CreateSyrianDisplacedDto,
    idDocument: Express.Multer.File,
  ): Promise<SyrianDisplaced> {
    const idDocumentUrl = await this.uploadIdDocument(idDocument);
    const created = await this.repository.createSyrian(payload, idDocumentUrl);
    this.cache.invalidatePrefix(CACHE_PREFIX.SYRIAN);
    return created;
  }

  async submitLebanese(
    payload: CreateLebaneseDisplacedDto,
    idDocument: Express.Multer.File,
  ): Promise<LebaneseDisplaced> {
    const idDocumentUrl = await this.uploadIdDocument(idDocument);
    const created = await this.repository.createLebanese(
      payload,
      idDocumentUrl,
    );
    this.cache.invalidatePrefix(CACHE_PREFIX.LEBANESE);
    return created;
  }

  /**
   * The registrant's identity proof (ID card / passport photo or PDF):
   * content-sniffed, size-checked and streamed to Supabase Storage by
   * the shared evidence pipeline before the row is persisted.
   */
  private async uploadIdDocument(
    idDocument: Express.Multer.File,
  ): Promise<string> {
    return this.uploads.uploadEvidence(
      'document',
      idDocument.buffer,
      idDocument.originalname,
      idDocument.mimetype,
    );
  }

  // ───────────────────────── Dashboard reads ───────────────────────

  /** Paginated, filterable, searchable inbox (not cached — always fresh). */
  async listSyrian(
    query: ListDisplacedQueryDto,
  ): Promise<PaginatedDisplaced<SyrianDisplaced>> {
    return this.repository.listSyrian(toFilter(query));
  }

  async listLebanese(
    query: ListDisplacedQueryDto,
  ): Promise<PaginatedDisplaced<LebaneseDisplaced>> {
    return this.repository.listLebanese(toFilter(query));
  }

  /** Metric cards + chart aggregates — cached, busted on every write. */
  async getSummary(audience: DisplacedAudience): Promise<DisplacedSummary> {
    return this.cache.getOrSet(
      `${CACHE_PREFIX[audience]}summary`,
      SUMMARY_CACHE_TTL_MS,
      () => this.repository.summarize(audience),
    );
  }

  // ──────────────────────── Status lifecycle ───────────────────────

  /**
   * Move a registration between PENDING/APPROVED/REJECTED. Intake triage
   * is deliberately reversible (unlike the damage-report lifecycle), so
   * any status can move to any other; every change lands in the audit
   * trail with the acting staff member.
   */
  async updateStatus(
    audience: DisplacedAudience,
    id: string,
    dto: UpdateDisplacedStatusDto,
    reviewer: ActingReviewer,
  ): Promise<SyrianDisplaced | LebaneseDisplaced> {
    const existing =
      audience === 'SYRIAN'
        ? await this.repository.findSyrianById(id)
        : await this.repository.findLebaneseById(id);
    if (!existing) {
      throw new DisplacedRegistrationNotFoundError(id);
    }

    const updated =
      audience === 'SYRIAN'
        ? await this.repository.updateSyrianStatus(id, dto.status)
        : await this.repository.updateLebaneseStatus(id, dto.status);

    await this.recordStatusAudit(audience, existing, dto.status, reviewer);
    this.cache.invalidatePrefix(CACHE_PREFIX[audience]);
    return updated;
  }

  async updateSyrian(
    id: string,
    dto: UpdateSyrianDisplacedDto,
    reviewer: ActingReviewer,
  ): Promise<SyrianDisplaced> {
    const existing = await this.repository.findSyrianById(id);
    if (!existing) {
      throw new DisplacedRegistrationNotFoundError(id);
    }

    const { entryDate, ...rest } = dto;
    const data: Prisma.SyrianDisplacedUpdateInput = {
      ...rest,
      entryDate: entryDate ? toCalendarDate(entryDate) : undefined,
    };

    const updated = await this.repository.updateSyrian(id, data);

    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'UPDATE_DISPLACED_REGISTRATION',
      targetId: id,
      details: `Updated Syrian registration for "${existing.fullName}"`,
      detailsAr: `تحديث تسجيل النازح السوري "${existing.fullName}"`,
      ipAddress: reviewer.ipAddress,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX.SYRIAN);
    return updated;
  }

  async updateLebanese(
    id: string,
    dto: UpdateLebaneseDisplacedDto,
    reviewer: ActingReviewer,
  ): Promise<LebaneseDisplaced> {
    const existing = await this.repository.findLebaneseById(id);
    if (!existing) {
      throw new DisplacedRegistrationNotFoundError(id);
    }

    const { displacementDate, ...rest } = dto;
    const data: Prisma.LebaneseDisplacedUpdateInput = {
      ...rest,
      displacementDate: displacementDate ? toCalendarDate(displacementDate) : undefined,
    };

    const updated = await this.repository.updateLebanese(id, data);

    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'UPDATE_DISPLACED_REGISTRATION',
      targetId: id,
      details: `Updated Lebanese registration for "${existing.fullName}"`,
      detailsAr: `تحديث تسجيل النازح اللبناني "${existing.fullName}"`,
      ipAddress: reviewer.ipAddress,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX.LEBANESE);
    return updated;
  }

  async uploadIdDocumentForRegistration(
    audience: DisplacedAudience,
    id: string,
    file: Express.Multer.File,
    reviewer: ActingReviewer,
  ): Promise<string> {
    const existing =
      audience === 'SYRIAN'
        ? await this.repository.findSyrianById(id)
        : await this.repository.findLebaneseById(id);
    if (!existing) {
      throw new DisplacedRegistrationNotFoundError(id);
    }

    const idDocumentUrl = await this.uploads.uploadEvidence(
      'document',
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    if (audience === 'SYRIAN') {
      await this.repository.updateSyrian(id, { idDocumentUrl });
    } else {
      await this.repository.updateLebanese(id, { idDocumentUrl });
    }

    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'UPDATE_DISPLACED_REGISTRATION',
      targetId: id,
      details: `Uploaded new ID document for ${AUDIENCE_LABEL[audience].en} "${existing.fullName}"`,
      detailsAr: `تحميل مستند هوية جديد لـ ${AUDIENCE_LABEL[audience].ar} "${existing.fullName}"`,
      ipAddress: reviewer.ipAddress,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX[audience]);
    return idDocumentUrl;
  }

  async deleteIdDocument(
    audience: DisplacedAudience,
    id: string,
    reviewer: ActingReviewer,
  ): Promise<void> {
    const existing =
      audience === 'SYRIAN'
        ? await this.repository.findSyrianById(id)
        : await this.repository.findLebaneseById(id);
    if (!existing) {
      throw new DisplacedRegistrationNotFoundError(id);
    }

    if (audience === 'SYRIAN') {
      await this.repository.updateSyrian(id, { idDocumentUrl: null });
    } else {
      await this.repository.updateLebanese(id, { idDocumentUrl: null });
    }

    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'UPDATE_DISPLACED_REGISTRATION',
      targetId: id,
      details: `Deleted ID document for ${AUDIENCE_LABEL[audience].en} "${existing.fullName}"`,
      detailsAr: `حذف مستند هوية لـ ${AUDIENCE_LABEL[audience].ar} "${existing.fullName}"`,
      ipAddress: reviewer.ipAddress,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX[audience]);
  }

  private async recordStatusAudit(
    audience: DisplacedAudience,
    existing: SyrianDisplaced | LebaneseDisplaced,
    nextStatus: DisplacedStatus,
    reviewer: ActingReviewer,
  ): Promise<void> {
    const label = AUDIENCE_LABEL[audience];
    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'UPDATE_DISPLACED_STATUS',
      targetId: existing.id,
      details: `${label.en} "${existing.fullName}": ${existing.status} → ${nextStatus}`,
      detailsAr: `${label.ar} "${existing.fullName}": تغيير الحالة ${existing.status} → ${nextStatus}`,
      ipAddress: reviewer.ipAddress,
    });
  }
}

function toFilter(query: ListDisplacedQueryDto) {
  return {
    status: query.status,
    search: query.search,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function toCalendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
