import { z } from 'zod';

// ──────────────────────────── Shared enums ───────────────────────────
// Mirrors the Prisma enums 1:1 so the API contract stays stable even
// if internal persistence changes.

/**
 * v2.5 four-card taxonomy: HOUSE (منزل), SHOP (محل تجاري), APARTMENT
 * (شقة) — the "property" family — plus VEHICLE (آلية). Each maps 1:1 to
 * the Prisma PropertyType.
 */
export const reportCategorySchema = z.enum([
  'HOUSE',
  'SHOP',
  'APARTMENT',
  'VEHICLE',
]);
export type ReportCategory = z.infer<typeof reportCategorySchema>;
/** Legacy JSON endpoint accepts every persisted PropertyType value. */
export const propertyTypeSchema = z.enum([
  'HOUSE',
  'SHOP',
  'APARTMENT',
  'VEHICLE',
  'BUILDING',
  'LAND',
  'CAR',
  'MOTORCYCLE',
]);
export const ownershipStatusSchema = z.enum(['OWNER', 'TENANT']);
export const reportStatusSchema = z.enum([
  'PENDING',
  'UNDER_REVIEW',
  'VERIFIED',
  'APPROVED',
  'REJECTED',
]);
export const damageSeveritySchema = z.enum(['TOTAL', 'PARTIAL', 'MINOR']);
export const attachmentTypeSchema = z.enum(['PHOTO', 'DOCUMENT']);

export type PropertyType = z.infer<typeof propertyTypeSchema>;
export type OwnershipStatus = z.infer<typeof ownershipStatusSchema>;
export type ReportStatus = z.infer<typeof reportStatusSchema>;
export type DamageSeverity = z.infer<typeof damageSeveritySchema>;
export type AttachmentType = z.infer<typeof attachmentTypeSchema>;

export const attachmentLabelSchema = z.enum([
  'DAMAGE_PHOTO',
  'NATIONAL_ID',
  'PROXY_NATIONAL_ID',
  'PROPERTY_DEED',
  'RENTAL_CONTRACT',
  'VEHICLE_REGISTRATION',
  'VEHICLE_PHOTO',
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
export type VehicleKind = z.infer<typeof vehicleKindSchema>;

/** Relationship options for proxy submissions ("التقديم عن الغير"). */
export const proxyRelationshipSchema = z.enum([
  'SON_DAUGHTER',
  'RELATIVE',
  'NEIGHBOR',
  'LEGAL_REPRESENTATIVE',
  'OTHER',
]);
export type ProxyRelationship = z.infer<typeof proxyRelationshipSchema>;

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

/** Only https:// is accepted — blocks javascript:/data: schemes from ever reaching stored evidence URLs. */
const httpsUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'URL must be a valid https:// address');

const attachmentInputSchema = z.object({
  url: httpsUrlSchema,
  type: attachmentTypeSchema,
  mimeType: z.string().max(100).optional(),
  sizeBytes: z.number().int().positive().optional(),
});

// ──────────────────────── Create report (citizen) ────────────────────

export const createDamageReportSchema = z
  .object({
    reporter: z.object({
      fullName: z.string().trim().min(2, 'Full name is too short').max(120),
      phoneNumber: phoneNumberSchema,
      preferredLanguage: z.enum(['AR', 'EN']).default('AR'),
    }),
    property: z
      .object({
        type: propertyTypeSchema,
        district: z.string().trim().max(120).optional(),
        neighborhood: z.string().trim().min(2, 'Neighborhood is required').max(120),
        addressLine: z.string().trim().max(255).optional(),
      })
      .merge(coordinatesSchema),
    report: z
      .object({
        description: z
          .string()
          .trim()
          .min(10, 'Please describe the damage in at least 10 characters')
          .max(5000),
        severity: damageSeveritySchema,
        voiceNoteUrl: httpsUrlSchema.optional(),
        submittedByProxy: z.boolean().default(false),
        proxyName: z.string().trim().min(2).max(120).optional(),
        proxyRelation: z.string().trim().min(2).max(60).optional(),
      })
      .superRefine((value, ctx) => {
        // Proxy submissions (a child filing for an elderly parent) MUST
        // identify who is physically filling the form and their relation.
        if (value.submittedByProxy) {
          if (!value.proxyName) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['proxyName'],
              message: 'Proxy name is required when submitting on behalf of someone',
            });
          }
          if (!value.proxyRelation) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['proxyRelation'],
              message: 'Proxy relation is required when submitting on behalf of someone',
            });
          }
        } else if (value.proxyName || value.proxyRelation) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['submittedByProxy'],
            message: 'Proxy fields were provided but submittedByProxy is false',
          });
        }
      }),
    attachments: z.array(attachmentInputSchema).max(10).default([]),
  })
  .strict();

export type CreateDamageReportDto = z.infer<typeof createDamageReportSchema>;

// ───────────────────── Update status (municipality) ──────────────────

export const updateReportStatusSchema = z
  .object({
    status: reportStatusSchema,
    rejectionReason: z.string().trim().min(5).max(1000).optional(),
  })
  .strict();

export type UpdateReportStatusDto = z.infer<typeof updateReportStatusSchema>;

// ───────────────────────── List query (dashboard) ────────────────────

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

/**
 * "التقديم عن الغير" — every field strictly mandatory when proxying;
 * choosing OTHER opens a mandatory free-text relationship description.
 */
const proxySchema = z
  .object({
    firstName: namePartSchema,
    middleName: namePartSchema,
    lastName: namePartSchema,
    phoneNumber: phoneNumberSchema,
    relationship: proxyRelationshipSchema,
    customRelationshipDescription: z.string().trim().min(2).max(60).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.relationship === 'OTHER' && !value.customRelationshipDescription) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customRelationshipDescription'],
        message: 'A relationship description is required when choosing OTHER',
      });
    }
  });

const multipartReportSchema = z
  .object({
    // v2.5: required by default, but relaxed to optional when a voice
    // note is attached (the file-level check lives in the service, which
    // is the only place that can see the uploaded files).
    description: z.string().trim().min(10).max(5000).optional(),
    severity: damageSeveritySchema,
    submittedByProxy: z.boolean().default(false),
    proxy: proxySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.submittedByProxy && !value.proxy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proxy'],
        message: 'Proxy details are required when submitting on behalf of someone',
      });
    }
    if (!value.submittedByProxy && value.proxy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['submittedByProxy'],
        message: 'Proxy details were provided but submittedByProxy is false',
      });
    }
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
 *   free text); vehicle papers + photos are mandatory uploads.
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

export const listReportsQuerySchema = z
  .object({
    status: reportStatusSchema.optional(),
    severity: damageSeveritySchema.optional(),
    neighborhood: z.string().trim().min(1).max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListReportsQueryDto = z.infer<typeof listReportsQuerySchema>;

export const reportIdParamSchema = z.string().uuid('Report id must be a UUID');
