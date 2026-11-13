import type { Media } from "@mycollections/core";
import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon.js";
import { MediaImage } from "./MediaImage.js";

interface ImageViewerProps {
  collectionId: string;
  itemId: string;
  itemName: string;
  photos: Media[];
  /** The photo on show, or null when the viewer is closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  /** Called with the index on show when the viewer has closed. */
  onClose: (index: number) => void;
  /**
   * The control focus returns to on close, for the photo last on show — which
   * the user may have stepped to, so not necessarily the one that opened it.
   */
  returnFocusTo: (index: number) => HTMLElement | null;
}

/**
 * One photo at full size (#37): the standard modal `<dialog>`, opened with
 * `showModal()`. That gives what a hand-made lightbox has to rebuild — the page
 * behind made inert, focus kept inside, Escape to close (the `cancel` event),
 * a top-layer backdrop — and assistive technology knows it as a dialog.
 *
 * The dialog element is always rendered, closed until a photo is chosen, so
 * the caption inside it is a polite live region that exists before it ever
 * changes: Previous and Next (or the left and right arrow keys) swap the photo, and the caption says
 * which one it is now. Opening needs no announcement of its own; a dialog's
 * name is read as focus enters it.
 */
export function ImageViewer({
  collectionId,
  itemId,
  itemName,
  photos,
  index,
  onIndexChange,
  onClose,
  returnFocusTo,
}: ImageViewerProps) {
  const { t } = useTranslation("items");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const captionId = useId();
  const open = index !== null && photos[index] !== undefined;
  const photo = open ? photos[index] : undefined;
  const count = photos.length;
  // The latest index for the native `close` handler, which is bound once.
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  /**
   * Every way out goes through here — Close, Escape, the backdrop. Closing a
   * modal dialog restores focus to whatever opened it, synchronously inside
   * `close()`; focusing the photo last on show right after, in the same task,
   * overrides that before anything is announced. Doing it later, from the
   * `close` event, let focus visit the opener first — two announcements, and
   * in Chromium sometimes the wrong one last.
   */
  function closeViewer() {
    const dialog = dialogRef.current;
    if (!dialog?.open) return;
    const shown = indexRef.current ?? 0;
    dialog.close();
    returnFocusTo(shown)?.focus();
  }

  function step(by: -1 | 1) {
    if (index === null) return;
    const next = index + by;
    if (next < 0 || next >= count) return;
    onIndexChange(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="image-viewer"
      aria-labelledby={captionId}
      onKeyDown={handleKeyDown}
      // Escape (the `cancel` event), the Close button and a backdrop click all
      // end in `close`; the parent drops its index and hands focus back.
      onCancel={(event) => {
        // Escape: closed by hand, so focus can be placed (see closeViewer).
        event.preventDefault();
        closeViewer();
      }}
      onClose={() => onClose(indexRef.current ?? 0)}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself, outside its box.
        if (event.target === event.currentTarget) closeViewer();
      }}
    >
      <div className="image-viewer-frame">
        <div className="image-viewer-bar">
          <p id={captionId} className="image-viewer-caption" aria-live="polite">
            {photo ? t("photo_alt", { name: itemName, position: (index ?? 0) + 1, count }) : ""}
          </p>
          <button
            type="button"
            className="touch-target button-quiet"
            aria-label={t("close_viewer")}
            onClick={closeViewer}
          >
            <Icon name="cross" />
          </button>
        </div>
        {photo && (
          <MediaImage
            collectionId={collectionId}
            itemId={itemId}
            mediaId={photo.id}
            variant="display"
            width={photo.width}
            height={photo.height}
            // The caption beside it already names the photo; saying it twice adds nothing.
            alt=""
            className="image-viewer-image"
          />
        )}
        {count > 1 && (
          <div className="image-viewer-nav">
            {/* Marked, not removed, at either end: a vanished button would take focus with it. */}
            <button
              type="button"
              className="touch-target button-quiet"
              aria-disabled={index === 0 || undefined}
              onClick={() => step(-1)}
            >
              <Icon name="earlier" />
              {t("previous_photo")}
            </button>
            <button
              type="button"
              className="touch-target button-quiet"
              aria-disabled={index === count - 1 || undefined}
              onClick={() => step(1)}
            >
              {t("next_photo")}
              <Icon name="later" />
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
