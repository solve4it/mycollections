import { expect, focusedControl, NOTHING_FOCUSED, tabOrder, test } from "./fixtures.js";

/**
 * The keyboard pass over every route (#24): tab order, no traps, and every
 * action operable without a pointer.
 *
 * Distinct from the `keyboard access` block in `a11y.spec.ts`, which is about
 * focus *management* — the skip link, and where focus lands across a navigation.
 * This file is about traversal: what a keyboard user meets, in what order, on
 * each screen, and whether pressing a key on it does the thing.
 *
 * Every expectation is the ARIA role and accessible name of each stop, in order,
 * as Playwright computes them — so an assertion failing here is reporting the
 * words a screen reader would say, not a CSS selector. A control that lost its
 * label, gained a second one, or moved in the sequence all show up as a diff of
 * two readable lists.
 *
 * What this file does **not** assert is where focus goes after an action, which
 * is where the sweep found the app wanting: focus is orphaned to `<body>` by six
 * actions that remove the control holding it (#367) and by seven that disable it
 * mid-mutation (#368). Those belong to their own issues rather than here, because
 * pinning the current answer would be writing the bug into the suite — and the
 * answer the specs will want is the name of the control focus *should* land on,
 * which is a design decision those issues make.
 *
 * Two more states this file traverses are knowingly wrong in ways it does not
 * assert: a row's open editor collides DOM ids with the add-item form, so one
 * form's labels double up and the other's vanish (#369), and a collection card
 * is announced code-then-count-then-name (#370).
 */

const FIELDS = [
  { id: "title", label: "Title", type: "text", required: true },
  { id: "year", label: "Year", type: "number" },
];

const SKIP_LINK = 'link "Skip to main content"';
const NAV = ['link "Collections"', 'link "Settings"'];

/**
 * The whole tab sequence for a screen, given the stops its own content adds.
 *
 * The nav's position is the structural claim, and it is different in the two
 * projects rather than merely styled differently: `.shell-sidebar` is
 * `display: none` below 768px and `.shell-bottom-nav` is `display: none` above
 * it (global.css), and `display: none` takes an element out of the tab order
 * altogether. So the same DOM is two genuinely different journeys — through the
 * cabinet and then into the drawer at desktop width, through the drawer and out
 * to the bottom bar on a phone — and the skip link is what makes the second one
 * bearable. Said once here so each screen below only has to declare itself.
 */
function wholeSequence(content: string[]): string[] {
  return onMobile() ? [SKIP_LINK, ...content, ...NAV] : [SKIP_LINK, ...NAV, ...content];
}

/**
 * The stops from wherever focus already is to the end of the document, for a
 * walk that starts mid-page rather than from a fresh load.
 *
 * Which is the only way to ask what a user meets *after* acting on something:
 * Chromium keeps a sequential focus navigation starting point where the removed
 * control was, so Tab resumes there rather than at the top. The nav is the only
 * difference from `wholeSequence` — on a phone it is after the content and so
 * still ahead of the walk, while the sidebar has long since been passed.
 */
function restOfSequence(content: string[]): string[] {
  return onMobile() ? [...content, ...NAV] : content;
}

function onMobile(): boolean {
  return test.info().project.name === "mobile-dark";
}

/**
 * Walks the page from the top and asserts the stops, naming the screen in the
 * failure so a diff of two long lists says which one it is about.
 */
async function expectTabOrder(page: import("@playwright/test").Page, screen: string, content: string[]): Promise<void> {
  expect(await tabOrder(page), `the tab order of ${screen}`).toEqual(wholeSequence(content));
}

/**
 * Drops a collection's catalog code to a placeholder.
 *
 * The code is derived from the server-generated id (`lib/cover.ts`), so it is a
 * different two characters every run. Everything else about the name — that the
 * code comes first, that the item count follows it, and that the collection's
 * own name comes third — is asserted exactly, because that order is what a
 * screen-reader user hears before they reach the word they were looking for.
 */
function withoutCatalogCode(stops: string[]): string[] {
  return stops.map((stop) => stop.replace(/C-[0-9A-Z]{2}/, "C-xx"));
}

