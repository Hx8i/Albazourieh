'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import {
  Building2,
  Camera,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Flame,
  HeartHandshake,
  Home,
  Loader2,
  MapPin,
  Mic,
  Paperclip,
  Square,
  Store,
  Trash2,
  TriangleAlert,
  UserRound,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  localizedErrorMessage,
  submitDamageReportMultipart,
  validatePropertyNumber,
} from '@/lib/api';
import { Dictionary, Locale, fill } from '@/lib/i18n/dictionaries';
import {
  DamageSeverity,
  MultipartPayload,
  OwnershipStatus,
  ProxyDetails,
  ProxyRelationship,
  ReportCategory,
  VehicleKind,
} from '@/lib/schemas/damage-report.schema';
import { cn } from '@/lib/utils';

/**
 * MapLibre touches browser APIs, so the pin-drop picker is loaded
 * client-side only — and lazily, keeping the wizard's initial bundle
 * light for citizens on slow connections.
 */
const LocationPickerMap = dynamic(
  () =>
    import('@/components/map/LocationPickerMap').then(
      (module) => module.LocationPickerMap,
    ),
  { ssr: false },
);

const TOTAL_STEPS = 6;
const MAX_RECORDING_SECONDS = 45;
const MAX_DAMAGE_PHOTOS = 10;

const VEHICLE_KINDS: readonly VehicleKind[] = [
  'CAR',
  'TRUCK',
  'TRACTOR',
  'BUS',
  'VAN',
  'OTHER',
];

const PROXY_RELATIONSHIPS: readonly ProxyRelationship[] = [
  'SON_DAUGHTER',
  'RELATIVE',
  'NEIGHBOR',
  'LEGAL_REPRESENTATIVE',
  'OTHER',
];

type WizardErrorKey = keyof Dictionary['wizard']['errors'];

type LocationStatus = 'idle' | 'loading' | 'success' | 'error' | 'unsupported';
type RecordingStatus = 'idle' | 'recording' | 'recorded' | 'denied' | 'unsupported';
type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';
type NumberCheckStatus = 'idle' | 'checking' | 'available' | 'taken';

interface WizardState {
  submittedByProxy: boolean;
  proxyFirstName: string;
  proxyMiddleName: string;
  proxyLastName: string;
  proxyPhoneNumber: string;
  proxyRelationship: ProxyRelationship | null;
  proxyCustomRelationship: string;
  category: ReportCategory | null;
  severity: DamageSeverity | null;
  description: string;
  street: string;
  projectName: string;
  floor: string;
  additionalDirections: string;
  district: string;
  latitude: number | null;
  longitude: number | null;
  firstName: string;
  middleName: string;
  lastName: string;
  phoneNumber: string;
  ownership: OwnershipStatus | null;
  ownerPhoneNumber: string;
  vehicleType: VehicleKind | null;
  customVehicleType: string;
  propertyNumber: string;
}

const INITIAL_STATE: WizardState = {
  submittedByProxy: false,
  proxyFirstName: '',
  proxyMiddleName: '',
  proxyLastName: '',
  proxyPhoneNumber: '',
  proxyRelationship: null,
  proxyCustomRelationship: '',
  category: null,
  severity: null,
  description: '',
  street: '',
  projectName: '',
  floor: '',
  additionalDirections: '',
  district: '',
  latitude: null,
  longitude: null,
  firstName: '',
  middleName: '',
  lastName: '',
  phoneNumber: '',
  ownership: null,
  ownerPhoneNumber: '',
  vehicleType: null,
  customVehicleType: '',
  propertyNumber: '',
};

interface DocumentFiles {
  nationalId: File | null;
  proxyNationalId: File | null;
  residencyProof: File | null;
  propertyDeed: File | null;
  rentalContract: File | null;
  vehicleRegistration: File | null;
}

const INITIAL_DOCUMENTS: DocumentFiles = {
  nationalId: null,
  proxyNationalId: null,
  residencyProof: null,
  propertyDeed: null,
  rentalContract: null,
  vehicleRegistration: null,
};

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

interface CitizenWizardFormProps {
  dict: Dictionary;
  locale: Locale;
}

/** Clean red asterisk marking a strictly mandatory field. */
function Req(): React.JSX.Element {
  return (
    <span className="text-destructive" aria-hidden>
      {' '}
      *
    </span>
  );
}

