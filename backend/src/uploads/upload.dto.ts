import { z } from 'zod';

export const uploadKindSchema = z.enum(['photo', 'voice', 'document']);
export type UploadKind = z.infer<typeof uploadKindSchema>;

export interface UploadResponseDto {
  url: string;
}

interface UploadKindConfig {
  bucket: string;
  maxSizeBytes: number;
  allowedMimeTypes: readonly string[];
  /** Which sniffed content families are acceptable. */
  allowedFamilies: readonly ('image' | 'audio' | 'pdf')[];
}

/**
 * Evidence pipelines: damage/vehicle photos, citizen voice notes and
 * official documents (IDs, deeds, contracts, registrations) each go to
 * their own bucket with their own size ceiling and MIME allowlist.
 */
export const UPLOAD_KIND_CONFIG: Record<UploadKind, UploadKindConfig> = {
  photo: {
    bucket: 'damage-photos',
    maxSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedFamilies: ['image'],
  },
  voice: {
    bucket: 'voice-notes',
    maxSizeBytes: 10 * 1024 * 1024,
    allowedMimeTypes: [
      'audio/webm',
      'audio/mp4',
      'audio/x-m4a',
      'audio/mpeg',
      'audio/mp3',
      'audio/ogg',
      'audio/wav',
      'audio/x-wav',
    ],
    allowedFamilies: ['audio'],
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
export function sniffFileFamily(
  buffer: Buffer,
): 'image' | 'audio' | 'pdf' | null {
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
  // WEBP: "RIFF"...."WEBP" | WAV: "RIFF"...."WAVE"
  if (buffer.toString('ascii', 0, 4) === 'RIFF') {
    const format = buffer.toString('ascii', 8, 12);
    if (format === 'WEBP') return 'image';
    if (format === 'WAVE') return 'audio';
    return null;
  }
  // WebM/Matroska (MediaRecorder default): EBML header 1A 45 DF A3
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'audio';
  }
  // MP4/M4A container: "ftyp" at offset 4
  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    return 'audio';
  }
  // MP3: "ID3" tag or MPEG frame sync FF Ex/FF Fx
  if (buffer.toString('ascii', 0, 3) === 'ID3') return 'audio';
  if (buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0) return 'audio';
  // OGG: "OggS"
  if (buffer.toString('ascii', 0, 4) === 'OggS') return 'audio';

  return null;
}
