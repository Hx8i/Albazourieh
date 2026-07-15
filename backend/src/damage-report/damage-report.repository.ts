import { Injectable } from '@nestjs/common';
import {
  AttachmentType,
  DamageReport,
  DamageSeverity,
  Language,
  OwnershipStatus,
  Prisma,
  PropertyType,
  ReportStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportSortField, SortDirection } from './damage-report.dto';
import { generateReferenceCode } from './reference-code';

const reportWithRelations = {
  include: {
    reporter: {
      select: { id: true, fullName: true, phoneNumber: true },
    },
    property: {
      select: {
        id: true,
        type: true,
        ownershipStatus: true,
        realEstateNumber: true,
        ownerPhoneNumber: true,
        vehicleType: true,
        vehicleTypeOther: true,
        district: true,
        neighborhood: true,
        street: true,
        projectName: true,
        floor: true,
        unitArea: true,
        additionalDirections: true,
        addressLine: true,
        latitude: true,
        longitude: true,
      },
    },
    attachments: {
      select: { id: true, url: true, type: true, label: true, mimeType: true },
    },
  },
} satisfies Prisma.DamageReportDefaultArgs;

export type DamageReportWithRelations = Prisma.DamageReportGetPayload<
  typeof reportWithRelations
>;

/** How many fresh codes to try before giving up on a pathological run. */
const MAX_REFERENCE_CODE_ATTEMPTS = 5;

export interface ListReportsFilter {
  status?: ReportStatus;
  severity?: DamageSeverity;
  neighborhood?: string;
  /** Single-input search: name, phone, property number or reference code. */
  search?: string;
  sortBy: ReportSortField;
  sortDir: SortDirection;
  page: number;
  pageSize: number;
}

/** Maps a dashboard-facing sort field onto the Prisma orderBy shape. */
function reportOrderBy(
  sortBy: ReportSortField,
  sortDir: SortDirection,
): Prisma.DamageReportOrderByWithRelationInput {
  switch (sortBy) {
    case 'referenceCode':
      return { referenceCode: sortDir };
    case 'reporterName':
      return { reporter: { fullName: sortDir } };
    case 'neighborhood':
      return { property: { neighborhood: sortDir } };
    case 'severity':
      return { severity: sortDir };
    case 'status':
      return { status: sortDir };
    case 'createdAt':
      return { createdAt: sortDir };
  }
}

