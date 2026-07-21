import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { TtlCacheService } from '../common/cache/ttl-cache.service';
import {
  ConcurrentUpdateError,
  DisplacedRegistrationNotFoundError,
  TooManyIdDocumentsError,
} from '../common/errors/domain.errors';
import { UploadsService } from '../uploads/uploads.service';
import { LebaneseDisplaced, Prisma, SyrianDisplaced } from '../generated/prisma/client';
import {
  CreateLebaneseDisplacedDto,
  CreateSyrianDisplacedDto,
  DisplacedStatus,
  ListDisplacedQueryDto,
  MAX_ID_DOCUMENTS_PER_REGISTRATION,
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

/**
 * Bounded retries for the compare-and-swap id-document list updates
 * below (see `updateSyrianIdDocumentsIfUnchanged`) — enough to absorb a
 * genuine race between two staff members without looping forever.
 */
const MAX_DOCUMENT_UPDATE_ATTEMPTS = 5;

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
    idDocuments: Express.Multer.File[],
  ): Promise<SyrianDisplaced> {
    this.assertWithinDocumentCap(idDocuments.length);
    const idDocumentUrls = await this.uploadIdDocuments(idDocuments);
    try {
      const created = await this.repository.createSyrian(payload, idDocumentUrls);
      this.cache.invalidatePrefix(CACHE_PREFIX.SYRIAN);
      return created;
    } catch (error) {
      await this.cleanupUploadedDocuments(idDocumentUrls);
      throw error;
    }
  }

  async submitLebanese(
    payload: CreateLebaneseDisplacedDto,
    idDocuments: Express.Multer.File[],
  ): Promise<LebaneseDisplaced> {
    this.assertWithinDocumentCap(idDocuments.length);
    const idDocumentUrls = await this.uploadIdDocuments(idDocuments);
    try {
      const created = await this.repository.createLebanese(
        payload,
        idDocumentUrls,
      );
      this.cache.invalidatePrefix(CACHE_PREFIX.LEBANESE);
      return created;
    } catch (error) {
      await this.cleanupUploadedDocuments(idDocumentUrls);
      throw error;
    }
  }

  /** Best-effort cleanup of orphaned storage objects after a failed persist. */
  private async cleanupUploadedDocuments(urls: string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.uploads.deleteEvidence(url)));
  }

  private assertWithinDocumentCap(count: number): void {
    if (count > MAX_ID_DOCUMENTS_PER_REGISTRATION) {
      throw new TooManyIdDocumentsError(MAX_ID_DOCUMENTS_PER_REGISTRATION);
    }
  }

  /**
   * The registrant's identity proof (ID card / passport photo(s) or
   * PDF(s)): content-sniffed, size-checked and streamed to Supabase
   * Storage by the shared evidence pipeline (in parallel, same pattern
   * as the damage-report multipart pipeline) before the row is persisted.
   */
  private async uploadIdDocuments(
    idDocuments: Express.Multer.File[],
  ): Promise<string[]> {
    return Promise.all(
      idDocuments.map((file) =>
        this.uploads.uploadEvidence(
          'document',
          file.buffer,
          file.originalname,
          file.mimetype,
        ),
      ),
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

  /** Single registration for the staff detail page. */
  async getSyrianById(id: string): Promise<SyrianDisplaced> {
    const existing = await this.repository.findSyrianById(id);
    if (!existing) {
      throw new DisplacedRegistrationNotFoundError(id);
    }
    return existing;
  }

  async getLebaneseById(id: string): Promise<LebaneseDisplaced> {
    const existing = await this.repository.findLebaneseById(id);
    if (!existing) {
      throw new DisplacedRegistrationNotFoundError(id);
    }
    return existing;
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

    // Field-level bilingual diff captured BEFORE persisting, so the trail
    // records exactly what changed (old → new) in both languages.
    const { detailsEn, detailsAr } = buildDisplacedAuditDetails(
      reviewer.name,
      AUDIENCE_LABEL.SYRIAN,
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
      existing.fullName,
    );

    const updated = await this.repository.updateSyrian(id, data);

    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'UPDATE_DISPLACED_REGISTRATION',
      targetId: id,
      details: detailsEn,
      detailsAr,
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

    const { detailsEn, detailsAr } = buildDisplacedAuditDetails(
      reviewer.name,
      AUDIENCE_LABEL.LEBANESE,
      existing as unknown as Record<string, unknown>,
      dto as Record<string, unknown>,
      existing.fullName,
    );

    const updated = await this.repository.updateLebanese(id, data);

    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'UPDATE_DISPLACED_REGISTRATION',
      targetId: id,
      details: detailsEn,
      detailsAr,
      ipAddress: reviewer.ipAddress,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX.LEBANESE);
    return updated;
  }

  /**
   * Staff "add document" action: uploads one or more files and appends
   * them to the registration's existing document list (never replaces
   * it), rejecting the request up front if the combined total would
   * exceed the per-registration cap. Returns the full updated list so
   * the edit dialog can render it immediately.
   */
  async uploadIdDocumentsForRegistration(
    audience: DisplacedAudience,
    id: string,
    files: Express.Multer.File[],
    reviewer: ActingReviewer,
  ): Promise<string[]> {
    const uploadedUrls = await this.uploadIdDocuments(files);

    let outcome: { finalUrls: string[]; fullName: string } | null = null;
    try {
      for (
        let attempt = 0;
        attempt < MAX_DOCUMENT_UPDATE_ATTEMPTS && !outcome;
        attempt += 1
      ) {
        const existing =
          audience === 'SYRIAN'
            ? await this.repository.findSyrianById(id)
            : await this.repository.findLebaneseById(id);
        if (!existing) {
          throw new DisplacedRegistrationNotFoundError(id);
        }
        if (
          existing.idDocumentUrls.length + uploadedUrls.length >
          MAX_ID_DOCUMENTS_PER_REGISTRATION
        ) {
          throw new TooManyIdDocumentsError(MAX_ID_DOCUMENTS_PER_REGISTRATION);
        }

        // Compare-and-swap against the list we just read: if another
        // request changed it first, updatedCount is 0 and we retry
        // against the fresh state instead of silently overwriting it.
        const nextUrls = [...existing.idDocumentUrls, ...uploadedUrls];
        const updatedCount =
          audience === 'SYRIAN'
            ? await this.repository.updateSyrianIdDocumentsIfUnchanged(
                id,
                existing.idDocumentUrls,
                nextUrls,
              )
            : await this.repository.updateLebaneseIdDocumentsIfUnchanged(
                id,
                existing.idDocumentUrls,
                nextUrls,
              );
        if (updatedCount > 0) {
          outcome = { finalUrls: nextUrls, fullName: existing.fullName };
        }
      }
      if (!outcome) {
        throw new ConcurrentUpdateError();
      }
    } catch (error) {
      await this.cleanupUploadedDocuments(uploadedUrls);
      throw error;
    }

    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'UPDATE_DISPLACED_REGISTRATION',
      targetId: id,
      details: `Uploaded ${uploadedUrls.length} new ID document(s) for ${AUDIENCE_LABEL[audience].en} "${outcome.fullName}"`,
      detailsAr: `تحميل ${uploadedUrls.length} مستند(ات) هوية جديدة لـ ${AUDIENCE_LABEL[audience].ar} "${outcome.fullName}"`,
      ipAddress: reviewer.ipAddress,
    });

    this.cache.invalidatePrefix(CACHE_PREFIX[audience]);
    return outcome.finalUrls;
  }

  /**
   * Staff "delete document" action: removes exactly one URL from the
   * registration's document list, leaving the rest untouched. Returns
   * the full updated list.
   */
  async deleteIdDocument(
    audience: DisplacedAudience,
    id: string,
    url: string,
    reviewer: ActingReviewer,
  ): Promise<string[]> {
    let outcome: { finalUrls: string[]; fullName: string; removed: boolean } | null =
      null;

    for (
      let attempt = 0;
      attempt < MAX_DOCUMENT_UPDATE_ATTEMPTS && !outcome;
      attempt += 1
    ) {
      const existing =
        audience === 'SYRIAN'
          ? await this.repository.findSyrianById(id)
          : await this.repository.findLebaneseById(id);
      if (!existing) {
        throw new DisplacedRegistrationNotFoundError(id);
      }

      const nextUrls = existing.idDocumentUrls.filter(
        (existingUrl) => existingUrl !== url,
      );
      if (nextUrls.length === existing.idDocumentUrls.length) {
        // Already gone (deleted concurrently, or an unknown URL) — no-op.
        outcome = { finalUrls: existing.idDocumentUrls, fullName: existing.fullName, removed: false };
        break;
      }

      const updatedCount =
        audience === 'SYRIAN'
          ? await this.repository.updateSyrianIdDocumentsIfUnchanged(
              id,
              existing.idDocumentUrls,
              nextUrls,
            )
          : await this.repository.updateLebaneseIdDocumentsIfUnchanged(
              id,
              existing.idDocumentUrls,
              nextUrls,
            );
      if (updatedCount > 0) {
        outcome = { finalUrls: nextUrls, fullName: existing.fullName, removed: true };
      }
    }

    if (!outcome) {
      throw new ConcurrentUpdateError();
    }

    if (outcome.removed) {
      await this.uploads.deleteEvidence(url);

      await this.audit.record({
        adminId: reviewer.id,
        adminName: reviewer.name,
        actionType: 'UPDATE_DISPLACED_REGISTRATION',
        targetId: id,
        details: `Deleted an ID document for ${AUDIENCE_LABEL[audience].en} "${outcome.fullName}"`,
        detailsAr: `حذف مستند هوية لـ ${AUDIENCE_LABEL[audience].ar} "${outcome.fullName}"`,
        ipAddress: reviewer.ipAddress,
      });

      this.cache.invalidatePrefix(CACHE_PREFIX[audience]);
    }

    return outcome.finalUrls;
  }

  /**
   * Trail entry for a staff member opening a registration's detail view.
   * Read-only — no cache invalidation, nothing mutated.
   */
  async recordView(
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

    const label = AUDIENCE_LABEL[audience];
    await this.audit.record({
      adminId: reviewer.id,
      adminName: reviewer.name,
      actionType: 'VIEW_DISPLACED_RECORD',
      targetId: id,
      details: `Viewed ${label.en} record "${existing.fullName}"`,
      detailsAr: `اطّلع على سجل ${label.ar} "${existing.fullName}"`,
      ipAddress: reviewer.ipAddress,
    });
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

// ────────────────── Dual-language diff engine ──────────────────
// Mirrors the war-damages audit pattern (damage-report.service.ts):
// every changed field is written to the trail as
// "updated <label> from 'old' to 'new'" in both English and Arabic.

/** Human-readable field labels for the displaced audit trail (EN / AR). */
const DISPLACED_FIELD_LABELS: Record<string, { en: string; ar: string }> = {
  fullName: { en: 'Full Name', ar: 'الاسم الكامل' },
  phone: { en: 'Phone Number', ar: 'رقم الهاتف' },
  alternatePhone: { en: 'Alternate Phone', ar: 'رقم الهاتف البديل' },
  familyMembersCount: { en: 'Family Members Count', ar: 'عدد أفراد الأسرة' },
  familyMembersNames: { en: 'Family Members Names', ar: 'أسماء أفراد الأسرة' },
  neighborhoodName: { en: 'Neighborhood', ar: 'الحي' },
  buildingName: { en: 'Building', ar: 'المبنى' },
  shelterType: { en: 'Housing Type', ar: 'نوع السكن' },
  shelterContactName: { en: 'Shelter Contact Name', ar: 'اسم جهة التواصل للسكن' },
  shelterContactPhone: { en: 'Shelter Contact Phone', ar: 'هاتف جهة التواصل للسكن' },
  originalCity: { en: 'City of Origin', ar: 'المدينة الأصلية' },
  originVillage: { en: 'Village of Origin', ar: 'قرية الأصل' },
  registrationNumber: { en: 'Registration Number', ar: 'رقم التسجيل' },
  isPropertyDamaged: { en: 'Property Damaged', ar: 'تضرر العقار' },
  primarySourceOfIncome: { en: 'Primary Source of Income', ar: 'مصدر الدخل الأساسي' },
  entryDate: { en: 'Date of Entry', ar: 'تاريخ الدخول' },
  displacementDate: { en: 'Displacement Date', ar: 'تاريخ النزوح' },
  urgentNeeds: { en: 'Urgent Needs', ar: 'الاحتياجات العاجلة' },
  vulnerabilityStatus: { en: 'Vulnerability Status', ar: 'حالة الهشاشة' },
  status: { en: 'Status', ar: 'الحالة' },
};

/** Normalises any stored/incoming value to a bilingual display string. */
function displayValue(value: unknown): { en: string; ar: string } {
  if (value === null || value === undefined || value === '') {
    return { en: '—', ar: '—' };
  }
  if (value instanceof Date) {
    const iso = value.toISOString().slice(0, 10);
    return { en: iso, ar: iso };
  }
  if (Array.isArray(value)) {
    const joined = value.join(', ') || '—';
    return { en: joined, ar: joined };
  }
  if (typeof value === 'boolean') {
    return { en: value ? 'yes' : 'no', ar: value ? 'نعم' : 'لا' };
  }
  return { en: String(value), ar: String(value) };
}

/** Two values compare equal when their display forms match. */
function sameValue(a: unknown, b: unknown): boolean {
  return displayValue(a).en === displayValue(b).en;
}

/**
 * Composes the bilingual trail message for a partial registration update:
 * one "updated X from 'a' to 'b'" fragment per genuinely-changed field,
 * or an explicit "no changes" line when the save was a no-op.
 */
function buildDisplacedAuditDetails(
  adminName: string,
  audienceLabel: { en: string; ar: string },
  existing: Record<string, unknown>,
  dto: Record<string, unknown>,
  fullName: string,
): { detailsEn: string; detailsAr: string } {
  const fragmentsEn: string[] = [];
  const fragmentsAr: string[] = [];

  for (const [key, labels] of Object.entries(DISPLACED_FIELD_LABELS)) {
    const incoming = dto[key];
    if (incoming === undefined) continue;
    if (sameValue(existing[key], incoming)) continue;
    const before = displayValue(existing[key]);
    const after = displayValue(incoming);
    fragmentsEn.push(
      `updated ${labels.en} from '${before.en}' to '${after.en}'`,
    );
    fragmentsAr.push(
      `عدّل ${labels.ar} من '${before.ar}' إلى '${after.ar}'`,
    );
  }

  if (fragmentsEn.length === 0) {
    return {
      detailsEn: `Staff ${adminName} saved ${audienceLabel.en} record "${fullName}" with no changes.`,
      detailsAr: `حفظ الموظف ${adminName} سجل ${audienceLabel.ar} "${fullName}" دون تغييرات.`,
    };
  }

  return {
    detailsEn: `Staff ${adminName} — ${audienceLabel.en} "${fullName}": ${fragmentsEn.join(' and ')}.`,
    detailsAr: `الموظف ${adminName} — ${audienceLabel.ar} "${fullName}": ${fragmentsAr.join(' و')}.`,
  };
}
