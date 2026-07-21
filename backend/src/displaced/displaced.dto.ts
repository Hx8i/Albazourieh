import { z } from 'zod';

// ──────────────────────────── Shared enums ───────────────────────────
// Mirrors the Prisma enums / agreed value sets 1:1 so the API contract
// stays stable even if internal persistence changes.

export const displacedStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type DisplacedStatus = z.infer<typeof displacedStatusSchema>;

/** Multi-select urgent-needs checklist offered on both intake forms. */
export const urgentNeedSchema = z.enum([
  'FOOD',
  'MEDICAL',
  'SHELTER',
  'CASH',
  'WINTERIZATION',
]);
export type UrgentNeed = z.infer<typeof urgentNeedSchema>;

/** Optional vulnerability flags, applicable to both programmes. */
export const vulnerabilitySchema = z.enum([
  'PREGNANT_LACTATING',
  'CHRONIC_ILLNESS',
  'DISABILITY',
]);
export type Vulnerability = z.infer<typeof vulnerabilitySchema>;

/**
 * Shelter type differs by programme, so each audience carries its own
 * enum. Every value except INFORMAL_SETTLEMENT requires a shelter
 * contact (name + phone) — see `requireShelterContact`.
 */
export const syrianShelterTypeSchema = z.enum([
  'RENTAL',
  'COLLECTIVE_CENTER',
  'INFORMAL_SETTLEMENT',
]);
export type SyrianShelterType = z.infer<typeof syrianShelterTypeSchema>;

export const lebaneseShelterTypeSchema = z.enum([
  'RENTAL',
  'HOST_FAMILY',
  'PUBLIC_SHELTER',
]);
export type LebaneseShelterType = z.infer<typeof lebaneseShelterTypeSchema>;

/** The only shelter value that does NOT require a contact name + phone. */
const SHELTER_WITHOUT_CONTACT = 'INFORMAL_SETTLEMENT';

// ─────────────────────────── Building blocks ─────────────────────────

/** Lebanese numbers with or without +961, but any E.164-ish number passes. */
const phoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'Phone number must contain 7–15 digits');

const fullNameSchema = z.string().trim().min(3).max(120);

const placeNameSchema = z.string().trim().min(2).max(120);

/** A required free-text location part (district, neighborhood, building). */
const locationPartSchema = z.string().trim().min(2).max(120);

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
    // JS Date rolls invalid days (e.g. "2024-02-30") over into the next
    // month instead of rejecting them; re-serialising and comparing back
    // to the input catches that normalisation.
    if (parsed.toISOString().slice(0, 10) !== value) return false;
    return parsed.getTime() <= Date.now();
  }, 'Date must be a valid day that is not in the future');

/** De-duplicated urgent-needs selection — at least one need is required. */
const urgentNeedsSchema = z
  .array(urgentNeedSchema)
  .min(1, 'Select at least one urgent need')
  .max(5)
  .transform((needs) => [...new Set(needs)]);

/** De-duplicated vulnerability flags; the whole list is optional. */
const vulnerabilitySelectionSchema = z
  .array(vulnerabilitySchema)
  .max(3)
  .default([])
  .transform((flags) => [...new Set(flags)]);

// ───────────────────────── Intake submissions ────────────────────────
//
// Fields shared by both programmes. Audience-specific shelter/origin/date
// fields are merged per schema below. The shelter contact (name + phone)
// is conditionally required (see `requireShelterContact`).

const sharedIntakeFields = {
  fullName: fullNameSchema,
  phone: phoneNumberSchema,
  /** Emergency fallback contact — optional. */
  alternatePhone: phoneNumberSchema.optional(),
  familyMembersCount: familyMembersCountSchema,
  familyMembersNames: z.string().trim().min(3).max(1000),
  neighborhoodName: locationPartSchema,
  buildingName: locationPartSchema,
  /**
   * Shelter contact — the rental owner, collective-centre manager or host
   * family member depending on shelterType. Required unless the shelter is
   * an informal settlement (see refinement).
   */
  shelterContactName: z.string().trim().min(2).max(120).optional(),
  shelterContactPhone: phoneNumberSchema.optional(),
  urgentNeeds: urgentNeedsSchema,
  vulnerabilityStatus: vulnerabilitySelectionSchema,
};

/**
 * Every shelter type except an informal settlement must name a contact
 * person and their phone. Applied on create (the whole record is present);
 * relaxed on partial updates so editing one field never fails for not
 * resending an already-stored contact.
 */
function requireShelterContact(
  value: { shelterType?: string; shelterContactName?: string; shelterContactPhone?: string },
  ctx: z.RefinementCtx,
): void {
  if (!value.shelterType || value.shelterType === SHELTER_WITHOUT_CONTACT) {
    return;
  }
  if (!value.shelterContactName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['shelterContactName'],
      message: 'A contact name is required for this housing type',
    });
  }
  if (!value.shelterContactPhone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['shelterContactPhone'],
      message: 'A contact phone number is required for this housing type',
    });
  }
}

const syrianIntakeObject = z
  .object({
    ...sharedIntakeFields,
    shelterType: syrianShelterTypeSchema,
    /** City/town of origin in Syria. */
    originalCity: placeNameSchema,
    /** UNHCR / government registration number — omitted when unregistered. */
    registrationNumber: z.string().trim().min(2).max(60).optional(),
    entryDate: calendarDateSchema,
  })
  .strict();

export const createSyrianDisplacedSchema =
  syrianIntakeObject.superRefine(requireShelterContact);

export type CreateSyrianDisplacedDto = z.infer<
  typeof createSyrianDisplacedSchema
>;

const lebaneseIntakeObject = z
  .object({
    ...sharedIntakeFields,
    shelterType: lebaneseShelterTypeSchema,
    /** Village of origin in Lebanon. */
    originVillage: placeNameSchema,
    isPropertyDamaged: z.boolean(),
    primarySourceOfIncome: z.string().trim().min(2).max(120).optional(),
    displacementDate: calendarDateSchema,
  })
  .strict();

export const createLebaneseDisplacedSchema =
  lebaneseIntakeObject.superRefine(requireShelterContact);

export type CreateLebaneseDisplacedDto = z.infer<
  typeof createLebaneseDisplacedSchema
>;

// Updates are partial (staff edit any subset) and carry an optional status.
// The landlord rule isn't re-checked here: an edit that changes only, say,
// the phone must not fail because it didn't resend an already-stored
// landlordPhone — the create path already guaranteed the invariant.
export const updateSyrianDisplacedSchema = syrianIntakeObject
  .partial()
  .extend({ status: displacedStatusSchema.optional() })
  .strict();
export type UpdateSyrianDisplacedDto = z.infer<
  typeof updateSyrianDisplacedSchema
>;

export const updateLebaneseDisplacedSchema = lebaneseIntakeObject
  .partial()
  .extend({ status: displacedStatusSchema.optional() })
  .strict();
export type UpdateLebaneseDisplacedDto = z.infer<
  typeof updateLebaneseDisplacedSchema
>;

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
