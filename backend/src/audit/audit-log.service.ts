import { Injectable, Logger } from '@nestjs/common';
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

  /** Newest-first, paginated trail for the SUPER_ADMIN view. */
  async list(page: number, pageSize: number): Promise<PaginatedAuditLogs> {
    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count(),
    ]);

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
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }
}
