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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MissingRequiredFileError } from '../common/errors/domain.errors';
import {
  ZodValidationPipe,
  validateWithSchema,
} from '../common/pipes/zod-validation.pipe';
import { LebaneseDisplaced, SyrianDisplaced } from '../generated/prisma/client';
import {
  ListDisplacedQueryDto,
  MAX_ID_DOCUMENTS_PER_REGISTRATION,
  UpdateDisplacedStatusDto,
  createLebaneseDisplacedSchema,
  createSyrianDisplacedSchema,
  displacedIdParamSchema,
  idDocumentUrlQuerySchema,
  listDisplacedQuerySchema,
  updateDisplacedStatusSchema,
  updateSyrianDisplacedSchema,
  updateLebaneseDisplacedSchema,
  UpdateSyrianDisplacedDto,
  UpdateLebaneseDisplacedDto,
} from './displaced.dto';
import {
  DisplacedSummary,
  PaginatedDisplaced,
} from './displaced.repository';
import { DisplacedService } from './displaced.service';

/** Single-file ceiling for each identity document upload. */
const ID_DOCUMENT_LIMIT_BYTES = 11 * 1024 * 1024;

/** Parses and validates the JSON `payload` field of the multipart body. */
function parsePayload(rawPayload: string | undefined): unknown {
  if (!rawPayload) {
    throw new BadRequestException('A "payload" form-data field is required');
  }
  try {
    return JSON.parse(rawPayload);
  } catch {
    throw new BadRequestException('"payload" must be valid JSON');
  }
}

/**
 * Two explicitly separate route families — /displaced/syrian and
 * /displaced/lebanese — rather than one parameterised path, so the two
 * programmes can never be queried through each other's endpoints.
 */
@Controller('displaced')
export class DisplacedController {
  constructor(private readonly service: DisplacedService) {}

  // ─────────────────────── Syrian displaced (لاجئين) ───────────────────

