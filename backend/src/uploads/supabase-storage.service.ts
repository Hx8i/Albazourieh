import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { StorageUnavailableError } from '../common/errors/domain.errors';
import { UPLOAD_KIND_CONFIG, UploadKind } from './upload.dto';

/**
 * Server-side Supabase Storage client. The service-role key lives only
 * here (never shipped to the browser), so every upload passes through
 * this backend's validation instead of a public bucket + anon key.
 */
@Injectable()
export class SupabaseStorageService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private client: SupabaseClient | null = null;

  constructor(config: ConfigService) {
    const url = config.get<string>('SUPABASE_URL');
    const serviceKey = config.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (url && serviceKey) {
      this.client = createClient(url, serviceKey, {
        auth: { persistSession: false },
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.client) {
      this.logger.warn(
        'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — evidence uploads are disabled.',
      );
      return;
    }

    const { data, error } = await this.client.storage.listBuckets();
    if (error) {
      this.logger.error(`Could not list Supabase buckets: ${error.message}`);
      return;
    }
    const existing = new Set(data.map((bucket) => bucket.name));

    for (const [kind, config] of Object.entries(UPLOAD_KIND_CONFIG)) {
      if (existing.has(config.bucket)) continue;
      const { error: createError } = await this.client.storage.createBucket(
        config.bucket,
        {
          public: true,
          fileSizeLimit: config.maxSizeBytes,
          allowedMimeTypes: [...config.allowedMimeTypes],
        },
      );
      if (createError) {
        this.logger.error(
          `Could not create bucket "${config.bucket}": ${createError.message}`,
        );
      } else {
        this.logger.log(`Created Supabase bucket "${config.bucket}" (${kind})`);
      }
    }
  }

  async upload(
    kind: UploadKind,
    buffer: Buffer,
    fileName: string,
    contentType: string,
  ): Promise<string> {
    if (!this.client) {
      throw new StorageUnavailableError();
    }

    const config = UPLOAD_KIND_CONFIG[kind];
    const path = `${Date.now()}-${crypto.randomUUID()}-${fileName.replace(/[^\w.-]/g, '_')}`;

    const { error } = await this.client.storage
      .from(config.bucket)
      .upload(path, buffer, { contentType, upsert: false });

    if (error) {
      this.logger.error(`Upload to "${config.bucket}" failed: ${error.message}`);
      throw new StorageUnavailableError();
    }

    const { data } = this.client.storage.from(config.bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  /**
   * Best-effort delete of a previously-uploaded object, given the public
   * URL `upload()` returned. Failures are logged, not thrown: a stray
   * blob left in storage is a lesser problem than blocking whatever
   * caused the delete (removing a doc, cleaning up after a failed save).
   */
  async remove(publicUrl: string): Promise<void> {
    if (!this.client) return;

    const marker = '/object/public/';
    const markerIndex = publicUrl.indexOf(marker);
    if (markerIndex === -1) return;

    const [bucket, ...pathParts] = publicUrl
      .slice(markerIndex + marker.length)
      .split('/');
    const path = pathParts.join('/');
    if (!bucket || !path) return;

    const { error } = await this.client.storage.from(bucket).remove([path]);
    if (error) {
      this.logger.warn(
        `Could not delete storage object "${path}" from "${bucket}": ${error.message}`,
      );
    }
  }
}
