import { reportError } from "@/lib/reportError";
import { fitWithin } from "@/lib/imageSize";

/**
 * Photos are shrunk in the browser before they are uploaded.
 *
 * A phone camera hands over 3000–4000px and 3–5 MB per picture. The person
 * uploading is usually on mobile data in a corridor, and every list that shows
 * the photo downloads it again. 1600px on the long edge keeps an ID card's
 * small print readable (the owner zooms in on it) and lands around 200–400 KB.
 *
 * Done here rather than on the server so the big file never crosses the
 * network at all, and with the browser's own canvas, so no image library joins
 * the four runtime dependencies.
 */
const JPEG_QUALITY = 0.82;
/** Below this, and already within MAX_EDGE, a file is sent as it is. */
const SMALL_ENOUGH_BYTES = 600 * 1024;

const SHRINKABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Returns a smaller JPEG of `file`, or `file` itself when it is not an image,
 * is already small, or cannot be decoded here. Never throws: a failed shrink
 * must not cost someone their registration, so it uploads the original and
 * reports why.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (!SHRINKABLE.has(file.type)) return file; // PDFs and anything unexpected

  try {
    // "from-image" applies the camera's EXIF rotation, so a portrait photo of
    // an ID card does not arrive lying on its side.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    if (width === bitmap.width && file.size <= SMALL_ENOUGH_BYTES) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    // JPEG has no transparency; a transparent PNG would otherwise turn black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("canvas.toBlob returned null");
    if (blob.size >= file.size) return file; // already well compressed

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch (err) {
    reportError(err, { where: "shrinkImage", type: file.type, size: file.size });
    return file;
  }
}
