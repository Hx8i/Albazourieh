"use client";

import * as React from "react";
import { Loader2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** A rejection must always carry a substantive reason. */
export const MIN_REJECT_REASON_LENGTH = 5;

export interface RejectReasonLabels {
  title: string;
  /** Already interpolated with the report reference by the caller. */
  subtitle: string;
  reasonLabel: string;
  placeholder: string;
  minLengthHint: string;
  confirm: string;
  cancel: string;
  close: string;
}

interface RejectReasonDialogProps {
  open: boolean;
  pending: boolean;
  error: string | null;
  labels: RejectReasonLabels;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/**
 * Centered modal that collects the mandatory rejection reason before a
 * report is rejected from the dashboard table — replacing the old native
 * `window.prompt`. Self-contained (no Radix Dialog dependency): locks body
 * scroll, closes on overlay click or Escape, focuses the textarea on open,
 * and blocks confirmation until the reason clears the minimum length.
 */
export function RejectReasonDialog({
  open,
  pending,
  error,
  labels,
  onConfirm,
  onClose,
}: RejectReasonDialogProps): React.JSX.Element | null {
  const [reason, setReason] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Fresh reason for every report the dialog is opened for.
  React.useEffect(() => {
    if (open) setReason("");
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Defer focus until after the element is painted.
    const focusHandle = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusHandle);
    };
  }, [open, pending, onClose]);

  if (!open) return null;

  const trimmed = reason.trim();
  const tooShort = trimmed.length < MIN_REJECT_REASON_LENGTH;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-dialog-title"
    >
      <button
        type="button"
        aria-label={labels.close}
        className="absolute inset-0 h-full w-full cursor-default bg-black/50 animate-in fade-in"
        onClick={() => {
          if (!pending) onClose();
        }}
      />
      <div className="relative z-10 flex w-full max-w-md flex-col rounded-xl border bg-background shadow-xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div className="space-y-1">
            <h2
              id="reject-dialog-title"
              className="text-lg font-semibold text-destructive"
            >
              {labels.title}
            </h2>
            <p className="font-mono text-sm text-muted-foreground" dir="ltr">
              {labels.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label={labels.close}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2 p-5">
          <Label htmlFor="reject-dialog-reason">{labels.reasonLabel}</Label>
          <Textarea
            id="reject-dialog-reason"
            ref={textareaRef}
            className="min-h-[110px]"
            placeholder={labels.placeholder}
            value={reason}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{labels.minLengthHint}</p>
          {error ? (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-2.5 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t p-5">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {labels.cancel}
          </Button>
          <Button
            variant="destructive"
            disabled={pending || tooShort}
            onClick={() => onConfirm(trimmed)}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {labels.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
