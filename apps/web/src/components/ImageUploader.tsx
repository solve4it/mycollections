import { type ChangeEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAnnounce } from "../lib/announcer.js";
import { ApiError, type UploadSource } from "../lib/api-client.js";
import { useUploadMedia } from "../lib/queries.js";
import { Icon } from "./Icon.js";

/**
 * The formats the server accepts (#37). Named rather than `image/*`: the
 * picker then greys out what would only be refused, and iOS Safari, offered no
 * HEIC, hands over a camera photo as JPEG.
 */
export const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/avif";

/** Which message a refused upload gets, from the status the server answered with. */
function failureKey(error: unknown): string {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 415) return "upload_failed_unsupported";
  if (status === 413) return "upload_failed_too_large";
  if (status === 409) return "upload_failed_full";
  if (status === 503) return "upload_failed_busy";
  return "upload_failed";
}

/** A camera on hand is what makes "Take photo" worth offering: a touch screen, in practice. */
function hasCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

interface ImageUploaderProps {
  collectionId: string;
  itemId: string;
}

/**
 * Adds photos to an item (#37): any number picked from files, or one taken with
 * the camera where there is one. Uploads go one at a time — the server
 * processes one image at a time anyway, and a burst would only earn 503s.
 *
 * Progress and success are spoken through the shell's announcer; a refusal is
 * shown, in a `role="alert"` rendered with its message inside, because it asks
 * the user to do something. Both buttons are marked unavailable while an upload
 * runs, with `aria-disabled` and a handler that refuses — `disabled` would drop
 * focus to <body>.
 */
export function ImageUploader({ collectionId, itemId }: ImageUploaderProps) {
  const { t } = useTranslation("items");
  const announce = useAnnounce();
  const upload = useUploadMedia(collectionId, itemId);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [canCapture] = useState(hasCoarsePointer);
  const filesInputId = useId();
  const cameraInputId = useId();
  const filesInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  async function send(event: ChangeEvent<HTMLInputElement>, source: UploadSource) {
    const files = [...(event.currentTarget.files ?? [])];
    // Cleared so picking the same file again still fires a change.
    event.currentTarget.value = "";
    if (files.length === 0) return;
    setBusy(true);
    setFailure(null);
    announce(t("photos_uploading", { count: files.length }));
    let added = 0;
    const refused: string[] = [];
    for (const file of files) {
      try {
        await upload.mutateAsync({ file, source });
        added += 1;
      } catch (error) {
        refused.push(failureKey(error));
        // A full item refuses every one after it too; asking again is noise.
        if (failureKey(error) === "upload_failed_full") break;
      }
    }
    setBusy(false);
    if (added > 0) announce(t("photos_added", { count: added }));
    if (refused.length > 0) {
      // One message, for the first kind of refusal, counted: several different
      // reasons at once is rare, and a list of them would bury the one to act on.
      setFailure(t(refused[0] as string, { count: refused.length }));
    }
  }

  function open(input: HTMLInputElement | null) {
    if (busy) return;
    input?.click();
  }

  return (
    <div className="image-uploader">
      {/* Hidden inputs behind ordinary buttons: a file input's own button
          cannot be labelled or styled consistently across browsers. Each is
          out of the tab order and the accessibility tree, since the button
          beside it is the control. */}
      <input
        id={filesInputId}
        ref={filesInput}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        hidden
        onChange={(event) => void send(event, "user-attached")}
      />
      <button
        type="button"
        className="touch-target button-primary"
        aria-disabled={busy || undefined}
        onClick={() => open(filesInput.current)}
      >
        <Icon name="add" />
        {t("add_photos")}
      </button>
      {canCapture && (
        <>
          <input
            id={cameraInputId}
            ref={cameraInput}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES}
            capture="environment"
            hidden
            onChange={(event) => void send(event, "user-camera")}
          />
          <button
            type="button"
            className="touch-target button-quiet"
            aria-disabled={busy || undefined}
            onClick={() => open(cameraInput.current)}
          >
            {t("take_photo")}
          </button>
        </>
      )}
      {failure && <p role="alert">{failure}</p>}
    </div>
  );
}
