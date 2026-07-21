/**
 * Framework-agnostic domain errors. Services throw these; the global
 * exception filter is the single place that maps them to HTTP responses,
 * keeping business logic decoupled from the transport layer.
 *
 * Every error carries a bilingual message pair — `message` (English) and
 * `messageAr` (Arabic) — so clients can show clean, user-friendly text in
 * the citizen's language without any client-side mapping tables.
 */

export type DomainErrorCode =
  | 'REPORT_NOT_FOUND'
  | 'REFERENCE_CODE_NOT_FOUND'
  | 'INVALID_STATUS_TRANSITION'
  | 'REJECTION_REASON_REQUIRED'
  | 'DUPLICATE_RESOURCE'
  | 'STORAGE_UNAVAILABLE'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_FILE'
  | 'PROPERTY_NUMBER_TAKEN'
  | 'MISSING_REQUIRED_FILE'
  | 'TOO_MANY_ID_DOCUMENTS'
  | 'DISPLACED_NOT_FOUND'
  | 'STAFF_NOT_FOUND'
  | 'STAFF_EMAIL_TAKEN'
  | 'PROTECTED_STAFF_ACCOUNT'
  | 'CONCURRENT_UPDATE';

/** Bilingual user-facing message pair. */
export interface LocalizedMessage {
  en: string;
  ar: string;
}

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
  /** Arabic counterpart of `message`. */
  readonly messageAr: string;

  protected constructor(localized: LocalizedMessage) {
    super(localized.en);
    this.messageAr = localized.ar;
    this.name = new.target.name;
  }
}

export class ReportNotFoundError extends DomainError {
  readonly code = 'REPORT_NOT_FOUND';

  constructor(reportId: string) {
    super({
      en: `Damage report "${reportId}" was not found`,
      ar: `لم يتم العثور على البلاغ "${reportId}"`,
    });
  }
}

export class ReferenceCodeNotFoundError extends DomainError {
  readonly code = 'REFERENCE_CODE_NOT_FOUND';

  constructor(referenceCode: string) {
    super({
      en: `No report matches the reference code "${referenceCode}"`,
      ar: `لا يوجد بلاغ يطابق الرمز المرجعي "${referenceCode}"`,
    });
  }
}

export class InvalidStatusTransitionError extends DomainError {
  readonly code = 'INVALID_STATUS_TRANSITION';

  constructor(from: string, to: string) {
    super({
      en: `Cannot move a report from status "${from}" to "${to}"`,
      ar: `لا يمكن نقل البلاغ من الحالة "${from}" إلى "${to}"`,
    });
  }
}

export class RejectionReasonRequiredError extends DomainError {
  readonly code = 'REJECTION_REASON_REQUIRED';

  constructor() {
    super({
      en: 'A rejection reason is required when rejecting a report',
      ar: 'يجب ذكر سبب الرفض عند رفض البلاغ',
    });
  }
}

export class StorageUnavailableError extends DomainError {
  readonly code = 'STORAGE_UNAVAILABLE';

  constructor() {
    super({
      en: 'File storage is not available right now. Please try again shortly.',
      ar: 'خدمة تخزين الملفات غير متاحة حالياً. يرجى المحاولة بعد قليل.',
    });
  }
}

export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super({
      en: 'Email or password is incorrect',
      ar: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    });
  }
}

export class InvalidFileError extends DomainError {
  readonly code = 'INVALID_FILE';

  constructor(reason: string) {
    super({
      en: `The uploaded file was rejected: ${reason}`,
      ar: `تم رفض الملف المرفوع: ${reason}`,
    });
  }
}

export class DuplicatePropertyNumberError extends DomainError {
  readonly code = 'PROPERTY_NUMBER_TAKEN';

  constructor(propertyNumber: string) {
    super({
      en: `Property number "${propertyNumber}" has already been submitted and is under evaluation`,
      ar: `رقم العقار "${propertyNumber}" تم تقديمه مسبقاً وهو قيد التقييم`,
    });
  }
}

export class MissingRequiredFileError extends DomainError {
  readonly code = 'MISSING_REQUIRED_FILE';

  constructor(field: string) {
    super({
      en: `The required file "${field}" is missing from the submission`,
      ar: `المستند المطلوب "${field}" غير مرفق بالطلب`,
    });
  }
}

export class TooManyIdDocumentsError extends DomainError {
  readonly code = 'TOO_MANY_ID_DOCUMENTS';

  constructor(limit: number) {
    super({
      en: `A registration can carry at most ${limit} identity documents`,
      ar: `لا يمكن أن يحمل التسجيل أكثر من ${limit} مستندات هوية`,
    });
  }
}

export class DisplacedRegistrationNotFoundError extends DomainError {
  readonly code = 'DISPLACED_NOT_FOUND';

  constructor(id: string) {
    super({
      en: `Displaced registration "${id}" was not found`,
      ar: `لم يتم العثور على التسجيل "${id}"`,
    });
  }
}

/**
 * Raised when a read-modify-write on a shared row (e.g. the id-document
 * list) loses a race against another concurrent update after every
 * retry — the caller should refetch and try again.
 */
export class ConcurrentUpdateError extends DomainError {
  readonly code = 'CONCURRENT_UPDATE';

  constructor() {
    super({
      en: 'This record was updated by someone else at the same time. Please try again.',
      ar: 'تم تعديل هذا السجل من قبل شخص آخر في نفس الوقت. يرجى المحاولة مرة أخرى.',
    });
  }
}

export class StaffNotFoundError extends DomainError {
  readonly code = 'STAFF_NOT_FOUND';

  constructor(staffId: string) {
    super({
      en: `Staff account "${staffId}" was not found`,
      ar: `لم يتم العثور على حساب الموظف "${staffId}"`,
    });
  }
}

export class StaffEmailTakenError extends DomainError {
  readonly code = 'STAFF_EMAIL_TAKEN';

  constructor(email: string) {
    super({
      en: `A staff account with the email "${email}" already exists`,
      ar: `يوجد حساب موظف مسجل مسبقاً بالبريد "${email}"`,
    });
  }
}

/**
 * Blocks self-removal (locking yourself out mid-session) and removal of
 * the last active SUPER_ADMIN (leaving the platform with no owner).
 */
export class ProtectedStaffAccountError extends DomainError {
  readonly code = 'PROTECTED_STAFF_ACCOUNT';

  constructor(localized: LocalizedMessage) {
    super(localized);
  }
}
