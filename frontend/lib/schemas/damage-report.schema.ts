import { z } from 'zod';

/**
 * Client-side replica of the backend Zod contract
 * (backend/src/damage-report/damage-report.dto.ts).
 * Keep the two files in sync — the server always re-validates.
 */

/**
 * v2.5 four-card taxonomy: HOUSE (منزل), SHOP (محل تجاري), APARTMENT
 * (شقة) — the "property" family — plus VEHICLE (آلية). Legacy values
 * remain in the read type so historical reports still render.
 */
export const reportCategorySchema = z.enum([
  'HOUSE',
  'SHOP',
  'APARTMENT',
  'VEHICLE',
]);
export const propertyCategorySchema = z.enum(['HOUSE', 'SHOP', 'APARTMENT']);
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
export type ReportCategory = z.infer<typeof reportCategorySchema>;
export type PropertyCategory = z.infer<typeof propertyCategorySchema>;
export type OwnershipStatus = z.infer<typeof ownershipStatusSchema>;
export type ReportStatus = z.infer<typeof reportStatusSchema>;
export type DamageSeverity = z.infer<typeof damageSeveritySchema>;
export type AttachmentType = z.infer<typeof attachmentTypeSchema>;

export type AttachmentLabel =
  | 'DAMAGE_PHOTO'
  | 'NATIONAL_ID'
  | 'PROXY_NATIONAL_ID'
  | 'PROPERTY_DEED'
  | 'RENTAL_CONTRACT'
  | 'VEHICLE_REGISTRATION'
  | 'VEHICLE_PHOTO'
  | 'RESIDENCY_PROOF';

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

/**
 * "التقديم عن الغير" — all fields strictly mandatory when proxying;
 * OTHER opens a mandatory free-text relationship description.
 */
export interface ProxyDetails {
  firstName: string;
  middleName: string;
  lastName: string;
  phoneNumber: string;
  relationship: ProxyRelationship;
  customRelationshipDescription?: string;
}

/**
 * Client replica of the backend's multipart `payload` contract
 * (discriminated on category — see backend damage-report.dto.ts).
 * HOUSE/SHOP/APARTMENT carry the full address block + ownership + the
 * uniqueness-checked property number; VEHICLE strictly bypasses the
 * address block (district + GPS only) and carries the vehicle sub-type.
 */
interface MultipartPayloadBase {
  reporter: {
    firstName: string;
    middleName: string;
    lastName: string;
    phoneNumber: string;
    preferredLanguage: 'AR' | 'EN';
  };
  report: {
    /** Required by default; optional when a voice note is attached. */
    description?: string;
    severity: DamageSeverity;
    submittedByProxy: boolean;
    proxy?: ProxyDetails;
  };
}

export type MultipartPayload =
  | (MultipartPayloadBase & {
      category: PropertyCategory;
      location: {
        street: string;
        projectName?: string;
        floor: string;
        additionalDirections?: string;
        district?: string;
        latitude: number;
        longitude: number;
      };
      property: {
        ownershipStatus: OwnershipStatus;
        propertyNumber: string;
        ownerPhoneNumber?: string;
      };
    })
  | (MultipartPayloadBase & {
      category: 'VEHICLE';
      location: {
        district: string;
        latitude: number;
        longitude: number;
      };
      property: {
        vehicleType: VehicleKind;
        customVehicleTypeDescription?: string;
      };
    });

const phoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'invalidPhone');

const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const attachmentInputSchema = z.object({
  url: z.string().url().max(2048),
  type: attachmentTypeSchema,
  mimeType: z.string().max(100).optional(),
  sizeBytes: z.number().int().positive().optional(),
});

export const createDamageReportSchema = z
  .object({
    reporter: z.object({
      fullName: z.string().trim().min(2, 'nameTooShort').max(120),
      phoneNumber: phoneNumberSchema,
      preferredLanguage: z.enum(['AR', 'EN']).default('AR'),
    }),
    property: z
      .object({
        type: propertyTypeSchema,
        district: z.string().trim().max(120).optional(),
        neighborhood: z.string().trim().min(2, 'neighborhoodRequired').max(120),
        addressLine: z.string().trim().max(255).optional(),
      })
      .merge(coordinatesSchema),
    report: z
      .object({
        description: z.string().trim().min(10, 'descriptionTooShort').max(5000),
        severity: damageSeveritySchema,
        voiceNoteUrl: z.string().url().max(2048).optional(),
        submittedByProxy: z.boolean().default(false),
        proxyName: z.string().trim().min(2).max(120).optional(),
        proxyRelation: z.string().trim().min(2).max(60).optional(),
      })
      .superRefine((value, ctx) => {
        if (value.submittedByProxy) {
          if (!value.proxyName) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['proxyName'],
              message: 'proxyNameRequired',
            });
          }
          if (!value.proxyRelation) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['proxyRelation'],
              message: 'proxyRelationRequired',
            });
          }
        }
      }),
    attachments: z.array(attachmentInputSchema).max(10).default([]),
  })
  .strict();

export type CreateDamageReportInput = z.infer<typeof createDamageReportSchema>;

// ───────────────────────── API response shapes ────────────────────────

export interface ReportListItem {
  id: string;
  description: string;
  voiceNoteUrl: string | null;
  status: ReportStatus;
  severity: DamageSeverity;
  submittedByProxy: boolean;
  proxyName: string | null;
  proxyRelation: string | null;
  proxyPhoneNumber: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  reporter: { id: string; fullName: string; phoneNumber: string };
  property: {
    id: string;
    type: PropertyType;
    ownershipStatus: OwnershipStatus | null;
    realEstateNumber: string | null;
    ownerPhoneNumber: string | null;
    vehicleType: string | null;
    vehicleTypeOther: string | null;
    district: string | null;
    neighborhood: string;
    street: string | null;
    projectName: string | null;
    floor: string | null;
    additionalDirections: string | null;
    addressLine: string | null;
    latitude: number;
    longitude: number;
  };
  attachments: Array<{
    id: string;
    url: string;
    type: AttachmentType;
    label: string | null;
    mimeType: string | null;
  }>;
}

export interface PaginatedReports {
  items: ReportListItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

export interface StatusSummary {
  total: number;
  byStatus: Record<ReportStatus, number>;
  bySeverity: Record<DamageSeverity, number>;
}

/** Minimal point payload streamed to the deck.gl map layer. */
export interface SpatialPoint {
  id: string;
  latitude: number;
  longitude: number;
  severity: DamageSeverity;
  status: ReportStatus;
  propertyType: PropertyType;
  neighborhood: string;
  reporterName: string;
  /** Enables inline audio playback in the map popover. */
  voiceNoteUrl: string | null;
}
