/**
 * Client-side replica of the backend API contract
 * (backend/src/damage-report/damage-report.dto.ts).
 * Keep the two files in sync — the server always re-validates.
 */

/**
 * v2.5 four-card taxonomy: HOUSE (منزل), SHOP (محل تجاري), APARTMENT
 * (شقة) — the "property" family — plus VEHICLE (آلية). Legacy values
 * remain in the read type so historical reports still render.
 */
export type ReportCategory = 'HOUSE' | 'SHOP' | 'APARTMENT' | 'VEHICLE';
export type PropertyCategory = 'HOUSE' | 'SHOP' | 'APARTMENT';
export type PropertyType =
  | ReportCategory
  | 'BUILDING'
  | 'LAND'
  | 'CAR'
  | 'MOTORCYCLE';
export type OwnershipStatus = 'OWNER' | 'TENANT';
export type ReportStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'APPROVED'
  | 'REJECTED';
export type DamageSeverity = 'TOTAL' | 'PARTIAL' | 'MINOR';
export type AttachmentType = 'PHOTO' | 'DOCUMENT';

/** Vehicle sub-types offered in the "أضرار آليات" combobox. */
export type VehicleKind = 'CAR' | 'TRUCK' | 'TRACTOR' | 'BUS' | 'VAN' | 'OTHER';

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
    description: string;
    severity: DamageSeverity;
  };
}

export type MultipartPayload =
  | (MultipartPayloadBase & {
      category: PropertyCategory;
      location: {
        street: string;
        projectName?: string;
        floor: string;
        unitArea?: number;
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

// ───────────────────────── API response shapes ────────────────────────

export interface ReportListItem {
  id: string;
  /** Public 6-character reference code (e.g. "A4X8Q2"). */
  referenceCode: string;
  description: string;
  status: ReportStatus;
  severity: DamageSeverity;
  rejectionReason: string | null;
  rejectedField: string | null;
  createdAt: string;
  updatedAt: string;
  reporter: { id: string; fullName: string; phoneNumber: string };
  property: {
    id: string;
    type: PropertyType;
    ownershipStatus: OwnershipStatus | null;
    realEstateNumber: string | null;
    ownerPhoneNumber: string | null;
    unitArea: number | null;
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
}

/**
 * Privacy-scrubbed payload from the public tracking endpoint
 * (`GET /damage-reports/status/:code`). Mirrors the backend
 * `PublicReportStatus` — status/category/timestamp only, no personal data.
 */
export interface PublicReportStatus {
  referenceCode: string;
  status: ReportStatus;
  category: PropertyType;
  /** ISO-8601 submission timestamp. */
  submittedAt: string;
  rejectedField?: string | null;
}

/** Public reference code: exactly 6 uppercase letters/digits (e.g. "A4X8Q2"). */
export const REFERENCE_CODE_PATTERN = /^[A-Z0-9]{6}$/;

/** Normalises then validates a citizen-typed reference code. */
export function isValidReferenceCode(raw: string): boolean {
  return REFERENCE_CODE_PATTERN.test(raw.trim().toUpperCase());
}

export interface AdminEditPayload {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  phoneNumber?: string;
  street?: string;
  projectName?: string;
  floor?: string;
  unitArea?: number;
  additionalDirections?: string;
  propertyNumber?: string;
  ownerPhoneNumber?: string;
  latitude?: number;
  longitude?: number;
  description?: string;
}

