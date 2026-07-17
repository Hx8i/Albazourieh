'use client';

import * as React from 'react';
import {
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Search,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getPublicReportStatus } from '@/lib/api';
import { Dictionary, Locale } from '@/lib/i18n/dictionaries';
import {
  isValidReferenceCode,
  PublicReportStatus,
  ReportStatus,
  RejectedField,
} from '@/lib/schemas/damage-report.schema';

interface TrackReportViewProps {
  dict: Dictionary;
  locale: Locale;
}

/** Fetch/validation lifecycle for the lookup form. */
type LookupState =
  | { phase: 'idle' }
  | { phase: 'invalid' }
  | { phase: 'loading' }
  | { phase: 'notFound' }
  | { phase: 'error' }
  | { phase: 'found'; data: PublicReportStatus };

type StepKey = 'submitted' | 'underReview' | 'verified' | 'approved' | 'rejected';
type StepState = 'done' | 'current' | 'upcoming';

interface TimelineStep {
  key: StepKey;
  state: StepState;
}

/** How far a (non-rejected) report has advanced along the happy path. */
const REACHED_INDEX: Record<Exclude<ReportStatus, 'REJECTED'>, number> = {
  PENDING: 0,
  UNDER_REVIEW: 1,
  VERIFIED: 2,
  APPROVED: 3,
};

const HAPPY_PATH: readonly StepKey[] = [
  'submitted',
  'underReview',
  'verified',
  'approved',
];

/**
 * Maps a raw status onto the visual stepper. REJECTED branches off after
 * "under review" into a terminal red node; every other status advances
 * linearly, with APPROVED marking the whole path complete.
 */
function buildTimeline(status: ReportStatus): TimelineStep[] {
  if (status === 'REJECTED') {
    return [
      { key: 'submitted', state: 'done' },
      { key: 'underReview', state: 'done' },
      { key: 'rejected', state: 'current' },
    ];
  }
  const reached = REACHED_INDEX[status];
  return HAPPY_PATH.map((key, index) => ({
    key,
    state:
      index < reached
        ? 'done'
        : index === reached
          ? status === 'APPROVED'
            ? 'done'
            : 'current'
          : 'upcoming',
  }));
}

/** Icon for a step given its lifecycle state. */
function StepIcon({
  stepKey,
  state,
}: {
  stepKey: StepKey;
  state: StepState;
}): React.JSX.Element {
  if (stepKey === 'rejected') {
    return <XCircle className="h-5 w-5" />;
  }
  if (state === 'done') {
    return <CheckCircle2 className="h-5 w-5" />;
  }
  if (state === 'current') {
    return stepKey === 'submitted' ? (
      <Clock className="h-5 w-5" />
    ) : (
      <Search className="h-5 w-5" />
    );
  }
  return <Circle className="h-5 w-5" />;
}

export function TrackReportView({
  dict,
  locale,
}: TrackReportViewProps): React.JSX.Element {
  const t = dict.trackReport;
  const [code, setCode] = React.useState('');
  const [state, setState] = React.useState<LookupState>({ phase: 'idle' });

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    // Uppercase + strip anything outside the 6-char alphanumeric alphabet.
    const next = event.target.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
    setCode(next);
    if (state.phase !== 'idle') setState({ phase: 'idle' });
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (!isValidReferenceCode(code)) {
      setState({ phase: 'invalid' });
      return;
    }
    setState({ phase: 'loading' });
    const result = await getPublicReportStatus(code);
    if (result.ok) {
      setState({ phase: 'found', data: result.data });
    } else if (result.error.status === 404) {
      setState({ phase: 'notFound' });
    } else {
      setState({ phase: 'error' });
    }
  };

  const errorMessage =
    state.phase === 'invalid'
      ? t.invalidCode
      : state.phase === 'notFound'
        ? t.notFound
        : state.phase === 'error'
          ? t.networkError
          : null;

  const dateFormatter = new Intl.DateTimeFormat(
    locale === 'ar' ? 'ar' : 'en-GB',
    { year: 'numeric', month: 'long', day: 'numeric' },
  );

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold sm:text-3xl">{t.title}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          {t.subtitle}
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            <label htmlFor="reference-code" className="text-sm font-medium">
              {t.codeLabel}
            </label>
            <Input
              id="reference-code"
              value={code}
              onChange={handleChange}
              placeholder={t.codePlaceholder}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={6}
              dir="ltr"
              className="text-center font-mono text-lg tracking-[0.4em]"
              aria-invalid={state.phase === 'invalid'}
            />
            <p className="text-xs text-muted-foreground">{t.codeHint}</p>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={state.phase === 'loading' || code.length === 0}
            >
              {state.phase === 'loading' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" /> {t.searching}
                </>
              ) : (
                <>
                  <Search className="h-5 w-5" /> {t.submit}
                </>
              )}
            </Button>
            {errorMessage ? (
              <p
                className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
                role="alert"
              >
                {errorMessage}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {state.phase === 'found' ? (
        <ResultCard data={state.data} dict={dict} formattedDate={dateFormatter} locale={locale} />
      ) : null}
    </div>
  );
}

