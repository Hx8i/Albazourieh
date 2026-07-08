import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Role, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateStaffDto,
  StaffAccountDto,
  createStaffSchema,
  staffIdParamSchema,
} from './admin-staff.dto';
import { ActingAdmin, AdminStaffService } from './admin-staff.service';

/**
 * SUPER_ADMIN-only staff administration. Every route is double-guarded:
 * `JwtAuthGuard` proves identity, then `RolesGuard` enforces the role via
 * the `@Roles(Role.SUPER_ADMIN)` metadata. STAFF_MEMBER tokens get a 403.
 */
@Controller('admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminStaffController {
  constructor(private readonly service: AdminStaffService) {}

  /** List all active management accounts. */
  @Get()
  async list(): Promise<StaffAccountDto[]> {
    return this.service.list();
  }

  /** Create a new staff account with an encrypted password. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(createStaffSchema)) dto: CreateStaffDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<StaffAccountDto> {
    return this.service.create(this.actingAdmin(request), dto);
  }

  /** Revoke (instantly disable) a staff member's account. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', new ZodValidationPipe(staffIdParamSchema)) id: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.remove(this.actingAdmin(request), id);
  }

  private actingAdmin(request: AuthenticatedRequest): ActingAdmin {
    return {
      id: request.user.sub,
      name: request.user.fullName,
      ipAddress: request.ip,
    };
  }
}
