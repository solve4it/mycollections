import type { FieldDefinition } from "@mycollections/core";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAnnounce } from "../lib/announcer.js";
import type { TagValues } from "../lib/api-client.js";
import { type FocusDestination, useFocusHandoff } from "../lib/focus-handoff.js";
import { tagValuesQueryKey, useRemoveTag, useRenameTag, useTagValues } from "../lib/queries.js";
import { ConfirmButton } from "./ConfirmButton.js";

/**
 * A tag as the server compares it — spaces trimmed, ASCII letters folded — so
 * the screen finds the row a rename landed on the way the rename matched it.
 * The same rule as `foldTag` in packages/db.
 */
function foldTag(value: string): string {
  return value.replace(/^ +| +$/g, "").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

interface TagManagerProps {
  collectionId: string;
  /** The stored schema — a tags field added but not saved has no tags yet. */
  fields: FieldDefinition[];
}

/**
 * "Tags in use" for each tags field (#41): rename a tag on every item that
 * carries it (merging into a tag already in use), or remove it.
 *
 * Its own sections, after the collection form and outside it: Enter in a
 * rename box must submit that rename, not the schema draft.
 */
export function TagManager({ collectionId, fields }: TagManagerProps) {
  const tagFields = fields.filter((field) => field.type === "tags");
  if (tagFields.length === 0) return null;
  return (
    <>
      {tagFields.map((field) => (
        <TagFieldSection key={field.id} collectionId={collectionId} field={field} />
      ))}
    </>
  );
}

function TagFieldSection({ collectionId, field }: { collectionId: string; field: FieldDefinition }) {
  const { t } = useTranslation("collections");
  const headingId = useId();
  const searchId = useId();
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const tags = useTagValues(collectionId, field.id, true, q);
  const rename = useRenameTag(collectionId);
  const remove = useRemoveTag(collectionId);
  const announce = useAnnounce();
  const handOffFocus = useFocusHandoff();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  // One tag change at a time. Each mutation's own callbacks fire only for its
  // latest call, so a second rename or removal sent while one is in flight
  // would lose the first one's announcement and focus handoff.
  const busy = rename.isPending || remove.isPending;

  /** Whether the tag list on screen — this search's — holds a tag, after a change has been fetched again. */
  function listed(value: string): boolean {
    const data = queryClient.getQueryData<TagValues>(tagValuesQueryKey(collectionId, field.id, q));
    return data?.values.some((entry) => foldTag(entry.value) === foldTag(value)) ?? false;
  }

  /** What a change also did in the trash, said after the live count the prompt asked about. */
  function trashNote(trashed: number, preposition: "from" | "on"): string {
    if (trashed === 0) return "";
    return preposition === "from" ? t("tags_trash_from", { count: trashed }) : t("tags_trash_on", { count: trashed });
  }

  /** A row's Rename button, found the way the server matches tags. */
  function renameButtonFor(value: string): FocusDestination {
    return () =>
      Array.from(sectionRef.current?.querySelectorAll<HTMLElement>("[data-tag-rename]") ?? []).find(
        (button) => foldTag(button.dataset.tagRename ?? "") === foldTag(value),
      ) ?? null;
  }

  /**
   * Successor rule after a removal: the row now at this index, else the one
   * before, else the heading. It waits (null) while the removed tag is still on
   * screen: the confirm prompt closes a commit before the fetched list arrives,
   * and "the row at this index" would then be the very row about to vanish.
   */
  function successor(index: number, removed: string): FocusDestination {
    return () => {
      const buttons = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>("[data-tag-rename]") ?? []);
      if (buttons.some((button) => button.dataset.tagRename === removed)) return null;
      return buttons[index] ?? buttons[buttons.length - 1] ?? headingRef.current;
    };
  }

  const values = tags.data?.values ?? [];

  return (
    <section className="tag-manager" aria-labelledby={headingId} ref={sectionRef}>
      {/* tabIndex -1: where focus goes when the last tag is removed. */}
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>
        {t("tags_heading", { field: field.label })}
      </h2>
      <div className="form-row">
        <label htmlFor={searchId}>{t("tags_find_label", { field: field.label })}</label>
        <input
          id={searchId}
          ref={searchRef}
          type="search"
          value={q}
          maxLength={200}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>
      {tags.isError && <p role="alert">{t("tags_load_error")}</p>}
      {tags.isSuccess && values.length === 0 && (
        <p className="form-hint">{q.trim() ? t("tags_none_matching") : t("tags_none")}</p>
      )}
      {tags.data?.truncated && <p className="form-hint">{t("tags_truncated")}</p>}
      <ul className="tag-list">
        {values.map((tag, index) => (
          <li key={tag.value} className="tag-row">
            {renaming === tag.value ? (
              <RenameForm
                tag={tag.value}
                pending={rename.isPending}
                onCancel={() => {
                  handOffFocus(renameButtonFor(tag.value));
                  setRenaming(null);
                }}
                onSubmit={(to) => {
                  if (busy) return;
                  rename.mutate(
                    { field: field.id, from: tag.value, to },
                    {
                      // Runs after the tag list has been fetched again. The
                      // destination is the renamed row, or the row it merged
                      // into — unless the new name is not in this list (a
                      // search it no longer matches, or past the fifty shown),
                      // and then the search box, where it can be found.
                      onSuccess: ({ updated, trashed, merged }) => {
                        handOffFocus(listed(to) ? renameButtonFor(to) : () => searchRef.current);
                        setRenaming((current) => (current === tag.value ? null : current));
                        const said =
                          foldTag(to) === foldTag(tag.value)
                            ? t("tags_tidied", { tag: to, count: updated })
                            : merged
                              ? t("tags_merged", { from: tag.value, to, count: updated })
                              : t("tags_renamed", { from: tag.value, to, count: updated });
                        announce(said + trashNote(trashed, "on"));
                      },
                    },
                  );
                }}
              />
            ) : (
              <>
                <span className="tag-name">{tag.value}</span>
                <span className="tag-count">{t("tags_count", { count: tag.count })}</span>
                <div className="tag-actions">
                  <button
                    type="button"
                    className="touch-target button-quiet"
                    data-tag-rename={tag.value}
                    aria-label={t("tags_rename_named", { tag: tag.value })}
                    aria-disabled={busy || undefined}
                    onClick={() => {
                      if (busy) return;
                      setRenaming(tag.value);
                    }}
                  >
                    {t("tags_rename")}
                  </button>
                  <ConfirmButton
                    label={t("tags_remove")}
                    accessibleLabel={t("tags_remove_named", { tag: tag.value })}
                    prompt={t("tags_remove_prompt", { tag: tag.value, count: tag.count })}
                    confirmLabel={t("tags_remove_confirm")}
                    cancelLabel={t("tags_remove_cancel")}
                    pending={remove.isPending && remove.variables?.value === tag.value}
                    onConfirm={() => {
                      if (busy) return;
                      remove.mutate(
                        { field: field.id, value: tag.value },
                        {
                          onSuccess: ({ updated, trashed }) => {
                            handOffFocus(successor(index, tag.value));
                            announce(
                              t("tags_removed", { tag: tag.value, count: updated }) + trashNote(trashed, "from"),
                            );
                          },
                        },
                      );
                    }}
                  />
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {(rename.isError || remove.isError) && <p role="alert">{t("tags_change_error")}</p>}
    </section>
  );
}

interface RenameFormProps {
  tag: string;
  pending: boolean;
  onSubmit: (to: string) => void;
  onCancel: () => void;
}

/** The inline rename: a form of its own, opened with focus in its box (disclosure rule). */
function RenameForm({ tag, pending, onSubmit, onCancel }: RenameFormProps) {
  const { t } = useTranslation("collections");
  const id = useId();
  const [value, setValue] = useState(tag);
  const [hasComma, setHasComma] = useState(false);
  return (
    <form
      className="tag-rename"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const to = value.trim();
        if (!to) return;
        // The item form splits tags on commas; the server refuses them too.
        if (to.includes(",")) {
          setHasComma(true);
          return;
        }
        setHasComma(false);
        onSubmit(to);
      }}
    >
      <label htmlFor={id}>{t("tags_new_name", { tag })}</label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={200}
        // biome-ignore lint/a11y/noAutofocus: the disclosure rule — the user asked to rename, so the box takes focus
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      {hasComma && <p role="alert">{t("tags_no_comma")}</p>}
      <button type="submit" className="touch-target" aria-disabled={pending || undefined}>
        {t("tags_save")}
      </button>
      <button type="button" className="touch-target button-quiet" onClick={onCancel}>
        {t("tags_cancel")}
      </button>
    </form>
  );
}
