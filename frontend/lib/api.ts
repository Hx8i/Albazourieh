import { StaffSession, clearStaffSession, getStaffSession } from './auth';
import {
  DamageSeverity,
  MultipartPayload,
  PaginatedReports,
  PublicReportStatus,
  ReportListItem,
  ReportStatus,
  SpatialPoint,
  StatusSummary,
  AdminEditPayload,
} from './schemas/damage-report.schema';
import {
  CreateLebaneseDisplacedPayload,
  CreateSyrianDisplacedPayload,
  DisplacedAudience,
  DisplacedStatus,
  DisplacedSummary,
  LebaneseDisplacedItem,
  PaginatedDisplaced,
  SyrianDisplacedItem,
} from './schemas/displaced.schema';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ApiError {
  status: number;
  code: string;
  message: string;
  /** Arabic counterpart of `message`, when the backend provides one. */
  messageAr?: string;
  issues?: Array<{ path: string; message: string }>;
}

/** Picks the user's language from a bilingual API error. */
export function localizedErrorMessage(
  error: ApiError,
  locale: 'ar' | 'en',
): string {
  return locale === 'ar' && error.messageAr ? error.messageAr : error.message;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

async function request<T>(
  path: string,
  init?: RequestInit,
  options?: { staffAuth?: boolean },
): Promise<ApiResult<T>> {
  try {
    const isFormData = init?.body instanceof FormData;
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (!isFormData) headers['Content-Type'] = 'application/json';
    if (options?.staffAuth) {
      const session = getStaffSession();
      if (session) headers['Authorization'] = `Bearer ${session.accessToken}`;
    }

    const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
    const raw: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      // An expired/invalid staff token anywhere logs the session out.
      if (response.status === 401 && options?.staffAuth) {
        clearStaffSession();
      }
      const body = (raw ?? {}) as Partial<{
        error: string;
        message: string;
        messageAr: string;
        issues: Array<{ path: string; message: string }>;
      }>;
      return {
        ok: false,
        error: {
          status: response.status,
          code: body.error ?? 'UNKNOWN_ERROR',
          message: body.message ?? 'The request failed',
          messageAr: body.messageAr,
          issues: body.issues,
        },
      };
    }

    return { ok: true, data: raw as T };
  } catch (cause: unknown) {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'NETWORK_ERROR',
        message:
          cause instanceof Error ? cause.message : 'Could not reach the server',
      },
    };
  }
}

// ─────────────────────────── Citizen endpoints ───────────────────────

/** Raw files travelling alongside the multipart payload. */
export interface MultipartFilesInput {
  damagePhotos?: File[];
  nationalId?: File | null;
  propertyDeed?: File | null;
  rentalContract?: File | null;
  vehicleRegistration?: File | null;
  residencyProof?: File | null;
}

/**
 * Single-request submission: the JSON payload plus every raw file
 * (photos and documents) go up together in one FormData body, parsed
 * server-side by FileFieldsInterceptor and streamed to storage.
 */
export function submitDamageReportMultipart(
  payload: MultipartPayload,
  files: MultipartFilesInput,
): Promise<ApiResult<ReportListItem>> {
  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));

  for (const photo of files.damagePhotos ?? []) {
    formData.append('damagePhotos', photo, photo.name);
  }
  if (files.nationalId) {
    formData.append('nationalId', files.nationalId, files.nationalId.name);
  }
  if (files.propertyDeed) {
    formData.append('propertyDeed', files.propertyDeed, files.propertyDeed.name);
  }
  if (files.rentalContract) {
    formData.append('rentalContract', files.rentalContract, files.rentalContract.name);
  }
  if (files.vehicleRegistration) {
    formData.append(
      'vehicleRegistration',
      files.vehicleRegistration,
      files.vehicleRegistration.name,
    );
  }
  if (files.residencyProof) {
    formData.append('residencyProof', files.residencyProof, files.residencyProof.name);
  }

  return request<ReportListItem>('/damage-reports/multipart', {
    method: 'POST',
    body: formData,
  });
}

/** onBlur uniqueness check: is this official property number still available? */
export function validatePropertyNumber(
  number: string,
): Promise<ApiResult<{ available: boolean }>> {
  const search = new URLSearchParams({ number });
  return request<{ available: boolean }>(
    `/properties/validate-number?${search.toString()}`,
  );
}

