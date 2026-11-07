// Checks a chosen logo and shrinks it if it is large, so bills stay light and the upload is small.
const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
const MAX_WIDTH = 600;
const MAX_HEIGHT = 240;
const KEEP_AS_IS_BELOW = 300 * 1024; // bytes

export async function prepareLogo(file: File): Promise<Blob> {
  if (!ALLOWED.includes(file.type)) {
    throw new Error("Please choose a PNG, JPEG or WebP image. SVG files are not supported.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image could not be read. Please choose another file.");
  }

  const scale = Math.min(1, MAX_WIDTH / bitmap.width, MAX_HEIGHT / bitmap.height);
  // The server stores PNG or JPEG only (they work in every PDF and browser), so WebP is always converted.
  if (scale === 1 && file.size <= KEEP_AS_IS_BELOW && file.type !== "image/webp") {
    bitmap.close();
    return file; // already small enough: keep the original bytes untouched
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // PNG keeps transparent backgrounds; photos stay JPEG.
  const type = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error("That image could not be processed. Please choose another file.");
  return blob;
}
