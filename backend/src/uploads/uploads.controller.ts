import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  UploadKind,
  UploadResponseDto,
  uploadKindSchema,
} from './upload.dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  /**
   * Citizens upload one file at a time from the wizard —
   * `/uploads/photo` or `/uploads/voice` — then reference the returned
   * URL in the report submission payload.
   */
  @Post(':kind')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 11 * 1024 * 1024 } }))
  async upload(
    @Param('kind', new ZodValidationPipe(uploadKindSchema)) kind: UploadKind,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestException('A "file" form-data field is required');
    }

    const url = await this.uploadsService.uploadEvidence(
      kind,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { url };
  }
}
