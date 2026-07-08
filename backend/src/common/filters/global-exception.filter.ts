import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { DomainError, DomainErrorCode } from '../errors/domain.errors';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  /** Arabic counterpart of `message` for bilingual clients. */
  messageAr?: string;
  issues?: unknown;
}

const DOMAIN_ERROR_STATUS: Record<DomainErrorCode, HttpStatus> = {
  REPORT_NOT_FOUND: HttpStatus.NOT_FOUND,
  INVALID_STATUS_TRANSITION: HttpStatus.CONFLICT,
  REJECTION_REASON_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  DUPLICATE_RESOURCE: HttpStatus.CONFLICT,
  STORAGE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  UNTRUSTED_ATTACHMENT_URL: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  INVALID_FILE: HttpStatus.UNPROCESSABLE_ENTITY,
  PROPERTY_NUMBER_TAKEN: HttpStatus.CONFLICT,
  MISSING_REQUIRED_FILE: HttpStatus.UNPROCESSABLE_ENTITY,
  DESCRIPTION_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  STAFF_NOT_FOUND: HttpStatus.NOT_FOUND,
  STAFF_EMAIL_TAKEN: HttpStatus.CONFLICT,
  PROTECTED_STAFF_ACCOUNT: HttpStatus.UNPROCESSABLE_ENTITY,
};

/**
 * Single choke-point that converts every thrown error — domain errors,
 * Prisma errors, HttpExceptions and unknown crashes — into one
 * consistent JSON envelope. Nothing internal ever leaks to clients.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toErrorBody(exception);

    if (body.statusCode >= 500) {
      this.logger.error(
        'Unhandled exception',
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toErrorBody(exception: unknown): ErrorBody {
    if (exception instanceof DomainError) {
      return {
        statusCode: DOMAIN_ERROR_STATUS[exception.code],
        error: exception.code,
        message: exception.message,
        messageAr: exception.messageAr,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { statusCode: status, error: exception.name, message: payload };
      }

      const record = payload as Record<string, unknown>;
      return {
        statusCode: status,
        error: typeof record.error === 'string' ? record.error : exception.name,
        message:
          typeof record.message === 'string'
            ? record.message
            : exception.message,
        issues: record.issues,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        return {
          statusCode: HttpStatus.NOT_FOUND,
          error: 'RESOURCE_NOT_FOUND',
          message: 'The requested resource does not exist',
        };
      }
      if (exception.code === 'P2002') {
        return {
          statusCode: HttpStatus.CONFLICT,
          error: 'DUPLICATE_RESOURCE',
          message: 'A resource with the same unique value already exists',
        };
      }
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'DATABASE_REQUEST_FAILED',
        message: 'The database rejected the request',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Something went wrong on our side. Please try again.',
    };
  }
}
