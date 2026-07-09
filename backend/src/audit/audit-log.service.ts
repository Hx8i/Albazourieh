import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Administrative actions tracked in the audit trail ("تتبع العمليات"). */
export type AuditActionType =
  | 'CREATE_STAFF'
  | 'DELETE_STAFF'
  | 'UPDATE_REPORT_STATUS'
  | 'EXPORT_DATA';

export interface AuditEntry {
  adminId: string;
  adminName: string;
  actionType: AuditActionType;
  targetId: string;
  details: string;
  ipAddress?: string;
}

export interface AuditLogItem {
  id: string;
  adminId: string;
  adminName: string;
  actionType: AuditActionType;
  targetId: string;
  details: string;
  ipAddress: string | null;
  createdAt: string;
}

export interface PaginatedAuditLogs {
  items: AuditLogItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

/** Columns the audit trail table lets staff sort by. */
export type AuditSortField = 'createdAt' | 'adminName' | 'actionType';
export type AuditSortDirection = 'asc' | 'desc';

export interface ListAuditLogsFilter {
  page: number;
  pageSize: number;
  /** Single-input search: admin name, action type, target or details. */
  search?: string;
  sortBy: AuditSortField;
  sortDir: AuditSortDirection;
}

/**
 * Persists one immutable row per administrative mutation. `record()` is
 * deliberately fire-and-safe: an audit-write failure is logged but never
 * allowed to break (or roll back) the action being audited.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          adminId: entry.adminId,
          adminName: entry.adminName,
          actionType: entry.actionType,
          targetId: entry.targetId,
          details: entry.details,
          ipAddress: entry.ipAddress ?? null,
        },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to persist audit log (${entry.actionType} by ${entry.adminName}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Newest-first by default, paginated, searchable, sortable trail for the SUPER_ADMIN view. */
  async list(filter: ListAuditLogsFilter): Promise<PaginatedAuditLogs> {
    const where: Prisma.AuditLogWhereInput = filter.search
      ? {
          OR: [
            { adminName: { contains: filter.search, mode: 'insensitive' } },
            { actionType: { contains: filter.search, mode: 'insensitive' } },
            { targetId: { contains: filter.search, mode: 'insensitive' } },
            { details: { contains: filter.search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [rows, totalCount] = await this.prisma.$transaction(
      [
        this.prisma.auditLog.findMany({
          where,
          orderBy: { [filter.sortBy]: filter.sortDir },
          skip: (filter.page - 1) * filter.pageSize,
          take: filter.pageSize,
        }),
        this.prisma.auditLog.count({ where }),
      ],
      // Prisma's defaults (5s execution, 2s to acquire a connection) are
      // too tight for this pooled single-connection link — see
      // damage-report.repository.ts's list().
      { timeout: 15000, maxWait: 15000 },
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        adminId: row.adminId,
        adminName: row.adminName,
        actionType: row.actionType as AuditActionType,
        targetId: row.targetId,
        details: row.details,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
      })),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / filter.pageSize)),
      currentPage: filter.page,
      pageSize: filter.pageSize,
    };
  }
}
