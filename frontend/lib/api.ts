import { StaffSession, clearStaffSession, getStaffSession } from './auth';
import {
  CreateDamageReportInput,
  DamageSeverity,
  MultipartPayload,
  PaginatedReports,
  ReportListItem,
  ReportStatus,
  SpatialPoint,
  StatusSummary,
} from './schemas/damage-report.schema';

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

export function createDamageReport(
  input: CreateDamageReportInput,
): Promise<ApiResult<ReportListItem>> {
  return request<ReportListItem>('/damage-reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type UploadKind = 'photo' | 'voice';

export interface UploadedEvidence {
  url: string;
}

/**
 * Uploads one photo or voice note through the backend, which validates
 * size + real file content before forwarding to Supabase Storage. The
 * returned URL is referenced in the report submission payload.
 */
export function uploadEvidenceFile(
  kind: UploadKind,
  file: Blob,
  fileName: string,
): Promise<ApiResult<UploadedEvidence>> {
  const formData = new FormData();
  formData.append('file', file, fileName);
  return request<UploadedEvidence>(`/uploads/${kind}`, {
    method: 'POST',
    body: formData,
  });
}

/** Raw files travelling alongside the multipart payload. */
export interface MultipartFilesInput {
  damagePhotos?: File[];
  vehiclePhotos?: File[];
  voiceNote?: Blob | null;
  nationalId?: File | null;
  proxyNationalId?: File | null;
  propertyDeed?: File | null;
  rentalContract?: File | null;
  vehicleRegistration?: File | null;
  residencyProof?: File | null;
}

/**
 * Single-request submission: the JSON payload plus every raw file
 * (photos, voice note, documents) go up together in one FormData body,
 * parsed server-side by FileFieldsInterceptor and streamed to storage.
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
  for (const photo of files.vehiclePhotos ?? []) {
    formData.append('vehiclePhotos', photo, photo.name);
  }
  if (files.voiceNote) {
    formData.append('voiceNote', files.voiceNote, 'voice-note.webm');
  }
  if (files.nationalId) {
    formData.append('nationalId', files.nationalId, files.nationalId.name);
  }
  if (files.proxyNationalId) {
    formData.append(
      'proxyNationalId',
      files.proxyNationalId,
      files.proxyNationalId.name,
    );
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

// ────────────────────────── Staff authentication ─────────────────────

export function staffLogin(
  email: string,
  password: string,
): Promise<ApiResult<StaffSession>> {
  return request<StaffSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// ───────────────────────── Municipality endpoints ────────────────────

export interface ListReportsParams {
  status?: ReportStatus;
  severity?: DamageSeverity;
  neighborhood?: string;
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
): Promise<ApiResult<ReportListItem>> {
  return request<ReportListItem>(
    `/damage-reports/${id}/status`,
    { method: 'PATCH', body: JSON.stringify({ status, rejectionReason }) },
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
  | 'EXPORT_DATA';

export interface AuditLogItem {
  id: string;
  adminId: string;
  adminName: string;
  actionType: AuditActionType;
  targetId: string;
  details: string;
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

export function listAuditLogs(
  page: number,
  pageSize = 20,
): Promise<ApiResult<PaginatedAuditLogs>> {
  const search = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
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