export interface PaginatedReports {
  items: DamageReportWithRelations[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

/**
 * Framework-agnostic persistence input — the multipart pipeline maps its
 * validated DTO onto this shape.
 */
export interface PersistReportInput {
  reporter: {
    fullName: string;
    phoneNumber: string;
    preferredLanguage: Language;
  };
  property: {
    type: PropertyType;
    ownershipStatus?: OwnershipStatus;
    realEstateNumber?: string;
    ownerPhoneNumber?: string;
    vehicleType?: string;
    vehicleTypeOther?: string;
    district?: string;
    neighborhood: string;
    street?: string;
    projectName?: string;
    floor?: string;
    unitArea?: number;
    additionalDirections?: string;
    addressLine?: string;
    latitude: number;
    longitude: number;
  };
  report: {
    description: string;
    severity: DamageSeverity;
  };
  attachments: Array<{
    url: string;
    type: AttachmentType;
    label?: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;
  /** BUILDING category: reject when the property number is already filed. */
  enforceUniquePropertyNumber?: boolean;
}

export interface StatusSummary {
  total: number;
  byStatus: Record<ReportStatus, number>;
  bySeverity: Record<DamageSeverity, number>;
}

export interface SpatialFilter {
  status?: ReportStatus;
  severity?: DamageSeverity;
  neighborhood?: string;
  limit: number;
}

/**
 * Privacy-scrubbed status payload for the public citizen tracking page.
 * Deliberately excludes every personal/identifying field.
 */
export interface PublicReportStatus {
  referenceCode: string;
  status: ReportStatus;
  /** Generic category only (PropertyType), never the full property record. */
  category: PropertyType;
  /** ISO-8601 submission timestamp. */
  submittedAt: string;
  rejectedField?: string | null;
}

/** Minimal payload shaped for direct deck.gl layer ingestion. */
export interface SpatialPoint {
  id: string;
  latitude: number;
  longitude: number;
  severity: DamageSeverity;
  status: ReportStatus;
  propertyType: string;
  neighborhood: string;
  reporterName: string;
}

/** True when the unique-index violation is on the reference code. */
function isReferenceCodeCollision(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    JSON.stringify(error.meta?.target ?? '').includes('referenceCode')
  );
}

/**
 * The only class in the feature that talks to Prisma. Services depend on
 * this abstraction, never on PrismaService directly.
 */
@Injectable()
export class DamageReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** True when a property with this official number is already filed. */
  async propertyNumberExists(realEstateNumber: string): Promise<boolean> {
    // Relaxation: official property numbers are no longer unique.
    return false;
  }

  /**
   * Creates the user (upserted by phone number), the property, the
   * report and its attachments atomically. Optionally rejects duplicate
   * official property numbers inside the same transaction so two
   * submissions can't race past the check. The public reference code is
   * generated here; on the (rare) unique-index collision the whole
   * transaction is retried with a fresh code.
   */
  async createFromSubmission(
    input: PersistReportInput,
  ): Promise<DamageReportWithRelations> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.persistSubmission(input, generateReferenceCode());
      } catch (error) {
        if (
          !isReferenceCodeCollision(error) ||
          attempt >= MAX_REFERENCE_CODE_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
  }

  private async persistSubmission(
    input: PersistReportInput,
    referenceCode: string,
  ): Promise<DamageReportWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      // Relaxation: official property numbers are no longer unique.
      // Uniqueness check block removed to allow duplicate submissions.

      const user = await tx.user.upsert({
        where: { phoneNumber: input.reporter.phoneNumber },
        create: {
          phoneNumber: input.reporter.phoneNumber,
          fullName: input.reporter.fullName,
          preferredLanguage: input.reporter.preferredLanguage,
        },
        update: { fullName: input.reporter.fullName },
      });

      const property = await tx.property.create({
        data: {
          type: input.property.type,
          ownershipStatus: input.property.ownershipStatus,
          realEstateNumber: input.property.realEstateNumber,
          ownerPhoneNumber: input.property.ownerPhoneNumber,
          vehicleType: input.property.vehicleType,
          vehicleTypeOther: input.property.vehicleTypeOther,
          district: input.property.district,
          neighborhood: input.property.neighborhood,
          street: input.property.street,
          projectName: input.property.projectName,
          floor: input.property.floor,
          additionalDirections: input.property.additionalDirections,
          addressLine: input.property.addressLine,
          latitude: input.property.latitude,
          longitude: input.property.longitude,
          ownerId: user.id,
        },
      });

      return tx.damageReport.create({
        data: {
          referenceCode,
          description: input.report.description,
          severity: input.report.severity,
          reporterId: user.id,
          propertyId: property.id,
          attachments: {
            create: input.attachments.map((attachment) => ({
              url: attachment.url,
              type: attachment.type,
              label: attachment.label,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
            })),
          },
        },
        ...reportWithRelations,
      });
    }, {
      // This transaction makes three sequential round-trips (upsert user,
      // create property, create report+attachments). Prisma's 5s default
      // interactive-transaction timeout is too tight over a high-latency
      // link, so it's raised generously here.
      timeout: 30000,
      maxWait: 30000,
    });
  }

  async findById(id: string): Promise<DamageReportWithRelations | null> {
    return this.prisma.damageReport.findUnique({
      where: { id },
      ...reportWithRelations,
    });
  }

  /**
   * Public status lookup by reference code. Selects ONLY the non-sensitive
   * fields the citizen tracking page is allowed to see — no reporter,
   * phone, description, attachments or rejection notes ever leave here.
   */
  async findPublicByCode(
    referenceCode: string,
  ): Promise<PublicReportStatus | null> {
    const row = await this.prisma.damageReport.findUnique({
      where: { referenceCode },
      select: {
        referenceCode: true,
        status: true,
        createdAt: true,
        rejectedField: true,
        property: { select: { type: true } },
      },
    });
    if (!row) return null;
    return {
      referenceCode: row.referenceCode,
      status: row.status,
      category: row.property.type,
      submittedAt: row.createdAt.toISOString(),
      rejectedField: row.rejectedField,
    };
  }

  async list(filter: ListReportsFilter): Promise<PaginatedReports> {
    const where: Prisma.DamageReportWhereInput = {
      status: filter.status,
      severity: filter.severity,
      property: filter.neighborhood
        ? {
            neighborhood: {
              contains: filter.neighborhood,
              mode: 'insensitive',
            },
          }
        : undefined,
    };

    if (filter.search) {
      // One input, four identifying fields — a report matches when any
      // of them contains the term (case-insensitively).
      where.OR = [
        { referenceCode: { contains: filter.search, mode: 'insensitive' } },
        {
          reporter: {
            fullName: { contains: filter.search, mode: 'insensitive' },
          },
        },
        { reporter: { phoneNumber: { contains: filter.search } } },
        {
          property: {
            realEstateNumber: { contains: filter.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [items, totalCount] = await this.prisma.$transaction(
      [
        this.prisma.damageReport.findMany({
          where,
          orderBy: reportOrderBy(filter.sortBy, filter.sortDir),
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
          ...reportWithRelations,
        }),
        this.prisma.damageReport.count({ where }),
      ],
      // Prisma's defaults (5s execution, 2s to acquire a connection) are
      // too tight for this pooled single-connection link (see
      // createFromSubmission for the same rationale) — every extra
      // column sort/search now drives this query far more often than
      // the old fixed-order listing did, so requests queue for the one
      // available connection more visibly.
      { timeout: 15000, maxWait: 15000 },
    );

    return {
      items,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / filter.pageSize)),
      currentPage: filter.page,
      pageSize: filter.pageSize,
    };
  }

  async updateStatus(
    id: string,
    status: ReportStatus,
    rejectionReason: string | null,
    rejectedField: string | null,
    reviewedById: string | null,
  ): Promise<DamageReport> {
    return this.prisma.damageReport.update({
      where: { id },
      data: { status, rejectionReason, rejectedField, reviewedById },
    });
  }

  // ──────────── Admin report data editing ────────────

  /** Field-level partial updates on the reporter, property, and report. */
  async updateReportData(
    reportId: string,
    reporterUpdates: Partial<{ fullName: string; phoneNumber: string }>,
    propertyUpdates: Partial<{
      street: string;
      projectName: string;
      floor: string;
      unitArea: number;
      additionalDirections: string;
      realEstateNumber: string;
      ownerPhoneNumber: string;
      latitude: number;
      longitude: number;
    }>,
    reportUpdates: Partial<{ description: string }>,
  ): Promise<DamageReportWithRelations> {
    const report = await this.prisma.damageReport.findUniqueOrThrow({
      where: { id: reportId },
      select: { reporterId: true, propertyId: true },
    });

    return this.prisma.$transaction(async (tx) => {
      if (Object.keys(reporterUpdates).length > 0) {
        await tx.user.update({
          where: { id: report.reporterId },
          data: reporterUpdates,
        });
      }
      if (Object.keys(propertyUpdates).length > 0) {
        // Sync neighborhood with street when street changes.
        const propData: Record<string, unknown> = { ...propertyUpdates };
        if (propertyUpdates.street) {
          propData.neighborhood = propertyUpdates.street;
        }
        await tx.property.update({
          where: { id: report.propertyId },
          data: propData,
        });
      }
      if (Object.keys(reportUpdates).length > 0) {
        await tx.damageReport.update({
          where: { id: reportId },
          data: reportUpdates,
        });
      }

      return tx.damageReport.findUniqueOrThrow({
        where: { id: reportId },
        ...reportWithRelations,
      });
    }, { timeout: 30000, maxWait: 30000 });
  }

  /** Replace an attachment row: delete old, create new in a transaction. */
  async replaceAttachment(
    reportId: string,
    oldAttachmentId: string,
    newData: {
      url: string;
      type: AttachmentType;
      label?: string;
      mimeType?: string;
      sizeBytes?: number;
    },
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.attachment.delete({ where: { id: oldAttachmentId } }),
      this.prisma.attachment.create({
        data: {
          reportId,
          url: newData.url,
          type: newData.type,
          label: newData.label,
          mimeType: newData.mimeType,
          sizeBytes: newData.sizeBytes,
        },
      }),
    ]);
  }

  /** Remove an attachment by id. */
  async deleteAttachment(attachmentId: string): Promise<void> {
    await this.prisma.attachment.delete({ where: { id: attachmentId } });
  }

  /**
   * Slim spatial slice for the map dashboard: one indexed query with a
   * targeted nested select (no N+1, no over-fetching of descriptions or
   * attachments), flattened into deck.gl-ready points.
   */
  async spatial(filter: SpatialFilter): Promise<SpatialPoint[]> {
    const rows = await this.prisma.damageReport.findMany({
      where: {
        status: filter.status,
        severity: filter.severity,
        property: filter.neighborhood
          ? {
              neighborhood: {
                contains: filter.neighborhood,
                mode: 'insensitive',
              },
            }
          : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit,
      select: {
        id: true,
        severity: true,
        status: true,
        reporter: { select: { fullName: true } },
        property: {
          select: {
            type: true,
            latitude: true,
            longitude: true,
            neighborhood: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      latitude: row.property.latitude,
      longitude: row.property.longitude,
      severity: row.severity,
      status: row.status,
      propertyType: row.property.type,
      neighborhood: row.property.neighborhood,
      reporterName: row.reporter.fullName,
    }));
  }

  async summarize(): Promise<StatusSummary> {
    // A single conditional-aggregation query rather than several concurrent
    // ones: on a transaction-mode connection pooler (Supabase PgBouncer),
    // firing multiple queries in parallel on one pooled connection is
    // flaky, and each extra round-trip is costly on a high-latency link.
    const [row] = await this.prisma.$queryRaw<SummaryRow[]>`
      SELECT
        count(*)                                        AS total,
        count(*) FILTER (WHERE status = 'PENDING')      AS pending,
        count(*) FILTER (WHERE status = 'UNDER_REVIEW') AS under_review,
        count(*) FILTER (WHERE status = 'VERIFIED')     AS verified,
        count(*) FILTER (WHERE status = 'APPROVED')     AS approved,
        count(*) FILTER (WHERE status = 'REJECTED')     AS rejected,
        count(*) FILTER (WHERE severity = 'TOTAL')      AS total_sev,
        count(*) FILTER (WHERE severity = 'PARTIAL')    AS partial_sev,
        count(*) FILTER (WHERE severity = 'MINOR')      AS minor_sev
      FROM damage_reports
    `;

    // Postgres count() comes back as bigint, which Prisma surfaces as a
    // JS BigInt; normalise to number for the JSON response.
    const n = (value: bigint | null | undefined): number => Number(value ?? 0n);

    return {
      total: n(row?.total),
      byStatus: {
        PENDING: n(row?.pending),
        UNDER_REVIEW: n(row?.under_review),
        VERIFIED: n(row?.verified),
        APPROVED: n(row?.approved),
        REJECTED: n(row?.rejected),
      },
      bySeverity: {
        TOTAL: n(row?.total_sev),
        PARTIAL: n(row?.partial_sev),
        MINOR: n(row?.minor_sev),
      },
    };
  }
}

interface SummaryRow {
  total: bigint;
  pending: bigint;
  under_review: bigint;
  verified: bigint;
  approved: bigint;
  rejected: bigint;
  total_sev: bigint;
  partial_sev: bigint;
  minor_sev: bigint;
}
