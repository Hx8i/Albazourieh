import { Injectable } from '@nestjs/common';
import {
  LebaneseDisplaced,
  Prisma,
  SyrianDisplaced,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLebaneseDisplacedDto,
  CreateSyrianDisplacedDto,
  DisplacedSortDirection,
  DisplacedSortField,
  DisplacedStatus,
  UrgentNeed,
} from './displaced.dto';

/**
 * Which displaced-persons programme a call operates on. The two
 * programmes share one repository but never share a query: every method
 * hits exactly one table, so Syrian and Lebanese figures cannot blend.
 */
export type DisplacedAudience = 'SYRIAN' | 'LEBANESE';

/** Raw-SQL table identifiers — fixed internal constants, never user input. */
const TABLE_NAME: Record<DisplacedAudience, string> = {
  SYRIAN: 'syrian_displaced',
  LEBANESE: 'lebanese_displaced',
};

export interface ListDisplacedFilter {
  status?: DisplacedStatus;
  /** Single-input search: registrant name or phone number. */
  search?: string;
  sortBy: DisplacedSortField;
  sortDir: DisplacedSortDirection;
  page: number;
  pageSize: number;
}

export interface PaginatedDisplaced<TItem> {
  items: TItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

/** Aggregates behind the four metric cards and the two charts. */
export interface DisplacedSummary {
  total: number;
  /** SUM of familyMembersCount across every registration. */
  totalFamilyMembers: number;
  /** Registrations that ticked at least one urgent need. */
  urgentCases: number;
  byStatus: Record<DisplacedStatus, number>;
  /** Bar chart: how many registrations ticked each need. */
  needs: Record<UrgentNeed, number>;
}

/**
 * Shared filter shape — every referenced column exists identically on
 * both tables, so the same literal satisfies both delegates' WhereInput.
 */
function buildWhere(filter: ListDisplacedFilter): {
  status?: DisplacedStatus;
  OR?: Array<Record<string, unknown>>;
} {
  return {
    status: filter.status,
    OR: filter.search
      ? [
          { fullName: { contains: filter.search, mode: 'insensitive' } },
          { phone: { contains: filter.search } },
        ]
      : undefined,
  };
}

/** Parses "YYYY-MM-DD" into the UTC-midnight Date a `@db.Date` column stores. */
function toCalendarDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * The only class in the feature that talks to Prisma. Services depend on
 * this abstraction, never on PrismaService directly.
 */
@Injectable()
export class DisplacedRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────── Intake writes ─────────────────────────

