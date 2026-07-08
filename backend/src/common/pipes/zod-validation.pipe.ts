import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { ZodSchema, z } from 'zod';

export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

/**
 * Standalone variant for values that aren't plain request bodies —
 * e.g. a JSON string field inside a multipart/form-data request.
 * Generic over the schema itself so Zod defaults/transforms resolve to
 * the schema's *output* type.
 */
export function validateWithSchema<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
    throw new BadRequestException({
      statusCode: 400,
      error: 'VALIDATION_FAILED',
      message: 'The submitted data is invalid',
      issues,
    });
  }
  return result.data;
}

/**
 * Validates an incoming body/query/param payload against a Zod schema
 * and returns the fully-typed, parsed value. On failure it throws a
 * 400 carrying a flat, client-friendly list of issues.
 */
@Injectable()
export class ZodValidationPipe<TOutput> implements PipeTransform<unknown, TOutput> {
  constructor(private readonly schema: ZodSchema<TOutput>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): TOutput {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const issues: ValidationIssue[] = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));

      throw new BadRequestException({
        statusCode: 400,
        error: 'VALIDATION_FAILED',
        message: 'The submitted data is invalid',
        issues,
      });
    }

    return result.data;
  }
}
