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
export type UrgentNeed = 'FOOD' | 'MEDICAL' | 'SHELTER' | 'CASH';

export const URGENT_NEEDS: readonly UrgentNeed[] = [
  'FOOD',
  'MEDICAL',
  'SHELTER',
  'CASH',
];

/** Where a displaced Syrian household currently lives. */
export type ShelterType =
  | 'RENTED_APARTMENT'
  | 'HOSTED_WITH_FAMILY'
  | 'COLLECTIVE_SHELTER'
  | 'TENT_OR_CAMP'
  | 'OTHER';

export const SHELTER_TYPES: readonly ShelterType[] = [
  'RENTED_APARTMENT',
  'HOSTED_WITH_FAMILY',
  'COLLECTIVE_SHELTER',
  'TENT_OR_CAMP',
  'OTHER',
];

// ───────────────────────── Intake payloads ────────────────────────

export interface CreateSyrianDisplacedPayload {
  fullName: string;
  phone: string;
  familyMembersCount: number;
  familyMembersNames: string;
  originalCity: string;
  /** UNHCR / government registration number — omitted when unregistered. */
  registrationNumber?: string;
  shelterType: ShelterType;
  urgentNeeds: UrgentNeed[];
  /** "YYYY-MM-DD" — date the household entered Lebanon. */
  entryDate: string;
}

export interface CreateLebaneseDisplacedPayload {
  fullName: string;
  phone: string;
  familyMembersCount: number;
  familyMembersNames: string;
  originVillage: string;
  isPropertyDamaged: boolean;
  primarySourceOfIncome?: string;
  urgentNeeds: UrgentNeed[];
  /** "YYYY-MM-DD" — date the household was displaced. */
  displacementDate: string;
}

// ──────────────────────── API response shapes ─────────────────────

interface DisplacedItemBase {
  id: string;
  fullName: string;
  phone: string;
  familyMembersCount: number;
  familyMembersNames: string;
  urgentNeeds: UrgentNeed[];
  /** Identity document (photo or PDF) proving who registered. */
  idDocumentUrl: string | null;
  status: DisplacedStatus;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

export interface SyrianDisplacedItem extends DisplacedItemBase {
  originalCity: string;
  registrationNumber: string | null;
  shelterType: ShelterType;
  /** ISO-8601 date the household entered Lebanon. */
  entryDate: string;
}

export interface LebaneseDisplacedItem extends DisplacedItemBase {
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
