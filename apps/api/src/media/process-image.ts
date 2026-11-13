import sharp from "sharp";

/** Long edge of the stored display image, in pixels. Never enlarged. */
export const DISPLAY_MAX_EDGE = 2560;
/** Long edge of the stored thumbnail, in pixels. Never enlarged. */
export const THUMB_MAX_EDGE = 480;
/**
 * The largest canvas an upload may declare. A decoded pixel is up to 4 bytes,
 * so 50 MP is about 200 MB of working memory, past any phone camera's output
 * while still refusing a small file that claims a vast canvas before it is
 * decoded (sharp checks the header first).
 */
export const MAX_INPUT_PIXELS = 50_000_000;

// One libvips worker per image and no operation cache: this is a personal
// server, and uploads are rare and large, so a bounded footprint matters more
// than throughput. The job queue above this caps how many run at once.
sharp.concurrency(1);
sharp.cache(false);

/** The upload is not an image this app accepts. The message is fixed text: it is sent to the client. */
export class UnsupportedImageError extends Error {
  constructor() {
    super("Unsupported image");
    this.name = "UnsupportedImageError";
  }
}

/** The upload declares more pixels than `MAX_INPUT_PIXELS`. Fixed text, sent to the client. */
export class ImageTooLargeError extends Error {
  constructor() {
    super("Image too large");
    this.name = "ImageTooLargeError";
  }
}

export interface ProcessedImage {
  display: Buffer;
  thumb: Buffer;
  /** Of the display image. */
  width: number;
  height: number;
  mimeType: "image/webp";
  /** Of the display image. */
  bytes: number;
}

type AcceptedFormat = "jpeg" | "png" | "gif" | "webp" | "avif";

/**
 * The format named by the file's own first bytes, or null. Checked before
 * sharp sees the data at all: the prebuilt libvips also reads SVG (a document
 * that can carry script and expand without bound), TIFF and more, so
 * "sharp could decode it" is not an allowlist.
 */
function sniff(input: Buffer): AcceptedFormat | null {
  const ascii = (start: number, end: number) => input.subarray(start, end).toString("latin1");
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return "jpeg";
  if (input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  // ISO base media: a `ftyp` box whose major brand is AVIF (still or sequence).
  if (ascii(4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(8, 12))) return "avif";
  return null;
}

/** What sharp's metadata calls each accepted format; AVIF is HEIF with AV1 compression. */
function decodedMatches(format: AcceptedFormat, metadata: sharp.Metadata): boolean {
  if (format === "avif") return metadata.format === "heif" && metadata.compression === "av1";
  return metadata.format === format;
}

function isPixelLimitError(error: unknown): boolean {
  return error instanceof Error && /pixel limit/i.test(error.message);
}

/**
 * Turns an upload into the two files the app stores: a display image and a
 * thumbnail, both WebP.
 *
 * The upload itself is never kept. Re-encoding is what strips it: sharp writes
 * no EXIF, XMP, IPTC or ICC unless asked (never call `keepMetadata`,
 * `withMetadata`, `keepExif` or `keepIccProfile` here), and a photo's EXIF
 * carries where it was taken. The orientation it carries is applied first, so
 * dropping it loses nothing. Only the first frame of an animation is kept.
 *
 * Errors are the two classes above, both fixed text. Anything sharp says is
 * swallowed rather than passed on: its messages can quote the input.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const format = sniff(input);
  if (format === null) throw new UnsupportedImageError();

  const options: sharp.SharpOptions = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", pages: 1 };
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, options).metadata();
  } catch (error) {
    throw isPixelLimitError(error) ? new ImageTooLargeError() : new UnsupportedImageError();
  }
  if (!decodedMatches(format, metadata)) throw new UnsupportedImageError();
  // metadata() reads the header only; enforce the limit on what it declared too.
  if ((metadata.width ?? 0) * (metadata.height ?? 0) > MAX_INPUT_PIXELS) throw new ImageTooLargeError();

  try {
    const { data: display, info } = await sharp(input, options)
      .autoOrient()
      .resize({ width: DISPLAY_MAX_EDGE, height: DISPLAY_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(display)
      .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75 })
      .toBuffer();
    return { display, thumb, width: info.width, height: info.height, mimeType: "image/webp", bytes: display.length };
  } catch (error) {
    throw isPixelLimitError(error) ? new ImageTooLargeError() : new UnsupportedImageError();
  }
}
