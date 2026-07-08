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
} from '@prisma/client';
import { DuplicatePropertyNumberError } from '../common/errors/domain.errors';
import { PrismaService } from '../prisma/prisma.service';

const reportWithRelations = Prisma.validator<Prisma.DamageReportDefaultArgs>()({
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
});

export type DamageReportWithRelations = Prisma.DamageReportGetPayload<
  typeof reportWithRelations
>;

export interface ListReportsFilter {
  status?: ReportStatus;
  severity?: DamageSeverity;
  neighborhood?: string;
  page: number;
  pageSize: number;
}

export interface PaginatedReports {
  items: DamageReportWithRelations[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

/**
 * Framework-agnostic persistence input — both the JSON endpoint and the
 * multipart pipeline map their validated DTOs onto this shape.
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
    additionalDirections?: string;
    addressLine?: string;
    latitude: number;
    longitude: number;
  };
  report: {
    description: string;
    severity: DamageSeverity;
    voiceNoteUrl?: string;
    submittedByProxy: boolean;
    proxyName?: string;
    proxyRelation?: string;
    proxyPhoneNumber?: string;
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
  /** Enables inline audio playback in the map popover. */
  voiceNoteUrl: string | null;
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
    const count = await this.prisma.property.count({
      where: {
        realEstateNumber: { equals: realEstateNumber, mode: 'insensitive' },
      },
    });
    return count > 0;
  }

  /**
   * Creates the user (upserted by phone number), the property, the
   * report and its attachments atomically. Optionally rejects duplicate
   * official property numbers inside the same transaction so two
   * submissions can't race past the check.
   */
  async createFromSubmission(
    input: PersistReportInput,
  ): Promise<DamageReportWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      if (input.enforceUniquePropertyNumber && input.property.realEstateNumber) {
        const duplicate = await tx.property.findFirst({
          where: {
            realEstateNumber: {
              equals: input.property.realEstateNumber,
              mode: 'insensitive',
            },
          },
          select: { id: true },
        });
        if (duplicate) {
          throw new DuplicatePropertyNumberError(
            input.property.realEstateNumber,
          );
        }
      }

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
          description: input.report.description,
          severity: input.report.severity,
          voiceNoteUrl: input.report.voiceNoteUrl,
          submittedByProxy: input.report.submittedByProxy,
          proxyName: input.report.proxyName,
          proxyRelation: input.report.proxyRelation,
          proxyPhoneNumber: input.report.proxyPhoneNumber,
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

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.damageReport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        ...reportWithRelations,
      }),
      this.prisma.damageReport.count({ where }),
    ]);

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
    reviewedById: string | null,
  ): Promise<DamageReport> {
    return this.prisma.damageReport.update({
      where: { id },
      data: { status, rejectionReason, reviewedById },
    });
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
        voiceNoteUrl: true,
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
      voiceNoteUrl: row.voiceNoteUrl,
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
