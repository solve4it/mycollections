import type { Media } from "@mycollections/core";
import { type MouseEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAnnounce } from "../lib/announcer.js";
import { type FocusDestination, useFocusHandoff } from "../lib/focus-handoff.js";
import { useOverlayClearance } from "../lib/overlay-clearance.js";
import { useDeleteMedia, useMakeCover, useMediaList, useReorderMedia, useRestoreMedia } from "../lib/queries.js";
import { Icon } from "./Icon.js";
import { MediaImage } from "./MediaImage.js";
import { UndoToast } from "./UndoToast.js";

interface ImageGalleryProps {
  collectionId: string;
  itemId: string;
  /** What the item is called, for each photo's alternative text. */
  itemName: string;
  /** Where focus goes when the last photo is deleted: the uploader's button. */
  emptyDestination: FocusDestination;
}

/** The first of a tile's action buttons, which is where a move, a cover change or an Undo hands focus. */
function tileFocus(mediaId: string): FocusDestination {
  return () => document.querySelector<HTMLElement>(`[data-media-id="${mediaId}"] .image-actions button`);
}

/**
 * An item's photos in order, and what can be done to them (#37). The first is
 * the item's cover — what its row shows — and says so in text, not by position
 * or styling alone.
 *
 * Every action is a button, so all of it works by keyboard and screen reader:
 * Make cover, Move earlier and Move later (dragging, for a pointer, is a
 * separate layer over the same order), and Delete, which offers Undo like
 * every other delete in the app. While any change is in flight the actions are
 * marked unavailable and refuse — a second move sent before the first lands
 * would be built on an order the server no longer has.
 */
