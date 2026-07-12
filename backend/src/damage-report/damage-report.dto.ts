import { z } from 'zod';

// ──────────────────────────── Shared enums ───────────────────────────
// Mirrors the Prisma enums 1:1 so the API contract stays stable even
// if internal persistence changes.

export const ownershipStatusSchema = z.enum(['OWNER', 'TENANT']);
export const reportStatusSchema = z.enum([
  'PENDING',
  'UNDER_REVIEW',
  'VERIFIED',
  'APPROVED',
  'REJECTED',
]);
export const damageSeveritySchema = z.enum(['TOTAL', 'PARTIAL', 'MINOR']);

export const attachmentLabelSchema = z.enum([
  'DAMAGE_PHOTO',
  'NATIONAL_ID',
  'PROPERTY_DEED',
  'RENTAL_CONTRACT',
  'VEHICLE_REGISTRATION',
  'RESIDENCY_PROOF',
]);
export type AttachmentLabel = z.infer<typeof attachmentLabelSchema>;

/** Vehicle sub-types offered in the "أضرار آليات" combobox. */
export const vehicleKindSchema = z.enum([
  'CAR',
  'TRUCK',
  'TRACTOR',
  'BUS',
  'VAN',
  'OTHER',
]);

// ─────────────────────────── Building blocks ─────────────────────────

/** Lebanese numbers with or without +961, but any E.164-ish number passes. */
const phoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Phone number must contain 7–15 digits');

const coordinatesSchema = z.object({
  latitude: z
    .number({ invalid_type_error: 'Latitude must be a number' })
    .min(-90, 'Latitude must be ≥ -90')
    .max(90, 'Latitude must be ≤ 90'),
  longitude: z
    .number({ invalid_type_error: 'Longitude must be a number' })
    .min(-180, 'Longitude must be ≥ -180')
    .max(180, 'Longitude must be ≤ 180'),
});

// ───────────────────── Update status (municipality) ──────────────────

export const updateReportStatusSchema = z
  .object({
    status: reportStatusSchema,
    rejectionReason: z.string().trim().min(5).max(1000).optional(),
  })
  .strict();

export type UpdateReportStatusDto = z.infer<typeof updateReportStatusSchema>;

// ─────────────── Multipart submission (citizen wizard v2) ────────────

/** One name part: first, middle (father's) or family name. */
const namePartSchema = z.string().trim().min(2).max(60);

const multipartReporterSchema = z.object({
  firstName: namePartSchema,
  middleName: namePartSchema,
  lastName: namePartSchema,
  phoneNumber: phoneNumberSchema,
  preferredLanguage: z.enum(['AR', 'EN']).default('AR'),
});

const multipartReportSchema = z.object({
  description: z.string().trim().min(10).max(5000),
  severity: damageSeveritySchema,
});

/**
 * Property categories carry the deep-precision address block; vehicles
 * strictly bypass it — only the city/district plus GPS coordinates.
 */
const propertyLocationSchema = z
  .object({
    street: z.string().trim().min(2).max(120),
    projectName: z.string().trim().max(120).optional(),
    floor: z.string().trim().min(1).max(30),
    additionalDirections: z.string().trim().max(255).optional(),
    district: z.string().trim().max(120).optional(),
  })
  .merge(coordinatesSchema);

const vehicleLocationSchema = z
  .object({
    district: z.string().trim().min(2).max(120),
  })
  .merge(coordinatesSchema);

const propertyDataSchema = z.object({
  ownershipStatus: ownershipStatusSchema,
  propertyNumber: z.string().trim().min(1).max(60),
  /** Tenants may optionally share the landlord's phone number. */
  ownerPhoneNumber: phoneNumberSchema.optional(),
});

const vehicleDataSchema = z
  .object({
    vehicleType: vehicleKindSchema,
    customVehicleTypeDescription: z.string().trim().min(2).max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.vehicleType === 'OTHER' && !value.customVehicleTypeDescription) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customVehicleTypeDescription'],
        message: 'A vehicle description is required when choosing OTHER',
      });
    }
  });

const propertyVariant = <TCategory extends 'HOUSE' | 'SHOP' | 'APARTMENT'>(
  category: TCategory,
) =>
  z
    .object({
      category: z.literal(category),
      reporter: multipartReporterSchema,
      report: multipartReportSchema,
      location: propertyLocationSchema,
      property: propertyDataSchema,
    })
    .strict();

/**
 * v2.5 category rules, one discriminated-union branch per card:
 * - HOUSE / SHOP / APARTMENT: full address block + ownership status +
 *   uniqueness-checked property number; deed optional; owners attach
 *   residency proof, tenants a rental contract (+ optional owner phone).
 * - VEHICLE (آلية): district + GPS only; vehicle sub-type (with OTHER
 *   free text); vehicle papers are an optional upload.
 */
export const multipartPayloadSchema = z.discriminatedUnion('category', [
  propertyVariant('HOUSE'),
  propertyVariant('SHOP'),
  propertyVariant('APARTMENT'),
  z
    .object({
      category: z.literal('VEHICLE'),
      reporter: multipartReporterSchema,
      report: multipartReportSchema,
      location: vehicleLocationSchema,
      property: vehicleDataSchema,
    })
    .strict(),
]);

export type MultipartPayloadDto = z.infer<typeof multipartPayloadSchema>;

// ────────────── Property-number uniqueness (onBlur check) ────────────

export const validatePropertyNumberSchema = z
  .object({
    number: z.string().trim().min(1).max(60),
  })
  .strict();

export type ValidatePropertyNumberDto = z.infer<
  typeof validatePropertyNumberSchema
>;

export interface PropertyNumberAvailabilityDto {
  available: boolean;
}

// ─────────────────────── Spatial query (map dashboard) ───────────────

export const spatialQuerySchema = z
  .object({
    status: reportStatusSchema.optional(),
    severity: damageSeveritySchema.optional(),
    neighborhood: z.string().trim().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(5000).default(2000),
  })
  .strict();

export type SpatialQueryDto = z.infer<typeof spatialQuerySchema>;

// ───────────────────────── List query (dashboard) ────────────────────

/** Columns the dashboard table lets staff sort by. */
export const reportSortFieldSchema = z.enum([
  'createdAt',
  'referenceCode',
  'reporterName',
  'neighborhood',
  'severity',
  'status',
]);
export type ReportSortField = z.infer<typeof reportSortFieldSchema>;

export const sortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof sortDirectionSchema>;

export const listReportsQuerySchema = z
  .object({
    status: reportStatusSchema.optional(),
    severity: damageSeveritySchema.optional(),
    neighborhood: z.string().trim().min(1).max(120).optional(),
    /**
     * Global search: matches applicant name, phone number, property
     * number (رقم العقار) or the 6-character reference code — all
     * case-insensitively, from a single input.
     */
    search: z.string().trim().min(1).max(120).optional(),
    sortBy: reportSortFieldSchema.default('createdAt'),
    sortDir: sortDirectionSchema.default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListReportsQueryDto = z.infer<typeof listReportsQuerySchema>;

export const reportIdParamSchema = z.string().uuid('Report id must be a UUID');

/**
 * Public reference code: exactly 6 uppercase letters/digits (see
 * reference-code.ts). Accepts lowercase input and normalises it, so a
 * citizen typing "a4x8q2" still resolves.
 */
export const referenceCodeParamSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{6}$/, 'Reference code must be 6 letters or digits');
