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
} as const;

/** Only bitmap images are worth compressing; anything else passes through. */
function isCompressibleImage(file: File): boolean {
  return file.type.startsWith("image/") && file.type !== "image/gif";
}

/**
 * Compresses a single image, preserving its original filename. On any
 * failure the untouched original is returned — a slightly larger upload
 * is preferable to dropping the citizen's evidence.
 */
export async function compressImage(file: File): Promise<File> {
  if (!isCompressibleImage(file)) return file;
  try {
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    // browser-image-compression returns a File; keep the original name so
    // the server-side field mapping and filenames stay intact.
    return new File([compressed], file.name, {
      type: compressed.type || file.type,
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
