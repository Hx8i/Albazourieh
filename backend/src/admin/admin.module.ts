import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AdminStaffController } from './admin-staff.controller';
import { AdminStaffService } from './admin-staff.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [AdminStaffController],
  providers: [AdminStaffService],
})
export class AdminModule {}
