import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Role, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuditLogService, PaginatedAuditLogs } from './audit-log.service';

export const auditListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    /** Spec-compatible alias for pageSize (?page=1&limit=20). */
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

type AuditListQueryDto = z.infer<typeof auditListQuerySchema>;

export const exportEventSchema = z
  .object({
    // How many rows the staff member exported (recorded in the details).
    rowCount: z.number().int().min(0).max(1_000_000),
  })
  .strict();

type ExportEventDto = z.infer<typeof exportEventSchema>;

@Controller('admin/audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  /** The full trail — visible only to the SUPER_ADMIN ("Mas2ool El Baladye"). */
  @Get()
  @Roles(Role.SUPER_ADMIN)
  async list(
    @Query(new ZodValidationPipe(auditListQuerySchema))
    query: AuditListQueryDto,
  ): Promise<PaginatedAuditLogs> {
    return this.service.list(query.page, query.limit ?? query.pageSize);
  }

  /**
   * CSV exports happen client-side, so the dashboard reports them here.
   * Any authenticated staff member's export is recorded.
   */
  @Post('export-event')
  @HttpCode(HttpStatus.NO_CONTENT)
  async exportEvent(
    @Body(new ZodValidationPipe(exportEventSchema)) dto: ExportEventDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.record({
      adminId: request.user.sub,
      adminName: request.user.fullName,
      actionType: 'EXPORT_DATA',
      targetId: 'damage-reports',
      details: `Exported ${dto.rowCount} report(s) as CSV`,
      ipAddress: request.ip,
    });
  }
}