/**
 * Public, unauthenticated status lookup for the citizen tracking page.
 * The code is normalised (trim + uppercase) before it hits the API, which
 * returns only status/category/timestamp — never any personal data.
 */
export function getPublicReportStatus(
  referenceCode: string,
): Promise<ApiResult<PublicReportStatus>> {
  const code = encodeURIComponent(referenceCode.trim().toUpperCase());
  return request<PublicReportStatus>(`/damage-reports/status/${code}`);
}

// ────────────────────────── Staff authentication ─────────────────────

export function staffLogin(
  email: string,
  password: string,
  rememberMe: boolean,
): Promise<ApiResult<StaffSession>> {
  return request<StaffSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, rememberMe }),
  });
}

// ───────────────────────── Municipality endpoints ────────────────────

export type ReportSortField =
  | 'createdAt'
  | 'referenceCode'
  | 'reporterName'
  | 'neighborhood'
  | 'severity'
  | 'status';
export type SortDirection = 'asc' | 'desc';

export interface ListReportsParams {
  status?: ReportStatus;
  severity?: DamageSeverity;
  neighborhood?: string;
  /** Global search: name, phone, property number or reference code. */
  search?: string;
  sortBy?: ReportSortField;
  sortDir?: SortDirection;
  page?: number;
  pageSize?: number;
}

export function listDamageReports(
  params: ListReportsParams = {},
): Promise<ApiResult<PaginatedReports>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.severity) search.set('severity', params.severity);
  if (params.neighborhood) search.set('neighborhood', params.neighborhood);
  if (params.search) search.set('search', params.search);
  if (params.sortBy) search.set('sortBy', params.sortBy);
  if (params.sortDir) search.set('sortDir', params.sortDir);
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const query = search.toString();
  return request<PaginatedReports>(
    `/damage-reports${query ? `?${query}` : ''}`,
    undefined,
    { staffAuth: true },
  );
}

export function getReportsSummary(): Promise<ApiResult<StatusSummary>> {
  return request<StatusSummary>('/damage-reports/summary', undefined, {
    staffAuth: true,
  });
}

export interface SpatialParams {
  status?: ReportStatus;
  severity?: DamageSeverity;
  neighborhood?: string;
}

export function getSpatialData(
  params: SpatialParams = {},
): Promise<ApiResult<SpatialPoint[]>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.severity) search.set('severity', params.severity);
  if (params.neighborhood) search.set('neighborhood', params.neighborhood);
  const query = search.toString();
  return request<SpatialPoint[]>(
    `/damage-reports/spatial${query ? `?${query}` : ''}`,
    undefined,
    { staffAuth: true },
  );
}

export function getReportById(
  id: string,
): Promise<ApiResult<ReportListItem>> {
  return request<ReportListItem>(`/damage-reports/${id}`, undefined, {
    staffAuth: true,
  });
}

export function updateReportStatus(
  id: string,
  status: ReportStatus,
  rejectionReason?: string,
  rejectedField?: string,
): Promise<ApiResult<ReportListItem>> {
  return request<ReportListItem>(
    `/damage-reports/${id}/status`,
    { method: 'PATCH', body: JSON.stringify({ status, rejectionReason, rejectedField }) },
    { staffAuth: true },
  );
}

// ─────────────── Displaced persons (Syrian / Lebanese) ────────────────

/** JSON payload + the registrant's identity document(s) in one FormData body. */
function displacedFormData(payload: unknown, idDocuments: File[]): FormData {
  const formData = new FormData();
  formData.append('payload', JSON.stringify(payload));
  for (const file of idDocuments) {
    formData.append('idDocument', file, file.name);
  }
  return formData;
}

/** Public intake: register a Syrian displaced household. */
export function submitSyrianDisplaced(
  payload: CreateSyrianDisplacedPayload,
  idDocuments: File[],
): Promise<ApiResult<SyrianDisplacedItem>> {
  return request<SyrianDisplacedItem>('/displaced/syrian', {
    method: 'POST',
    body: displacedFormData(payload, idDocuments),
  });
}

/** Public intake: register a Lebanese displaced household. */
export function submitLebaneseDisplaced(
  payload: CreateLebaneseDisplacedPayload,
  idDocuments: File[],
): Promise<ApiResult<LebaneseDisplacedItem>> {
  return request<LebaneseDisplacedItem>('/displaced/lebanese', {
    method: 'POST',
    body: displacedFormData(payload, idDocuments),
  });
}

