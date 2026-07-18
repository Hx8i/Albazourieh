import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TtlCacheService } from '../common/cache/ttl-cache.service';
import { UploadsModule } from '../uploads/uploads.module';
import { DisplacedController } from './displaced.controller';
import { DisplacedRepository } from './displaced.repository';
import { DisplacedService } from './displaced.service';

@Module({
  imports: [AuthModule, AuditModule, UploadsModule],
  controllers: [DisplacedController],
  providers: [DisplacedService, DisplacedRepository, TtlCacheService],
  exports: [DisplacedService],
})
export class DisplacedModule {}
