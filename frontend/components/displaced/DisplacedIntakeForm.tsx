'use client';

import * as React from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HandCoins,
  HeartPulse,
  Loader2,
  Paperclip,
  Snowflake,
  Tent,
  Trash2,
  TriangleAlert,
  UtensilsCrossed,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { localizedErrorMessage } from '@/lib/api';
import { compressImage } from '@/lib/image-compression';
import { Dictionary, Locale, fill } from '@/lib/i18n/dictionaries';
import {
  useSubmitLebaneseDisplacedMutation,
  useSubmitSyrianDisplacedMutation,
} from '@/lib/queries';
import { toApiError } from '@/lib/query-client';
import {
  DisplacedAudience,
  LEBANESE_SHELTER_TYPES,
  LebaneseShelterType,
  MAX_ID_DOCUMENTS_PER_REGISTRATION,
  SHELTER_WITHOUT_CONTACT,
  ShelterType,
  SYRIAN_SHELTER_TYPES,
  SyrianShelterType,
  URGENT_NEEDS,
  UrgentNeed,
  VULNERABILITIES,
  Vulnerability,
} from '@/lib/schemas/displaced.schema';
import { cn } from '@/lib/utils';

const NEED_ICONS: Record<UrgentNeed, typeof UtensilsCrossed> = {
  FOOD: UtensilsCrossed,
  MEDICAL: HeartPulse,
  SHELTER: Tent,
  CASH: HandCoins,
  WINTERIZATION: Snowflake,
};

/**
 * Vercel serverless functions reject request bodies over ~4.5MB. Images
 * are compressed client-side to ~0.3MB; this guard catches the residual
 * case (a large PDF) with a clear message instead of an opaque 413.
 */
const SAFE_UPLOAD_BYTES = 4_200_000;

const ID_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

/**
 * The linear wizard sequence (mirrors the War Damage Reports wizard):
 * 0 identity & documents → 1 household → 2 housing & location → 3 needs.
 */
const TOTAL_STEPS = 4;

/** Lebanese numbers with or without +961, but any E.164-ish number passes. */
function isValidPhone(value: string): boolean {
  return /^\+?[0-9]{7,15}$/.test(value.replace(/[\s-]/g, ''));
}

function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, '');
}

type FieldError =
  | 'fullNameRequired'
  | 'invalidPhone'
  | 'invalidAlternatePhone'
  | 'familyMembersRequired'
  | 'familyMembersNamesRequired'
  | 'neighborhoodRequired'
  | 'buildingRequired'
  | 'shelterTypeRequired'
  | 'shelterContactNameRequired'
  | 'shelterContactPhoneRequired'
  | 'originRequired'
  | 'dateRequired'
  | 'needsRequired'
  | 'idRequired'
  | 'fileTooLarge';

interface FormState {
  fullName: string;
  phone: string;
  alternatePhone: string;
  familyMembersCount: string;
  familyMembersNames: string;
  neighborhoodName: string;
  buildingName: string;
  shelterType: ShelterType | '';
  /** Contact person for the shelter; required unless INFORMAL_SETTLEMENT. */
  shelterContactName: string;
  shelterContactPhone: string;
  origin: string;
  vulnerabilities: Vulnerability[];
  /** Syrian only: UNHCR / government registration number. */
  registrationNumber: string;
  /** Lebanese only. */
  isPropertyDamaged: boolean | null;
  /** Lebanese only. */
  income: string;
  needs: UrgentNeed[];
  /** "YYYY-MM-DD" from the native date input. */
  date: string;
  /** Identity document(s) (photos compressed client-side, or PDFs). */
  idDocuments: File[];
}

const INITIAL_STATE: FormState = {
  fullName: '',
  phone: '',
  alternatePhone: '',
  familyMembersCount: '',
  familyMembersNames: '',
  neighborhoodName: '',
  buildingName: '',
  shelterType: '',
  shelterContactName: '',
  shelterContactPhone: '',
  origin: '',
  vulnerabilities: [],
  registrationNumber: '',
  isPropertyDamaged: null,
  income: '',
  needs: [],
  date: '',
  idDocuments: [],
};

/**
 * Which fields each wizard step owns — pressing Next only validates the
 * current step, so earlier answers are retained and later steps stay
 * untouched until reached.
 */