  async createSyrian(
    input: CreateSyrianDisplacedDto,
    idDocumentUrls: string[],
  ): Promise<SyrianDisplaced> {
    return this.prisma.syrianDisplaced.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        alternatePhone: input.alternatePhone,
        familyMembersCount: input.familyMembersCount,
        familyMembersNames: input.familyMembersNames,
        neighborhoodName: input.neighborhoodName,
        buildingName: input.buildingName,
        shelterType: input.shelterType,
        shelterContactName: input.shelterContactName,
        shelterContactPhone: input.shelterContactPhone,
        originalCity: input.originalCity,
        registrationNumber: input.registrationNumber,
        idDocumentUrls,
        urgentNeeds: input.urgentNeeds,
        vulnerabilityStatus: input.vulnerabilityStatus,
        entryDate: toCalendarDate(input.entryDate),
      },
    });
  }

  async createLebanese(
    input: CreateLebaneseDisplacedDto,
    idDocumentUrls: string[],
  ): Promise<LebaneseDisplaced> {
    return this.prisma.lebaneseDisplaced.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        alternatePhone: input.alternatePhone,
        familyMembersCount: input.familyMembersCount,
        familyMembersNames: input.familyMembersNames,
        neighborhoodName: input.neighborhoodName,
        buildingName: input.buildingName,
        shelterType: input.shelterType,
        shelterContactName: input.shelterContactName,
        shelterContactPhone: input.shelterContactPhone,
        originVillage: input.originVillage,
        isPropertyDamaged: input.isPropertyDamaged,
        primarySourceOfIncome: input.primarySourceOfIncome,
        idDocumentUrls,
        urgentNeeds: input.urgentNeeds,
        vulnerabilityStatus: input.vulnerabilityStatus,
        displacementDate: toCalendarDate(input.displacementDate),
      },
    });
  }

  // ───────────────────────── Dashboard reads ───────────────────────

  async listSyrian(
    filter: ListDisplacedFilter,
  ): Promise<PaginatedDisplaced<SyrianDisplaced>> {
    const where = buildWhere(filter) as Prisma.SyrianDisplacedWhereInput;
    const [items, totalCount] = await this.prisma.$transaction(
      [
        this.prisma.syrianDisplaced.findMany({
          where,
          orderBy: { [filter.sortBy]: filter.sortDir },
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
        this.prisma.syrianDisplaced.count({ where }),
      ],
      // Generous limits for the pooled single-connection link — see
      // damage-report.repository.ts's list() for the rationale.
      { timeout: 15000, maxWait: 15000 },
    );
    return paginate(items, totalCount, filter);
  }

  async listLebanese(
    filter: ListDisplacedFilter,
  ): Promise<PaginatedDisplaced<LebaneseDisplaced>> {
    const where = buildWhere(filter) as Prisma.LebaneseDisplacedWhereInput;
    const [items, totalCount] = await this.prisma.$transaction(
      [
        this.prisma.lebaneseDisplaced.findMany({
          where,
          orderBy: { [filter.sortBy]: filter.sortDir },
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
        this.prisma.lebaneseDisplaced.count({ where }),
      ],
      { timeout: 15000, maxWait: 15000 },
    );
    return paginate(items, totalCount, filter);
  }

  async findSyrianById(id: string): Promise<SyrianDisplaced | null> {
    return this.prisma.syrianDisplaced.findUnique({ where: { id } });
  }

  async findLebaneseById(id: string): Promise<LebaneseDisplaced | null> {
    return this.prisma.lebaneseDisplaced.findUnique({ where: { id } });
  }

  // ──────────────────────── Status lifecycle ───────────────────────

  async updateSyrianStatus(
    id: string,
    status: DisplacedStatus,
  ): Promise<SyrianDisplaced> {
    return this.prisma.syrianDisplaced.update({
      where: { id },
      data: { status },
    });
  }

  async updateLebaneseStatus(
    id: string,
    status: DisplacedStatus,
  ): Promise<LebaneseDisplaced> {
    return this.prisma.lebaneseDisplaced.update({
      where: { id },
      data: { status },
    });
  }

  async updateSyrian(
    id: string,
    data: Prisma.SyrianDisplacedUpdateInput,
  ): Promise<SyrianDisplaced> {
    return this.prisma.syrianDisplaced.update({
      where: { id },
      data,
    });
  }

  async updateLebanese(
    id: string,
    data: Prisma.LebaneseDisplacedUpdateInput,
  ): Promise<LebaneseDisplaced> {
    return this.prisma.lebaneseDisplaced.update({
      where: { id },
      data,
    });
  }

  /**
   * Compare-and-swap write for the id-document array: only applies when
   * the row's current list still matches `expected`, so two concurrent
   * uploads/deletes on the same registration can't silently clobber one
   * another or push the list past the cap. Returns how many rows
   * matched (0 means someone else changed it first — caller retries).
   */
  async updateSyrianIdDocumentsIfUnchanged(
    id: string,
    expected: string[],
    next: string[],
  ): Promise<number> {
    const result = await this.prisma.syrianDisplaced.updateMany({
      where: { id, idDocumentUrls: { equals: expected } },
      data: { idDocumentUrls: next },
    });
    return result.count;
  }

  async updateLebaneseIdDocumentsIfUnchanged(
    id: string,
    expected: string[],
    next: string[],
  ): Promise<number> {
    const result = await this.prisma.lebaneseDisplaced.updateMany({
      where: { id, idDocumentUrls: { equals: expected } },
      data: { idDocumentUrls: next },
    });
    return result.count;
  }

  // ─────────────────────────── Aggregates ──────────────────────────

  /**
   * The full dashboard summary in three grouped queries run on one
   * connection: conditional-aggregation counters, the urgent-needs
   * distribution (array column unnested) and the governorate breakdown.
   */
  async summarize(audience: DisplacedAudience): Promise<DisplacedSummary> {
    const table = Prisma.raw(TABLE_NAME[audience]);

    const [counterRows, needRows] =
      await this.prisma.$transaction(
        [
          this.prisma.$queryRaw<CounterRow[]>`
            SELECT
              count(*)                                                 AS total,
              COALESCE(sum("familyMembersCount"), 0)                   AS family_members,
              count(*) FILTER (WHERE status = 'PENDING')               AS pending,
              count(*) FILTER (WHERE status = 'APPROVED')              AS approved,
              count(*) FILTER (WHERE status = 'REJECTED')              AS rejected,
              count(*) FILTER (WHERE cardinality("urgentNeeds") > 0)   AS urgent
            FROM ${table}
          `,
          this.prisma.$queryRaw<NeedRow[]>`
            SELECT need, count(*) AS count
            FROM ${table}, unnest("urgentNeeds") AS need
            GROUP BY need
          `,
        ],
        { timeout: 15000, maxWait: 15000 },
      );

    // Postgres count()/sum() come back as bigint; normalise for JSON.
    const n = (value: bigint | number | null | undefined): number =>
      Number(value ?? 0);

    const counters = counterRows[0];
    const needs: Record<UrgentNeed, number> = {
      FOOD: 0,
      MEDICAL: 0,
      SHELTER: 0,
      CASH: 0,
      WINTERIZATION: 0,
    };
    for (const row of needRows) {
      if (row.need in needs) {
        needs[row.need as UrgentNeed] = n(row.count);
      }
    }

    return {
      total: n(counters?.total),
      totalFamilyMembers: n(counters?.family_members),
      urgentCases: n(counters?.urgent),
      byStatus: {
        PENDING: n(counters?.pending),
        APPROVED: n(counters?.approved),
        REJECTED: n(counters?.rejected),
      },
      needs,
    };
  }
}

function paginate<TItem>(
  items: TItem[],
  totalCount: number,
  filter: ListDisplacedFilter,
): PaginatedDisplaced<TItem> {
  return {
    items,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / filter.pageSize)),
    currentPage: filter.page,
    pageSize: filter.pageSize,
  };
}

interface CounterRow {
  total: bigint;
  family_members: bigint;
  pending: bigint;
  approved: bigint;
  rejected: bigint;
  urgent: bigint;
}

interface NeedRow {
  need: string;
  count: bigint;
}
