'use client';

import * as React from 'react';
import { Loader2, TriangleAlert, X, FileText, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import {
  DisplacedAudience,
  DisplacedItem,
  DisplacedStatus,
  LebaneseDisplacedItem,
  MAX_ID_DOCUMENTS_PER_REGISTRATION,
  SyrianDisplacedItem,
  SHELTER_TYPES,
  ShelterType,
} from '@/lib/schemas/displaced.schema';
import {
  useUpdateLebaneseDisplacedMutation,
  useUpdateSyrianDisplacedMutation,
  useUploadDisplacedIdDocumentsMutation,
  useDeleteDisplacedIdDocumentMutation,
} from '@/lib/queries';
import { Dictionary, fill } from '@/lib/i18n/dictionaries';

interface DisplacedEditDialogProps {
  open: boolean;
  audience: DisplacedAudience;
  item: DisplacedItem | null;
  dict: Dictionary;
  onClose: () => void;
}

export function DisplacedEditDialog({
  open,
  audience,
  item,
  dict,
  onClose,
}: DisplacedEditDialogProps): React.JSX.Element | null {
  const t = dict.displaced;
  const tEdit = t.dashboard.editDialog;

  const updateSyrian = useUpdateSyrianDisplacedMutation();
  const updateLebanese = useUpdateLebaneseDisplacedMutation();
  const uploadIdMutation = useUploadDisplacedIdDocumentsMutation(audience);
  const deleteIdMutation = useDeleteDisplacedIdDocumentMutation(audience);
  const addDocumentInputRef = React.useRef<HTMLInputElement>(null);

  const isPending =
    updateSyrian.isPending ||
    updateLebanese.isPending ||
    uploadIdMutation.isPending ||
    deleteIdMutation.isPending;

  const [error, setError] = React.useState<string | null>(null);

  // Form State
  const [fullName, setFullName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [familyMembersCount, setFamilyMembersCount] = React.useState('');
  const [familyMembersNames, setFamilyMembersNames] = React.useState('');
  const [status, setStatus] = React.useState<DisplacedStatus>('PENDING');
  const [idDocumentUrls, setIdDocumentUrls] = React.useState<string[]>([]);

  // Syrian specific
  const [originalCity, setOriginalCity] = React.useState('');
  const [registrationNumber, setRegistrationNumber] = React.useState('');
  const [shelterType, setShelterType] = React.useState<ShelterType | ''>('');
  const [entryDate, setEntryDate] = React.useState('');

  // Lebanese specific
  const [originVillage, setOriginVillage] = React.useState('');
  const [isPropertyDamaged, setIsPropertyDamaged] = React.useState<boolean>(false);
  const [primarySourceOfIncome, setPrimarySourceOfIncome] = React.useState('');
  const [displacementDate, setDisplacementDate] = React.useState('');

  // Load state when item is set
  React.useEffect(() => {
    if (item && open) {
      setError(null);
      setFullName(item.fullName);
      setPhone(item.phone);
      setFamilyMembersCount(String(item.familyMembersCount));
      setFamilyMembersNames(item.familyMembersNames);
      setStatus(item.status);
      setIdDocumentUrls(item.idDocumentUrls);

      if (audience === 'syrian') {
        const syrian = item as SyrianDisplacedItem;
        setOriginalCity(syrian.originalCity);
        setRegistrationNumber(syrian.registrationNumber ?? '');
        setShelterType(syrian.shelterType);
        setEntryDate(syrian.entryDate ? syrian.entryDate.slice(0, 10) : '');
      } else {
        const lebanese = item as LebaneseDisplacedItem;
        setOriginVillage(lebanese.originVillage);
        setIsPropertyDamaged(lebanese.isPropertyDamaged);
        setPrimarySourceOfIncome(lebanese.primarySourceOfIncome ?? '');
        setDisplacementDate(lebanese.displacementDate ? lebanese.displacementDate.slice(0, 10) : '');
      }
    }
  }, [item, open, audience]);

  // Lock body scroll on open
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isPending) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isPending, onClose]);

  if (!open || !item) return null;

  const handleUploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    setError(null);

    try {
      const res = await uploadIdMutation.mutateAsync({ id: item.id, files });
      setIdDocumentUrls(res.idDocumentUrls);
    } catch (err: any) {
      setError(err?.message || tEdit.error);
    }
  };

  const handleDeleteFile = async (url: string) => {
    if (!window.confirm(tEdit.confirmDeleteId)) return;
    setError(null);

    try {
      const res = await deleteIdMutation.mutateAsync({ id: item.id, url });
      setIdDocumentUrls(res.idDocumentUrls);
    } catch (err: any) {
      setError(err?.message || tEdit.error);
    }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const commonPayload = {
      fullName: fullName.trim(),
      phone: phone.trim(),
      familyMembersCount: parseInt(familyMembersCount, 10) || 1,
      familyMembersNames: familyMembersNames.trim(),
      status,
    };

    try {
      if (audience === 'syrian') {
        const payload = {
          ...commonPayload,
          originalCity: originalCity.trim(),
          registrationNumber: registrationNumber.trim() || undefined,
          shelterType: shelterType as ShelterType,
          entryDate: entryDate || undefined,
        };
        await updateSyrian.mutateAsync({ id: item.id, payload });
      } else {
        const payload = {
          ...commonPayload,
          originVillage: originVillage.trim(),
          isPropertyDamaged,
          primarySourceOfIncome: primarySourceOfIncome.trim() || undefined,
          displacementDate: displacementDate || undefined,
        };
        await updateLebanese.mutateAsync({ id: item.id, payload });
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || tEdit.error);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default bg-transparent"
        onClick={() => {
          if (!isPending) onClose();
        }}
        aria-label={dict.displaced.dashboard.editDialog.cancel}
      />
      
      <div className="relative z-10 flex w-full max-w-lg flex-col rounded-xl border bg-background shadow-xl my-8 max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">
              {tEdit.title}
            </h2>
            <p className="text-sm text-muted-foreground">
              {item.fullName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label={tEdit.cancel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-4">
          
          {/* Status Select */}
          <div className="space-y-2">
            <Label htmlFor="edit-status">{tEdit.statusLabel}</Label>
            <Select
              value={status}
              onValueChange={(val) => setStatus(val as DisplacedStatus)}
            >
              <SelectTrigger id="edit-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PENDING">{t.status.PENDING}</SelectItem>
                <SelectItem value="APPROVED">{t.status.APPROVED}</SelectItem>
                <SelectItem value="REJECTED">{t.status.REJECTED}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Full Name */}
            <div className="space-y-2">
              <Label htmlFor="edit-fullname">{tEdit.fullNameLabel}</Label>
              <Input
                id="edit-fullname"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={isPending}
              />
            </div>
            
            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="edit-phone">{tEdit.phoneLabel}</Label>
              <Input
                id="edit-phone"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Family Members Count */}
            <div className="space-y-2">
              <Label htmlFor="edit-count">{tEdit.familyMembersLabel}</Label>
              <Input
                id="edit-count"
                type="number"
                min={1}
                max={50}
                required
                value={familyMembersCount}
                onChange={(e) => setFamilyMembersCount(e.target.value)}
                disabled={isPending}
              />
            </div>

            {/* Origin City / Village */}
            <div className="space-y-2">
              <Label htmlFor="edit-origin">{tEdit.originLabel}</Label>
              <Input
                id="edit-origin"
                required
                value={audience === 'syrian' ? originalCity : originVillage}
                onChange={(e) =>
                  audience === 'syrian'
                    ? setOriginalCity(e.target.value)
                    : setOriginVillage(e.target.value)
                }
                disabled={isPending}
              />
            </div>
          </div>

          {/* Family Members Names */}
          <div className="space-y-2">
            <Label htmlFor="edit-familynames">{tEdit.familyMembersNamesLabel}</Label>
            <Textarea
              id="edit-familynames"
              required
              rows={3}
              value={familyMembersNames}
              onChange={(e) => setFamilyMembersNames(e.target.value)}
              disabled={isPending}
            />
          </div>

          {/* Syrian Specific Fields */}
          {audience === 'syrian' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                {/* Registration Number */}
                <div className="space-y-2">
                  <Label htmlFor="edit-regnumber">{tEdit.registrationNumberLabel}</Label>
                  <Input
                    id="edit-regnumber"
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    disabled={isPending}
                  />
                </div>

                {/* Entry Date */}
                <div className="space-y-2">
                  <Label htmlFor="edit-entrydate">{tEdit.entryDateLabel}</Label>
                  <Input
                    id="edit-entrydate"
                    type="date"
                    required
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    disabled={isPending}
                  />
                </div>
              </div>

              {/* Shelter Type */}
              <div className="space-y-2">
                <Label htmlFor="edit-sheltertype">{tEdit.shelterTypeLabel}</Label>
                <Select
                  value={shelterType}
                  onValueChange={(val) => setShelterType(val as ShelterType)}
                >
                  <SelectTrigger id="edit-sheltertype">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHELTER_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t.shelterTypes[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Lebanese Specific Fields */}
          {audience === 'lebanese' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                {/* Income */}
                <div className="space-y-2">
                  <Label htmlFor="edit-income">{tEdit.incomeLabel}</Label>
                  <Input
                    id="edit-income"
                    value={primarySourceOfIncome}
                    onChange={(e) => setPrimarySourceOfIncome(e.target.value)}
                    disabled={isPending}
                  />
                </div>

                {/* Displacement Date */}
                <div className="space-y-2">
                  <Label htmlFor="edit-displacementdate">{tEdit.displacementDateLabel}</Label>
                  <Input
                    id="edit-displacementdate"
                    type="date"
                    required
                    value={displacementDate}
                    onChange={(e) => setDisplacementDate(e.target.value)}
                    disabled={isPending}
                  />
                </div>
              </div>

              {/* Property Damaged Checkbox */}
              <div className="flex items-center space-x-2 py-2">
                <input
                  id="edit-damaged"
                  type="checkbox"
                  checked={isPropertyDamaged}
                  onChange={(e) => setIsPropertyDamaged(e.target.checked)}
                  disabled={isPending}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <Label htmlFor="edit-damaged" className="cursor-pointer select-none">
                  {tEdit.isPropertyDamagedLabel}
                </Label>
              </div>
            </>
          )}

          {/*
            ID documents: a list, one row per document, each with only
            two buttons (View, Delete) — that cap keeps every row inside
            the dialog's width no matter how many documents exist. Adding
            new ones is a single control below the list, decoupled from
            any individual row so it never grows a row past two buttons.
          */}
          <div className="space-y-2">
            <Label>{tEdit.idDocumentsLabel}</Label>
            {idDocumentUrls.length > 0 ? (
              <ul className="space-y-2">
                {idDocumentUrls.map((url, index) => (
                  <li
                    key={url}
                    className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 rounded-md bg-primary/10 p-2 text-primary">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="truncate text-sm font-medium">
                        {fill(tEdit.documentLabel, { index: index + 1 })}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button type="button" variant="outline" size="sm" asChild>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {tEdit.viewId}
                        </a>
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleDeleteFile(url)}
                        disabled={isPending}
                        aria-label={tEdit.deleteId}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                {tEdit.noDocumentsYet}
              </p>
            )}
            <input
              ref={addDocumentInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(event) => void handleUploadFiles(event)}
              disabled={isPending}
            />
            {idDocumentUrls.length < MAX_ID_DOCUMENTS_PER_REGISTRATION ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={isPending}
                onClick={() => addDocumentInputRef.current?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                {uploadIdMutation.isPending ? tEdit.uploading : tEdit.uploadId}
              </Button>
            ) : null}
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-2.5 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          {/* Action buttons inside form */}
          <div className="flex justify-end gap-2 border-t pt-5 mt-6">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isPending}
            >
              {tEdit.cancel}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tEdit.save}
            </Button>
          </div>

        </form>

      </div>
    </div>
  );
}
