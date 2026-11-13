import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import type { Media } from "@mycollections/core";
import { type MouseEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAnnounce } from "../lib/announcer.js";
import { type FocusDestination, useFocusHandoff } from "../lib/focus-handoff.js";
import { useOverlayClearance } from "../lib/overlay-clearance.js";
import { useDeleteMedia, useMakeCover, useMediaList, useReorderMedia, useRestoreMedia } from "../lib/queries.js";
import { moveOnto } from "../lib/reorder.js";
import { Icon } from "./Icon.js";
import { ImageViewer } from "./ImageViewer.js";
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
 * dnd-kit's own announcements, switched off. Dragging is a pointer-only layer
 * over the same order the Move buttons change; those buttons are the keyboard
 * and screen-reader path, and their results are spoken through the shell's
 * announcer, like every other message in the app. Left on, dnd-kit would speak
 * "Picked up draggable item…" through a second live region for a mouse drag.
 */
const SILENT: Announcements = {
  onDragStart: () => undefined,
  onDragMove: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

interface SortableTileProps {
  id: string;
  disabled: boolean;
  reduceMotion: boolean;
  children: (handle: { ref: (node: HTMLElement | null) => void; listeners: DraggableSyntheticListeners }) => ReactNode;
}

/**
 * One tile, draggable by its photo (#37). Only the listeners are spread, onto
 * the photo, never dnd-kit's `attributes`: those would make the tile a
 * focusable `role="button"` with a second keyboard model — space to lift —
 * beside the Move buttons, which are the keyboard path.
 */
function SortableTile({ id, disabled, reduceMotion, children }: SortableTileProps) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id,
    disabled,
    // The neighbors sliding aside is motion; under reduced motion they jump.
    transition: reduceMotion ? null : undefined,
  });
  return (
    <li
      ref={setNodeRef}
      className={isDragging ? "image-gallery-item image-gallery-item-dragging" : "image-gallery-item"}
      data-media-id={id}
      style={{
        transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
        transition: transition ?? undefined,
      }}
    >
      {children({ ref: setActivatorNodeRef, listeners })}
    </li>
  );
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
  const [reduceMotion] = useState(prefersReducedMotion);
  // The photo open in the viewer, if any.
  const [viewing, setViewing] = useState<number | null>(null);
  // A drag ends with the button still under the pointer often enough that its
  // click would open the viewer; for that one click after a drag, it does not.
  const justDragged = useRef(false);
  // A mouse drag starts after 8px of movement, so a click on a tile's buttons
  // is still a click. A touch drag starts after a 250ms press, so a swipe across
  // the photos still scrolls the page.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

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

  function drop(list: Media[], { active, over }: DragEndEvent) {
    if (busy) return;
    const moved = String(active.id);
    const ids = moveOnto(
      list.map((image) => image.id),
      moved,
      over ? String(over.id) : null,
    );
    if (!ids) return;
    resetFailures();
    reorder.mutateAsync(ids).then(
      () => announce(t("photo_moved", { position: ids.indexOf(moved) + 1, count: list.length })),
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => {
          justDragged.current = true;
        }}
        onDragEnd={(event) => {
          drop(list, event);
          setTimeout(() => {
            justDragged.current = false;
          });
        }}
        onDragCancel={() => {
          setTimeout(() => {
            justDragged.current = false;
          });
        }}
        accessibility={{ announcements: SILENT, screenReaderInstructions: { draggable: "" } }}
      >
        <SortableContext items={list.map((image) => image.id)} strategy={rectSortingStrategy}>
          <ul className="image-gallery">
            {list.map((image, index) => {
              const photo = t("photo_name", { position: index + 1, count });
              return (
                <SortableTile key={image.id} id={image.id} disabled={busy} reduceMotion={reduceMotion}>
                  {(handle) => (
                    <>
                      {/* The photo is the drag handle, for a pointer only — the
                          Move buttons below are the keyboard path, so this
                          wrapper takes no role and no tab stop. */}
                      <div className="image-drag-handle" ref={handle.ref} {...handle.listeners}>
                        {/* Opens the photo full size. Its name is the photo's own alternative

                            text, which also makes it the drag handle's visible content. */}

                        <button
                          type="button"
                          className="image-open"
                          aria-haspopup="dialog"
                          onClick={() => {
                            if (justDragged.current) return;

                            setViewing(index);
                          }}
                        >
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
                        </button>
                      </div>
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
                    </>
                  )}
                </SortableTile>
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
    );
  }

  return (
    <div className="image-gallery-area">
      {content}
      <ImageViewer
        collectionId={collectionId}
        itemId={itemId}
        itemName={itemName}
        photos={media.data ?? []}
        index={viewing}
        onIndexChange={setViewing}
        onClose={() => setViewing(null)}
        returnFocusTo={(index) => {
          const id = media.data?.[index]?.id;
          return id ? document.querySelector<HTMLElement>(`[data-media-id="${id}"] .image-open`) : null;
        }}
      />
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
