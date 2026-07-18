import { z } from 'zod';

// ──────────────────────────── Shared enums ───────────────────────────
// Mirrors the Prisma enums / agreed value sets 1:1 so the API contract
// stays stable even if internal persistence changes.

export const displacedStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type DisplacedStatus = z.infer<typeof displacedStatusSchema>;

/** Multi-select urgent-needs checklist offered on both intake forms. */
export const urgentNeedSchema = z.enum(['FOOD', 'MEDICAL', 'SHELTER', 'CASH']);
export type UrgentNeed = z.infer<typeof urgentNeedSchema>;

/** Where a displaced Syrian household currently lives. */
export const shelterTypeSchema = z.enum([
  'RENTED_APARTMENT',
  'HOSTED_WITH_FAMILY',
  'COLLECTIVE_SHELTER',
  'TENT_OR_CAMP',
  'OTHER',
]);
export type ShelterType = z.infer<typeof shelterTypeSchema>;

// ─────────────────────────── Building blocks ─────────────────────────

/** Lebanese numbers with or without +961, but any E.164-ish number passes. */
const phoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Phone number must contain 7–15 digits');

const fullNameSchema = z.string().trim().min(3).max(120);

const placeNameSchema = z.string().trim().min(2).max(120);

const familyMembersCountSchema = z
  .number({ invalid_type_error: 'Family members count must be a number' })
  .int()
  .min(1, 'A household has at least one member')
  .max(50, 'Family members count is unrealistically large');

/**
 * Calendar date as "YYYY-MM-DD" (matches the native date input), checked
 * to be a real day that is not in the future.
 */
const calendarDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return false;
    return parsed.getTime() <= Date.now();
  }, 'Date must be a valid day that is not in the future');

/** De-duplicated urgent-needs selection; an empty list is allowed. */
const urgentNeedsSchema = z
  .array(urgentNeedSchema)
  .max(4)
  .default([])
  .transform((needs) => [...new Set(needs)]);

// ───────────────────────── Intake submissions ────────────────────────

export const createSyrianDisplacedSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneNumberSchema,
    familyMembersCount: familyMembersCountSchema,
    familyMembersNames: z.string().trim().min(3).max(1000),
    originalCity: placeNameSchema,
    /** UNHCR / government registration number — omitted when unregistered. */
    registrationNumber: z.string().trim().min(2).max(60).optional(),
    shelterType: shelterTypeSchema,
    urgentNeeds: urgentNeedsSchema,
    entryDate: calendarDateSchema,
  })
  .strict();

export type CreateSyrianDisplacedDto = z.infer<
  typeof createSyrianDisplacedSchema
>;

export const createLebaneseDisplacedSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneNumberSchema,
    familyMembersCount: familyMembersCountSchema,
    familyMembersNames: z.string().trim().min(3).max(1000),
    originVillage: placeNameSchema,
    isPropertyDamaged: z.boolean(),
    primarySourceOfIncome: z.string().trim().min(2).max(120).optional(),
    urgentNeeds: urgentNeedsSchema,
    displacementDate: calendarDateSchema,
  })
  .strict();

export type CreateLebaneseDisplacedDto = z.infer<
  typeof createLebaneseDisplacedSchema
>;

export const updateSyrianDisplacedSchema = createSyrianDisplacedSchema.partial().extend({
  status: displacedStatusSchema.optional(),
}).strict();
export type UpdateSyrianDisplacedDto = z.infer<typeof updateSyrianDisplacedSchema>;

export const updateLebaneseDisplacedSchema = createLebaneseDisplacedSchema.partial().extend({
  status: displacedStatusSchema.optional(),
}).strict();
export type UpdateLebaneseDisplacedDto = z.infer<typeof updateLebaneseDisplacedSchema>;

// ───────────────────────── List query (dashboard) ────────────────────

/** Columns the displaced dashboard table lets staff sort by. */
export const displacedSortFieldSchema = z.enum([
  'createdAt',
  'fullName',
  'familyMembersCount',
  'status',
]);
export type DisplacedSortField = z.infer<typeof displacedSortFieldSchema>;

export const displacedSortDirectionSchema = z.enum(['asc', 'desc']);
export type DisplacedSortDirection = z.infer<
  typeof displacedSortDirectionSchema
>;

export const listDisplacedQuerySchema = z
  .object({
    status: displacedStatusSchema.optional(),
    /** Single-input search: registrant name or phone number. */
    search: z.string().trim().min(1).max(120).optional(),
    sortBy: displacedSortFieldSchema.default('createdAt'),
    sortDir: displacedSortDirectionSchema.default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListDisplacedQueryDto = z.infer<typeof listDisplacedQuerySchema>;

// ───────────────────── Status change (municipality) ──────────────────

export const updateDisplacedStatusSchema = z
  .object({
    status: displacedStatusSchema,
  })
  .strict();

export type UpdateDisplacedStatusDto = z.infer<
  typeof updateDisplacedStatusSchema
>;

export const displacedIdParamSchema = z
  .string()
  .uuid('Registration id must be a UUID');

// ───────────────────── Identity documents (files) ─────────────────────

/** Ceiling on identity documents a single registration can carry. */
export const MAX_ID_DOCUMENTS_PER_REGISTRATION = 6;

/** Query param validating the target URL on a delete-one-document call. */
export const idDocumentUrlQuerySchema = z.string().trim().url();
