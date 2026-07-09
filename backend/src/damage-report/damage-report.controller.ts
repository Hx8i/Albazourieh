import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ZodValidationPipe,
  validateWithSchema,
} from '../common/pipes/zod-validation.pipe';
import {
  ListReportsQueryDto,
  SpatialQueryDto,
  UpdateReportStatusDto,
  listReportsQuerySchema,
  multipartPayloadSchema,
  reportIdParamSchema,
  spatialQuerySchema,
  updateReportStatusSchema,
} from './damage-report.dto';
import {
  DamageReportWithRelations,
  PaginatedReports,
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
}
