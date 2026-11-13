import type { MediaVariant } from "../lib/api-client.js";
import { useSeen } from "../lib/in-view.js";
import { useMediaImage } from "../lib/queries.js";

/** The long edge of a stored thumbnail, as the API makes it (`THUMB_MAX_EDGE`). */
const THUMB_MAX_EDGE = 480;

/**
 * A thumbnail's size from its display image's, never enlarged — what the API
 * produces, so the space can be reserved before the bytes arrive.
 */
export function thumbSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

interface MediaImageProps {
  collectionId: string;
  itemId: string;
  mediaId: string;
  variant: MediaVariant;
  alt: string;
  /** Of the display image; a thumbnail derives its own. */
  width: number;
  height: number;
  className?: string;
  /** Fetch only once the image nears the viewport — for long lists, like a collection's rows. */
  lazy?: boolean;
}

/**
 * One stored image (#37). The bytes are fetched with the token — an `<img src>`
 * pointing at the API could not send it — and shown through an object URL.
 *
 * Until they arrive, and if they never do (a file missing on disk), a
 * placeholder holds the image's space and its name, so the layout does not jump
 * and a screen reader still hears what the picture is.
 */
export function MediaImage({
  collectionId,
  itemId,
  mediaId,
  variant,
  alt,
  width,
  height,
  className,
  lazy = false,
}: MediaImageProps) {
  const [seenRef, seen] = useSeen<HTMLElement>();
  const image = useMediaImage(collectionId, itemId, mediaId, variant, { enabled: !lazy || seen });
  const size = variant === "thumb" ? thumbSize(width, height) : { width, height };
  if (!image.data) {
    return (
      <span
        ref={lazy ? seenRef : undefined}
        className={className ? `media-image-placeholder ${className}` : "media-image-placeholder"}
        // A placeholder stands in for the picture, so it says what the picture
        // would — and, for a decorative one (`alt=""`), says nothing at all.
        {...(alt ? { role: "img", "aria-label": alt } : { "aria-hidden": true })}
        // A thumbnail sits in a tile its container sizes; a display image
        // reserves its own shape.
        style={variant === "display" ? { aspectRatio: `${size.width} / ${size.height}` } : undefined}
      />
    );
  }
  return <img src={image.data} alt={alt} width={size.width} height={size.height} className={className} />;
}