  /**
   * Public intake form submission (rate-limited, no login). One
   * multipart/form-data request: the JSON `payload` field plus one or
   * more `idDocument` files identifying the registrant.
   */
  @Post('syrian')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FilesInterceptor('idDocument', MAX_ID_DOCUMENTS_PER_REGISTRATION, {
      limits: { fileSize: ID_DOCUMENT_LIMIT_BYTES },
    }),
  )
  async submitSyrian(
    @Body('payload') rawPayload: string | undefined,
    @UploadedFiles() idDocuments: Express.Multer.File[] | undefined,
  ): Promise<SyrianDisplaced> {
    const dto = validateWithSchema(
      createSyrianDisplacedSchema,
      parsePayload(rawPayload),
    );
    if (!idDocuments?.length) {
      throw new MissingRequiredFileError('idDocument');
    }
    return this.service.submitSyrian(dto, idDocuments);
  }

  /** Municipality staff: filterable, searchable, paginated inbox. */
  @Get('syrian')
  @UseGuards(JwtAuthGuard)
  async listSyrian(
    @Query(new ZodValidationPipe(listDisplacedQuerySchema))
    query: ListDisplacedQueryDto,
  ): Promise<PaginatedDisplaced<SyrianDisplaced>> {
    return this.service.listSyrian(query);
  }

  /** Municipality staff: metric cards + chart aggregates. */
  @Get('syrian/summary')
  @UseGuards(JwtAuthGuard)
  async syrianSummary(): Promise<DisplacedSummary> {
    return this.service.getSummary('SYRIAN');
  }

  /**
   * Municipality staff: one registration for the detail page. Declared
   * after `syrian/summary` so the literal route keeps winning.
   */
  @Get('syrian/:id')
  @UseGuards(JwtAuthGuard)
  async getSyrianById(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
  ): Promise<SyrianDisplaced> {
    return this.service.getSyrianById(id);
  }

  /** Municipality staff: triage a registration (PENDING/APPROVED/REJECTED). */
  @Patch('syrian/:id/status')
  @UseGuards(JwtAuthGuard)
  async updateSyrianStatus(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(updateDisplacedStatusSchema))
    dto: UpdateDisplacedStatusDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<SyrianDisplaced> {
    return this.service.updateStatus('SYRIAN', id, dto, {
      id: request.user.sub,
      name: request.user.fullName,
      ipAddress: request.ip,
    }) as Promise<SyrianDisplaced>;
  }

  /** Municipality staff: update registration details. */
  @Patch('syrian/:id')
  @UseGuards(JwtAuthGuard)
  async updateSyrian(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(updateSyrianDisplacedSchema))
    dto: UpdateSyrianDisplacedDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<SyrianDisplaced> {
    return this.service.updateSyrian(id, dto, {
      id: request.user.sub,
      name: request.user.fullName,
      ipAddress: request.ip,
    });
  }

  /** Municipality staff: record that a registration's detail view was opened. */
  @Post('syrian/:id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logSyrianView(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.recordView('SYRIAN', id, {
      id: request.user.sub,
      name: request.user.fullName,
      ipAddress: request.ip,
    });
  }

  /** Municipality staff: append one or more ID documents to a registration. */
  @Post('syrian/:id/id-document')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('idDocument', MAX_ID_DOCUMENTS_PER_REGISTRATION, {
      limits: { fileSize: ID_DOCUMENT_LIMIT_BYTES },
    }),
  )
  async uploadSyrianIdDocument(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ idDocumentUrls: string[] }> {
    if (!files?.length) {
      throw new MissingRequiredFileError('idDocument');
    }
    const idDocumentUrls = await this.service.uploadIdDocumentsForRegistration(
      'SYRIAN',
      id,
      files,
      {
        id: request.user.sub,
        name: request.user.fullName,
        ipAddress: request.ip,
      },
    );
    return { idDocumentUrls };
  }

  /** Municipality staff: remove exactly one ID document from a registration. */
  @Delete('syrian/:id/id-document')
  @UseGuards(JwtAuthGuard)
  async deleteSyrianIdDocument(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
    @Query('url', new ZodValidationPipe(idDocumentUrlQuerySchema)) url: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ idDocumentUrls: string[] }> {
    const idDocumentUrls = await this.service.deleteIdDocument(
      'SYRIAN',
      id,
      url,
      {
        id: request.user.sub,
        name: request.user.fullName,
        ipAddress: request.ip,
      },
    );
    return { idDocumentUrls };
  }

  // ────────────────────── Lebanese displaced (نازحين) ──────────────────

  /**
   * Public intake form submission (rate-limited, no login). One
   * multipart/form-data request: the JSON `payload` field plus one or
   * more `idDocument` files identifying the registrant.
   */
  @Post('lebanese')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FilesInterceptor('idDocument', MAX_ID_DOCUMENTS_PER_REGISTRATION, {
      limits: { fileSize: ID_DOCUMENT_LIMIT_BYTES },
    }),
  )
  async submitLebanese(
    @Body('payload') rawPayload: string | undefined,
    @UploadedFiles() idDocuments: Express.Multer.File[] | undefined,
  ): Promise<LebaneseDisplaced> {
    const dto = validateWithSchema(
      createLebaneseDisplacedSchema,
      parsePayload(rawPayload),
    );
    if (!idDocuments?.length) {
      throw new MissingRequiredFileError('idDocument');
    }
    return this.service.submitLebanese(dto, idDocuments);
  }

  /** Municipality staff: filterable, searchable, paginated inbox. */
  @Get('lebanese')
  @UseGuards(JwtAuthGuard)
  async listLebanese(
    @Query(new ZodValidationPipe(listDisplacedQuerySchema))
    query: ListDisplacedQueryDto,
  ): Promise<PaginatedDisplaced<LebaneseDisplaced>> {
    return this.service.listLebanese(query);
  }

  /** Municipality staff: metric cards + chart aggregates. */
  @Get('lebanese/summary')
  @UseGuards(JwtAuthGuard)
  async lebaneseSummary(): Promise<DisplacedSummary> {
    return this.service.getSummary('LEBANESE');
  }

  /**
   * Municipality staff: one registration for the detail page. Declared
   * after `lebanese/summary` so the literal route keeps winning.
   */
  @Get('lebanese/:id')
  @UseGuards(JwtAuthGuard)
  async getLebaneseById(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
  ): Promise<LebaneseDisplaced> {
    return this.service.getLebaneseById(id);
  }

  /** Municipality staff: triage a registration (PENDING/APPROVED/REJECTED). */
  @Patch('lebanese/:id/status')
  @UseGuards(JwtAuthGuard)
  async updateLebaneseStatus(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(updateDisplacedStatusSchema))
    dto: UpdateDisplacedStatusDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<LebaneseDisplaced> {
    return this.service.updateStatus('LEBANESE', id, dto, {
      id: request.user.sub,
      name: request.user.fullName,
      ipAddress: request.ip,
    }) as Promise<LebaneseDisplaced>;
  }

  /** Municipality staff: update registration details. */
  @Patch('lebanese/:id')
  @UseGuards(JwtAuthGuard)
  async updateLebanese(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(updateLebaneseDisplacedSchema))
    dto: UpdateLebaneseDisplacedDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<LebaneseDisplaced> {
    return this.service.updateLebanese(id, dto, {
      id: request.user.sub,
      name: request.user.fullName,
      ipAddress: request.ip,
    });
  }

  /** Municipality staff: record that a registration's detail view was opened. */
  @Post('lebanese/:id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  async logLebaneseView(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.recordView('LEBANESE', id, {
      id: request.user.sub,
      name: request.user.fullName,
      ipAddress: request.ip,
    });
  }

  /** Municipality staff: append one or more ID documents to a registration. */
  @Post('lebanese/:id/id-document')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('idDocument', MAX_ID_DOCUMENTS_PER_REGISTRATION, {
      limits: { fileSize: ID_DOCUMENT_LIMIT_BYTES },
    }),
  )
  async uploadLebaneseIdDocument(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ idDocumentUrls: string[] }> {
    if (!files?.length) {
      throw new MissingRequiredFileError('idDocument');
    }
    const idDocumentUrls = await this.service.uploadIdDocumentsForRegistration(
      'LEBANESE',
      id,
      files,
      {
        id: request.user.sub,
        name: request.user.fullName,
        ipAddress: request.ip,
      },
    );
    return { idDocumentUrls };
  }

  /** Municipality staff: remove exactly one ID document from a registration. */
  @Delete('lebanese/:id/id-document')
  @UseGuards(JwtAuthGuard)
  async deleteLebaneseIdDocument(
    @Param('id', new ZodValidationPipe(displacedIdParamSchema)) id: string,
    @Query('url', new ZodValidationPipe(idDocumentUrlQuerySchema)) url: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ idDocumentUrls: string[] }> {
    const idDocumentUrls = await this.service.deleteIdDocument(
      'LEBANESE',
      id,
      url,
      {
        id: request.user.sub,
        name: request.user.fullName,
        ipAddress: request.ip,
      },
    );
    return { idDocumentUrls };
  }
}
