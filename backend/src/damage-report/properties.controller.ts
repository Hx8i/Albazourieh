import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  PropertyNumberAvailabilityDto,
  ValidatePropertyNumberDto,
  validatePropertyNumberSchema,
} from './damage-report.dto';
import { DamageReportService } from './damage-report.service';

@Controller('properties')
export class PropertiesController {
  constructor(private readonly service: DamageReportService) {}

  /**
   * onBlur uniqueness check: is this official property number already
   * filed? Public (citizens call it mid-wizard) but throttled against
   * enumeration scraping. The server re-checks inside the submission
   * transaction regardless, so this is UX, not the security boundary.
   */
  @Get('validate-number')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async validateNumber(
    @Query(new ZodValidationPipe(validatePropertyNumberSchema))
    query: ValidatePropertyNumberDto,
  ): Promise<PropertyNumberAvailabilityDto> {
    return this.service.checkPropertyNumber(query.number);
  }
}
