import { Injectable } from '@nestjs/common';
import { MunicipalityUser } from '@prisma/client';
import { hash } from 'bcryptjs';
import { AuditLogService } from '../audit/audit-log.service';
import {
  ProtectedStaffAccountError,
  StaffEmailTakenError,
  StaffNotFoundError,
} from '../common/errors/domain.errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto, StaffAccountDto } from './admin-staff.dto';

/** bcrypt work factor — matches the seed script. */
const PASSWORD_SALT_ROUNDS = 12;

/** The signed-in administrator performing the mutation (from the JWT). */
export interface ActingAdmin {
  id: string;
  name: string;
  ipAddress?: string;
}

/**
 * Staff account administration, reserved for SUPER_ADMIN at the transport
 * layer (see the controller's guards). Removal is a soft-disable: it
 * revokes access instantly (the login flow rejects `isActive === false`)
 * without breaking the audit trail of reports a staff member reviewed.
 */
@Injectable()
export class AdminStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** All active management accounts, newest first. */
  async list(): Promise<StaffAccountDto[]> {
    const users = await this.prisma.municipalityUser.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return users.map((user) => this.toDto(user));
  }

  /** Create a new staff account with an encrypted (bcrypt) password. */
  async create(
    actor: ActingAdmin,
    dto: CreateStaffDto,
  ): Promise<StaffAccountDto> {
    const existing = await this.prisma.municipalityUser.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new StaffEmailTakenError(dto.email);
    }

    // New accounts inherit the creating administrator's municipality.
    const actorRecord = await this.prisma.municipalityUser.findUnique({
      where: { id: actor.id },
      select: { municipalityName: true },
    });

    const passwordHash = await hash(dto.password, PASSWORD_SALT_ROUNDS);
    const created = await this.prisma.municipalityUser.create({
      data: {
        fullName: dto.fullName,
        email: dto.email,
        passwordHash,
        role: dto.role,
        municipalityName: actorRecord?.municipalityName ?? 'Al Bazourieh',
        isActive: true,
      },
    });

    await this.audit.record({
      adminId: actor.id,
      adminName: actor.name,
      actionType: 'CREATE_STAFF',
      targetId: created.id,
      details: `Created staff account ${created.email} (${created.role})`,
      ipAddress: actor.ipAddress,
    });

    return this.toDto(created);
  }

  /**
   * Instantly revoke a staff member by disabling their account. Guards
   * against locking yourself out or removing the last administrator.
   */
  async remove(actor: ActingAdmin, staffId: string): Promise<void> {
    const target = await this.prisma.municipalityUser.findFirst({
      where: { id: staffId, isActive: true },
    });
    if (!target) {
      throw new StaffNotFoundError(staffId);
    }
    if (target.id === actor.id) {
      throw new ProtectedStaffAccountError({
        en: 'You cannot remove your own account while signed in',
        ar: 'لا يمكنك إزالة حسابك الخاص أثناء تسجيل الدخول',
      });
    }
    if (target.role === 'SUPER_ADMIN') {
      const activeAdmins = await this.prisma.municipalityUser.count({
        where: { role: 'SUPER_ADMIN', isActive: true },
      });
      if (activeAdmins <= 1) {
        throw new ProtectedStaffAccountError({
          en: 'Cannot remove the last active administrator',
          ar: 'لا يمكن إزالة آخر مسؤول نشط في المنصة',
        });
      }
    }

    await this.prisma.municipalityUser.update({
      where: { id: staffId },
      data: { isActive: false },
    });

    await this.audit.record({
      adminId: actor.id,
      adminName: actor.name,
      actionType: 'DELETE_STAFF',
      targetId: target.id,
      details: `Revoked staff account ${target.email} (${target.role})`,
      ipAddress: actor.ipAddress,
    });
  }

  private toDto(user: MunicipalityUser): StaffAccountDto {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      municipalityName: user.municipalityName,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
