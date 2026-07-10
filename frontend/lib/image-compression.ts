import imageCompression from "browser-image-compression";

/**
 * Client-side image compression for the citizen wizard.
 *
 * Vercel serverless functions cap the request body at ~4.5MB. Citizen
 * photos straight off a phone camera routinely exceed that on their own,
 * so we shrink every selected image in the browser *before* it is ever
 * appended to the multipart FormData. This keeps the whole submission
 * (up to 10 photos + a 45s voice note) comfortably below the limit and
 * avoids the 413 FUNCTION_PAYLOAD_TOO_LARGE the endpoint was hitting.
 */

/** Tuned so a full 10-photo batch stays well under Vercel's ~4.5MB body cap. */
const COMPRESSION_OPTIONS = {
  /** Cap the longest edge — plenty of detail for damage assessment. */
  maxWidthOrHeight: 1280,
  /** Hard ceiling per image; the library iterates quality to hit it. */
  maxSizeMB: 0.4,
  /** Off-main-thread so the UI stays responsive on low-end phones. */
  useWebWorker: true,
  /**
   * Normalize every photo to JPEG. This guarantees the output MIME is in
   * the backend's photo allowlist (image/jpeg|png|webp) regardless of what
   * the phone captured, and JPEG shrinks photographs harder than PNG —
   * keeping the multipart body small enough for Vercel's serverless cap.
   */
  fileType: "image/jpeg",
} as const;

/** Only bitmap images are worth compressing; anything else passes through. */
function isCompressibleImage(file: File): boolean {
  return file.type.startsWith("image/") && file.type !== "image/gif";
}

/** Swaps any file extension for `.jpg` so the name matches the JPEG output. */
function toJpegName(name: string): string {
  return name.replace(/\.[^./\\]+$/, "") + ".jpg";
}

/**
 * Compresses a single image and normalizes it to JPEG. On any failure the
 * untouched original is returned — a slightly larger upload is preferable
 * to dropping the citizen's evidence.
 */
export async function compressImage(file: File): Promise<File> {
  if (!isCompressibleImage(file)) return file;
  try {
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    // browser-image-compression returns a File; rebuild it with a matching
    // JPEG name and type so the server-side validation and stored filename
    // stay consistent.
    return new File([compressed], toJpegName(file.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

/** Compresses a batch of images in parallel (web workers keep it smooth). */
export async function compressImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map((file) => compressImage(file)));
}
