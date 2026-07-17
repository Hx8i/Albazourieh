'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  CreateStaffInput,
  ListAuditLogsParams,
  ListReportsParams,
  MultipartFilesInput,
  SpatialParams,
  createStaff,
  getReportById,
  getReportsSummary,
  getSpatialData,
  listAuditLogs,
  listDamageReports,
  listStaff,
  logExportEvent,
  removeStaff,
  staffLogin,
  submitDamageReportMultipart,
  updateReportStatus,
  validatePropertyNumber,
  adminEditReport,
  deleteReportAttachment,
  addReportAttachment,
} from './api';
import { unwrap } from './query-client';
import { MultipartPayload, ReportStatus, AdminEditPayload } from './schemas/damage-report.schema';

/**
 * Hierarchical query keys. Invalidating a parent key (e.g. `reports.all`)
 * also invalidates every child (`list`, `summary`, `spatial`, `detail`)
 * since TanStack Query matches by array prefix.
 */
export const queryKeys = {
  reports: {
    all: ['reports'] as const,
    list: (params: ListReportsParams) => ['reports', 'list', params] as const,
    summary: () => ['reports', 'summary'] as const,
    spatial: (params: SpatialParams) => ['reports', 'spatial', params] as const,
    detail: (id: string) => ['reports', 'detail', id] as const,
  },
  staff: {
    all: ['staff'] as const,
    list: () => ['staff', 'list'] as const,
  },
  audit: {
    all: ['audit'] as const,
    list: (params: ListAuditLogsParams) => ['audit', 'list', params] as const,
  },
  properties: {
    availability: (number: string) =>
      ['properties', 'availability', number] as const,
  },
} as const;

/** Aggregate counters change slowly — cached longer than the list views. */
const AGGREGATE_STALE_TIME_MS = 5 * 60 * 1000;

// ───────────────────────── Municipality: reports ──────────────────────

export function useReportsQuery(params: ListReportsParams) {
  return useQuery({
    queryKey: queryKeys.reports.list(params),
    queryFn: () => unwrap(listDamageReports(params)),
    placeholderData: keepPreviousData,
  });
}

export function useReportsSummaryQuery() {
  return useQuery({
    queryKey: queryKeys.reports.summary(),
    queryFn: () => unwrap(getReportsSummary()),
    staleTime: AGGREGATE_STALE_TIME_MS,
  });
}

export function useSpatialQuery(params: SpatialParams) {
  return useQuery({
    queryKey: queryKeys.reports.spatial(params),
    queryFn: () => unwrap(getSpatialData(params)),
    staleTime: AGGREGATE_STALE_TIME_MS,
    placeholderData: keepPreviousData,
  });
}

export function useReportQuery(id: string) {
  return useQuery({
    queryKey: queryKeys.reports.detail(id),
    queryFn: () => unwrap(getReportById(id)),
  });
}

/** Advances a report through the review lifecycle. */
export function useUpdateReportStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      rejectionReason,
      rejectedField,
    }: {
      id: string;
      status: ReportStatus;
      rejectionReason?: string;
      rejectedField?: string;
    }) => unwrap(updateReportStatus(id, status, rejectionReason, rejectedField)),
    onSuccess: (updated) => {
      // Seed the detail cache directly so the case file reflects the new
      // status instantly, then invalidate everything else that could be
      // showing this report (inbox list, counters, map).
      queryClient.setQueryData(queryKeys.reports.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    },
  });
}

/** Records a client-side CSV export in the audit trail (fire-and-forget). */
export function useLogExportMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rowCount: number) => unwrap(logExportEvent(rowCount)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });
}

// ───────────────────────── Municipality: staff ────────────────────────

export function useStaffQuery() {
  return useQuery({
    queryKey: queryKeys.staff.list(),
    queryFn: () => unwrap(listStaff()),
  });
}

export function useCreateStaffMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStaffInput) => unwrap(createStaff(input)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
    },
  });
}

export function useRemoveStaffMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(removeStaff(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.staff.all });
    },
  });
}

// ───────────────────────── Municipality: audit trail ──────────────────

export function useAuditLogsQuery(params: ListAuditLogsParams) {
  return useQuery({
    queryKey: queryKeys.audit.list(params),
    queryFn: () => unwrap(listAuditLogs(params)),
    placeholderData: keepPreviousData,
  });
}

// ───────────────────────── Staff authentication ───────────────────────

export function useStaffLoginMutation() {
  return useMutation({
    mutationFn: ({
      email,
      password,
      rememberMe,
    }: {
      email: string;
      password: string;
      rememberMe: boolean;
    }) => unwrap(staffLogin(email, password, rememberMe)),
  });
}

// ───────────────────────── Citizen wizard ──────────────────────────────

/**
 * onBlur uniqueness check — a plain mutation (not a cached query) since
 * it's an imperative one-shot check triggered by a blur event, not data
 * the UI subscribes to.
 */
export function useValidatePropertyNumberMutation() {
  return useMutation({
    mutationFn: (number: string) => unwrap(validatePropertyNumber(number)),
  });
}

export function useSubmitReportMutation() {
  return useMutation({
    mutationFn: ({
      payload,
      files,
    }: {
      payload: MultipartPayload;
      files: MultipartFilesInput;
    }) => unwrap(submitDamageReportMultipart(payload, files)),
  });
}

export function useAdminEditReportMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: AdminEditPayload;
    }) => unwrap(adminEditReport(id, payload)),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.reports.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });
}

export function useDeleteAttachmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      reportId,
      attachmentId,
    }: {
      reportId: string;
      attachmentId: string;
    }) => unwrap(deleteReportAttachment(reportId, attachmentId)),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.detail(variables.reportId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });
}

export function useAddAttachmentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      reportId,
      file,
      label,
    }: {
      reportId: string;
      file: File;
      label: string;
    }) => unwrap(addReportAttachment(reportId, file, label)),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(queryKeys.reports.detail(variables.reportId), updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all });
    },
  });
}


