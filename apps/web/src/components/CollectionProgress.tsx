import { type Collection, collectionProgress } from "@mycollections/core";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon.js";

interface CollectionProgressProps {
  collection: Pick<Collection, "isFiniteSet" | "targetCount">;
  /** Live owned items — the dashboard list's `ownedCount`, or the counts route's `owned`. */
  ownedCount: number;
  /**
   * The collection page has just watched an action complete the set (#42): the
   * Complete badge stamps once. Never on the card, and never on landing on a
   * set that was already complete — only the transition is news.
   */
  celebrating?: boolean;
}

/**
 * A finite set's progress toward its target (#42): "3 of 5 collected", a bar,
 * and a "Complete" badge once owned reaches the target. The same widget on the
 * dashboard card and the collection header.
 *
 * The words are the content. The track and fill are `aria-hidden` spans that
 * repeat them for the eye — not a `<progress>` or `<meter>`, which inside the
 * card's link would add their value to its name a second time, and of which
 * `<progress>` would clamp an over-target set ("6 of 5") to its max. The count
 * is never capped; only the fill is.
 *
 * The fill width is set as `inline-size` directly, never through a custom
 * property: `--progress` is already the manila-ink color token, and declaring
 * it on an element would shadow the color for the subtree and paint the fill
 * an invalid color (the class of bug #223 hit with `--cover-hue`).
 *
 * Renders nothing when there is nothing to measure — not a finite set, or one
 * whose size is not known yet. The collection header explains the latter
 * itself; the card stays silent rather than nag from the dashboard.
 */
export function CollectionProgress({ collection, ownedCount, celebrating = false }: CollectionProgressProps) {
  const { t } = useTranslation("collections");
  const progress = collectionProgress(collection, ownedCount);
  if (!progress) return null;

  let className = "collection-progress";
  if (progress.complete) className += " collection-progress-complete";
  // Only a complete set has a badge to stamp.
  if (progress.complete && celebrating) className += " collection-progress-celebrating";

  return (
    <p className={className}>
      <span className="collection-progress-count">
        {t("progress_count", { count: progress.target, owned: progress.owned })}
      </span>
      {progress.complete && (
        <span className="collection-progress-badge">
          <Icon name="check" />
          {t("progress_complete")}
        </span>
      )}
      <span className="collection-progress-track" aria-hidden="true">
        <span className="collection-progress-fill" style={{ inlineSize: `${progress.fraction * 100}%` }} />
      </span>
    </p>
  );
}
