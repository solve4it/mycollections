import { TARGET_COUNT_MAX } from "@mycollections/core";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { scopedId } from "../lib/dom-id.js";
import { formatNumber } from "../lib/intl.js";

/**
 * Whether a collection is a finite set, and — only once it is — how many items
 * the set has (#42). Shared by the new-collection form and the collection
 * editor, which each used to carry their own copy of the checkbox under a
 * literal id.
 *
 * The target is held as the text in the box, not as a number, so a box the user
 * has emptied stays empty instead of snapping to 0, and unchecking finite only
 * hides the box: its draft survives being checked again. What gets sent is
 * decided once, by `targetCountFromDraft`.
 *
 * Out-of-range, fractional and non-numeric input are the browser's to refuse,
 * the same way these forms already refuse a missing name: `min`, `max` and
 * `step` make the input invalid, a form without `noValidate` will not submit
 * while it is, and the browser says why at the control. The hint states the rule
 * up front so nobody has to fail to learn it, and the server stays the authority
 * — a refusal there shows the form's usual alert.
 */
export interface FiniteSetFieldsProps {
  isFiniteSet: boolean;
  /** The target as typed: `""` for none. */
  targetCount: string;
  onFiniteSetChange: (isFiniteSet: boolean) => void;
  onTargetCountChange: (targetCount: string) => void;
}

export function FiniteSetFields({
  isFiniteSet,
  targetCount,
  onFiniteSetChange,
  onTargetCountChange,
}: FiniteSetFieldsProps) {
  const { t, i18n } = useTranslation("collections");
  // From `useId()`, never a literal (#369): two copies on one screen would
  // otherwise label the first twice and leave the second unnamed.
  const idPrefix = useId();
  const finiteId = scopedId(idPrefix, "finite");
  const targetId = scopedId(idPrefix, "target");
  const hintId = scopedId(idPrefix, "target-hint");
  const max = formatNumber(TARGET_COUNT_MAX, i18n.resolvedLanguage ?? i18n.language);

  return (
    <>
      <div className="form-row">
        <label htmlFor={finiteId} className="checkbox-row">
          <input
            id={finiteId}
            type="checkbox"
            checked={isFiniteSet}
            onChange={(e) => onFiniteSetChange(e.target.checked)}
          />
          {t("finite_label")}
        </label>
      </div>

      {isFiniteSet && (
        <div className="form-row">
          <label htmlFor={targetId}>{t("target_label")}</label>
          <input
            id={targetId}
            type="number"
            inputMode="numeric"
            min={1}
            max={TARGET_COUNT_MAX}
            step={1}
            value={targetCount}
            onChange={(e) => onTargetCountChange(e.target.value)}
            aria-describedby={hintId}
          />
          <p id={hintId} className="field-hint">
            {t("target_hint", { max })}
          </p>
        </div>
      )}
    </>
  );
}

/**
 * The `targetCount` a create or an edit sends: the typed number for a finite
 * set, and `null` for an empty box or for a collection that is not a finite set
 * — never omitted, so an edit that unchecks finite or empties the box clears the
 * stored target instead of leaving it in place.
 *
 * A number input's `value` is already sanitized by the browser — anything that
 * does not parse as a number reads as `""` — so the only text reaching here is
 * empty or numeric, and constraint validation has refused a fraction or an
 * out-of-range number before submit.
 */
export function targetCountFromDraft(isFiniteSet: boolean, draft: string): number | null {
  if (!isFiniteSet || draft.trim() === "") return null;
  return Number(draft);
}

/** A stored target as the text that fills the box. */
export function targetCountToDraft(targetCount: number | null): string {
  return targetCount === null ? "" : String(targetCount);
}
