import { ITEM_VIEWS, type ItemView } from "@mycollections/core";
import { useId } from "react";
import { useTranslation } from "react-i18next";

interface ItemViewSelectProps {
  value: ItemView;
  onChange: (view: ItemView) => void;
}

/**
 * The collection screen's "View" control (#38): a native `<select>`, the owner's
 * call, so it reads like its neighbor "Sort by" and the theme choice in
 * Settings. It changes a layout and fetches nothing, so it needs no
 * announcement of its own — the select speaks the option chosen — and focus
 * stays on it.
 */
export function ItemViewSelect({ value, onChange }: ItemViewSelectProps) {
  const { t } = useTranslation("items");
  const id = useId();
  return (
    <div className="form-row item-view">
      <label htmlFor={id}>{t("view_label")}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const next = ITEM_VIEWS.find((view) => view === event.target.value);
          if (next) onChange(next);
        }}
      >
        <option value="list">{t("view_list")}</option>
        <option value="grid">{t("view_grid")}</option>
      </select>
    </div>
  );
}