test.describe("keyboard traversal of every screen", () => {
  test.describe("the setup screen", () => {
    // The screen only exists without a token, and the shared context seeds one.
    test.use({ storageState: { cookies: [], origins: [] } });

    test("asking for a token", async ({ page }) => {
      await page.goto("/setup");
      await expect(page.getByLabel("API Token")).toBeVisible();

      await expectTabOrder(page, "the setup screen", ['textbox "API Token"', 'button "Connect"']);
    });
  });

  test("the collections list with no collections", async ({ page, api }) => {
    await api.reset();
    await page.goto("/collections");
    await expect(page.getByRole("heading", { level: 1, name: "No collections yet" })).toBeVisible();

    await expectTabOrder(page, "the empty collections list", ['link "Create collection"']);
  });

  /**
   * Two collections rather than one, with different item counts and only one
   * carrying a description: a card whose name came from the wrong collection, or
   * which dropped the count or the description, could not pass.
   */
  test("the collections list with collections", async ({ page, api }) => {
    await api.reset();
    const vinyl = await api.createCollection({ name: "Vinyl records", description: "Jazz", fields: FIELDS });
    await api.createItem(vinyl.id, { title: "Kind of Blue", year: 1959 });
    await api.createCollection({ name: "Board games", fields: FIELDS });

    await page.goto("/collections");
    await expect(page.getByRole("heading", { level: 1, name: "Collections" })).toBeVisible();

    expect(withoutCatalogCode(await tabOrder(page)), "the tab order of the collections list").toEqual(
      wholeSequence([
        'link "Create collection"',
        'link "C-xx ·1 item Vinyl records Jazz"',
        'link "C-xx ·0 items Board games"',
      ]),
    );
  });

  test("the new collection form", async ({ page, api }) => {
    await api.reset();
    await page.goto("/collections/new");
    await expect(page.getByRole("heading", { level: 1, name: "New collection" })).toBeVisible();

    await expectTabOrder(page, "the new collection form", [
      'textbox "Collection name"',
      'textbox "Description"',
      'checkbox "Finite set (a fixed, known number of items)"',
      'textbox "Field label"',
      'combobox "Field type"',
      'checkbox "Required"',
      'button "Remove field"',
      'button "Add field"',
      'button "Create collection"',
    ]);
  });

  /**
   * The editor, whose every control arrives carrying a stored value — so the
   * stops assert what the form was filled with, not merely that it has fields.
   * Two field rows, the first required and the second not, so a checkbox reading
   * the wrong field's state could not pass either.
   */
  test("the collection editor", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", description: "Jazz", fields: FIELDS });

    await page.goto(`/collections/${collection.id}/edit`);
    await expect(page.getByRole("heading", { level: 1, name: "Edit collection" })).toBeVisible();

    await expectTabOrder(page, "the collection editor", [
      'link "Back to collection"',
      'textbox "Collection name": Vinyl records',
      'textbox "Description": Jazz',
      'checkbox "Finite set (a fixed, known number of items)"',
      'textbox "Field label": Title',
      'combobox "Field type"',
      'checkbox "Required" [checked]',
      'button "Remove field"',
      'textbox "Field label": Year',
      'combobox "Field type"',
      'checkbox "Required"',
      'button "Remove field"',
      'button "Add field"',
      'button "Save changes"',
    ]);
  });

  /**
   * A collection with items: the row actions come in pairs, one pair per item,
   * and the add-item form is last. The undo-toast region sits between them and
   * contributes nothing while it is empty, which is the point of it being
   * mounted empty rather than conditionally (#308).
   */
  test("a collection with items", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.createItem(collection.id, { title: "Blue Train", year: 1957 });

    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Vinyl records" })).toBeVisible();

    await expectTabOrder(page, "a collection with items", [
      'link "All collections"',
      'link "Edit collection"',
      'button "Edit"',
      'button "Delete"',
      'button "Edit"',
      'button "Delete"',
      'combobox "Status"',
      'textbox "Title"',
      'spinbutton "Year"',
      'button "Save"',
    ]);
  });

  /**
   * Settings with something in the trash, which is the only state in which the
   * trash contributes controls at all — and the longest sequence in the app.
   */
  test("settings, with something in the trash", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.deleteItem(collection.id, item.id);

    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();

    await expectTabOrder(page, "settings with a full trash", [
      'combobox "Language"',
      'combobox "Theme"',
      'button "Export data"',
      'button "Choose backup file"',
      'button "Restore"',
      'button "Delete forever"',
      'button "Empty trash"',
      'checkbox "Record error reports" [checked]',
      'button "Disconnect"',
    ]);
  });

  test("an address with no page behind it", async ({ page }) => {
    await page.goto("/nope/not-a-page");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();

    await expectTabOrder(page, "the not-found screen", ['link "Back to collections"', 'link "Go to settings"']);
  });
});

