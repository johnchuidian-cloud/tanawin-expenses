"use client";

/**
 * Client-side image helpers.
 *
 * Phone gallery photos are routinely 3–6 MB. Storing the raw base64 of one
 * in a Postgres text column is slow and can quietly blow past request-size
 * limits — the insert fails, the entry saves without its photo, and the
 * image vanishes on the next refresh. So before we keep a photo we downscale
 * it to a sane dimension and re-encode as JPEG, which brings a typical
 * receipt snap down to a couple hundred KB with no meaningful loss of
 * legibility.
 *
 * Everything here runs in the browser (FileReader + canvas), so it's safe on
 * edge-runtime pages.
 */

const MAX_DIM = 1600; // longest edge, px
const JPEG_QUALITY = 0.82;

/** Read a File into a data URL string. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Unexpected FileReader result"));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/** Load a data URL into an HTMLImageElement. */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = dataUrl;
  });
}

/**
 * Turn a user-picked image File into a downscaled JPEG data URL suitable for
 * storing on an entry/receipt. Falls back to the original (un-resized) data
 * URL if the browser can't decode the image (e.g. some HEIC files) so we
 * never lose the photo outright.
 */
export async function fileToCompressedDataUrl(file: File): Promise<string> {
  const original = await readAsDataUrl(file);

  // Non-images (shouldn't happen with accept="image/*", but be safe) get
  // returned as-is.
  if (!file.type.startsWith("image/")) return original;

  try {
    const img = await loadImage(original);
    const { width, height } = img;
    const longest = Math.max(width, height);
    const scale = longest > MAX_DIM ? MAX_DIM / longest : 1;

    // Already small enough and already a JPEG → keep the original bytes.
    if (scale === 1 && file.type === "image/jpeg") return original;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch {
    // Decode failed (HEIC, corrupt, etc.) — better to keep the raw photo
    // than to drop it.
    return original;
  }
}
