import { Module } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';
import { UploadsService } from './uploads.service';

/**
 * Evidence upload pipeline. Files only ever arrive through the citizen
 * wizard's single multipart submission (see DamageReportController),
 * which validates and streams them here — there is no standalone
 * upload endpoint.
 */
@Module({
  providers: [UploadsService, SupabaseStorageService],
  exports: [SupabaseStorageService, UploadsService],
})
export class UploadsModule {}