export function ImageGallery({ collectionId, itemId, itemName, emptyDestination }: ImageGalleryProps) {
  const { t } = useTranslation("items");
  const announce = useAnnounce();
  const media = useMediaList(collectionId, itemId);
  const reorder = useReorderMedia(collectionId, itemId);
  const makeCover = useMakeCover(collectionId, itemId);
  const deleteMedia = useDeleteMedia(collectionId, itemId);
  const restoreMedia = useRestoreMedia(collectionId, itemId);
  const handOffFocus = useFocusHandoff();
  const toastRegionRef = useOverlayClearance();
  const [undo, setUndo] = useState<{ mediaId: string; index: number } | null>(null);

  const busy = reorder.isPending || makeCover.isPending || deleteMedia.isPending || restoreMedia.isPending;
  const failed = reorder.isError || makeCover.isError || deleteMedia.isError;

  /** Where focus goes when the photo at `index` is gone: the one now there, else the one before, else the uploader. */
  function indexFocus(index: number): FocusDestination {
    return () => {
      const firsts = Array.from(document.querySelectorAll<HTMLElement>(".image-gallery .image-actions"))
        .map((actions) => actions.querySelector<HTMLElement>("button"))
        .filter((button): button is HTMLElement => button !== null);
      return firsts[index] ?? firsts[firsts.length - 1] ?? emptyDestination();
    };
  }

  /** Clears the alerts of earlier attempts, so only the one being made can answer. */
  function resetFailures() {
    reorder.reset();
    makeCover.reset();
    deleteMedia.reset();
  }

  function move(list: Media[], index: number, by: -1 | 1) {
    const target = index + by;
    if (busy || target < 0 || target >= list.length) return;
    resetFailures();
    const ids = list.map((image) => image.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(target, 0, moved);
    // Re-ordering keyed tiles can move the focused node, and a moved node loses
    // focus; the handoff puts it back on the same tile's control if so.
    handOffFocus(tileFocus(moved));
    reorder.mutateAsync(ids).then(
      () => announce(t("photo_moved", { position: target + 1, count: list.length })),
      () => {},
    );
  }

  function cover(image: Media) {
    if (busy) return;
    resetFailures();
    // The button goes with the change — the cover has no Make cover — so focus
    // moves to the photo's first remaining control, now at the front.
    handOffFocus(tileFocus(image.id));
    makeCover.mutateAsync(image.id).then(
      () => announce(t("photo_now_cover")),
      () => {},
    );
  }

  function remove(image: Media, index: number, event: MouseEvent<HTMLButtonElement>) {
    if (busy) return;
    resetFailures();
    restoreMedia.reset();
    handOffFocus(indexFocus(index), { removing: event.currentTarget });
    // The toast is this component's, which survives the tile, so the follow-up
    // rides the promise rather than a tile-level onSuccess (see DEVELOPMENT.md).
    deleteMedia.mutateAsync(image.id).then(
      () => setUndo({ mediaId: image.id, index }),
      () => {},
    );
  }

  let content: ReactNode;
  if (media.error) {
    // Rendered with its message inside: a `role="alert"` is announced on insertion.
    content = <p role="alert">{t("photos_error")}</p>;
  } else if (!media.data) {
    content = <p className="form-hint">{t("photos_loading")}</p>;
  } else if (media.data.length === 0) {
    content = <p className="form-hint">{t("photos_empty")}</p>;
  } else {
    const list = media.data;
    const count = list.length;
    content = (
      <ul className="image-gallery">
        {list.map((image, index) => {
          const photo = t("photo_name", { position: index + 1, count });
          return (
            <li key={image.id} className="image-gallery-item" data-media-id={image.id}>
              <MediaImage
                collectionId={collectionId}
                itemId={itemId}
                mediaId={image.id}
                variant="thumb"
                width={image.width}
                height={image.height}
                alt={t("photo_alt", { name: itemName, position: index + 1, count })}
                className="image-gallery-thumb"
              />
              {index === 0 && <span className="image-cover-badge">{t("photo_cover")}</span>}
              <div className="image-actions">
                {index > 0 && (
                  <button
                    type="button"
                    className="touch-target button-quiet"
                    aria-label={t("make_cover_photo", { photo })}
                    aria-disabled={busy || undefined}
                    onClick={() => cover(image)}
                  >
                    {t("make_cover")}
                  </button>
                )}
                {/* At either end the move is not removed but marked: a button
                    that vanished would take focus with it, and one that stays
                    says plainly that this way is not possible. */}
                <button
                  type="button"
                  className="touch-target button-quiet"
                  aria-label={t("move_earlier_photo", { photo })}
                  aria-disabled={busy || index === 0 || undefined}
                  onClick={() => move(list, index, -1)}
                >
                  <Icon name="earlier" />
                </button>
                <button
                  type="button"
                  className="touch-target button-quiet"
                  aria-label={t("move_later_photo", { photo })}
                  aria-disabled={busy || index === count - 1 || undefined}
                  onClick={() => move(list, index, 1)}
                >
                  <Icon name="later" />
                </button>
                <button
                  type="button"
                  className="touch-target button-quiet"
                  aria-label={t("delete_photo", { photo })}
                  aria-disabled={busy || undefined}
                  onClick={(event) => remove(image, index, event)}
                >
                  <Icon name="delete" />
                  {t("delete")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="image-gallery-area">
      {content}
      {failed && <p role="alert">{t("photos_change_error")}</p>}
      {/* Always rendered once the page is, empty until a delete — the same
          region shape as the collection page's toast (#308): a live region
          inserted already holding its words is often not announced. */}
      <div className="undo-toast-region" ref={toastRegionRef}>
        <div className="undo-toast-live" aria-live="polite">
          {undo && (
            <UndoToast
              key={undo.mediaId}
              message={t("photo_deleted_toast")}
              actionLabel={t("undo")}
              dismissLabel={t("dismiss_undo")}
              onAction={() =>
                restoreMedia.mutate(undo.mediaId, {
                  onSuccess: () => {
                    // Focus follows the photo back, once the list has it again.
                    handOffFocus(tileFocus(undo.mediaId));
                    announce(t("photo_restored"));
                    setUndo(null);
                  },
                })
              }
              onDismiss={() => {
                if (restoreMedia.isPending) return;
                handOffFocus(indexFocus(undo.index));
                setUndo(null);
              }}
            />
          )}
        </div>
        {undo && restoreMedia.isError && <p role="alert">{t("photo_restore_error")}</p>}
      </div>
    </div>
  );
}
