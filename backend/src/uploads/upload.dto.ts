export type UploadKind = 'photo' | 'document';

interface UploadKindConfig {
  bucket: string;
  maxSizeBytes: number;
  allowedMimeTypes: readonly string[];
  /** Which sniffed content families are acceptable. */
  allowedFamilies: readonly ('image' | 'pdf')[];
}

/**
 * Evidence pipelines: damage/vehicle photos and official documents
 * (IDs, deeds, contracts, registrations) each go to their own bucket
 * with their own size ceiling and MIME allowlist.
 */
export const UPLOAD_KIND_CONFIG: Record<UploadKind, UploadKindConfig> = {
  photo: {
    bucket: 'damage-photos',
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedFamilies: ['image'],
  },
  document: {
    bucket: 'citizen-documents',
    maxSizeBytes: 8 * 1024 * 1024,
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ],
    allowedFamilies: ['image', 'pdf'],
  },
};

/**
 * Magic-number sniffing so a renamed .exe can't sneak through with a
 * declared image MIME type. Returns the detected family or null.
 */
export function sniffFileFamily(buffer: Buffer): 'image' | 'pdf' | null {
  if (buffer.length < 12) return null;

  // PDF: "%PDF"
  if (buffer.toString('ascii', 0, 4) === '%PDF') return 'pdf';
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image';
  }
  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image';
  }
  // WEBP: "RIFF"...."WEBP"
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image';
  }

  return null;
}