export type DisplacedSortField =
  | 'createdAt'
  | 'fullName'
  | 'familyMembersCount'
  | 'status';

export interface ListDisplacedParams {
  status?: DisplacedStatus;
  /** Single-input search: registrant name or phone number. */
  search?: string;
  sortBy?: DisplacedSortField;
  sortDir?: SortDirection;
  page?: number;
  pageSize?: number;
}

function displacedListQuery(params: ListDisplacedParams): string {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.search) search.set('search', params.search);
  if (params.sortBy) search.set('sortBy', params.sortBy);
  if (params.sortDir) search.set('sortDir', params.sortDir);
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function listSyrianDisplaced(
  params: ListDisplacedParams = {},
): Promise<ApiResult<PaginatedDisplaced<SyrianDisplacedItem>>> {
  return request<PaginatedDisplaced<SyrianDisplacedItem>>(
    `/displaced/syrian${displacedListQuery(params)}`,
    undefined,
    { staffAuth: true },
  );
}

export function listLebaneseDisplaced(
  params: ListDisplacedParams = {},
): Promise<ApiResult<PaginatedDisplaced<LebaneseDisplacedItem>>> {
  return request<PaginatedDisplaced<LebaneseDisplacedItem>>(
    `/displaced/lebanese${displacedListQuery(params)}`,
    undefined,
    { staffAuth: true },
  );
}

/** Metric cards + chart aggregates for one audience's dashboard. */
export function getDisplacedSummary(
  audience: DisplacedAudience,
): Promise<ApiResult<DisplacedSummary>> {
  return request<DisplacedSummary>(`/displaced/${audience}/summary`, undefined, {
    staffAuth: true,
  });
}

/** Staff triage: move a registration between PENDING/APPROVED/REJECTED. */
export function updateDisplacedStatus(
  audience: DisplacedAudience,
  id: string,
  status: DisplacedStatus,
): Promise<ApiResult<SyrianDisplacedItem | LebaneseDisplacedItem>> {
  return request<SyrianDisplacedItem | LebaneseDisplacedItem>(
    `/displaced/${audience}/${id}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
    { staffAuth: true },
  );
}

/** Update a displaced registration (Syrian). */
export function updateSyrianDisplaced(
  id: string,
  payload: Partial<CreateSyrianDisplacedPayload> & { status?: DisplacedStatus },
): Promise<ApiResult<SyrianDisplacedItem>> {
  return request<SyrianDisplacedItem>(
    `/displaced/syrian/${id}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    { staffAuth: true },
  );
}

