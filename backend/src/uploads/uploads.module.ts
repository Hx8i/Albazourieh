import { Module } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService, SupabaseStorageService],
  exports: [SupabaseStorageService, UploadsService],
})
export class UploadsModule {}