const STEP_FIELDS: ReadonlyArray<ReadonlyArray<keyof FormState>> = [
  ['fullName', 'phone', 'alternatePhone', 'idDocuments'],
  ['familyMembersCount', 'familyMembersNames'],
  [
    'neighborhoodName',
    'buildingName',
    'shelterType',
    'shelterContactName',
    'shelterContactPhone',
    'origin',
    'date',
  ],
  ['needs'],
];

interface DisplacedIntakeFormProps {
  dict: Dictionary;
  locale: Locale;
  audience: DisplacedAudience;
}

/**
 * Step-by-step intake wizard for one displaced-persons programme,
 * width/typography/progress-matched to the War Damage Reports wizard.
 * The two audiences share the layout but never a payload: each submits
 * to its own endpoint with its own field set (including a different
 * shelter-type option list).
 */
export function DisplacedIntakeForm({
  dict,
  locale,
  audience,
}: DisplacedIntakeFormProps): React.JSX.Element {
  const t = dict.displaced;
  const tForm = t.form;
  // Audience-specific labels (title, origin field, date field).
  const tAudience = audience === 'syrian' ? t.syrian : t.lebanese;
  const shelterOptions: readonly (SyrianShelterType | LebaneseShelterType)[] =
    audience === 'syrian' ? SYRIAN_SHELTER_TYPES : LEBANESE_SHELTER_TYPES;

  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, FieldError>>>({});
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);
  const [showToast, setShowToast] = React.useState(false);
  const [compressing, setCompressing] = React.useState(false);
  const idInputRef = React.useRef<HTMLInputElement>(null);

  const submitSyrian = useSubmitSyrianDisplacedMutation();
  const submitLebanese = useSubmitLebaneseDisplacedMutation();
  const pending = submitSyrian.isPending || submitLebanese.isPending;

  // Success toast auto-dismisses; the success card stays until reset.
  React.useEffect(() => {
    if (!showToast) return;
    const handle = setTimeout(() => setShowToast(false), 4000);
    return () => clearTimeout(handle);
  }, [showToast]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setState((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) =>
      previous[key] ? { ...previous, [key]: undefined } : previous,
    );
  };

  const toggleNeed = (need: UrgentNeed): void => {
    set(
      'needs',
      state.needs.includes(need)
        ? state.needs.filter((item) => item !== need)
        : [...state.needs, need],
    );
  };

  const toggleVulnerability = (flag: Vulnerability): void => {
    set(
      'vulnerabilities',
      state.vulnerabilities.includes(flag)
        ? state.vulnerabilities.filter((item) => item !== flag)
        : [...state.vulnerabilities, flag],
    );
  };

  /** Images are shrunk in the browser; PDFs pass through with a size guard. */
  const handleIdDocumentsChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const selected = Array.from(event.target.files ?? []);
    // Allow re-selecting the same file(s) after a remove.
    event.target.value = '';
    if (selected.length === 0) return;

    setCompressing(true);
    try {
      const prepared = await Promise.all(selected.map((file) => compressImage(file)));
      if (prepared.some((file) => file.size > SAFE_UPLOAD_BYTES)) {
        setErrors((previous) => ({ ...previous, idDocuments: 'fileTooLarge' }));
        return;
      }
      setState((previous) => {
        const combined = [...previous.idDocuments, ...prepared].slice(
          0,
          MAX_ID_DOCUMENTS_PER_REGISTRATION,
        );
        return { ...previous, idDocuments: combined };
      });
      setErrors((previous) =>
        previous.idDocuments ? { ...previous, idDocuments: undefined } : previous,
      );
    } finally {
      setCompressing(false);
    }
  };

  const removeIdDocument = (index: number): void => {
    setState((previous) => ({
      ...previous,
      idDocuments: previous.idDocuments.filter((_, i) => i !== index),
    }));
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  // Every shelter type except an informal settlement collects a contact.
  const needsContact =
    state.shelterType !== '' && state.shelterType !== SHELTER_WITHOUT_CONTACT;

  /** Full-record rule evaluation (pure — the wizard filters per step). */
  const collectErrors = (): Partial<Record<keyof FormState, FieldError>> => {
    const next: Partial<Record<keyof FormState, FieldError>> = {};
    if (state.fullName.trim().length < 3) next.fullName = 'fullNameRequired';
    if (!isValidPhone(state.phone)) next.phone = 'invalidPhone';
    if (state.alternatePhone.trim() && !isValidPhone(state.alternatePhone)) {
      next.alternatePhone = 'invalidAlternatePhone';
    }
    const members = Number.parseInt(state.familyMembersCount, 10);
    if (!Number.isInteger(members) || members < 1 || members > 50) {
      next.familyMembersCount = 'familyMembersRequired';
    }
    if (state.familyMembersNames.trim().length < 3) {
      next.familyMembersNames = 'familyMembersNamesRequired';
    }
    if (state.neighborhoodName.trim().length < 2) next.neighborhoodName = 'neighborhoodRequired';
    if (state.buildingName.trim().length < 2) next.buildingName = 'buildingRequired';
    if (!state.shelterType) next.shelterType = 'shelterTypeRequired';
    if (needsContact) {
      if (state.shelterContactName.trim().length < 2) {
        next.shelterContactName = 'shelterContactNameRequired';
      }
      if (!isValidPhone(state.shelterContactPhone)) {
        next.shelterContactPhone = 'shelterContactPhoneRequired';
      }
    }
    if (state.origin.trim().length < 2) next.origin = 'originRequired';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(state.date) || state.date > todayIso) {
      next.date = 'dateRequired';
    }
    if (state.needs.length === 0) next.needs = 'needsRequired';
    if (state.idDocuments.length === 0) {
      next.idDocuments = 'idRequired';
    } else if (state.idDocuments.some((file) => file.size > SAFE_UPLOAD_BYTES)) {
      next.idDocuments = 'fileTooLarge';
    }
    return next;
  };

  /** Gate for Next: surfaces only the current step's problems. */
  const validateStep = (index: number): boolean => {
    const all = collectErrors();
    const scoped: Partial<Record<keyof FormState, FieldError>> = {};
    for (const key of STEP_FIELDS[index]) {
      if (all[key]) scoped[key] = all[key];
    }
    setErrors(scoped);
    return Object.keys(scoped).length === 0;
  };

  const goNext = (): void => {
    if (validateStep(step)) {
      setSubmitError(null);
      setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
    }
  };

  const goBack = (): void => {
    setErrors({});
    setSubmitError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  /** First wizard step that still carries one of these errors. */
  const firstStepWithError = (
    all: Partial<Record<keyof FormState, FieldError>>,
  ): number => {
    for (let index = 0; index < STEP_FIELDS.length; index += 1) {
      if (STEP_FIELDS[index].some((key) => all[key])) return index;
    }
    return TOTAL_STEPS - 1;
  };

  const handleSubmit = async (): Promise<void> => {
    setSubmitError(null);
    if (pending || compressing) return;

    // Final gate re-checks the whole record; if anything regressed,
    // jump back to the offending step with its inline errors shown.
    const all = collectErrors();
    if (Object.keys(all).length > 0) {
      setErrors(all);
      setStep(firstStepWithError(all));
      return;
    }

    const idDocuments = state.idDocuments;
    const shared = {
      fullName: state.fullName.trim(),
      phone: normalizePhone(state.phone),
      alternatePhone: state.alternatePhone.trim()
        ? normalizePhone(state.alternatePhone)
        : undefined,
      familyMembersCount: Number.parseInt(state.familyMembersCount, 10),
      familyMembersNames: state.familyMembersNames.trim(),
      neighborhoodName: state.neighborhoodName.trim(),
      buildingName: state.buildingName.trim(),
      shelterContactName: needsContact
        ? state.shelterContactName.trim()
        : undefined,
      shelterContactPhone: needsContact
        ? normalizePhone(state.shelterContactPhone)
        : undefined,
      urgentNeeds: state.needs,
      vulnerabilityStatus: state.vulnerabilities,
    };

    try {
      if (audience === 'syrian') {
        await submitSyrian.mutateAsync({
          payload: {
            ...shared,
            shelterType: state.shelterType as SyrianShelterType,
            originalCity: state.origin.trim(),
            registrationNumber: state.registrationNumber.trim() || undefined,
            entryDate: state.date,
          },
          idDocuments,
        });
      } else {
        await submitLebanese.mutateAsync({
          payload: {
            ...shared,
            shelterType: state.shelterType as LebaneseShelterType,
            originVillage: state.origin.trim(),
            isPropertyDamaged: state.isPropertyDamaged === true,
            primarySourceOfIncome: state.income.trim() || undefined,
            displacementDate: state.date,
          },
          idDocuments,
        });
      }
      // Clear everything immediately so "register another" starts fresh.
      setState(INITIAL_STATE);
      setErrors({});
      setStep(0);
      setSubmitted(true);
      setShowToast(true);
    } catch (error) {
      setSubmitError(localizedErrorMessage(toApiError(error), locale));
    }
  };

  const errorText = (key: keyof FormState): React.JSX.Element | null =>
    errors[key] ? (
      <p className="text-sm font-medium text-destructive">
        {tForm.errors[errors[key] as FieldError]}
      </p>
    ) : null;

  const toast = showToast ? (
    <div
      role="status"
      className="fixed inset-x-0 top-4 z-50 mx-auto flex w-fit items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg"
    >
      <CheckCircle2 className="h-4 w-4" />
      {tForm.successToast}
    </div>
  ) : null;

  if (submitted) {
    return (
      <>
        {toast}
        <Card className="mx-auto w-full max-w-xl text-center">
          <CardHeader>
            <CheckCircle2 className="mx-auto h-20 w-20 text-emerald-600" />
            <h2 className="text-3xl font-semibold">{tForm.successTitle}</h2>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-lg text-muted-foreground">{tForm.successBody}</p>
            <Button
              size="lg"
              className="w-full"
              onClick={() => setSubmitted(false)}
            >
              {tForm.registerAnother}
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      {toast}
      <Card className="mx-auto w-full max-w-xl">
        {/* Progress header — same mechanics as the War Damage wizard. */}
        <CardHeader className="space-y-3 p-4 md:p-6">
          <p className="text-sm font-medium text-muted-foreground">
            {fill(dict.wizard.stepOf, { current: step + 1, total: TOTAL_STEPS })}
          </p>
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: TOTAL_STEPS }, (_, index) => (
              <div
                key={index}
                className={cn(
                  'h-2 flex-1 rounded-full',
                  index <= step ? 'bg-primary' : 'bg-muted',
                )}
              />
            ))}
          </div>
        </CardHeader>

        <CardContent className="space-y-5 p-4 pt-0 md:space-y-6 md:p-6 md:pt-0">
          {/* Step 0 — identity & documents */}
          {step === 0 ? (
            <section className="space-y-5">
              <h2 className="text-xl font-bold md:text-2xl">
                {tForm.identitySection}
              </h2>
              <div className="space-y-2">
                <Label htmlFor="displaced-name">{tForm.fullNameLabel}</Label>
                <Input
                  id="displaced-name"
                  autoComplete="name"
                  value={state.fullName}
                  onChange={(e) => set('fullName', e.target.value)}
                />
                {errorText('fullName')}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="displaced-phone">{tForm.phoneLabel}</Label>
                  <Input
                    id="displaced-phone"
                    type="tel"
                    dir="ltr"
                    autoComplete="tel"
                    placeholder={tForm.phonePlaceholder}
                    value={state.phone}
                    onChange={(e) => set('phone', e.target.value)}
                  />
                  {errorText('phone')}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displaced-alt-phone">
                    {tForm.alternatePhoneLabel}{' '}
                    <span className="text-muted-foreground">
                      ({dict.common.optional})
                    </span>
                  </Label>
                  <Input
                    id="displaced-alt-phone"
                    type="tel"
                    dir="ltr"
                    autoComplete="tel"
                    placeholder={tForm.phonePlaceholder}
                    value={state.alternatePhone}
                    onChange={(e) => set('alternatePhone', e.target.value)}
                  />
                  {errorText('alternatePhone')}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="leading-snug">
                  {tForm.idLabel}{' '}
                  <span className="text-muted-foreground">({tForm.idHint})</span>
                </Label>
                <input
                  ref={idInputRef}
                  type="file"
                  accept={ID_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(event) => void handleIdDocumentsChange(event)}
                />
                {state.idDocuments.length > 0 ? (
                  <ul className="space-y-2">
                    {state.idDocuments.map((file, index) => (
                      <li
                        key={`${file.name}-${index}`}
                        className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 p-2 text-sm"
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <Paperclip className="h-4 w-4 shrink-0 text-emerald-600" />
                          <span className="truncate">{file.name}</span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={dict.wizard.photosRemove}
                          onClick={() => removeIdDocument(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {state.idDocuments.length < MAX_ID_DOCUMENTS_PER_REGISTRATION ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={compressing}
                    onClick={() => idInputRef.current?.click()}
                  >
                    {compressing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Paperclip className="h-4 w-4" />
                    )}
                    {dict.wizard.chooseFile}
                  </Button>
                ) : null}
                {errorText('idDocuments')}
              </div>
            </section>
          ) : null}

          {/* Step 1 — household */}
          {step === 1 ? (
            <section className="space-y-5">
              <h2 className="text-xl font-bold md:text-2xl">
                {tForm.householdSection}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="displaced-members">
                    {tForm.familyMembersLabel}
                  </Label>
                  <Input
                    id="displaced-members"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={50}
                    value={state.familyMembersCount}
                    onChange={(e) => set('familyMembersCount', e.target.value)}
                  />
                  {errorText('familyMembersCount')}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displaced-family-names">
                    {tForm.familyMembersNamesLabel}
                  </Label>
                  <Textarea
                    id="displaced-family-names"
                    placeholder={tForm.familyMembersNamesPlaceholder}
                    value={state.familyMembersNames}
                    onChange={(e) => set('familyMembersNames', e.target.value)}
                    className="min-h-[80px]"
                  />
                  {errorText('familyMembersNames')}
                </div>
              </div>
              {/* Vulnerability status (optional multi-select) */}
              <div className="space-y-2">
                <Label>
                  {tForm.vulnerabilityLabel}{' '}
                  <span className="text-muted-foreground">
                    ({dict.common.optional})
                  </span>
                </Label>
                <div className="flex flex-wrap gap-2">
                  {VULNERABILITIES.map((flag) => {
                    const selected = state.vulnerabilities.includes(flag);
                    return (
                      <button
                        key={flag}
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        onClick={() => toggleVulnerability(flag)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-all',
                          selected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input bg-background hover:border-primary/50 hover:bg-accent',
                        )}
                      >
                        {selected ? <Check className="h-3.5 w-3.5" /> : null}
                        {t.vulnerabilities[flag]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {/* Step 2 — housing & location */}
          {step === 2 ? (
            <section className="space-y-5">
              <h2 className="text-xl font-bold md:text-2xl">
                {tForm.locationSection}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="displaced-neighborhood">
                    {tForm.neighborhoodLabel}
                  </Label>
                  <Input
                    id="displaced-neighborhood"
                    placeholder={tForm.neighborhoodPlaceholder}
                    value={state.neighborhoodName}
                    onChange={(e) => set('neighborhoodName', e.target.value)}
                  />
                  {errorText('neighborhoodName')}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displaced-building">{tForm.buildingLabel}</Label>
                  <Input
                    id="displaced-building"
                    placeholder={tForm.buildingPlaceholder}
                    value={state.buildingName}
                    onChange={(e) => set('buildingName', e.target.value)}
                  />
                  {errorText('buildingName')}
                </div>
              </div>

              <div className="space-y-2">
                <Label>{tForm.shelterTypeLabel}</Label>
                <Select
                  value={state.shelterType}
                  onValueChange={(value) => set('shelterType', value as ShelterType)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={tForm.shelterTypePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {shelterOptions.map((shelter) => (
                      <SelectItem key={shelter} value={shelter}>
                        {t.shelterTypes[shelter]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errorText('shelterType')}
              </div>

              {/* Shelter contact — name + phone, for every type but informal settlement */}
              {needsContact && state.shelterType !== '' ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="displaced-contact-name">
                      {t.shelterContact[state.shelterType].nameLabel}
                    </Label>
                    <Input
                      id="displaced-contact-name"
                      value={state.shelterContactName}
                      onChange={(e) => set('shelterContactName', e.target.value)}
                    />
                    {errorText('shelterContactName')}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="displaced-contact-phone">
                      {t.shelterContact[state.shelterType].phoneLabel}
                    </Label>
                    <Input
                      id="displaced-contact-phone"
                      type="tel"
                      dir="ltr"
                      placeholder={tForm.phonePlaceholder}
                      value={state.shelterContactPhone}
                      onChange={(e) => set('shelterContactPhone', e.target.value)}
                    />
                    {errorText('shelterContactPhone')}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="displaced-origin">{tAudience.originLabel}</Label>
                <Input
                  id="displaced-origin"
                  placeholder={tAudience.originPlaceholder}
                  value={state.origin}
                  onChange={(e) => set('origin', e.target.value)}
                />
                {errorText('origin')}
              </div>

              {audience === 'syrian' ? (
                <div className="space-y-2">
                  <Label htmlFor="displaced-registration">
                    {tForm.registrationNumberLabel}{' '}
                    <span className="text-muted-foreground">
                      ({tForm.registrationNumberHint})
                    </span>
                  </Label>
                  <Input
                    id="displaced-registration"
                    dir="ltr"
                    value={state.registrationNumber}
                    onChange={(e) => set('registrationNumber', e.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>{tForm.propertyDamagedLabel}</Label>
                    <div className="grid grid-cols-2 gap-3">
                      {([true, false] as const).map((option) => (
                        <button
                          key={String(option)}
                          type="button"
                          aria-pressed={state.isPropertyDamaged === option}
                          onClick={() => set('isPropertyDamaged', option)}
                          className={cn(
                            'flex h-12 items-center justify-center rounded-lg border-2 text-sm font-semibold transition-all',
                            state.isPropertyDamaged === option
                              ? 'border-primary bg-primary/10 text-primary shadow-sm'
                              : 'border-input bg-background hover:border-primary/50 hover:bg-accent',
                          )}
                        >
                          {option ? dict.common.yes : dict.common.no}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="displaced-income">
                      {tForm.incomeLabel}{' '}
                      <span className="text-muted-foreground">
                        ({dict.common.optional})
                      </span>
                    </Label>
                    <Input
                      id="displaced-income"
                      placeholder={tForm.incomePlaceholder}
                      value={state.income}
                      onChange={(e) => set('income', e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="displaced-date">{tAudience.dateLabel}</Label>
                <DatePicker
                  id="displaced-date"
                  locale={locale}
                  max={todayIso}
                  value={state.date}
                  onChange={(value) => set('date', value)}
                  placeholder={tAudience.dateLabel}
                />
                {errorText('date')}
              </div>
            </section>
          ) : null}

          {/* Step 3 — urgent needs + submit */}
          {step === 3 ? (
            <section className="space-y-5">
              <h2 className="text-xl font-bold md:text-2xl">
                {tForm.needsSection}
              </h2>
              <p className="text-sm text-muted-foreground">{tForm.needsHint}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {URGENT_NEEDS.map((need) => {
                  const Icon = NEED_ICONS[need];
                  const selected = state.needs.includes(need);
                  return (
                    <button
                      key={need}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      onClick={() => toggleNeed(need)}
                      className={cn(
                        'relative flex h-20 flex-col items-center justify-center gap-1.5 rounded-xl border-2 text-sm font-semibold transition-all',
                        selected
                          ? 'border-primary bg-primary/10 text-primary shadow-md'
                          : 'border-input bg-background hover:border-primary/50 hover:bg-accent',
                      )}
                    >
                      {selected ? (
                        <span className="absolute end-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      ) : null}
                      <Icon className="h-6 w-6" />
                      {t.needs[need]}
                    </button>
                  );
                })}
              </div>
              {errorText('needs')}

              {submitError ? (
                <div className="flex items-start gap-3 rounded-lg bg-destructive/10 p-4 text-destructive">
                  <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-semibold">{tForm.errorTitle}</p>
                    <p className="text-sm">{submitError}</p>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {/* Navigation — mirrors the War Damage wizard footer. */}
          <div className="flex gap-3 pt-2">
            {step > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="flex-1"
                onClick={goBack}
                disabled={pending}
              >
                <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
                {dict.common.back}
              </Button>
            ) : null}
            {step < TOTAL_STEPS - 1 ? (
              <Button
                type="button"
                size="lg"
                className="flex-1"
                onClick={goNext}
                disabled={compressing}
              >
                {dict.common.next}
                <ChevronRight className="h-5 w-5 rtl:rotate-180" />
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                className="flex-1"
                onClick={() => void handleSubmit()}
                disabled={pending || compressing}
              >
                {pending ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" /> {tForm.submitting}
                  </>
                ) : (
                  tForm.submit
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
