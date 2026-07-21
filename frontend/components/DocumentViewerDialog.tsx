'use client';

import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Dictionary } from '@/lib/i18n/dictionaries';

/** PDFs render in an iframe; everything else is treated as an image. */
function isPdf(url: string): boolean {
  return url.split('?')[0].toLowerCase().endsWith('.pdf');
}

interface DocumentViewerDialogProps {
  dict: Dictionary;
  /** The document/image to preview — null keeps the dialog closed. */
  url: string | null;
  /** Heading shown above the preview (e.g. "Document 2" / label). */
  title: string;
  onClose: () => void;
}

/**
 * In-site lightbox for every uploaded document and image (shadcn Dialog):
 * images render full-width, PDFs in an embedded frame, and a fallback
 * "open in new tab" action always remains available.
 */
export function DocumentViewerDialog({
  dict,
  url,
  title,
  onClose,
}: DocumentViewerDialogProps): React.JSX.Element {
  return (
    <Dialog open={url !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-3xl"
        closeLabel={dict.common.close}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {url ? (
          <div className="max-h-[70vh] overflow-auto rounded-lg border bg-muted/30">
            {isPdf(url) ? (
              <iframe
                src={url}
                title={title}
                className="h-[65vh] w-full"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={title}
                className="mx-auto max-h-[65vh] w-auto object-contain"
              />
            )}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <a href={url ?? '#'} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              {dict.common.openInNewTab}
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
