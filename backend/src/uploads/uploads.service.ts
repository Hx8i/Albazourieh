import { Injectable } from '@nestjs/common';
import { InvalidFileError } from '../common/errors/domain.errors';
import { SupabaseStorageService } from './supabase-storage.service';
import {
  UPLOAD_KIND_CONFIG,
  UploadKind,
  sniffFileFamily,
} from './upload.dto';

@Injectable()
export class UploadsService {
  constructor(private readonly storage: SupabaseStorageService) {}

  /**
   * Validates size, declared MIME type AND real file content (magic
   * numbers) before anything touches storage.
   */
  async uploadEvidence(
    kind: UploadKind,
    buffer: Buffer,
    fileName: string,
    declaredMimeType: string,
  ): Promise<string> {
    const config = UPLOAD_KIND_CONFIG[kind];

    if (buffer.length === 0) {
      throw new InvalidFileError('file is empty');
    }
    if (buffer.length > config.maxSizeBytes) {
      const limitMb = Math.round(config.maxSizeBytes / (1024 * 1024));
      throw new InvalidFileError(`file exceeds the ${limitMb}MB limit`);
    }

    const normalizedMime = declaredMimeType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!config.allowedMimeTypes.includes(normalizedMime)) {
      throw new InvalidFileError(`type "${normalizedMime}" is not allowed`);
    }

    const family = sniffFileFamily(buffer);
    if (family === null || !config.allowedFamilies.includes(family)) {
      throw new InvalidFileError('file content does not match its declared type');
    }

    return this.storage.upload(kind, buffer, fileName, normalizedMime);
  }

  /** Best-effort removal of a previously-uploaded object (see SupabaseStorageService.remove). */
  async deleteEvidence(url: string): Promise<void> {
    await this.storage.remove(url);
  }
}
