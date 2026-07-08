import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { JwtPayload } from './auth.dto';

/** Express request enriched with the verified staff identity. */
export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/**
 * Verifies the `Authorization: Bearer <jwt>` header on municipality-only
 * routes and attaches the decoded staff identity to the request so
 * handlers can audit who performed each action.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('A municipality staff login is required');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        header.slice('Bearer '.length),
      );
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Session expired — please log in again');
    }
  }
}