/** Update a displaced registration (Lebanese). */
export function updateLebaneseDisplaced(
  id: string,
  payload: Partial<CreateLebaneseDisplacedPayload> & { status?: DisplacedStatus },
): Promise<ApiResult<LebaneseDisplacedItem>> {
  return request<LebaneseDisplacedItem>(
    `/displaced/lebanese/${id}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    { staffAuth: true },
  );
}

/** Append one or more ID documents to a displaced registration. */
export function uploadDisplacedIdDocuments(
  audience: DisplacedAudience,
  id: string,
  files: File[],
): Promise<ApiResult<{ idDocumentUrls: string[] }>> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('idDocument', file, file.name);
  }

  return request<{ idDocumentUrls: string[] }>(
    `/displaced/${audience}/${id}/id-document`,
    {
      method: 'POST',
      body: formData,
    },
    { staffAuth: true },
  );
}

/** One registration for the staff detail page. */
export function getDisplacedById(
  audience: DisplacedAudience,
  id: string,
): Promise<ApiResult<SyrianDisplacedItem | LebaneseDisplacedItem>> {
  return request<SyrianDisplacedItem | LebaneseDisplacedItem>(
    `/displaced/${audience}/${id}`,
    undefined,
    { staffAuth: true },
  );
}

/** Trail entry: a staff member opened a registration's detail view. 204 → no body. */
export function logDisplacedRecordView(
  audience: DisplacedAudience,
  id: string,
): Promise<ApiResult<null>> {
  return request<null>(
    `/displaced/${audience}/${id}/view`,
    { method: 'POST' },
    { staffAuth: true },
  );
}

/** Remove exactly one ID document (by URL) from a displaced registration. */
export function deleteDisplacedIdDocument(
  audience: DisplacedAudience,
  id: string,
  url: string,
): Promise<ApiResult<{ idDocumentUrls: string[] }>> {
  const search = new URLSearchParams({ url });
  return request<{ idDocumentUrls: string[] }>(
    `/displaced/${audience}/${id}/id-document?${search.toString()}`,
    { method: 'DELETE' },
    { staffAuth: true },
  );
}

// ─────────────────── Staff administration (SUPER_ADMIN) ───────────────

export type StaffRole = 'SUPER_ADMIN' | 'STAFF_MEMBER';

export interface StaffAccount {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
  municipalityName: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateStaffInput {
  fullName: string;
  email: string;
  password: string;
  role: StaffRole;
}

export function listStaff(): Promise<ApiResult<StaffAccount[]>> {
  return request<StaffAccount[]>('/admin/staff', undefined, {
    staffAuth: true,
  });
}

export function createStaff(
  input: CreateStaffInput,
): Promise<ApiResult<StaffAccount>> {
  return request<StaffAccount>(
    '/admin/staff',
    { method: 'POST', body: JSON.stringify(input) },
    { staffAuth: true },
  );
}

/** Revoke (instantly disable) a staff account. 204 → no JSON body. */
export function removeStaff(id: string): Promise<ApiResult<null>> {
  return request<null>(
    `/admin/staff/${id}`,
    { method: 'DELETE' },
    { staffAuth: true },
  );
}

// ──────────────── Audit trail — "تتبع العمليات" (SUPER_ADMIN) ─────────

export type AuditActionType =
  | 'CREATE_STAFF'
  | 'DELETE_STAFF'
  | 'UPDATE_REPORT_STATUS'
  | 'UPDATE_DISPLACED_STATUS'
  | 'UPDATE_DISPLACED_REGISTRATION'
  | 'VIEW_DISPLACED_RECORD'
  | 'EDIT_REPORT_DATA'
  | 'EXPORT_DATA';

export interface AuditLogItem {
  id: string;
  adminId: string;
  adminName: string;
  actionType: AuditActionType;
  targetId: string;
  details: string;
  detailsAr: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface PaginatedAuditLogs {
  items: AuditLogItem[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

export type AuditSortField = 'createdAt' | 'adminName' | 'actionType';

export interface ListAuditLogsParams {
  page: number;
  pageSize?: number;
  search?: string;
  sortBy?: AuditSortField;
  sortDir?: SortDirection;
}

export function listAuditLogs(
  params: ListAuditLogsParams,
): Promise<ApiResult<PaginatedAuditLogs>> {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize ?? 20),
  });
  if (params.search) search.set('search', params.search);
  if (params.sortBy) search.set('sortBy', params.sortBy);
  if (params.sortDir) search.set('sortDir', params.sortDir);
  return request<PaginatedAuditLogs>(
    `/admin/audit-logs?${search.toString()}`,
    undefined,
    { staffAuth: true },
  );
}

/** Records a client-side CSV export in the audit trail (fire-and-forget). */
export function logExportEvent(rowCount: number): Promise<ApiResult<null>> {
  return request<null>(
    '/admin/audit-logs/export-event',
    { method: 'POST', body: JSON.stringify({ rowCount }) },
    { staffAuth: true },
  );
}

/** Admin edit: update report data fields. */
export function adminEditReport(
  id: string,
  payload: AdminEditPayload,
): Promise<ApiResult<ReportListItem>> {
  return request<ReportListItem>(
    `/damage-reports/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
    { staffAuth: true },
  );
}

/** Admin edit: delete a specific attachment. */
export function deleteReportAttachment(
  reportId: string,
  attachmentId: string,
): Promise<ApiResult<null>> {
  return request<null>(
    `/damage-reports/${reportId}/attachments/${attachmentId}`,
    {
      method: 'DELETE',
    },
    { staffAuth: true },
  );
}

/** Admin edit: add a specific attachment. */
export function addReportAttachment(
  reportId: string,
  file: File,
  label: string,
): Promise<ApiResult<ReportListItem>> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('label', label);

  return request<ReportListItem>(
    `/damage-reports/${reportId}/attachments`,
    {
      method: 'POST',
      body: formData,
    },
    { staffAuth: true },
  );
}


