/**
 * Client-side replica of the displaced-persons API contract
 * (backend/src/displaced/displaced.dto.ts).
 * Keep the two files in sync — the server always re-validates.
 */

/**
 * Which programme a screen operates on. Also doubles as the URL segment
 * (/syrian/…, /lebanese/…) and the API path segment — the two audiences
 * never share an endpoint, a query key or a metric.
 */
export type DisplacedAudience = 'syrian' | 'lebanese';

export type DisplacedStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** Multi-select urgent-needs checklist offered on both intake forms. */
export type UrgentNeed = 'FOOD' | 'MEDICAL' | 'SHELTER' | 'CASH' | 'WINTERIZATION';

export const URGENT_NEEDS: readonly UrgentNeed[] = [
  'FOOD',
  'MEDICAL',
  'SHELTER',
  'CASH',
  'WINTERIZATION',
];

/** Optional vulnerability flags, applicable to both programmes. */
export type Vulnerability =
  | 'PREGNANT_LACTATING'
  | 'CHRONIC_ILLNESS'
  | 'DISABILITY';

export const VULNERABILITIES: readonly Vulnerability[] = [
  'PREGNANT_LACTATING',
  'CHRONIC_ILLNESS',
  'DISABILITY',
];

/**
 * Shelter type differs per programme. Every value except INFORMAL_SETTLEMENT
 * requires a shelter contact (name + phone).
 */
export type SyrianShelterType =
  | 'RENTAL'
  | 'COLLECTIVE_CENTER'
  | 'INFORMAL_SETTLEMENT';

export const SYRIAN_SHELTER_TYPES: readonly SyrianShelterType[] = [
  'RENTAL',
  'COLLECTIVE_CENTER',
  'INFORMAL_SETTLEMENT',
];

export type LebaneseShelterType = 'RENTAL' | 'HOST_FAMILY' | 'PUBLIC_SHELTER';

export const LEBANESE_SHELTER_TYPES: readonly LebaneseShelterType[] = [
  'RENTAL',
  'HOST_FAMILY',
  'PUBLIC_SHELTER',
];

/** Union of both audiences' shelter values (for display-map lookups). */
export type ShelterType = SyrianShelterType | LebaneseShelterType;

/** The one shelter value that does NOT collect a contact name + phone. */
export const SHELTER_WITHOUT_CONTACT: ShelterType = 'INFORMAL_SETTLEMENT';

// ───────────────────────── Intake payloads ────────────────────────

/** Fields both intake forms submit identically. */
interface CreateDisplacedPayloadBase {
  fullName: string;
  phone: string;
  alternatePhone?: string;
  familyMembersCount: number;
  familyMembersNames: string;
  neighborhoodName: string;
  buildingName: string;
  /** Contact person for the shelter; required unless INFORMAL_SETTLEMENT. */
  shelterContactName?: string;
  shelterContactPhone?: string;
  urgentNeeds: UrgentNeed[];
  vulnerabilityStatus: Vulnerability[];
}

export interface CreateSyrianDisplacedPayload extends CreateDisplacedPayloadBase {
  shelterType: SyrianShelterType;
  originalCity: string;
  /** UNHCR / government registration number — omitted when unregistered. */
  registrationNumber?: string;
  /** "YYYY-MM-DD" — date the household entered Lebanon. */
  entryDate: string;
}

export interface CreateLebaneseDisplacedPayload
  extends CreateDisplacedPayloadBase {
  shelterType: LebaneseShelterType;
  originVillage: string;
  isPropertyDamaged: boolean;
  primarySourceOfIncome?: string;
  /** "YYYY-MM-DD" — date the household was displaced. */
  displacementDate: string;
}

// ──────────────────────── API response shapes ─────────────────────

interface DisplacedItemBase {
  id: string;
  fullName: string;
  phone: string;
  alternatePhone: string | null;
  familyMembersCount: number;
  familyMembersNames: string;
  neighborhoodName: string;
  buildingName: string;
  shelterContactName: string | null;
  shelterContactPhone: string | null;
  urgentNeeds: UrgentNeed[];
  vulnerabilityStatus: Vulnerability[];
  /** Identity document(s) (photo or PDF) proving who registered. */
  idDocumentUrls: string[];
  status: DisplacedStatus;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

export interface SyrianDisplacedItem extends DisplacedItemBase {
  shelterType: SyrianShelterType;
  originalCity: string;
  registrationNumber: string | null;
  /** ISO-8601 date the household entered Lebanon. */
  entryDate: string;
}

export interface LebaneseDisplacedItem extends DisplacedItemBase {
  shelterType: LebaneseShelterType;
  originVillage: string;
  isPropertyDamaged: boolean;
  primarySourceOfIncome: string | null;
  /** ISO-8601 date the household was displaced. */
  displacementDate: string;
}

export type DisplacedItem = SyrianDisplacedItem | LebaneseDisplacedItem;

export interface PaginatedDisplaced<TItem> {
  items: TItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

/** Aggregates behind the four metric cards and the two charts. */
export interface DisplacedSummary {
  total: number;
  /** SUM of familyMembersCount across every registration. */
  totalFamilyMembers: number;
  /** Registrations that ticked at least one urgent need. */
  urgentCases: number;
  byStatus: Record<DisplacedStatus, number>;
  /** Bar chart: how many registrations ticked each need. */
  needs: Record<UrgentNeed, number>;
}

/** Ceiling on identity documents a single registration can carry. */
export const MAX_ID_DOCUMENTS_PER_REGISTRATION = 6;
