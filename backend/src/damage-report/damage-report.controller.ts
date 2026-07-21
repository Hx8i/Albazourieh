import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Role, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  ZodValidationPipe,
  validateWithSchema,
} from '../common/pipes/zod-validation.pipe';
import {
  AdminEditReportDto,
  AttachmentLabel,
  ListReportsQueryDto,
  SpatialQueryDto,
  UpdateReportStatusDto,
  adminEditReportSchema,
  attachmentIdParamSchema,
  attachmentLabelSchema,
  listReportsQuerySchema,
  multipartPayloadSchema,
  referenceCodeParamSchema,
  reportIdParamSchema,
  spatialQuerySchema,
  updateReportStatusSchema,
} from './damage-report.dto';
import {
  DamageReportWithRelations,
  PaginatedReports,
  PublicReportStatus,
  SpatialPoint,
  StatusSummary,
} from './damage-report.repository';
import { DamageReportService, MultipartFiles } from './damage-report.service';

/** Single-file ceiling for any part of the multipart submission. */
const MULTIPART_FILE_LIMIT_BYTES = 11 * 1024 * 1024;

const MULTIPART_FILE_FIELDS = [
  { name: 'damagePhotos', maxCount: 10 },
  { name: 'nationalId', maxCount: 1 },
  { name: 'propertyDeed', maxCount: 1 },
  { name: 'rentalContract', maxCount: 1 },
  { name: 'vehicleRegistration', maxCount: 1 },
  { name: 'residencyProof', maxCount: 1 },
];

@Controller('damage-reports')
export class DamageReportController {
  constructor(private readonly service: DamageReportService) {}

  /**
   * Citizen wizard v2: one multipart/form-data request carrying the
   * JSON `payload` field plus every raw file (photos, national ID,
   * deeds/contracts/registrations, residency proof), parsed by
   * FileFieldsInterceptor and streamed to Supabase Storage.
   */
  @Post('multipart')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileFieldsInterceptor(MULTIPART_FILE_FIELDS, {
      limits: { fileSize: MULTIPART_FILE_LIMIT_BYTES, files: 15 },
    }),
  )
  async submitMultipart(
    @Body('payload') rawPayload: string | undefined,
    @UploadedFiles() files: MultipartFiles,
  ): Promise<DamageReportWithRelations> {
    if (!rawPayload) {
      throw new BadRequestException('A "payload" form-data field is required');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      throw new BadRequestException('"payload" must be valid JSON');
    }
    const payload = validateWithSchema(multipartPayloadSchema, parsed);
    return this.service.submitMultipart(payload, files);
  }

  /**
   * Public citizen tracking: look up a report's evaluation status by its
   * 6-character reference code. Unauthenticated by design (no JwtAuthGuard),
   * but rate-limited and privacy-scrubbed — the service returns only the
   * status, category and submission time, never any personal data. Placed
   * before `:id` so the two-segment path always resolves here.
   */
  @Get('status/:code')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async publicStatus(
    @Param('code', new ZodValidationPipe(referenceCodeParamSchema))
    code: string,
  ): Promise<PublicReportStatus> {
    return this.service.getPublicStatus(code);
  }

  /** Municipality staff: filterable, searchable, paginated report inbox. */
  @Get()
  @UseGuards(JwtAuthGuard)
  async list(
    @Query(new ZodValidationPipe(listReportsQuerySchema))
    query: ListReportsQueryDto,
  ): Promise<PaginatedReports> {
    return this.service.listReports(query);
  }

  /** Municipality staff: dashboard counters (status + severity). */
  @Get('summary')
  @UseGuards(JwtAuthGuard)
  async summary(): Promise<StatusSummary> {
    return this.service.getSummary();
  }

  /** Municipality staff: minimal spatial payload for the deck.gl map. */
  @Get('spatial')
  @UseGuards(JwtAuthGuard)
  async spatial(
    @Query(new ZodValidationPipe(spatialQuerySchema))
    query: SpatialQueryDto,
  ): Promise<SpatialPoint[]> {
    return this.service.getSpatialData(query);
  }

  /** Municipality staff: single report case file. */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getById(
    @Param('id', new ZodValidationPipe(reportIdParamSchema)) id: string,
  ): Promise<DamageReportWithRelations> {
    return this.service.getReportById(id);
  }

  /** Municipality staff: move a report through the review lifecycle. */
  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  async updateStatus(
    @Param('id', new ZodValidationPipe(reportIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(updateReportStatusSchema))
    dto: UpdateReportStatusDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<DamageReportWithRelations> {
    return this.service.updateStatus(id, dto, {
      id: request.user.sub,
      name: request.user.fullName,
      ipAddress: request.ip,
    });
  }

  // ─────────────────── Admin data editing ───────────────────

  /** Admin/staff: edit citizen-submitted report data fields. */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.STAFF_MEMBER)
  async adminEditReport(
    @Param('id', new ZodValidationPipe(reportIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(adminEditReportSchema))
    dto: AdminEditReportDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<DamageReportWithRelations> {
    return this.service.adminEditReport(id, dto, {
      id: request.user.sub,
      name: request.user.fullName,
      ipAddress: request.ip,
    });
  }

  /** Admin/staff: add a specific attachment to a report. */
  @Post(':id/attachments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.STAFF_MEMBER)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTIPART_FILE_LIMIT_BYTES } }))
  async addAttachment(
    @Param('id', new ZodValidationPipe(reportIdParamSchema)) id: string,
    @Body('label', new ZodValidationPipe(attachmentLabelSchema)) label: AttachmentLabel,
    @UploadedFile() file: Express.Multer.File,
    @Req() request: AuthenticatedRequest,
  ): Promise<DamageReportWithRelations> {
    if (!file) {
      throw new BadRequestException('A file upload is required');
    }
    return this.service.addReportAttachment(id, file, label, {
      id: request.user.sub,
      name: request.user.fullName,
      ipAddress: request.ip,
    });
  }

  /** Admin/staff: delete a specific attachment from a report. */
  @Delete(':id/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN, Role.STAFF_MEMBER)
  async deleteAttachment(
    @Param('id', new ZodValidationPipe(reportIdParamSchema)) id: string,
    @Param('attachmentId', new ZodValidationPipe(attachmentIdParamSchema))
    attachmentId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.deleteReportAttachment(id, attachmentId, {
      id: request.user.sub,
      name: request.user.fullName,
      ipAddress: request.ip,
    });
  }
}