/** The found-report panel: metadata summary + the status timeline. */
function ResultCard({
  data,
  dict,
  formattedDate,
  locale,
}: {
  data: PublicReportStatus;
  dict: Dictionary;
  formattedDate: Intl.DateTimeFormat;
  locale: Locale;
}): React.JSX.Element {
  const t = dict.trackReport;
  const steps = buildTimeline(data.status);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t.resultHeading}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t.referenceLabel}</dt>
            <dd className="font-mono font-semibold tracking-wider" dir="ltr">
              {data.referenceCode}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.categoryLabel}</dt>
            <dd className="font-medium">{dict.dashboard.asset[data.category]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t.submittedLabel}</dt>
            <dd className="font-medium">
              {formattedDate.format(new Date(data.submittedAt))}
            </dd>
          </div>
        </dl>

        <div>
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            {t.currentStatus}
          </p>
          <ol className="space-y-0">
            {steps.map((step, index) => (
              <TimelineRow
                key={step.key}
                step={step}
                label={t.steps[step.key]}
                hint={t.stepHint[step.key]}
                isLast={index === steps.length - 1}
              />
            ))}
          </ol>
        </div>

        {data.status === 'REJECTED' ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t.rejectedNote}
              {data.rejectedField ? (
                <>
                  <br />
                  <span className="font-semibold">
                    {locale === 'ar' ? 'الحقل المرفوض: ' : 'Rejected field: '}
                  </span>
                  {(() => {
                    const mapping: Record<RejectedField, string> = {
                      Name: dict.detail.rejectedFields.Name,
                      Address: dict.detail.rejectedFields.Address,
                      Description: dict.detail.rejectedFields.Description,
                      Media: dict.detail.rejectedFields.Media,
                    };
                    return mapping[data.rejectedField] || data.rejectedField;
                  })()}
                </>
              ) : null}
            </p>
            <p className="text-sm font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-3">
              {t.rejectionNotice}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** One row of the vertical stepper, with a connecting spine. */
function TimelineRow({
  step,
  label,
  hint,
  isLast,
}: {
  step: TimelineStep;
  label: string;
  hint: string;
  isLast: boolean;
}): React.JSX.Element {
  const isRejected = step.key === 'rejected';
  const bubble =
    isRejected || step.state === 'done'
      ? isRejected
        ? 'border-destructive bg-destructive/10 text-destructive'
        : 'border-emerald-600 bg-emerald-50 text-emerald-600'
      : step.state === 'current'
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-muted-foreground/30 bg-muted text-muted-foreground/50';
  const spine =
    step.state === 'done' ? 'bg-emerald-500/40' : 'bg-muted-foreground/20';

  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {!isLast ? (
        <span
          className={`absolute top-9 h-[calc(100%-2.25rem)] w-px ${spine}`}
          style={{ insetInlineStart: '1.125rem' }}
          aria-hidden
        />
      ) : null}
      <span
        className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 ${bubble} ${
          step.state === 'current' ? 'animate-pulse' : ''
        }`}
      >
        <StepIcon stepKey={step.key} state={step.state} />
      </span>
      <div className="pt-1">
        <p
          className={`font-medium ${
            step.state === 'upcoming' ? 'text-muted-foreground' : ''
          }`}
        >
          {label}
        </p>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
    </li>
  );
}
