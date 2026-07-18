'use client';

import * as React from 'react';
import {
  Check,
  CheckCircle2,
  HandCoins,
  HeartPulse,
  Loader2,
  Paperclip,
  Tent,
  Trash2,
  TriangleAlert,
  Users,
  UtensilsCrossed,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import {
  useSubmitLebaneseDisplacedMutation,
  useSubmitSyrianDisplacedMutation,
} from '@/lib/queries';
import { toApiError } from '@/lib/query-client';
import {
  DisplacedAudience,
  MAX_ID_DOCUMENTS_PER_REGISTRATION,
  SHELTER_TYPES,
  ShelterType,
  URGENT_NEEDS,
  UrgentNeed,
} from '@/lib/schemas/displaced.schema';
import { cn } from '@/lib/utils';

const NEED_ICONS: Record<UrgentNeed, typeof UtensilsCrossed> = {
  FOOD: UtensilsCrossed,
  MEDICAL: HeartPulse,
  SHELTER: Tent,
  CASH: HandCoins,
};

/**
 * Vercel serverless functions reject request bodies over ~4.5MB. Images
 * are compressed client-side to ~0.3MB; this guard catches the residual
 * case (a large PDF) with a clear message instead of an opaque 413.
 */
const SAFE_UPLOAD_BYTES = 4_200_000;

const ID_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

type FieldError =
  | 'fullNameRequired'
  | 'invalidPhone'
  | 'familyMembersRequired'
  | 'familyMembersNamesRequired'
  | 'originRequired'
  | 'shelterTypeRequired'
  | 'dateRequired'
  | 'idRequired'
  | 'fileTooLarge';

interface FormState {
  fullName: string;
  phone: string;
  familyMembersCount: string;
  familyMembersNames: string;
  origin: string;
  /** Syrian only: UNHCR / government registration number. */
  registrationNumber: string;
  /** Syrian only. */
  shelterType: ShelterType | '';
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
  familyMembersCount: '',
  familyMembersNames: '',
  origin: '',
  registrationNumber: '',
  shelterType: '',
  isPropertyDamaged: null,
  income: '',
  needs: [],
  date: '',
  idDocuments: [],
};

interface DisplacedIntakeFormProps {
  dict: Dictionary;
  locale: Locale;
  audience: DisplacedAudience;
}

/**
 * Single-page intake form for one displaced-persons programme. The two
 * audiences share the layout but never a payload: each submits to its
 * own endpoint with its own field set.
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

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, FieldError>> = {};
    if (state.fullName.trim().length < 3) next.fullName = 'fullNameRequired';
    if (!/^\+?[0-9]{7,15}$/.test(state.phone.replace(/[\s-]/g, ''))) {
      next.phone = 'invalidPhone';
    }
    const members = Number.parseInt(state.familyMembersCount, 10);
    if (!Number.isInteger(members) || members < 1 || members > 50) {
      next.familyMembersCount = 'familyMembersRequired';
    }
    if (state.familyMembersNames.trim().length < 3) {
      next.familyMembersNames = 'familyMembersNamesRequired';
    }
    if (state.origin.trim().length < 2) next.origin = 'originRequired';
    if (audience === 'syrian' && !state.shelterType) {
      next.shelterType = 'shelterTypeRequired';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(state.date) || state.date > todayIso) {
      next.date = 'dateRequired';
    }
    if (state.idDocuments.length === 0) {
      next.idDocuments = 'idRequired';
    } else if (state.idDocuments.some((file) => file.size > SAFE_UPLOAD_BYTES)) {
      next.idDocuments = 'fileTooLarge';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setSubmitError(null);
    if (!validate() || pending || compressing) return;
    const idDocuments = state.idDocuments;
    if (idDocuments.length === 0) return;

    const shared = {
      fullName: state.fullName.trim(),
      phone: state.phone.replace(/[\s-]/g, ''),
      familyMembersCount: Number.parseInt(state.familyMembersCount, 10),
      familyMembersNames: state.familyMembersNames.trim(),
      urgentNeeds: state.needs,
    };

    try {
      if (audience === 'syrian') {
        await submitSyrian.mutateAsync({
          payload: {
            ...shared,
            originalCity: state.origin.trim(),
            registrationNumber: state.registrationNumber.trim() || undefined,
            shelterType: state.shelterType as ShelterType,
            entryDate: state.date,
          },
          idDocuments,
        });
      } else {
        await submitLebanese.mutateAsync({
          payload: {
            ...shared,
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
      <Card className="mx-auto w-full max-w-2xl">
        <CardContent className="pt-6">
          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-8" noValidate>
            {/* ── Identity & contact ── */}
            <section className="space-y-4">
              <h2 className="border-b pb-2 text-lg font-semibold">
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

            {/* ── Household & location ── */}
            <section className="space-y-4">
              <h2 className="border-b pb-2 text-lg font-semibold">
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
                <>
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
                  <div className="space-y-2">
                    <Label>{tForm.shelterTypeLabel}</Label>
                    <Select
                      value={state.shelterType}
                      onValueChange={(value) =>
                        set('shelterType', value as ShelterType)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={tForm.shelterTypePlaceholder} />
                      </SelectTrigger>
                      <SelectContent>
                        {SHELTER_TYPES.map((shelter) => (
                          <SelectItem key={shelter} value={shelter}>
                            {t.shelterTypes[shelter]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {errorText('shelterType')}
                  </div>
                </>
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
                <Input
                  id="displaced-date"
                  type="date"
                  max={todayIso}
                  value={state.date}
                  onChange={(e) => set('date', e.target.value)}
                />
                {errorText('date')}
              </div>
            </section>

            {/* ── Urgent needs ── */}
            <section className="space-y-4">
              <h2 className="border-b pb-2 text-lg font-semibold">
                {tForm.needsSection}
              </h2>
              <p className="text-sm text-muted-foreground">{tForm.needsHint}</p>
              <div className="grid grid-cols-2 gap-3">
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
            </section>

            {submitError ? (
              <div className="flex items-start gap-3 rounded-lg bg-destructive/10 p-4 text-destructive">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold">{tForm.errorTitle}</p>
                  <p className="text-sm">{submitError}</p>
                </div>
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={pending || compressing}
            >
              {pending ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" /> {tForm.submitting}
                </>
              ) : (
                <>
                  <Users className="h-5 w-5" /> {tForm.submit}
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
