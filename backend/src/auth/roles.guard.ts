import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MunicipalityRole } from '@prisma/client';
import { AuthenticatedRequest } from './jwt-auth.guard';
import { ROLES_KEY } from './roles.decorator';

/**
 * Reads the `@Roles(...)` metadata via Reflection and checks it against
 * the role embedded in the verified JWT. Routes with no `@Roles` metadata
 * are unrestricted (authentication alone is enough). Pair it after
 * `JwtAuthGuard` — it depends on `request.user` already being populated.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<MunicipalityRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;

    if (!role || !required.includes(role)) {
      throw new ForbiddenException(
        'This action requires elevated municipality privileges',
      );
    }
    return true;
  }
}
