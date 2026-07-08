import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TtlCacheService } from '../common/cache/ttl-cache.service';
import { UploadsModule } from '../uploads/uploads.module';
import { DamageReportController } from './damage-report.controller';
import { DamageReportRepository } from './damage-report.repository';
import { DamageReportService } from './damage-report.service';
import { PropertiesController } from './properties.controller';

@Module({
  imports: [AuthModule, AuditModule, UploadsModule],
  controllers: [DamageReportController, PropertiesController],
  providers: [DamageReportService, DamageReportRepository, TtlCacheService],
  exports: [DamageReportService],
})
export class DamageReportModule {}