export function CitizenWizardForm({
  dict,
  locale,
}: CitizenWizardFormProps): React.JSX.Element {
  const t = dict.wizard;
  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState<WizardState>(INITIAL_STATE);
  const [stepError, setStepError] = React.useState<string | null>(null);

  // Voice recording (45s hard cap with a visible countdown) — optional.
  const [recording, setRecording] = React.useState<RecordingStatus>('idle');
  const [voiceUrl, setVoiceUrl] = React.useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = React.useState(MAX_RECORDING_SECONDS);
  const voiceBlobRef = React.useRef<Blob | null>(null);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const countdownRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Location — dual mode: automatic GPS or manual pin drop on a map.
  const [locationStatus, setLocationStatus] =
    React.useState<LocationStatus>('idle');
  const [showMapPicker, setShowMapPicker] = React.useState(false);
  const [mapPicked, setMapPicked] = React.useState(false);

  // Damage photos (≥1 mandatory) + vehicle photos + documents.
  const [photos, setPhotos] = React.useState<File[]>([]);
  const [vehiclePhotos, setVehiclePhotos] = React.useState<File[]>([]);
  const [documents, setDocuments] = React.useState<DocumentFiles>(INITIAL_DOCUMENTS);
  const photoInputRef = React.useRef<HTMLInputElement | null>(null);
  const vehiclePhotoInputRef = React.useRef<HTMLInputElement | null>(null);

  // Vehicle-type searchable combobox.
  const [vehicleQuery, setVehicleQuery] = React.useState('');
  const [vehicleOpen, setVehicleOpen] = React.useState(false);

  // Property-number availability (checked on blur, blocks submission).
  const [numberStatus, setNumberStatus] =
    React.useState<NumberCheckStatus>('idle');

  // Submission.
  const [submitStatus, setSubmitStatus] = React.useState<SubmitStatus>('idle');
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [referenceId, setReferenceId] = React.useState<string | null>(null);

  const isVehicle = state.category === 'VEHICLE';

  const patch = (partial: Partial<WizardState>): void => {
    setState((previous) => ({ ...previous, ...partial }));
    setStepError(null);
  };

  const setDocument = (key: keyof DocumentFiles, file: File | null): void => {
    setDocuments((previous) => ({ ...previous, [key]: file }));
    setStepError(null);
  };

  const errorText = (key: WizardErrorKey): string => t.errors[key];

  // ───────────────────────── Voice recording ─────────────────────────

  const clearCountdown = (): void => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  const stopRecording = React.useCallback((): void => {
    clearCountdown();
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  const startRecording = async (): Promise<void> => {
    if (
      typeof MediaRecorder === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setRecording('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        voiceBlobRef.current = blob;
        setVoiceUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setRecording('recorded');
        stream.getTracks().forEach((track) => track.stop());
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording('recording');
      setSecondsLeft(MAX_RECORDING_SECONDS);

      // Hard 45-second cap with a per-second countdown.
      countdownRef.current = setInterval(() => {
        setSecondsLeft((previous) => {
          if (previous <= 1) {
            stopRecording();
            return 0;
          }
          return previous - 1;
        });
      }, 1000);
    } catch {
      setRecording('denied');
    }
  };

  const resetRecording = (): void => {
    clearCountdown();
    voiceBlobRef.current = null;
    setVoiceUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setSecondsLeft(MAX_RECORDING_SECONDS);
    setRecording('idle');
  };

  React.useEffect(() => clearCountdown, []);

  // ─────────────────────────── Geolocation ───────────────────────────

  const grabLocation = (): void => {
    if (!('geolocation' in navigator)) {
      setLocationStatus('unsupported');
      return;
    }
    setLocationStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (position: GeolocationPosition) => {
        patch({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setMapPicked(false);
        setLocationStatus('success');
      },
      () => setLocationStatus('error'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  // ────────────────────────────── Photos ─────────────────────────────

  const appendPhotos = (
    event: React.ChangeEvent<HTMLInputElement>,
    setter: React.Dispatch<React.SetStateAction<File[]>>,
    max: number,
  ): void => {
    const selected = Array.from(event.target.files ?? []);
    setter((previous) => [...previous, ...selected].slice(0, max));
    event.target.value = '';
    setStepError(null);
  };

  // ─────────────── Property-number onBlur uniqueness check ───────────

  const checkPropertyNumber = async (): Promise<void> => {
    const number = state.propertyNumber.trim();
    if (!number) {
      setNumberStatus('idle');
      return;
    }
    setNumberStatus('checking');
    const result = await validatePropertyNumber(number);
    if (result.ok) {
      setNumberStatus(result.data.available ? 'available' : 'taken');
    } else {
      // Network hiccup: don't block the citizen — the server re-checks
      // inside the submission transaction anyway.
      setNumberStatus('idle');
    }
  };

  // ─────────────────────── Step-by-step validation ───────────────────

  const isValidPhone = (value: string): boolean =>
    PHONE_PATTERN.test(value.replace(/[\s-]/g, ''));

  const validateStep = (current: number): boolean => {
    switch (current) {
      case 0:
        if (state.submittedByProxy) {
          if (
            state.proxyFirstName.trim().length < 2 ||
            state.proxyMiddleName.trim().length < 2 ||
            state.proxyLastName.trim().length < 2
          ) {
            setStepError(errorText('proxyNameRequired'));
            return false;
          }
          if (!isValidPhone(state.proxyPhoneNumber)) {
            setStepError(errorText('proxyPhoneRequired'));
            return false;
          }
          if (!state.proxyRelationship) {
            setStepError(errorText('proxyRelationshipRequired'));
            return false;
          }
          if (
            state.proxyRelationship === 'OTHER' &&
            state.proxyCustomRelationship.trim().length < 2
          ) {
            setStepError(errorText('customRelationshipRequired'));
            return false;
          }
          if (!documents.proxyNationalId) {
            setStepError(errorText('proxyIdRequired'));
            return false;
          }
        }
        return true;
      case 1:
        if (!state.category) {
          setStepError(errorText('assetRequired'));
          return false;
        }
        return true;
      case 2:
        if (!state.severity) {
          setStepError(errorText('severityRequired'));
          return false;
        }
        return true;
      case 3:
        // v2.5: the written description is required by default, but a
        // recorded voice note relaxes it to optional…
        if (
          voiceBlobRef.current === null &&
          state.description.trim().length < 10
        ) {
          setStepError(errorText('descriptionRequired'));
          return false;
        }
        // …and at least one damage photo is always mandatory.
        if (photos.length === 0) {
          setStepError(errorText('damagePhotoRequired'));
          return false;
        }
        return true;
      case 4:
        if (state.latitude === null || state.longitude === null) {
          setStepError(errorText('locationRequired'));
          return false;
        }
        if (isVehicle) {
          // Vehicles strictly bypass the address block: district + GPS.
          if (state.district.trim().length < 2) {
            setStepError(errorText('districtRequired'));
            return false;
          }
          return true;
        }
        if (state.street.trim().length < 2) {
          setStepError(errorText('streetRequired'));
          return false;
        }
        if (state.floor.trim().length === 0) {
          setStepError(errorText('floorRequired'));
          return false;
        }
        if (!state.propertyNumber.trim()) {
          setStepError(errorText('propertyNumberRequired'));
          return false;
        }
        if (numberStatus === 'taken') {
          setStepError(t.propertyNumberTaken);
          return false;
        }
        return true;
      case 5: {
        if (state.firstName.trim().length < 2) {
          setStepError(errorText('firstNameRequired'));
          return false;
        }
        if (state.middleName.trim().length < 2) {
          setStepError(errorText('middleNameRequired'));
          return false;
        }
        if (state.lastName.trim().length < 2) {
          setStepError(errorText('lastNameRequired'));
          return false;
        }
        if (!isValidPhone(state.phoneNumber)) {
          setStepError(errorText('invalidPhone'));
          return false;
        }
        if (!documents.nationalId) {
          setStepError(errorText('nationalIdRequired'));
          return false;
        }
        if (isVehicle) {
          if (!state.vehicleType) {
            setStepError(errorText('vehicleTypeRequired'));
            return false;
          }
          if (
            state.vehicleType === 'OTHER' &&
            state.customVehicleType.trim().length < 2
          ) {
            setStepError(errorText('customVehicleTypeRequired'));
            return false;
          }
          if (!documents.vehicleRegistration) {
            setStepError(errorText('vehiclePapersRequired'));
            return false;
          }
          if (vehiclePhotos.length === 0) {
            setStepError(errorText('vehiclePhotosRequired'));
            return false;
          }
        } else {
          if (!state.ownership) {
            setStepError(errorText('ownershipRequired'));
            return false;
          }
          if (state.ownership === 'TENANT' && !documents.rentalContract) {
            setStepError(errorText('rentalContractRequired'));
            return false;
          }
          // Tenants don't provide residency proof — it's not applicable.
          if (state.ownership === 'OWNER' && !documents.residencyProof) {
            setStepError(errorText('residencyProofRequired'));
            return false;
          }
        }
        return true;
      }
      default:
        return true;
    }
  };

  const goNext = (): void => {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  };
  const goBack = (): void => {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  // ───────────────────────────── Submit ──────────────────────────────

  const handleSubmit = async (): Promise<void> => {
    if (!validateStep(4) || !validateStep(5)) return;
    if (!state.category || !state.severity) return;

    setSubmitStatus('submitting');
    setSubmitError(null);

    const proxy: ProxyDetails | undefined =
      state.submittedByProxy && state.proxyRelationship
        ? {
            firstName: state.proxyFirstName.trim(),
            middleName: state.proxyMiddleName.trim(),
            lastName: state.proxyLastName.trim(),
            phoneNumber: state.proxyPhoneNumber.replace(/[\s-]/g, ''),
            relationship: state.proxyRelationship,
            customRelationshipDescription:
              state.proxyRelationship === 'OTHER'
                ? state.proxyCustomRelationship.trim()
                : undefined,
          }
        : undefined;

    const base = {
      reporter: {
        firstName: state.firstName.trim(),
        middleName: state.middleName.trim(),
        lastName: state.lastName.trim(),
        phoneNumber: state.phoneNumber.replace(/[\s-]/g, ''),
        preferredLanguage: locale === 'ar' ? ('AR' as const) : ('EN' as const),
      },
      report: {
        // Optional when a voice note is attached (validated in step 3).
        description: state.description.trim() || undefined,
        severity: state.severity,
        submittedByProxy: state.submittedByProxy,
        proxy,
      },
    };

    const payload: MultipartPayload =
      state.category === 'VEHICLE'
        ? {
            category: 'VEHICLE',
            ...base,
            location: {
              district: state.district.trim(),
              latitude: state.latitude ?? 0,
              longitude: state.longitude ?? 0,
            },
            property: {
              vehicleType: state.vehicleType ?? 'OTHER',
              customVehicleTypeDescription:
                state.vehicleType === 'OTHER'
                  ? state.customVehicleType.trim()
                  : undefined,
            },
          }
        : {
            category: state.category,
            ...base,
            location: {
              street: state.street.trim(),
              projectName: state.projectName.trim() || undefined,
              floor: state.floor.trim(),
              additionalDirections:
                state.additionalDirections.trim() || undefined,
              latitude: state.latitude ?? 0,
              longitude: state.longitude ?? 0,
            },
            property: {
              ownershipStatus: state.ownership ?? 'OWNER',
              propertyNumber: state.propertyNumber.trim(),
              ownerPhoneNumber:
                state.ownership === 'TENANT' && state.ownerPhoneNumber.trim()
                  ? state.ownerPhoneNumber.replace(/[\s-]/g, '')
                  : undefined,
            },
          };

    const result = await submitDamageReportMultipart(payload, {
      damagePhotos: photos,
      vehiclePhotos: isVehicle ? vehiclePhotos : [],
      voiceNote: voiceBlobRef.current,
      nationalId: documents.nationalId,
      proxyNationalId: state.submittedByProxy ? documents.proxyNationalId : null,
      propertyDeed: isVehicle ? null : documents.propertyDeed,
      rentalContract:
        !isVehicle && state.ownership === 'TENANT'
          ? documents.rentalContract
          : null,
      vehicleRegistration: isVehicle ? documents.vehicleRegistration : null,
      residencyProof:
        !isVehicle && state.ownership === 'OWNER'
          ? documents.residencyProof
          : null,
    });

    if (result.ok) {
      setReferenceId(result.data.id);
      setSubmitStatus('success');
    } else {
      if (result.error.code === 'PROPERTY_NUMBER_TAKEN') {
        setNumberStatus('taken');
        setStepError(t.propertyNumberTaken);
        setSubmitStatus('idle');
        return;
      }
      setSubmitError(localizedErrorMessage(result.error, locale));
      setSubmitStatus('error');
    }
  };

  const resetWizard = (): void => {
    setState(INITIAL_STATE);
    resetRecording();
    setPhotos([]);
    setVehiclePhotos([]);
    setDocuments(INITIAL_DOCUMENTS);
    setLocationStatus('idle');
    setShowMapPicker(false);
    setMapPicked(false);
    setVehicleQuery('');
    setVehicleOpen(false);
    setNumberStatus('idle');
    setSubmitStatus('idle');
    setSubmitError(null);
    setReferenceId(null);
    setStep(0);
  };

  // ──────────────────────────── Rendering ────────────────────────────

  if (submitStatus === 'success') {
    return (
      <Card className="mx-auto w-full max-w-xl text-center">
        <CardHeader>
          <CheckCircle2 className="mx-auto h-20 w-20 text-emerald-600" />
          <h2 className="text-3xl font-semibold">{t.successTitle}</h2>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-lg text-muted-foreground">{t.successBody}</p>
          {referenceId ? (
            <p className="rounded-lg bg-muted p-4 font-mono text-sm" dir="ltr">
              {t.referenceLabel}: {referenceId}
            </p>
          ) : null}
          <Button size="xl" className="w-full" onClick={resetWizard}>
            {t.newReport}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const bigChoice = (selected: boolean): string =>
    cn(
      'flex h-28 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 text-lg font-semibold transition-all',
      selected
        ? 'border-primary bg-primary/10 text-primary shadow-md'
        : 'border-input bg-background hover:border-primary/50 hover:bg-accent',
    );

  const fileField = (
    key: keyof DocumentFiles,
    label: string,
    required: boolean,
    hint?: string,
  ): React.JSX.Element => (
    <div className="space-y-2">
      <Label className="leading-snug">
        {label}
        {required ? <Req /> : null}
        {hint ? (
          <span className="text-muted-foreground"> ({hint})</span>
        ) : null}
      </Label>
      {documents[key] ? (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-2 text-sm">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Paperclip className="h-4 w-4 shrink-0 text-emerald-600" />
            <span className="truncate">{documents[key]?.name}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDocument(key, null)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <label className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground">
          <FileText className="h-5 w-5" />
          {t.chooseFile}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setDocument(key, file);
              event.target.value = '';
            }}
          />
        </label>
      )}
    </div>
  );

  const filteredVehicleKinds = VEHICLE_KINDS.filter((kind) =>
    t.vehicleTypes[kind]
      .toLowerCase()
      .includes(vehicleQuery.trim().toLowerCase()),
  );

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">
          {fill(t.stepOf, { current: step + 1, total: TOTAL_STEPS })}
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

      <CardContent className="space-y-6">
        {/* Step 0 — self or proxy ("التقديم عن الغير") */}
        {step === 0 ? (
          <section className="space-y-5">
            <h2 className="text-2xl font-bold">{t.proxyTitle}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <button
                type="button"
                className={bigChoice(!state.submittedByProxy)}
                onClick={() => patch({ submittedByProxy: false })}
              >
                <UserRound className="h-9 w-9" />
                {t.proxySelf}
              </button>
              <button
                type="button"
                className={bigChoice(state.submittedByProxy)}
                onClick={() => patch({ submittedByProxy: true })}
              >
                <HeartHandshake className="h-9 w-9" />
                {t.proxyOther}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                id="proxy"
                checked={state.submittedByProxy}
                onCheckedChange={(checked) =>
                  patch({ submittedByProxy: checked === true })
                }
              />
              <Label htmlFor="proxy" className="leading-snug">
                {t.proxyCheckbox}
              </Label>
            </div>

            {state.submittedByProxy ? (
              <div className="space-y-4 rounded-xl border bg-muted/40 p-4">
                <h3 className="font-semibold">{t.proxySectionTitle}</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="proxyFirstName">
                      {t.proxyFirstNameLabel}
                      <Req />
                    </Label>
                    <Input
                      id="proxyFirstName"
                      value={state.proxyFirstName}
                      onChange={(e) => patch({ proxyFirstName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="proxyMiddleName">
                      {t.proxyMiddleNameLabel}
                      <Req />
                    </Label>
                    <Input
                      id="proxyMiddleName"
                      value={state.proxyMiddleName}
                      onChange={(e) => patch({ proxyMiddleName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="proxyLastName">
                      {t.proxyLastNameLabel}
                      <Req />
                    </Label>
                    <Input
                      id="proxyLastName"
                      value={state.proxyLastName}
                      onChange={(e) => patch({ proxyLastName: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="proxyPhone">
                    {t.proxyPhoneLabel}
                    <Req />
                  </Label>
                  <Input
                    id="proxyPhone"
                    type="tel"
                    inputMode="tel"
                    dir="ltr"
                    placeholder={t.phonePlaceholder}
                    value={state.proxyPhoneNumber}
                    onChange={(e) => patch({ proxyPhoneNumber: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    {t.proxyRelationshipLabel}
                    <Req />
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    {PROXY_RELATIONSHIPS.map((relationship) => (
                      <button
                        key={relationship}
                        type="button"
                        onClick={() => patch({ proxyRelationship: relationship })}
                        className={cn(
                          'inline-flex h-12 items-center justify-center rounded-lg border-2 px-2 text-sm font-medium transition-colors',
                          state.proxyRelationship === relationship
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input bg-background hover:border-primary/50',
                        )}
                      >
                        {t.proxyRelationships[relationship]}
                      </button>
                    ))}
                  </div>
                  {/* OTHER slides open a mandatory free-text description. */}
                  {state.proxyRelationship === 'OTHER' ? (
                    <div className="space-y-2 pt-1">
                      <Label htmlFor="proxyCustomRelationship">
                        {t.customRelationshipLabel}
                        <Req />
                      </Label>
                      <Input
                        id="proxyCustomRelationship"
                        value={state.proxyCustomRelationship}
                        onChange={(e) =>
                          patch({ proxyCustomRelationship: e.target.value })
                        }
                      />
                    </div>
                  ) : null}
                </div>
                {fileField('proxyNationalId', t.proxyIdLabel, true)}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* Step 1 — four-card category: house / shop / apartment / vehicle */}
        {step === 1 ? (
          <section className="space-y-5">
            <h2 className="text-2xl font-bold">{t.assetTitle}</h2>
            <div className="grid grid-cols-2 gap-4">
              {(
                [
                  ['HOUSE', Home, t.assetHouse],
                  ['SHOP', Store, t.assetShop],
                  ['APARTMENT', Building2, t.assetApartment],
                  ['VEHICLE', Car, t.assetVehicle],
                ] as const
              ).map(([value, Icon, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(bigChoice(state.category === value), 'h-32 gap-3')}
                  onClick={() => patch({ category: value })}
                >
                  <Icon className="h-11 w-11" />
                  {label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Step 2 — severity */}
        {step === 2 ? (
          <section className="space-y-5">
            <h2 className="text-2xl font-bold">{t.severityTitle}</h2>
            <div className="grid grid-cols-1 gap-4">
              {(
                [
                  ['TOTAL', Flame, t.severityTotal],
                  ['PARTIAL', TriangleAlert, t.severityPartial],
                  ['MINOR', Wrench, t.severityMinor],
                ] as const
              ).map(([value, Icon, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(bigChoice(state.severity === value), 'h-20 flex-row')}
                  onClick={() => patch({ severity: value })}
                >
                  <Icon className="h-7 w-7" />
                  {label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Step 3 — voice (optional) + required description + required photos */}
        {step === 3 ? (
          <section className="space-y-5">
            <h2 className="text-2xl font-bold">{t.describeTitle}</h2>
            <p className="text-muted-foreground">
              {t.describeHint}{' '}
              <span className="text-xs">({t.recordMaxNote})</span>
            </p>

            {recording === 'unsupported' ? (
              <p className="text-sm text-amber-600">{t.recordUnsupported}</p>
            ) : recording === 'denied' ? (
              <p className="text-sm text-destructive">{t.recordDenied}</p>
            ) : recording === 'recorded' && voiceUrl ? (
              <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
                <p className="font-medium text-emerald-700">{t.voiceReady}</p>
                <audio controls src={voiceUrl} className="w-full" />
                <Button variant="outline" size="lg" onClick={resetRecording}>
                  <Trash2 className="h-5 w-5" /> {t.recordAgain}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Button
                  type="button"
                  size="xl"
                  variant={recording === 'recording' ? 'destructive' : 'secondary'}
                  className="w-full"
                  onClick={
                    recording === 'recording'
                      ? stopRecording
                      : () => void startRecording()
                  }
                >
                  {recording === 'recording' ? (
                    <>
                      <Square className="h-7 w-7 animate-pulse" /> {t.recordStop}
                    </>
                  ) : (
                    <>
                      <Mic className="h-7 w-7" /> {t.recordStart}
                    </>
                  )}
                </Button>
                {recording === 'recording' ? (
                  <div className="space-y-1">
                    <p
                      className={cn(
                        'text-center text-lg font-bold tabular-nums',
                        secondsLeft <= 10 ? 'text-destructive' : 'text-foreground',
                      )}
                    >
                      {fill(t.recordCountdown, { seconds: secondsLeft })}
                    </p>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-destructive transition-all duration-1000 ease-linear"
                        style={{
                          width: `${(secondsLeft / MAX_RECORDING_SECONDS) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="description">
                {t.descriptionLabel}
                {/* A recorded voice note relaxes the requirement. */}
                {recording === 'recorded' ? null : <Req />}
              </Label>
              {recording === 'recorded' ? (
                <p className="text-sm font-medium text-emerald-700">
                  {t.descriptionOptionalNote}
                </p>
              ) : null}
              <Textarea
                id="description"
                value={state.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder={t.descriptionPlaceholder}
                className="min-h-[120px] text-lg"
              />
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold">
                {t.photosTitle}
                <Req />
              </h3>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(event) =>
                  appendPhotos(event, setPhotos, MAX_DAMAGE_PHOTOS)
                }
              />
              <Button
                type="button"
                size="lg"
                variant="secondary"
                className="w-full"
                disabled={photos.length >= MAX_DAMAGE_PHOTOS}
                onClick={() => photoInputRef.current?.click()}
              >
                <Camera className="h-6 w-6" /> {t.photosButton}
              </Button>
              {/* Real-time counter against the strict 10-photo ceiling. */}
              <p
                className={cn(
                  'text-sm font-medium tabular-nums',
                  photos.length >= MAX_DAMAGE_PHOTOS
                    ? 'text-amber-600'
                    : 'text-muted-foreground',
                )}
              >
                {fill(t.photosCounter, {
                  count: photos.length,
                  max: MAX_DAMAGE_PHOTOS,
                })}
              </p>
              {photos.length > 0 ? (
                <ul className="space-y-2">
                  {photos.map((photo, index) => (
                    <li
                      key={`${photo.name}-${index}`}
                      className="flex items-center justify-between rounded-lg border p-2 text-sm"
                    >
                      <span className="truncate">{photo.name}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setPhotos((previous) =>
                            previous.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" /> {t.photosRemove}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Step 4 — location: GPS/pin + deep-precision address fields */}
        {step === 4 ? (
          <section className="space-y-5">
            <h2 className="text-2xl font-bold">{t.locationTitle}</h2>
            <Button
              type="button"
              size="xl"
              variant={locationStatus === 'success' ? 'secondary' : 'default'}
              className="w-full"
              onClick={grabLocation}
              disabled={locationStatus === 'loading'}
            >
              {locationStatus === 'loading' ? (
                <>
                  <Loader2 className="h-7 w-7 animate-spin" /> {t.locationGrabbing}
                </>
              ) : locationStatus === 'success' ? (
                <>
                  <CheckCircle2 className="h-7 w-7 text-emerald-600" />{' '}
                  {t.locationSuccess}
                </>
              ) : (
                <>
                  <MapPin className="h-7 w-7" /> {t.locationGrab}
                </>
              )}
            </Button>
            {locationStatus === 'error' ? (
              <p className="text-sm text-destructive">{t.locationError}</p>
            ) : null}
            {locationStatus === 'unsupported' ? (
              <p className="text-sm text-amber-600">{t.locationUnsupported}</p>
            ) : null}
            {state.latitude !== null && state.longitude !== null ? (
              <p
                className="rounded-lg bg-muted p-3 text-center font-mono text-sm"
                dir="ltr"
              >
                {state.latitude.toFixed(6)}, {state.longitude.toFixed(6)}
              </p>
            ) : null}

            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                onClick={() => setShowMapPicker((previous) => !previous)}
              >
                <MapPin className="h-5 w-5" /> {t.locationPickOnMap}
              </Button>
              {showMapPicker ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t.locationMapHint}</p>
                  <LocationPickerMap
                    latitude={state.latitude}
                    longitude={state.longitude}
                    onPick={(latitude, longitude) => {
                      patch({ latitude, longitude });
                      setMapPicked(true);
                      setLocationStatus('idle');
                    }}
                  />
                  {mapPicked ? (
                    <p className="text-center text-sm font-medium text-emerald-700">
                      {t.locationMapDone}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {isVehicle ? (
              /* Vehicles strictly bypass the address block: city + GPS. */
              <div className="space-y-2">
                <Label htmlFor="district">
                  {t.districtLabel}
                  <Req />
                </Label>
                <Input
                  id="district"
                  placeholder={t.districtPlaceholder}
                  value={state.district}
                  onChange={(e) => patch({ district: e.target.value })}
                />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="street">
                    {t.streetLabel}
                    <Req />
                  </Label>
                  <Input
                    id="street"
                    placeholder={t.streetPlaceholder}
                    value={state.street}
                    onChange={(e) => patch({ street: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="projectName">
                      {t.projectNameLabel}{' '}
                      <span className="text-muted-foreground">
                        ({dict.common.optional})
                      </span>
                    </Label>
                    <Input
                      id="projectName"
                      value={state.projectName}
                      onChange={(e) => patch({ projectName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="floor">
                      {t.floorLabel}
                      <Req />
                    </Label>
                    <Input
                      id="floor"
                      placeholder={t.floorPlaceholder}
                      value={state.floor}
                      onChange={(e) => patch({ floor: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="additionalDirections">
                    {t.additionalDirectionsLabel}{' '}
                    <span className="text-muted-foreground">
                      ({dict.common.optional})
                    </span>
                  </Label>
                  <Input
                    id="additionalDirections"
                    placeholder={t.additionalDirectionsPlaceholder}
                    value={state.additionalDirections}
                    onChange={(e) =>
                      patch({ additionalDirections: e.target.value })
                    }
                  />
                </div>
                {/* Official property number with onBlur uniqueness check. */}
                <div className="space-y-2">
                  <Label htmlFor="propertyNumber">
                    {t.propertyNumberLabel}
                    <Req />
                  </Label>
                  <Input
                    id="propertyNumber"
                    dir="ltr"
                    value={state.propertyNumber}
                    onChange={(e) => {
                      patch({ propertyNumber: e.target.value });
                      setNumberStatus('idle');
                    }}
                    onBlur={() => void checkPropertyNumber()}
                    aria-invalid={numberStatus === 'taken'}
                    className={cn(
                      numberStatus === 'taken' &&
                        'border-destructive ring-2 ring-destructive/40',
                    )}
                  />
                  {numberStatus === 'checking' ? (
                    <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t.propertyNumberChecking}
                    </p>
                  ) : null}
                  {numberStatus === 'available' ? (
                    <p className="text-sm font-medium text-emerald-700">
                      {t.propertyNumberOk}
                    </p>
                  ) : null}
                  {numberStatus === 'taken' ? (
                    <p className="rounded-lg bg-destructive p-3 text-sm font-bold text-destructive-foreground">
                      {t.propertyNumberTaken}
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </section>
        ) : null}

        {/* Step 5 — identity, documents, property/vehicle data & submit */}
        {step === 5 ? (
          <section className="space-y-5">
            <h2 className="text-2xl font-bold">{t.personalTitle}</h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">
                  {t.firstNameLabel}
                  <Req />
                </Label>
                <Input
                  id="firstName"
                  value={state.firstName}
                  onChange={(e) => patch({ firstName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="middleName">
                  {t.middleNameLabel}
                  <Req />
                </Label>
                <Input
                  id="middleName"
                  value={state.middleName}
                  onChange={(e) => patch({ middleName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">
                  {t.lastNameLabel}
                  <Req />
                </Label>
                <Input
                  id="lastName"
                  value={state.lastName}
                  onChange={(e) => patch({ lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">
                {t.phoneLabel}
                <Req />
              </Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                dir="ltr"
                placeholder={t.phonePlaceholder}
                value={state.phoneNumber}
                onChange={(e) => patch({ phoneNumber: e.target.value })}
              />
            </div>

            {fileField('nationalId', t.nationalIdLabel, true)}

            {isVehicle ? (
              <>
                {/* Vehicle type — searchable combobox */}
                <div className="space-y-2">
                  <Label htmlFor="vehicleType">
                    {t.vehicleTypeLabel}
                    <Req />
                  </Label>
                  <div className="relative">
                    <Input
                      id="vehicleType"
                      role="combobox"
                      aria-expanded={vehicleOpen}
                      placeholder={t.vehicleTypePlaceholder}
                      value={
                        vehicleOpen
                          ? vehicleQuery
                          : state.vehicleType
                            ? t.vehicleTypes[state.vehicleType]
                            : ''
                      }
                      onFocus={() => {
                        setVehicleOpen(true);
                        setVehicleQuery('');
                      }}
                      onChange={(e) => {
                        setVehicleQuery(e.target.value);
                        setVehicleOpen(true);
                      }}
                    />
                    <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    {vehicleOpen ? (
                      <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-background shadow-lg">
                        {filteredVehicleKinds.length === 0 ? (
                          <li className="px-3 py-2 text-sm text-muted-foreground">
                            —
                          </li>
                        ) : (
                          filteredVehicleKinds.map((kind) => (
                            <li key={kind}>
                              <button
                                type="button"
                                className={cn(
                                  'flex w-full items-center gap-2 px-3 py-2.5 text-start text-sm transition-colors hover:bg-accent',
                                  state.vehicleType === kind &&
                                    'bg-primary/10 font-semibold text-primary',
                                )}
                                onClick={() => {
                                  patch({ vehicleType: kind });
                                  setVehicleOpen(false);
                                  setVehicleQuery('');
                                }}
                              >
                                {state.vehicleType === kind ? (
                                  <CheckCircle2 className="h-4 w-4" />
                                ) : (
                                  <Car className="h-4 w-4 text-muted-foreground" />
                                )}
                                {t.vehicleTypes[kind]}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    ) : null}
                  </div>
                </div>

                {/* OTHER opens a mandatory free-text vehicle description. */}
                {state.vehicleType === 'OTHER' ? (
                  <div className="space-y-2">
                    <Label htmlFor="customVehicleType">
                      {t.customVehicleTypeLabel}
                      <Req />
                    </Label>
                    <Input
                      id="customVehicleType"
                      value={state.customVehicleType}
                      onChange={(e) =>
                        patch({ customVehicleType: e.target.value })
                      }
                    />
                  </div>
                ) : null}

                {fileField('vehicleRegistration', t.vehiclePapersLabel, true)}

                <div className="space-y-2">
                  <Label className="leading-snug">
                    {t.vehiclePhotosLabel}
                    <Req />
                  </Label>
                  <input
                    ref={vehiclePhotoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    className="hidden"
                    onChange={(event) => appendPhotos(event, setVehiclePhotos, 8)}
                  />
                  <Button
                    type="button"
                    size="lg"
                    variant="secondary"
                    className="w-full"
                    onClick={() => vehiclePhotoInputRef.current?.click()}
                  >
                    <Camera className="h-6 w-6" /> {t.photosButton}
                  </Button>
                  {vehiclePhotos.length > 0 ? (
                    <ul className="space-y-2">
                      {vehiclePhotos.map((photo, index) => (
                        <li
                          key={`${photo.name}-${index}`}
                          className="flex items-center justify-between rounded-lg border p-2 text-sm"
                        >
                          <span className="truncate">{photo.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setVehiclePhotos((previous) =>
                                previous.filter((_, i) => i !== index),
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold">
                    {t.ownershipTitle}
                    <Req />
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      className={cn(bigChoice(state.ownership === 'OWNER'), 'h-16 flex-row')}
                      onClick={() => patch({ ownership: 'OWNER' })}
                    >
                      <Home className="h-5 w-5" /> {t.ownerOption}
                    </button>
                    <button
                      type="button"
                      className={cn(bigChoice(state.ownership === 'TENANT'), 'h-16 flex-row')}
                      onClick={() => patch({ ownership: 'TENANT' })}
                    >
                      <FileText className="h-5 w-5" /> {t.tenantOption}
                    </button>
                  </div>
                </div>

                {/* Tenants: rental contract required + optional landlord
                    phone; residency proof is not applicable and stays
                    hidden. Owners: residency proof required. */}
                {state.ownership === 'TENANT' ? (
                  <>
                    {fileField('rentalContract', t.rentalContractLabel, true)}
                    <div className="space-y-2">
                      <Label htmlFor="ownerPhone">
                        {t.ownerPhoneLabel}{' '}
                        <span className="text-muted-foreground">
                          ({dict.common.optional})
                        </span>
                      </Label>
                      <Input
                        id="ownerPhone"
                        type="tel"
                        inputMode="tel"
                        dir="ltr"
                        placeholder={t.phonePlaceholder}
                        value={state.ownerPhoneNumber}
                        onChange={(e) =>
                          patch({ ownerPhoneNumber: e.target.value })
                        }
                      />
                    </div>
                  </>
                ) : null}
                {state.ownership === 'OWNER'
                  ? fileField('residencyProof', t.residencyProofLabel, true)
                  : null}

                {fileField(
                  'propertyDeed',
                  t.propertyDeedLabel,
                  false,
                  t.deedOptionalHint,
                )}
              </>
            )}

            {submitStatus === 'error' && submitError ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {t.errorTitle}: {submitError}
                </span>
              </div>
            ) : null}
          </section>
        ) : null}

        {stepError ? (
          <p className="rounded-lg bg-destructive/10 p-3 text-center font-medium text-destructive">
            {stepError}
          </p>
        ) : null}

        {/* Navigation */}
        <div className="flex gap-3 pt-2">
          {step > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={goBack}
              disabled={submitStatus === 'submitting'}
            >
              <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
              {dict.common.back}
            </Button>
          ) : null}
          {step < TOTAL_STEPS - 1 ? (
            <Button type="button" size="lg" className="flex-1" onClick={goNext}>
              {dict.common.next}
              <ChevronRight className="h-5 w-5 rtl:rotate-180" />
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              className="flex-1"
              onClick={() => void handleSubmit()}
              disabled={
                submitStatus === 'submitting' || numberStatus === 'checking'
              }
            >
              {submitStatus === 'submitting' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" /> {t.submitting}
                </>
              ) : (
                dict.common.submit
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