test.describe("no screen traps focus", () => {
  /**
   * Forward and back over the longest sequence in the app.
   *
   * `tabOrder` already proves the forward half — it only returns once focus has
   * run off the end of the document, and throws if it never does (WCAG 2.1.2).
   * This adds the half that a one-way walk cannot see: that Shift+Tab retraces
   * the same stops rather than a different set, which is what a control with a
   * positive `tabindex` or a hand-managed `onKeyDown` would break.
   */
  test("Shift+Tab retraces the same stops in reverse", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.deleteItem(collection.id, item.id);

    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();

    const forward = await tabOrder(page);
    // The walk left focus off the end of the sequence, so the first Shift+Tab
    // lands on the last stop — the same element the forward walk finished on.
    const backward: string[] = [];
    for (let index = 0; index < forward.length; index++) {
      await page.keyboard.press("Shift+Tab");
      backward.push(await focusedControl(page));
    }

    expect(backward, "Shift+Tab must retrace the forward sequence").toEqual([...forward].reverse());
    // And back out the top, rather than cycling inside the page.
    await page.keyboard.press("Shift+Tab");
    expect(await focusedControl(page), "Shift+Tab off the top must leave the page").toBe(NOTHING_FOCUSED);
  });
});

test.describe("every action is operable without a pointer", () => {
  /**
   * The row actions and the editor they open, driven by key alone.
   *
   * Space as well as Enter, because they are not interchangeable: a `<button>`
   * answers both, while an anchor styled as a button answers only Enter — so a
   * control that stopped being a real button would still pass an Enter-only
   * test. Both row actions here are buttons and must take either key.
   */
  test("a row's edit and delete, and the editor's save", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });

    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Vinyl records" })).toBeVisible();

    const rowEditor = page.getByRole("list").getByRole("button", { name: "Save" });

    // Space opens the editor.
    await page.getByRole("button", { name: "Edit" }).focus();
    await page.keyboard.press(" ");
    await expect(rowEditor, "Space on a row's Edit must open its editor").toBeVisible();

    // Enter closes it again, discarding the edit.
    await page.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Enter");
    await expect(rowEditor, "Enter on Cancel must close the editor").toHaveCount(0);

    // Enter deletes, and the value is gone from the list rather than merely
    // greyed: the row is what carries it.
    await page.getByRole("button", { name: "Delete" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listitem"), "Enter on Delete must remove the row").toHaveCount(0);
    await expect(page.locator(".item-list")).toHaveCount(0);
  });

  /**
   * The undo shortcut, which is the app's one action with a deadline on it, and
   * the only one a keyboard user could lose by not reaching in time (#33).
   */
  test("the undo toast's undo and dismiss", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.createItem(collection.id, { title: "Blue Train", year: 1957 });

    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("listitem")).toHaveCount(2);

    // Deleted by key, from the row's own button, so the walk below starts where
    // a keyboard user actually is when the toast appears.
    await page.getByRole("button", { name: "Delete" }).first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listitem")).toHaveCount(1);

    /**
     * Both of the toast's controls are in the sequence, two stops past the row
     * that was deleted — between the surviving rows above and the add-item form
     * below.
     *
     * Which is the whole answer to whether the shortcut can be reached inside
     * `UNDO_WINDOW_MS`: it costs two keystrokes from where the delete left the
     * user, not a traversal of the page, however many items the collection has.
     * Chromium resumes the sequence at the removed row rather than at the top of
     * the document — the one mercy in the focus loss this leaves behind.
     */
    expect(await tabOrder(page), "the tab order from a delete to the undo shortcut").toEqual(
      restOfSequence([
        'button "Edit"',
        'button "Delete"',
        'button "Undo"',
        'button "Dismiss"',
        'combobox "Status"',
        'textbox "Title"',
        'spinbutton "Year"',
        'button "Save"',
      ]),
    );

    // Space on Undo puts the item back.
    await page.getByRole("button", { name: "Undo" }).focus();
    await page.keyboard.press(" ");
    await expect(page.getByRole("listitem"), "Space on Undo must restore the item").toHaveCount(2);

    // And the toast's other control closes it without undoing anything.
    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await page.getByRole("button", { name: "Dismiss" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Undo" }), "Enter on Dismiss must close the toast").toHaveCount(0);
    await expect(page.getByRole("listitem"), "dismissing must not restore the item").toHaveCount(1);
  });

  /**
   * A destructive action's confirmation, which is the one place in the app that
   * manages focus by hand (`ConfirmButton.tsx`) — and the model the sites in
   * #367 should follow. Pinned here because it is the behavior that fix will be
   * measured against, and the one piece of it already working.
   *
   * The confirm button is deliberately *behind* the cancel button: focus opens
   * on the safe option, and the one that destroys data is a Shift+Tab away
   * rather than the next thing a forward Tab reaches.
   */
  test("a confirmation opens on its safe option and hands focus back", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.deleteItem(collection.id, item.id);

    await page.goto("/settings");
    const trigger = page.getByRole("button", { name: "Empty trash" });
    await expect(trigger).toBeVisible();

    await trigger.focus();
    await page.keyboard.press(" ");
    await expect(page.getByRole("alert")).toContainText("Permanently delete 0 collections and 1 item?");
    expect(await focusedControl(page), "the question must open on its safe option").toBe('button "Cancel"');

    // The destructive option is reachable, one stop back.
    await page.keyboard.press("Shift+Tab");
    expect(await focusedControl(page), "the confirm must sit behind the cancel").toBe('button "Empty trash"');

    // Cancelling hands focus back to the button that asked.
    await page.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await focusedControl(page), "cancelling must return focus to the trigger").toBe('button "Empty trash"');
  });

  /**
   * The schema builder's two controls, which are the only way to change how many
   * fields a collection has.
   */
  test("adding and removing a field in the schema builder", async ({ page, api }) => {
    await api.reset();
    await page.goto("/collections/new");
    await expect(page.getByRole("heading", { level: 1, name: "New collection" })).toBeVisible();

    const removes = page.getByRole("button", { name: "Remove field" });
    await expect(removes).toHaveCount(1);

    await page.getByRole("button", { name: "Add field" }).focus();
    await page.keyboard.press(" ");
    await expect(removes, "Space on Add field must add a row").toHaveCount(2);

    await page.getByRole("button", { name: "Add field" }).focus();
    await page.keyboard.press("Enter");
    await expect(removes, "Enter on Add field must add a row").toHaveCount(3);

    // Removing names the row it removed: the first field is labelled, so the
    // label is what must be gone afterwards rather than merely a count.
    await page.getByRole("textbox", { name: "Field label" }).first().fill("Title");
    await removes.first().press("Enter");
    await expect(removes, "Enter on Remove field must remove that row").toHaveCount(2);
    await expect(
      page.getByRole("textbox", { name: "Field label" }).first(),
      "the row that was removed must be the one that was asked for",
    ).toHaveValue("");
  });

  /**
   * Settings' own controls. The file picker is the one to prove: it is a native
   * `<input type="file">` (#337), and a keyboard user reaching it must find a
   * named, operable control rather than an unlabelled one.
   */
  test("the settings controls, including the file picker", async ({ page, api }) => {
    await api.reset();
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

    // The theme select, operated by keyboard, actually changes the theme.
    const theme = page.getByRole("combobox", { name: "Theme" });
    await theme.focus();
    await theme.selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const picker = page.getByRole("button", { name: "Choose backup file" });
    await picker.focus();
    expect(await focusedControl(page), "the file picker must be reachable and named").toBe(
      'button "Choose backup file"',
    );

    const toggle = page.getByRole("checkbox", { name: "Record error reports" });
    await toggle.focus();
    await page.keyboard.press(" ");
    await expect(toggle, "Space must toggle the error-reporting checkbox").not.toBeChecked();
  });

  /**
   * Leaving a screen by keyboard. `Enter` on a link is a navigation, and the
   * nav's links are outside the pathname-keyed wrapper so they keep focus across
   * it — asserted here as the operability claim rather than the focus one, which
   * `a11y.spec.ts` owns.
   */
  test("the nav and a content link both navigate on Enter", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });

    await page.goto("/collections");
    await page.getByRole("link", { name: /Vinyl records/ }).press("Enter");
    await expect(page).toHaveURL(`/collections/${collection.id}`);

    await page.getByRole("link", { name: "Edit collection" }).press("Enter");
    await expect(page).toHaveURL(`/collections/${collection.id}/edit`);

    await page.getByRole("link", { name: "Settings" }).first().press("Enter");
    await expect(page).toHaveURL(/\/settings$/);
  });
});
