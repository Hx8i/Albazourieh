import { SetMetadata } from '@nestjs/common';
import { MunicipalityRole } from '../generated/prisma/client';

/** Re-exported so guards/controllers can read `Role.SUPER_ADMIN` ergonomically. */
export const Role = MunicipalityRole;

export const ROLES_KEY = 'roles';

/**
 * Locks a route (or controller) to one or more municipality roles.
 * Enforced by {@link RolesGuard}, which must run after `JwtAuthGuard` so
 * the verified identity is already attached to the request.
 *
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles(Role.SUPER_ADMIN)
 */
export const Roles = (...roles: MunicipalityRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
