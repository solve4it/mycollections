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
 * The last two blocks are about where focus is *left*, which is where the sweep
 * first found the app wanting: focus was orphaned to `<body>` by seven controls
 * that disabled themselves mid-mutation (#368) and by seven actions that removed
 * the control holding it (#367). Those blocks assert a specific named control
 * rather than "not `<body>`", which would pass for a focus landing anywhere.
 *
 */

const FIELDS = [
  { id: "title", label: "Title", type: "text", required: true },
  { id: "year", label: "Year", type: "number" },
];

/**
 * A row's controls, which now name the row they act on (#375).
 *
 * Said once here because every one of them appears in both a tab-order
 * expectation and a selector: the sweep's whole contract is that the expected
 * stop and the element a spec reaches for are the same string, so a change to
 * the pattern is one edit rather than forty.
 *
 * The visible label comes first and the row's name after it, which is not
 * merely tidier. WCAG 2.5.3 Label in Name (Level A) requires the visible label
 * to appear in the accessible name as a contiguous run, so
 * `Delete forever “Kind of Blue”` passes where the issue's own suggestion,
 * "Delete Kind of Blue forever", splits "Delete forever" and does not. That is
 * machine-checkable rather than a matter of taste: axe's
 * `label-content-name-mismatch` is tagged `wcag21a`, which `fixtures.ts`
 * includes, so the wrong shape would turn the scans in `a11y.spec.ts` red on
 * every row.
 */
const editName = (item: string) => `Edit “${item}”`;
const deleteName = (item: string) => `Delete “${item}”`;
const restoreName = (row: string) => `Restore “${row}”`;
const purgeName = (row: string) => `Delete forever “${row}”`;
const markName = (item: string) => `Mark collected “${item}”`;

/**
 * The same controls as tab stops, which carry one more thing than a selector
 * does: Playwright appends an element's text content to the stop when the
 * accessible name differs from it, so a stop reads
 * `button "Edit “Kind of Blue”": Edit`.
 *
 * That is the 2.5.3 relationship written out — announced name on the left,
 * visible label on the right — so these expectations fail both if a row stops
 * naming itself and if the visible label drifts out of the name it is supposed
 * to be contained in.
 */
const editStop = (item: string) => `button "${editName(item)}": Edit`;
const deleteStop = (item: string) => `button "${deleteName(item)}": Delete`;
const restoreStop = (row: string) => `button "${restoreName(row)}": Restore`;
const purgeStop = (row: string) => `button "${purgeName(row)}": Delete forever`;
const markStop = (item: string) => `button "${markName(item)}": Mark collected`;

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

test.describe("keyboard traversal of every screen", () => {
  test.describe("the setup screen", () => {
    // The screen only exists without a token, and the shared context seeds one.
    test.use({ storageState: { cookies: [], origins: [] } });

    /**
     * The form and nothing else (#371). The shell's nav and skip link are not
     * on this screen: every destination they offered redirected straight back
     * here, so "Collections" was a link that did nothing and said nothing. With
     * no token there is nowhere else to go, so the first-run screen offers
     * nowhere else.
     */
    test("asking for a token", async ({ page }) => {
      await page.goto("/setup");
      await expect(page.getByLabel("API Token")).toBeVisible();

      expect(await tabOrder(page), "the tab order of the setup screen").toEqual([
        'textbox "API Token"',
        'button "Connect"',
      ]);
    });

    /**
     * Settings is guarded like every other screen (#371). Without the guard it
     * rendered with every query unauthenticated, offering to disconnect a token
     * that was never there.
     */
    test("settings without a token goes to setup", async ({ page }) => {
      await page.goto("/settings");
      await expect(page).toHaveURL(/\/setup$/);
      await expect(page.getByLabel("API Token")).toBeVisible();
      await expect(page.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
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
   *
   * And three finite sets (#42): the progress is inside the card's link, so it
   * is part of what the card is called — last, after the name, so a user still
   * hears which collection before how far along it is. Owned items only (the
   * coin set's wanted coin is not counted), "Complete" only once owned reaches
   * the target, and nothing at all on a finite set with no target (R6).
   */
  test("the collections list with collections", async ({ page, api }) => {
    await api.reset();
    const vinyl = await api.createCollection({ name: "Vinyl records", description: "Jazz", fields: FIELDS });
    await api.createItem(vinyl.id, { title: "Kind of Blue", year: 1959 });
    await api.createCollection({ name: "Board games", fields: FIELDS });
    const coins = await api.createCollection({ name: "Coin set", fields: FIELDS, isFiniteSet: true, targetCount: 3 });
    await api.createItem(coins.id, { title: "Penny" }, "owned");
    await api.createItem(coins.id, { title: "Nickel" }, "wanted");
    const stamps = await api.createCollection({ name: "Stamp set", fields: FIELDS, isFiniteSet: true, targetCount: 1 });
    await api.createItem(stamps.id, { title: "Penny Black" }, "owned");
    await api.createCollection({ name: "Card set", fields: FIELDS, isFiniteSet: true });

    await page.goto("/collections");
    await expect(page.getByRole("heading", { level: 1, name: "Collections" })).toBeVisible();

    // The name first, then the count (#370). The catalog code is not in the
    // name at all — it is a cover ornament derived from the id — and nor is the
    // drawn `·` between it and the count. Asserted exactly, with no
    // placeholder for the code: one leaking back in would differ every run and fail here.
    expect(await tabOrder(page), "the tab order of the collections list").toEqual(
      wholeSequence([
        'link "Create collection"',
        'link "Vinyl records 1 item Jazz"',
        'link "Board games 0 items"',
        'link "Coin set 2 items 1 of 3 collected"',
        'link "Stamp set 1 item 1 of 1 collected Complete"',
        'link "Card set 0 items"',
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
   * The same form once Space has made it a finite set (#42): the target box
   * appears directly after the checkbox that asked for it, so the next Tab
   * reaches it, and the box carries what was typed. Walked from the checkbox
   * because that is where the keyboard user is — the stops before it are
   * asserted, unchanged, by the test above.
   */
  test("the new collection form as a finite set", async ({ page, api }) => {
    await api.reset();
    await page.goto("/collections/new");
    await expect(page.getByRole("heading", { level: 1, name: "New collection" })).toBeVisible();

    const finite = page.getByRole("checkbox", { name: "Finite set (a fixed, known number of items)" });
    await finite.focus();
    await page.keyboard.press(" ");
    await expect(finite, "Space on the finite checkbox must check it").toBeChecked();
    await page.getByRole("spinbutton", { name: "Number of items in the set" }).fill("102");
    await finite.focus();

    expect(await tabOrder(page), "the tab order of the new collection form as a finite set").toEqual(
      restOfSequence([
        'spinbutton "Number of items in the set": "102"',
        'textbox "Field label"',
        'combobox "Field type"',
        'checkbox "Required"',
        'button "Remove field"',
        'button "Add field"',
        'button "Create collection"',
      ]),
    );
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

  /** The editor of a finite set with a target (#42): the box follows the checkbox, filled with the stored target. */
  test("the collection editor of a finite set", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({
      name: "Pokémon Base Set",
      fields: FIELDS,
      isFiniteSet: true,
      targetCount: 102,
    });

    await page.goto(`/collections/${collection.id}/edit`);
    await expect(page.getByRole("heading", { level: 1, name: "Edit collection" })).toBeVisible();

    await expectTabOrder(page, "the collection editor of a finite set", [
      'link "Back to collection"',
      'textbox "Collection name": Pokémon Base Set',
      'textbox "Description"',
      'checkbox "Finite set (a fixed, known number of items)" [checked]',
      'spinbutton "Number of items in the set": "102"',
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
   *
   * The status tabs (#42) are one stop, the selected tab — the others are a
   * roving tabindex away, on the arrow keys — and then the panel, which is a
   * stop of its own because what it opens on is text, not a control.
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
      'searchbox "Search items"',
      'combobox "Sort by"',
      'button "Filters"',
      'tab "All" [selected]',
      'tabpanel "All"',
      editStop("Kind of Blue"),
      deleteStop("Kind of Blue"),
      editStop("Blue Train"),
      deleteStop("Blue Train"),
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
    await expect(page.getByRole("button", { name: restoreName("Kind of Blue") })).toBeVisible();

    await expectTabOrder(page, "settings with a full trash", [
      'combobox "Language"',
      'combobox "Theme"',
      'button "Export data"',
      'button "Choose backup file"',
      restoreStop("Kind of Blue"),
      purgeStop("Kind of Blue"),
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
    await expect(page.getByRole("button", { name: restoreName("Kind of Blue") })).toBeVisible();

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
    await page.getByRole("button", { name: editName("Kind of Blue") }).focus();
    await page.keyboard.press(" ");
    await expect(rowEditor, "Space on a row's Edit must open its editor").toBeVisible();

    // Enter closes it again, discarding the edit.
    await page.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Enter");
    await expect(rowEditor, "Enter on Cancel must close the editor").toHaveCount(0);

    // Enter deletes, and the value is gone from the list rather than merely
    // greyed: the row is what carries it.
    await page.getByRole("button", { name: deleteName("Kind of Blue") }).focus();
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
    await page.getByRole("button", { name: deleteName("Kind of Blue") }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listitem")).toHaveCount(1);

    /**
     * Both of the toast's controls are in the sequence, two stops past where the
     * delete left the user — between the surviving rows above and the add-item
     * form below.
     *
     * Which is the whole answer to whether the shortcut can be reached inside
     * `UNDO_WINDOW_MS`: it costs two keystrokes, not a traversal of the page,
     * however many items the collection has. The walk starts one stop further
     * down than it used to, because focus now lands on the surviving row's Edit
     * rather than on `<body>` (#367) — so that button is behind the user, not
     * ahead of them.
     */
    expect(await tabOrder(page), "the tab order from a delete to the undo shortcut").toEqual(
      restOfSequence([
        deleteStop("Blue Train"),
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
    await page.getByRole("button", { name: deleteName("Kind of Blue") }).click();
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
    await expect(page.locator(".confirm-prompt")).toContainText("Permanently delete 0 collections and 1 item?");
    expect(await focusedControl(page), "the question must open on its safe option").toBe('button "Cancel"');

    // The destructive option is reachable, one stop back.
    await page.keyboard.press("Shift+Tab");
    expect(await focusedControl(page), "the confirm must sit behind the cancel").toBe('button "Empty trash"');

    // Cancelling hands focus back to the button that asked.
    await page.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".confirm-prompt")).toHaveCount(0);
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

/**
 * Where focus is while an action is in flight (#368).
 *
 * Chrome drops `document.activeElement` to `<body>` the moment the focused
 * element becomes `disabled`, so a control disabled for the duration of its own
 * mutation throws a keyboard user out of the page by doing its job — nothing
 * unmounts, and focus is gone anyway. The idiom that keeps them is
 * `aria-disabled` plus a handler that refuses: the control stays in the tab
 * order, keeps its accessible name, and announces its own state.
 *
 * Every spec here holds the request open and reads focus *while* the pending
 * state is on screen, because the bug is invisible to a spec that only looks
 * afterwards — by then the control is enabled again and focus has already been
 * lost and not returned.
 */

interface HeldRequest {
  /** Resolves once the request has arrived and is being held open. */
  arrived: Promise<void>;
  /** Lets it through to the server. */
  release: () => void;
}

/**
 * Holds the first matching request open so the pending state can be observed.
 *
 * Matching on method as well as URL because the globs below would otherwise
 * catch the query that loads the screen: `/api/collections` is both the list and
 * the create. A request that does not match is handed on with `fallback()`
 * rather than continued, so the page fixture's foreign-origin guard and any
 * other handler still see it.
 */
async function holdRequest(page: import("@playwright/test").Page, url: string, method: string): Promise<HeldRequest> {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let announceArrival = (): void => {};
  const arrived = new Promise<void>((resolve) => {
    announceArrival = resolve;
  });

  await page.route(url, async (route) => {
    if (route.request().method() !== method) return await route.fallback();
    announceArrival();
    await gate;
    await route.continue();
  });

  return { arrived, release };
}

/**
 * Waits until the control is marked as busy, whichever way it is marked.
 *
 * Without this the focus assertions below race React: `holdRequest` resolves
 * when the request leaves the browser, which is before the pending render has
 * been committed — so a read of focus could land in the gap and see the control
 * still focused, passing over the very bug it is there to catch. Both markings
 * count, because the fix changes which one it is: `disabled` is what drops focus
 * today, `aria-disabled` is what must replace it.
 */
async function expectMarkedBusy(control: import("@playwright/test").Locator): Promise<void> {
  await expect(async () => {
    const marked = await control.evaluate(
      (el) => el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
    );
    expect(marked, "the control must mark itself busy while its action is in flight").toBe(true);
  }).toPass({ timeout: 5_000 });
}

test.describe("focus while an action is in flight", () => {
  test("the add form's Save keeps focus while the item saves, and the form clears", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });

    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Vinyl records" })).toBeVisible();

    const held = await holdRequest(page, "**/api/collections/*/items", "POST");
    const title = page.getByRole("textbox", { name: "Title" });
    await title.fill("Kind of Blue");

    const save = page.getByRole("button", { name: "Save" });
    await save.focus();
    await page.keyboard.press("Enter");

    await held.arrived;
    await expectMarkedBusy(save);
    // The busy state is in the name a screen reader hears, which is the other
    // half of the fix: `aria-disabled` is announced where a lost focus was not.
    expect(await focusedControl(page), "focus must stay on Save while the item is saving").toBe(
      'button "Save" [disabled]',
    );

    held.release();
    await expect(page.getByRole("listitem")).toHaveCount(1);
    expect(await focusedControl(page), "focus must still be on Save once the item has saved").toBe('button "Save"');

    // The form is ready for the next item rather than still holding the last
    // one — a form that keeps what it submitted is how a second Enter made a
    // duplicate, with nothing said to explain either.
    await expect(title, "a saved form must not still hold what was submitted").toHaveValue("");
    await expect(page.locator(".add-item-live"), "the add must be announced").toContainText("Added “Kind of Blue”");
  });

  test("a locked field type stays in the tab order with its hint", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", description: "Jazz", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });

    await page.goto(`/collections/${collection.id}/edit`);
    await expect(page.getByRole("heading", { level: 1, name: "Edit collection" })).toBeVisible();

    const type = page.getByRole("combobox", { name: "Field type" }).first();
    await expect(type, "a type whose values are already stored must say it cannot change").toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // `disabled` is the whole bug: it takes the control, and with it the hint it
    // points at, out of the tab order — so the rule explaining why the type is
    // fixed is unreachable by exactly the user who cannot see the grey.
    expect(await type.evaluate((el) => el.hasAttribute("disabled")), "aria-disabled, never disabled").toBe(false);

    const stops = await tabOrder(page);
    expect(
      stops.filter((stop) => stop.startsWith('combobox "Field type"')),
      "both field types must be reachable, the locked one included",
    ).toHaveLength(2);

    const hintId = await type.getAttribute("aria-describedby");
    expect(hintId, "a locked type must point at its explanation").toBeTruthy();
    await expect(page.locator(`#${hintId}`)).toHaveText(
      "Cannot change the type: this collection already has items, and their stored values would not convert.",
    );

    // Reachable, and still refused. Driven by key rather than `selectOption`,
    // which waits for the control to be enabled and treats `aria-disabled` as
    // disabled — it would hang here, which is its own evidence that the state
    // is being read: ArrowDown on a focused `<select>` is what a keyboard user
    // presses, and it is what must bounce.
    await type.focus();
    await page.keyboard.press("ArrowDown");
    await expect(type, "a locked type must refuse the change it is reachable for").toHaveValue("text");
  });

  test("the new collection form's Create keeps focus while it saves", async ({ page, api }) => {
    await api.reset();
    await page.goto("/collections/new");
    await expect(page.getByRole("heading", { level: 1, name: "New collection" })).toBeVisible();

    await page.getByRole("textbox", { name: "Collection name" }).fill("Vinyl records");
    await page.getByRole("textbox", { name: "Field label" }).fill("Title");

    const held = await holdRequest(page, "**/api/collections", "POST");
    const create = page.getByRole("button", { name: "Create collection" });
    await create.focus();
    await page.keyboard.press("Enter");

    await held.arrived;
    await expectMarkedBusy(create);
    expect(await focusedControl(page), "focus must stay on Create collection while it saves").toBe(
      'button "Create collection" [disabled]',
    );

    held.release();
    await expect(page).toHaveURL(/\/collections$/);
  });

  test("the collection editor's Save changes keeps focus while it saves", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });

    await page.goto(`/collections/${collection.id}/edit`);
    await expect(page.getByRole("textbox", { name: "Collection name" })).toHaveValue("Vinyl records");

    const held = await holdRequest(page, "**/api/collections/*", "PATCH");
    const save = page.getByRole("button", { name: "Save changes" });
    await save.focus();
    await page.keyboard.press("Enter");

    await held.arrived;
    await expectMarkedBusy(save);
    expect(await focusedControl(page), "focus must stay on Save changes while it saves").toBe(
      'button "Save changes" [disabled]',
    );

    held.release();
    await expect(page).toHaveURL(`/collections/${collection.id}`);
  });

  test("a trash row's Restore keeps focus while it restores", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.deleteItem(collection.id, item.id);

    await page.goto("/settings");
    const restore = page.getByRole("button", { name: restoreName("Kind of Blue") });
    await expect(restore).toBeVisible();

    const held = await holdRequest(page, "**/api/collections/*/items/*/restore", "POST");
    await restore.focus();
    await page.keyboard.press("Enter");

    await held.arrived;
    await expectMarkedBusy(restore);
    expect(await focusedControl(page), "focus must stay on Restore while the item is being put back").toBe(
      `button "${restoreName("Kind of Blue")}" [disabled]: Restore`,
    );

    held.release();
    await expect(page.getByRole("button", { name: restoreName("Kind of Blue") })).toHaveCount(0);
  });

  test("a confirmation's confirm keeps focus while the action is in flight", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.deleteItem(collection.id, item.id);

    await page.goto("/settings");
    const trigger = page.getByRole("button", { name: "Empty trash" });
    await expect(trigger).toBeVisible();

    await trigger.focus();
    await page.keyboard.press(" ");
    expect(await focusedControl(page), "the question opens on its safe option").toBe('button "Cancel"');

    const held = await holdRequest(page, "**/api/trash", "DELETE");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Enter");

    await held.arrived;
    await expectMarkedBusy(page.getByRole("button", { name: "Empty trash" }));
    expect(await focusedControl(page), "focus must stay on the confirm while it empties the trash").toBe(
      'button "Empty trash" [disabled]',
    );

    held.release();
    await expect(page.getByText("The trash is empty.")).toBeVisible();
  });

  test("the file picker keeps focus while an import runs", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    const backup = await api.exportDocument();

    await page.goto("/settings");
    const picker = page.getByRole("button", { name: "Choose backup file" });
    await expect(picker).toBeVisible();

    const held = await holdRequest(page, "**/api/import", "POST");
    await picker.focus();
    await picker.setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(backup) });

    await held.arrived;
    await expectMarkedBusy(picker);
    expect(await focusedControl(page), "focus must stay on the file picker while the import runs").toBe(
      'button "Choose backup file" [disabled]',
    );

    held.release();
    await expect(page.locator(".import-live")).toContainText("Imported");
  });
});

/**
 * Where focus goes when the control holding it is removed (#367).
 *
 * Six actions in the app take away the control the user is standing on, and
 * focus fell to `<body>` at every one of them: the tab sequence resumes roughly
 * in place, because Chromium keeps its sequential focus navigation starting
 * point at the removed node, but a screen reader's virtual cursor drops to the
 * top of the page and nothing says where the user now is (WCAG 2.4.3).
 *
 * The destinations follow ARIA APG rather than being invented here: the dialog
 * pattern's return-to-invoker rule for anything that closes (Cancel, Save), the
 * disclosure pattern's enter-the-revealed-content rule for anything that opens
 * (Edit), and "Developing a Keyboard Interface" for the successor-row rule after
 * a deletion. Each is asserted as a *specific* control rather than as "not
 * `<body>`", which would pass for a focus landing anywhere at all.
 */
test.describe("focus when the control holding it goes away", () => {
  test("deleting a row hands focus to the row that takes its place", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.createItem(collection.id, { title: "Blue Train", year: 1957 });

    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("listitem")).toHaveCount(2);

    await page.getByRole("button", { name: deleteName("Kind of Blue") }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listitem")).toHaveCount(1);

    // The successor row, not the undo shortcut: the toast announces itself
    // through the page's live region, and parking focus in it would tax every
    // delete to save two keystrokes on the rare one that is regretted.
    await expect(
      page.getByRole("button", { name: editName("Blue Train") }),
      "focus must land on the surviving row's Edit, not on <body>",
    ).toBeFocused();
  });

  test("deleting the last row hands focus to the tab panel, which now holds the empty state", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });

    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("listitem")).toHaveCount(1);

    await page.getByRole("button", { name: deleteName("Kind of Blue") }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listitem")).toHaveCount(0);

    // No row left to go to, and the add-item form is the wrong answer: dropping
    // a user into "add an item" because they deleted their last one is a worse
    // surprise than landing where the list was — the panel, which now says why
    // it is empty (#42; the Items heading before the tabs).
    const panel = page.getByRole("tabpanel", { name: "All" });
    await expect(panel, "an emptied list must hand focus to its panel").toBeFocused();
    // Described by the empty state, so arriving on the panel reads why it is empty.
    await expect(panel).toHaveAccessibleDescription("No items yet Add your first item using the form below.");
  });

  test("opening a row's editor puts focus in the editor, which says which item it is", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });

    await page.goto(`/collections/${collection.id}`);
    const row = page.getByRole("listitem");
    await expect(row).toHaveCount(1);

    await page.getByRole("button", { name: editName("Kind of Blue") }).focus();
    await page.keyboard.press("Enter");

    // The disclosure the user just opened, entered at its first control. The
    // editor replaces the row's fields, so the item's name leaves the screen
    // with them — the form carries it as its own accessible name, which is what
    // is announced on the way in.
    await expect(
      page.getByRole("form", { name: "Editing “Kind of Blue”" }),
      "the editor must say which item it is editing",
    ).toBeVisible();
    // Named, not just found: with the add form on the same screen the two used
    // to share ids, and this control was announced as "Status Status" (#369).
    await expect(
      row.getByRole("combobox", { name: "Status", exact: true }),
      "focus must enter the editor that opened",
    ).toBeFocused();
  });

  test("cancelling a row's editor hands focus back to the Edit that opened it", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });

    await page.goto(`/collections/${collection.id}`);
    await page.getByRole("button", { name: editName("Kind of Blue") }).click();
    const cancel = page.getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeVisible();

    await cancel.focus();
    await page.keyboard.press("Enter");
    await expect(cancel).toHaveCount(0);

    await expect(
      page.getByRole("button", { name: editName("Kind of Blue") }),
      "closing the editor must return focus to the control that opened it",
    ).toBeFocused();
  });

  test("saving a row's editor hands focus back to the Edit that opened it", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });

    await page.goto(`/collections/${collection.id}`);
    await page.getByRole("button", { name: editName("Kind of Blue") }).click();
    const row = page.getByRole("listitem");
    await row.getByRole("textbox", { name: "Title" }).fill("A Love Supreme");

    const save = row.getByRole("button", { name: "Save" });
    await save.focus();
    await page.keyboard.press("Enter");
    await expect(save, "a saved editor must close").toHaveCount(0);
    await expect(row).toContainText("A Love Supreme");

    // Save closes the editor exactly as Cancel does, so it is the same handoff
    // — and it was not in #367's table of six, which is how a seventh site
    // hides behind a list.
    await expect(
      // Named for the title it was just given: a row's controls carry the row's
      // name, so saving a rename renames them too (#375).
      page.getByRole("button", { name: editName("A Love Supreme") }),
      "saving must return focus to the control that opened the editor",
    ).toBeFocused();
  });

  test("undoing a delete follows the item back into the list", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });

    await page.goto(`/collections/${collection.id}`);
    await page.getByRole("button", { name: deleteName("Kind of Blue") }).click();
    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();

    await undo.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listitem"), "Undo must restore the item").toHaveCount(1);

    // The destination does not exist at the moment focus is lost: the toast
    // unmounts at once and the row only reappears on a later commit, when the
    // list has been fetched again. So the handoff has to wait for it.
    await expect(
      page.getByRole("button", { name: editName("Kind of Blue") }),
      "focus must follow the restored row",
    ).toBeFocused();
  });

  test("dismissing the toast hands focus where the delete left it", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.createItem(collection.id, { title: "Blue Train", year: 1957 });

    await page.goto(`/collections/${collection.id}`);
    await page.getByRole("button", { name: deleteName("Kind of Blue") }).click();
    const dismiss = page.getByRole("button", { name: "Dismiss" });
    await expect(dismiss).toBeVisible();

    await dismiss.focus();
    await page.keyboard.press("Enter");
    await expect(dismiss).toHaveCount(0);

    // The same destination the delete chose, so a delete-then-dismiss leaves
    // the user where a delete alone would have.
    await expect(
      page.getByRole("button", { name: editName("Blue Train") }),
      "dismissing must hand focus back to the list, not to <body>",
    ).toBeFocused();
  });

  test("removing a field hands focus to the field that takes its place", async ({ page, api }) => {
    await api.reset();
    await page.goto("/collections/new");
    await expect(page.getByRole("heading", { level: 1, name: "New collection" })).toBeVisible();

    await page.getByRole("button", { name: "Add field" }).click();
    const labels = page.getByRole("textbox", { name: "Field label" });
    await labels.first().fill("Title");
    await labels.nth(1).fill("Year");

    const removes = page.getByRole("button", { name: "Remove field" });
    await removes.first().focus();
    await page.keyboard.press("Enter");
    await expect(removes).toHaveCount(1);

    // The successor row's *label*, not its Remove field: the label names the
    // surviving field, so arrival says where the user is, while a second
    // destructive control under the keyboard says nothing and invites a slip.
    await expect(labels.first(), "focus must land on the surviving field").toBeFocused();
    await expect(labels.first()).toHaveValue("Year");

    // And with no row left to go to, the control that makes one.
    await removes.first().focus();
    await page.keyboard.press("Enter");
    await expect(removes).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add field" }),
      "removing the last field must hand focus to Add field",
    ).toBeFocused();
  });

  /**
   * A submit with no field left (#42). It used to do nothing at all; there is
   * no field box for the browser to stop at, so the form names the control that
   * fixes it — Add field, which the alert describes — and moves focus there.
   */
  test("creating a collection with no field hands focus to Add field, saying why", async ({ page, api }) => {
    await api.reset();
    await page.goto("/collections/new");
    await expect(page.getByRole("heading", { level: 1, name: "New collection" })).toBeVisible();

    await page.getByRole("textbox", { name: "Collection name" }).fill("Vinyl records");
    await page.getByRole("button", { name: "Remove field" }).click();
    const create = page.getByRole("button", { name: "Create collection" });
    await create.focus();
    await page.keyboard.press("Enter");

    const addField = page.getByRole("button", { name: "Add field" });
    await expect(page.getByRole("alert")).toHaveText("A collection needs at least one field. Add one to continue.");
    await expect(addField, "a refused submit must hand focus to the control that fixes it").toBeFocused();
    await expect(addField).toHaveAccessibleDescription("A collection needs at least one field. Add one to continue.");
    await expect(page).toHaveURL(/\/collections\/new$/);

    // Adding the field it asked for takes the alert away.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Field label" })).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("purging a trash row hands focus to the next row in the same list", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const first = await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    const second = await api.createItem(collection.id, { title: "Blue Train", year: 1957 });
    await api.deleteItem(collection.id, first.id);
    await api.deleteItem(collection.id, second.id);

    await page.goto("/settings");
    const restores = page.getByRole("button", { name: /^Restore/ });
    await expect(restores).toHaveCount(2);

    await page.getByRole("button", { name: purgeName("Kind of Blue") }).click();
    const confirm = page.getByRole("button", { name: purgeName("Kind of Blue") });
    await confirm.focus();
    await page.keyboard.press("Enter");
    await expect(restores).toHaveCount(1);

    await expect(restores.first(), "focus must stay in the list that was purged").toBeFocused();
    await expect(restores.first(), "and the row it landed on says which row it is").toHaveAccessibleName(
      restoreName("Blue Train"),
    );
  });

  test("purging the last trash row hands focus to the trash section", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.deleteItem(collection.id, item.id);

    await page.goto("/settings");
    await expect(page.getByRole("button", { name: restoreName("Kind of Blue") })).toHaveCount(1);

    await page.getByRole("button", { name: purgeName("Kind of Blue") }).click();
    await page.getByRole("button", { name: purgeName("Kind of Blue") }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: restoreName("Kind of Blue") })).toHaveCount(0);

    // "The trash is empty." is a plain paragraph in a branch of the section, not
    // a live region, so focus arriving on the section is the only thing that
    // tells a screen-reader user the purge landed at all.
    await expect(
      page.locator("section.settings-trash"),
      "an emptied trash must hand focus to its section",
    ).toBeFocused();
  });
});

/**
 * Escape, as the way out of the two transient surfaces (#376).
 *
 * The confirmation kept by hand what a `<dialog>` would have given it, except
 * this; and the undo toast never times out while focus is inside it, so for a
 * keyboard user it is permanent until they find Dismiss. Escape is the exit both
 * owe, and it goes where the matching button goes: Cancel's destination for the
 * confirmation, Dismiss's for the toast.
 */
test.describe("Escape dismisses what is transient (#376)", () => {
  test("Escape closes a confirmation without confirming, handing focus back to its trigger", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.deleteItem(collection.id, item.id);

    await page.goto("/settings");
    const trigger = page.getByRole("button", { name: purgeName("Kind of Blue") });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".confirm-prompt")).toBeVisible();
    expect(await focusedControl(page)).toBe('button "Cancel"');

    await page.keyboard.press("Escape");
    await expect(page.locator(".confirm-prompt"), "Escape must close the question").toHaveCount(0);
    await expect(trigger, "Escape must hand focus back to the button that asked").toBeFocused();
    // And it answered "no": the row is still in the trash.
    await expect(page.getByRole("button", { name: restoreName("Kind of Blue") })).toHaveCount(1);

    // From the destructive option too, which is where Shift+Tab leaves a user.
    await page.keyboard.press("Enter");
    await page.keyboard.press("Shift+Tab");
    expect(await focusedControl(page)).toBe(purgeStop("Kind of Blue"));
    await page.keyboard.press("Escape");
    await expect(page.locator(".confirm-prompt")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("button", { name: restoreName("Kind of Blue") })).toHaveCount(1);
  });

  test("Escape closes the undo toast without undoing, handing focus where the delete left it", async ({
    page,
    api,
  }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.createItem(collection.id, { title: "Blue Train", year: 1957 });

    await page.goto(`/collections/${collection.id}`);
    await page.getByRole("button", { name: deleteName("Kind of Blue") }).click();
    const undo = page.getByRole("button", { name: "Undo" });
    await undo.focus();

    await page.keyboard.press("Escape");
    await expect(undo, "Escape must close the toast").toHaveCount(0);
    await expect(page.getByRole("listitem"), "Escape must not undo the delete").toHaveCount(1);
    await expect(
      page.getByRole("button", { name: editName("Blue Train") }),
      "Escape must hand focus where the delete left it, as Dismiss does",
    ).toBeFocused();
  });

  /**
   * A second delete inside the window used to rebind the toast in place: same
   * element, same focused Undo, now about a different item — so a user standing
   * on it could undo the wrong delete. The press is a programmatic click, which
   * presses Delete without moving focus off Undo, as a Safari click or an iOS
   * tap does.
   */
  test("a second delete inside the window does not leave focus on an Undo bound to another item", async ({
    page,
    api,
  }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.createItem(collection.id, { title: "Blue Train", year: 1957 });
    await api.createItem(collection.id, { title: "Giant Steps", year: 1960 });

    await page.goto(`/collections/${collection.id}`);
    await page.getByRole("button", { name: deleteName("Kind of Blue") }).click();
    const undo = page.getByRole("button", { name: "Undo" });
    await undo.focus();
    const firstUndo = await undo.elementHandle();

    await page
      .getByRole("button", { name: deleteName("Blue Train") })
      .evaluate((button: HTMLElement) => button.click());
    await expect(page.getByText("Deleted “Blue Train”")).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(1);

    expect(
      await firstUndo?.evaluate((button) => button.isConnected),
      "the toast for the first delete must be replaced, not rebound",
    ).toBe(false);
    await expect(
      page.getByRole("button", { name: editName("Giant Steps") }),
      "focus must go where the second delete sends it, not stay on a rebound Undo",
    ).toBeFocused();
  });
});

/**
 * The undo toast is fixed over the page, so it can paint over a control a
 * keyboard user has just tabbed to (#372, WCAG 2.2 2.4.11 Focus Not Obscured).
 * Compared as boxes, not screenshots: every stop on the page, with the toast up,
 * must have its box — focus ring included — clear of the toast's.
 */
/** Whether the focused control's box, focus ring included, meets the toast's. */
async function isUnderToast(page: import("@playwright/test").Page): Promise<boolean> {
  return await page.evaluate(() => {
    const toast = document.querySelector(".undo-toast")?.getBoundingClientRect();
    const focused = document.activeElement?.getBoundingClientRect();
    if (!toast || !focused) return false;
    // The focus ring is drawn outside the box (global.css :focus-visible).
    const ring = 4;
    return (
      focused.left - ring < toast.right &&
      focused.right + ring > toast.left &&
      focused.top - ring < toast.bottom &&
      focused.bottom + ring > toast.top
    );
  });
}

test.describe("the undo toast never covers the focused control (#372)", () => {
  for (const items of [2, 14]) {
    test(`with ${items} items, no stop is under the toast`, async ({ page, api }) => {
      await api.reset();
      const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
      for (let index = 0; index < items; index++) {
        await api.createItem(collection.id, { title: `Record ${index + 1}`, year: 1950 + index });
      }

      await page.goto(`/collections/${collection.id}`);
      await expect(page.getByRole("listitem")).toHaveCount(items);
      await page.getByRole("button", { name: deleteName("Record 1") }).click();
      await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
      await page.locator("body").focus();
      await page.evaluate(() => window.scrollTo(0, 0));

      const obscured: string[] = [];
      for (let press = 0; press < 80; press++) {
        await page.keyboard.press("Tab");
        const stop = await focusedControl(page);
        if (stop === NOTHING_FOCUSED) break;
        const overlap = await isUnderToast(page);
        if (overlap && !stop.startsWith('button "Undo"') && !stop.startsWith('button "Dismiss"')) obscured.push(stop);
      }

      expect(obscured, "controls whose focus ring the toast paints over").toEqual([]);
    });
  }

  /**
   * Focus moved by script rather than by Tab — which is how every handoff in
   * the app moves it (#367). Chromium's scroll-if-needed for `focus()` ignores
   * `scroll-padding`, so the padding alone left the add form's Save, the last
   * control on a short page, behind the toast on a phone.
   */
  test("a control focused by script is scrolled clear of the toast too", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    await api.createItem(collection.id, { title: "Blue Train", year: 1957 });

    await page.goto(`/collections/${collection.id}`);
    await page.getByRole("button", { name: deleteName("Kind of Blue") }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));

    await page
      .locator(".add-item")
      .getByRole("button", { name: "Save" })
      .evaluate((save: HTMLElement) => save.focus());
    await expect.poll(() => isUnderToast(page), "Save, focused by script, must not sit under the toast").toBe(false);
  });
});

test.describe("searching a collection (#41)", () => {
  test("Clear search hands focus to the search box, and Escape empties it", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });

    await page.goto(`/collections/${collection.id}?q=sonic`);
    await expect(page.getByText("No items match “sonic”")).toBeVisible();

    const clear = page.getByRole("button", { name: "Clear search" });
    await clear.focus();
    await page.keyboard.press("Enter");

    const box = page.getByRole("searchbox", { name: "Search items" });
    await expect(page.getByRole("button", { name: editName("Kind of Blue") })).toBeVisible();
    await expect(box, "Clear search goes with the empty state, so focus goes to the box").toBeFocused();
    await expect(page).toHaveURL(`/collections/${collection.id}`);

    await box.fill("blue");
    await expect(page).toHaveURL(`/collections/${collection.id}?q=blue`);
    await page.keyboard.press("Escape");
    await expect(box).toHaveValue("");
    await expect(page).toHaveURL(`/collections/${collection.id}`);
  });

  test("saving an item so the search no longer matches it hands focus to the row in its place", async ({
    page,
    api,
  }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Blue Train", year: 1958 });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });

    await page.goto(`/collections/${collection.id}?q=blue`);
    await page.getByRole("button", { name: editName("Blue Train") }).click();
    const editor = page.getByRole("form", { name: "Editing “Blue Train”" });
    await editor.getByRole("textbox", { name: "Title" }).fill("Giant Steps");
    const save = editor.getByRole("button", { name: "Save" });
    await save.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: editName("Giant Steps") })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: editName("Kind of Blue") }),
      "the successor rule, as for a delete — not <body>",
    ).toBeFocused();
    await expect(page.locator('.visually-hidden[aria-live="polite"]')).toContainText(
      "Saved “Giant Steps”. It no longer matches the current search, filters or tab, so it isn’t shown.",
    );
  });

  test("a save that moves the row under the sort keeps focus on that row's Edit", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Blue Train", year: 1958 });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });

    await page.goto(`/collections/${collection.id}`);
    await page.getByRole("combobox", { name: "Sort by" }).selectOption({ label: "Name, A to Z" });
    await expect(page).toHaveURL(`/collections/${collection.id}?sort=name`);

    // Renamed to sort last: React moves the row with insertBefore, which takes
    // the node out of the document for a moment, and a browser sends focus that
    // was inside it to <body>. The page's handoff has to put it back.
    await page.getByRole("button", { name: editName("Blue Train") }).click();
    const editor = page.getByRole("form", { name: "Editing “Blue Train”" });
    await editor.getByRole("textbox", { name: "Title" }).fill("Ziggurat");
    const save = editor.getByRole("button", { name: "Save" });
    await save.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("listitem").last()).toContainText("Ziggurat");
    await expect(page.getByRole("button", { name: editName("Ziggurat") })).toBeFocused();
  });
});

/**
 * Presses a control without giving it focus first, and leaves focus on <body>
 * while it runs. A mouse click in Safari or Firefox on macOS does this, and so
 * do an iOS tap and a VoiceOver double-tap. A programmatic `.click()` is the
 * same thing in Chromium, whose own mouse clicks do focus a button.
 */
async function pressWithoutFocus(control: import("@playwright/test").Locator): Promise<void> {
  await control.evaluate((element: HTMLElement) => {
    (document.activeElement as HTMLElement | null)?.blur();
    element.click();
  });
}

/**
 * The removals again, pressed with focus on <body> (#42 review). A handoff
 * asked for then cannot tell "focus already fell" from "nothing has been removed
 * yet" by reading `document.activeElement`. If it resolves at once, "the row
 * at this index" is still the row being deleted, and focus follows that row out
 * of the document. Each caller names the control it is removing, and the
 * handoff waits for that control to leave.
 */
test.describe("focus when the removed control never held it", () => {
  for (const finite of [false, true]) {
    test(`deleting a row hands focus to the row in its place${finite ? " on a finite set with a target" : ""}`, async ({
      page,
      api,
    }) => {
      await api.reset();
      const collection = await api.createCollection(
        finite
          ? { name: "Vinyl records", fields: FIELDS, isFiniteSet: true, targetCount: 5 }
          : { name: "Vinyl records", fields: FIELDS },
      );
      await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
      await api.createItem(collection.id, { title: "Blue Train", year: 1957 });

      await page.goto(`/collections/${collection.id}`);
      await expect(page.getByRole("listitem")).toHaveCount(2);
      if (finite) await expect(page.locator(".collection-detail .collection-progress")).toHaveText("2 of 5 collected");

      await pressWithoutFocus(page.getByRole("button", { name: deleteName("Kind of Blue") }));

      await expect(page.getByRole("listitem")).toHaveCount(1);
      await expect(
        page.getByRole("button", { name: editName("Blue Train") }),
        "the successor's Edit, not <body>",
      ).toBeFocused();
      await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    });
  }

  test("purging a trash row hands focus to the next row in the same list", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const first = await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    const second = await api.createItem(collection.id, { title: "Blue Train", year: 1957 });
    await api.deleteItem(collection.id, first.id);
    await api.deleteItem(collection.id, second.id);

    await page.goto("/settings");
    const restores = page.getByRole("button", { name: /^Restore/ });
    await expect(restores).toHaveCount(2);

    await page.getByRole("button", { name: purgeName("Kind of Blue") }).click();
    // The prompt is open, so this is now its confirm, under the same name.
    await pressWithoutFocus(page.getByRole("button", { name: purgeName("Kind of Blue") }));
    await expect(restores).toHaveCount(1);

    await expect(restores.first(), "focus must land in the list that was purged, not on <body>").toBeFocused();
    await expect(restores.first()).toHaveAccessibleName(restoreName("Blue Train"));
  });

  test("removing a filter chip hands focus to the chip in its place", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });
    const filter = JSON.stringify([
      { field: "year", op: "gte", value: 1958 },
      { field: "year", op: "lte", value: 1960 },
    ]);

    await page.goto(`/collections/${collection.id}?filter=${encodeURIComponent(filter)}`);
    const chips = page.getByRole("button", { name: /^Remove filter Year/ });
    await expect(chips).toHaveCount(2);

    // The chip goes only once the router has moved, a commit after the press.
    await pressWithoutFocus(page.getByRole("button", { name: "Remove filter Year: from 1958" }));

    await expect(chips).toHaveCount(1);
    await expect(chips.first(), "the chip now in its place, not <body>").toBeFocused();
  });
});

/**
 * A finite set with a target (#42), whose header reads its counts from a
 * second query under the items prefix. That second refetch gives the browser
 * time to commit the list fetched again, unmounting the row, before the row's
 * mutation settles, and a `mutate`-level callback on the row's own observer is
 * then dropped (R1). These two are the page-owned follow-ups that would vanish:
 * the delete's Undo, and the Save's focus handoff when a search hides the row.
 */
test.describe("a finite set with a target (#42)", () => {
  test("deleting a row still offers Undo, and the header's count follows", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({
      name: "Coin set",
      fields: FIELDS,
      isFiniteSet: true,
      targetCount: 3,
    });
    await api.createItem(collection.id, { title: "Penny", year: 1909 }, "owned");
    await api.createItem(collection.id, { title: "Nickel", year: 1913 }, "owned");

    await page.goto(`/collections/${collection.id}`);
    const progress = page.locator(".collection-detail .collection-progress");
    await expect(progress).toHaveText("2 of 3 collected");

    await page.getByRole("button", { name: deleteName("Penny") }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("listitem")).toHaveCount(1);
    await expect(page.locator(".undo-toast-live")).toContainText("Deleted “Penny”");
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.getByRole("button", { name: editName("Nickel") })).toBeFocused();
    await expect(progress).toHaveText("1 of 3 collected");
  });

  test("saving an item a search no longer matches hands focus to the row in its place", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({
      name: "Coin set",
      fields: FIELDS,
      isFiniteSet: true,
      targetCount: 3,
    });
    await api.createItem(collection.id, { title: "Buffalo nickel", year: 1913 }, "owned");
    await api.createItem(collection.id, { title: "Jefferson nickel", year: 1938 }, "owned");

    await page.goto(`/collections/${collection.id}?q=nickel`);
    await expect(page.locator(".collection-detail .collection-progress")).toHaveText("2 of 3 collected");
    await page.getByRole("button", { name: editName("Buffalo nickel") }).click();
    const editor = page.getByRole("form", { name: "Editing “Buffalo nickel”" });
    await editor.getByRole("textbox", { name: "Title" }).fill("Indian Head cent");
    await editor.getByRole("button", { name: "Save" }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: editName("Indian Head cent") })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: editName("Jefferson nickel") }),
      "the successor rule, as for a delete — not <body>",
    ).toBeFocused();
    await expect(page.locator('.visually-hidden[aria-live="polite"]')).toContainText(
      "Saved “Indian Head cent”. It no longer matches the current search, filters or tab, so it isn’t shown.",
    );
  });
});

test.describe("filtering a collection (#41)", () => {
  test("the open panel's stops, then applying and removing a filter by keyboard", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Blue Train", year: 1958 });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 });

    await page.goto(`/collections/${collection.id}`);
    const toggle = page.getByRole("button", { name: "Filters", exact: true });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle, "a disclosure keeps focus on its button").toBeFocused();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("spinbutton", { name: "Minimum" })).toBeFocused();
    await page.keyboard.type("1959");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("spinbutton", { name: "Maximum" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: editName("Blue Train") })).toHaveCount(0);
    await expect(page.getByText("1 item matches")).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply filters" }), "Apply keeps focus").toBeFocused();

    const chip = page.getByRole("button", { name: "Remove filter Year: from 1959" });
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: editName("Blue Train") })).toBeVisible();
    await expect(toggle, "with no chip left, focus goes to the Filters toggle").toBeFocused();
  });
});

test.describe("managing tags (#41)", () => {
  const TAG_FIELDS = [
    { id: "title", label: "Title", type: "text", required: true },
    { id: "tags", label: "Tags", type: "tags" },
  ];

  test("renaming a tag by keyboard, then removing one, with focus where each action leaves it", async ({
    page,
    api,
  }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: TAG_FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", tags: ["signed", "mono"] });
    await api.createItem(collection.id, { title: "Blue Train", tags: ["signed"] });

    await page.goto(`/collections/${collection.id}/edit`);
    const rename = page.getByRole("button", { name: "Rename “signed”" });
    await rename.focus();
    await page.keyboard.press("Enter");
    const box = page.getByRole("textbox", { name: "New name for “signed”" });
    await expect(box, "the rename box takes focus").toBeFocused();
    await box.fill("autographed");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("button", { name: "Rename “autographed”" })).toBeFocused();
    await expect(page.getByText("2 items", { exact: true })).toBeVisible();
    await expect(page.locator('.visually-hidden[aria-live="polite"]')).toContainText(
      "Renamed “signed” to “autographed” on 2 items",
    );
    // The schema form above was not submitted by that Enter.
    await expect(page).toHaveURL(`/collections/${collection.id}/edit`);

    const remove = page.getByRole("button", { name: "Remove “autographed”" });
    await remove.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Remove “autographed”" }).last().press("Enter");
    await expect(page.getByRole("button", { name: "Rename “autographed”" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Rename “mono”" }), "the successor row").toBeFocused();
  });
});

/**
 * The status tabs (#42): the APG tabs pattern with automatic activation. The
 * arrow keys move focus *and* select, which is only acceptable because the
 * panel is instant — the tabs narrow the list already fetched (R4) — so each
 * keypress here asserts the rows of the tab it lands on, not just the focus.
 */
test.describe("the status tabs (#42)", () => {
  async function seed(api: import("./fixtures.js").ApiFixture) {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 }, "owned");
    await api.createItem(collection.id, { title: "Blue Train", year: 1957 }, "wanted");
    await api.createItem(collection.id, { title: "Giant Steps", year: 1960 }, "ordered");
    await api.createItem(collection.id, { title: "Mingus Ah Um", year: 1959 }, "owned");
    return collection;
  }

  /** The rows on screen, by the names their Edit buttons carry. */
  async function rows(page: import("@playwright/test").Page): Promise<string[]> {
    return (
      await page.locator("[data-row-edit]").evaluateAll((edits) => edits.map((e) => e.getAttribute("aria-label")))
    ).map((label) => (label ?? "").replace(/^Edit “(.*)”$/, "$1"));
  }

  test("the arrow keys, Home and End move between tabs and select as they go; Tab enters the panel", async ({
    page,
    api,
  }) => {
    const collection = await seed(api);
    await page.goto(`/collections/${collection.id}`);
    const all = page.getByRole("tab", { name: "All" });
    await expect(page.getByRole("listitem")).toHaveCount(4);

    await all.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Collected", selected: true })).toBeFocused();
    await expect(page).toHaveURL(`/collections/${collection.id}?show=collected`);
    await expect.poll(() => rows(page)).toEqual(["Kind of Blue", "Mingus Ah Um"]);

    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Remaining", selected: true })).toBeFocused();
    await expect.poll(() => rows(page)).toEqual(["Blue Train", "Giant Steps"]);

    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "All", selected: true }), "Right wraps to the first tab").toBeFocused();
    await expect(page).toHaveURL(`/collections/${collection.id}`);

    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Remaining", selected: true }), "Left wraps to the last").toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "All", selected: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Remaining", selected: true })).toBeFocused();

    // The tablist is one stop: Tab leaves it for the panel, then the first row.
    expect(await tabOrder(page), "the stops after the selected tab").toEqual(
      restOfSequence([
        'tabpanel "Remaining"',
        markStop("Blue Train"),
        editStop("Blue Train"),
        deleteStop("Blue Train"),
        markStop("Giant Steps"),
        editStop("Giant Steps"),
        deleteStop("Giant Steps"),
        'combobox "Status"',
        'textbox "Title"',
        'spinbutton "Year"',
        'button "Save"',
      ]),
    );
  });

  test("saving an owned item as wanted under Collected hands focus to the row in its place, and says why", async ({
    page,
    api,
  }) => {
    const collection = await seed(api);
    await page.goto(`/collections/${collection.id}?show=collected`);
    await expect.poll(() => rows(page)).toEqual(["Kind of Blue", "Mingus Ah Um"]);

    await page.getByRole("button", { name: editName("Kind of Blue") }).click();
    const editor = page.getByRole("form", { name: "Editing “Kind of Blue”" });
    await editor.getByRole("combobox", { name: "Status" }).selectOption("wanted");
    await editor.getByRole("button", { name: "Save" }).focus();
    await page.keyboard.press("Enter");

    await expect.poll(() => rows(page)).toEqual(["Mingus Ah Um"]);
    await expect(
      page.getByRole("button", { name: editName("Mingus Ah Um") }),
      "the successor rule, as for a delete — not <body>",
    ).toBeFocused();
    await expect(page.locator('.visually-hidden[aria-live="polite"]')).toContainText(
      "Saved “Kind of Blue”. It no longer matches the current search, filters or tab, so it isn’t shown.",
    );
  });

  test("deleting the last item in a tab hands focus to the panel and its empty state", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({
      name: "Coin set",
      fields: FIELDS,
      isFiniteSet: true,
      targetCount: 3,
    });
    await api.createItem(collection.id, { title: "Penny", year: 1909 }, "owned");
    await api.createItem(collection.id, { title: "Nickel", year: 1913 }, "wanted");

    await page.goto(`/collections/${collection.id}?show=remaining`);
    await expect.poll(() => rows(page)).toEqual(["Nickel"]);
    await page.getByRole("button", { name: deleteName("Nickel") }).focus();
    await page.keyboard.press("Enter");

    const panel = page.getByRole("tabpanel", { name: "Remaining" });
    await expect(panel.locator(".empty-state-title")).toHaveText("2 more to find");
    await expect(panel, "focus lands on the panel that now says what is left").toBeFocused();
    await expect(panel).toHaveAccessibleDescription(
      "2 more to find Nothing is on your wanted list. Add the items you are looking for as Wanted or Ordered.",
    );
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  });

  test("adding under Remaining starts as Wanted and lands in the tab on screen", async ({ page, api }) => {
    const collection = await seed(api);
    await page.goto(`/collections/${collection.id}?show=remaining`);
    await expect.poll(() => rows(page)).toEqual(["Blue Train", "Giant Steps"]);

    const form = page.locator(".add-item");
    await expect(form.getByRole("combobox", { name: "Status" })).toHaveValue("wanted");
    await form.getByRole("textbox", { name: "Title" }).fill("Round Midnight");
    await form.getByRole("button", { name: "Save" }).focus();
    await page.keyboard.press("Enter");

    await expect.poll(() => rows(page)).toEqual(["Blue Train", "Giant Steps", "Round Midnight"]);
    await expect(page.locator(".add-item-live")).toHaveText("Added “Round Midnight”");
  });
});

/**
 * A remaining row's Mark collected (#42, D9 and D10). The button goes with the
 * press — the row is owned now — so every spec here asserts where focus is
 * left: the row's own Edit while the row is still listed, wherever it moved;
 * the row in its place, or the panel, when the tab drops it. And the button
 * marks itself busy, never `disabled`, while the change is in flight.
 */
test.describe("marking an item collected (#42)", () => {
  async function seed(api: import("./fixtures.js").ApiFixture, target?: number) {
    await api.reset();
    const collection = await api.createCollection(
      target === undefined
        ? { name: "Vinyl records", fields: FIELDS }
        : { name: "Vinyl records", fields: FIELDS, isFiniteSet: true, targetCount: target },
    );
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 }, "owned");
    await api.createItem(collection.id, { title: "Blue Train", year: 1957 }, "wanted");
    await api.createItem(collection.id, { title: "Giant Steps", year: 1960 }, "ordered");
    return collection;
  }

  async function rows(page: import("@playwright/test").Page): Promise<string[]> {
    return (
      await page.locator("[data-row-edit]").evaluateAll((edits) => edits.map((e) => e.getAttribute("aria-label")))
    ).map((label) => (label ?? "").replace(/^Edit “(.*)”$/, "$1"));
  }

  const announcer = (page: import("@playwright/test").Page) => page.locator('.visually-hidden[aria-live="polite"]');

  test("each remaining row has a Mark collected stop before its Edit; an owned row has none", async ({ page, api }) => {
    const collection = await seed(api);
    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("listitem")).toHaveCount(3);

    await expectTabOrder(page, "a collection with remaining items", [
      'link "All collections"',
      'link "Edit collection"',
      'searchbox "Search items"',
      'combobox "Sort by"',
      'button "Filters"',
      'tab "All" [selected]',
      'tabpanel "All"',
      editStop("Kind of Blue"),
      deleteStop("Kind of Blue"),
      markStop("Blue Train"),
      editStop("Blue Train"),
      deleteStop("Blue Train"),
      markStop("Giant Steps"),
      editStop("Giant Steps"),
      deleteStop("Giant Steps"),
      'combobox "Status"',
      'textbox "Title"',
      'spinbutton "Year"',
      'button "Save"',
    ]);
  });

  test("Mark collected keeps focus while it is in flight, then hands it to the row's Edit", async ({ page, api }) => {
    const collection = await seed(api);
    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("listitem")).toHaveCount(3);

    const held = await holdRequest(page, "**/api/collections/*/items/*", "PATCH");
    const mark = page.getByRole("button", { name: markName("Blue Train") });
    await mark.focus();
    await page.keyboard.press("Enter");

    await held.arrived;
    await expectMarkedBusy(mark);
    expect(await focusedControl(page), "focus must stay on Mark collected while it is in flight").toBe(
      `button "${markName("Blue Train")}" [disabled]: Mark collected`,
    );
    // A second press is refused, not sent.
    await page.keyboard.press("Enter");

    held.release();
    await expect(page.getByRole("button", { name: markName("Blue Train") })).toHaveCount(0);
    await expect(page.getByRole("button", { name: editName("Blue Train") })).toBeFocused();
  });

  for (const pressed of ["by keyboard", "without focus"] as const) {
    test(`under All the row stays, and focus goes to its Edit (${pressed})`, async ({ page, api }) => {
      const collection = await seed(api, 5);
      await page.goto(`/collections/${collection.id}`);
      const progress = page.locator(".collection-detail .collection-progress");
      await expect(progress).toHaveText("1 of 5 collected");

      const mark = page.getByRole("button", { name: markName("Blue Train") });
      if (pressed === "by keyboard") {
        await mark.focus();
        await page.keyboard.press("Enter");
      } else {
        await pressWithoutFocus(mark);
      }

      await expect(page.getByRole("button", { name: markName("Blue Train") })).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: editName("Blue Train") }),
        "the marked row's Edit, not <body>",
      ).toBeFocused();
      await expect.poll(() => rows(page)).toEqual(["Kind of Blue", "Blue Train", "Giant Steps"]);
      await expect(announcer(page)).toContainText("Marked “Blue Train” as collected.");
      await expect(progress).toHaveText("2 of 5 collected");
    });

    test(`under Remaining the row goes, and focus goes to the row in its place (${pressed})`, async ({ page, api }) => {
      const collection = await seed(api);
      await page.goto(`/collections/${collection.id}?show=remaining`);
      await expect.poll(() => rows(page)).toEqual(["Blue Train", "Giant Steps"]);

      const mark = page.getByRole("button", { name: markName("Blue Train") });
      if (pressed === "by keyboard") {
        await mark.focus();
        await page.keyboard.press("Enter");
      } else {
        await pressWithoutFocus(mark);
      }

      await expect.poll(() => rows(page)).toEqual(["Giant Steps"]);
      await expect(
        page.getByRole("button", { name: editName("Giant Steps") }),
        "the successor rule, as for a delete — not <body>",
      ).toBeFocused();
      await expect(announcer(page)).toContainText("Marked “Blue Train” as collected. It is no longer in this list.");
    });
  }

  test("marking the last remaining item hands focus to the panel, which says the set is complete", async ({
    page,
    api,
  }) => {
    await api.reset();
    const collection = await api.createCollection({
      name: "Coin set",
      fields: FIELDS,
      isFiniteSet: true,
      targetCount: 2,
    });
    await api.createItem(collection.id, { title: "Penny", year: 1909 }, "owned");
    await api.createItem(collection.id, { title: "Nickel", year: 1913 }, "wanted");

    await page.goto(`/collections/${collection.id}?show=remaining`);
    await expect.poll(() => rows(page)).toEqual(["Nickel"]);
    await page.getByRole("button", { name: markName("Nickel") }).focus();
    await page.keyboard.press("Enter");

    const panel = page.getByRole("tabpanel", { name: "Remaining" });
    await expect(panel.locator(".empty-state-title")).toHaveText("All collected");
    await expect(panel, "focus lands on the panel that now says the set is complete").toBeFocused();
    await expect(panel).toHaveAccessibleDescription("All collected You own every item in this set.");
    await expect(page.locator(".collection-detail .collection-progress")).toContainText("2 of 2 collected");
    // The mark completed the set, so it is said once, by the celebration (#42,
    // R8) — which changes the words and leaves focus exactly where it was sent.
    await expect(page.locator(".celebration-live")).toHaveText(
      "Marked “Nickel” as collected. It is no longer in this list. Coin set is complete!",
    );
    await expect(announcer(page)).not.toContainText("Marked");
    await expect(panel).toBeFocused();
  });

  for (const pressed of ["by keyboard", "without focus"] as const) {
    test(`under the status sort the row moves up but stays listed, and focus follows it (${pressed})`, async ({
      page,
      api,
    }) => {
      const collection = await seed(api);
      await page.goto(`/collections/${collection.id}?sort=status`);
      // Owned, then ordered, then wanted.
      await expect.poll(() => rows(page)).toEqual(["Kind of Blue", "Giant Steps", "Blue Train"]);

      // Moving a keyed row is an insertBefore, which takes the node out of the
      // document for a moment and sends focus inside it to <body>; the page's
      // handoff has to put it back on the row's Edit in its new place.
      const mark = page.getByRole("button", { name: markName("Blue Train") });
      if (pressed === "by keyboard") {
        await mark.focus();
        await page.keyboard.press("Enter");
      } else {
        await pressWithoutFocus(mark);
      }

      await expect.poll(() => rows(page)).toEqual(["Kind of Blue", "Blue Train", "Giant Steps"]);
      await expect(page.getByRole("button", { name: editName("Blue Train") })).toBeFocused();
    });
  }

  /**
   * The mark lands but the list cannot be fetched again (#42 review). The query
   * client retries the refetch (about seven seconds of backoff) before giving
   * up; all that time the mutation is pending, so the button stays, marked busy,
   * holding focus. Then the server's answer is written into the cached list, so
   * the row says Owned and what is announced is true. Later, with the list
   * reachable again and focus on <body>, nothing left waiting moves focus.
   */
  for (const pressed of ["by keyboard", "without focus"] as const) {
    test(`a mark whose list refetch fails still shows the row as collected, and leaves nothing waiting (${pressed})`, async ({
      page,
      api,
    }) => {
      test.setTimeout(45_000);
      const collection = await seed(api);
      await page.goto(`/collections/${collection.id}`);
      await expect(page.getByRole("listitem")).toHaveCount(3);
      let failLists = true;
      await page.route(
        (url) => url.pathname.endsWith("/items"),
        async (route) => {
          if (failLists && route.request().method() === "GET")
            return await route.fulfill({ status: 500, json: { message: "Internal Server Error" } });
          return await route.fallback();
        },
      );

      const mark = page.getByRole("button", { name: markName("Blue Train") });
      if (pressed === "by keyboard") {
        await mark.focus();
        await page.keyboard.press("Enter");
        await expectMarkedBusy(mark);
        await expect(mark, "focus stays on the busy button while the refetch is retried").toBeFocused();
      } else {
        await pressWithoutFocus(mark);
      }

      const row = page
        .getByRole("listitem")
        .filter({ has: page.getByRole("button", { name: editName("Blue Train") }) });
      await expect(row.locator(".item-status")).toHaveText("Owned", { timeout: 20_000 });
      await expect(page.getByRole("button", { name: markName("Blue Train") })).toHaveCount(0);
      await expect(page.getByRole("button", { name: editName("Blue Train") })).toBeFocused();
      await expect(page.locator('.visually-hidden[aria-live="polite"]')).toContainText(
        "Marked “Blue Train” as collected.",
      );

      // The user moves on; the list becomes reachable and is fetched again.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      failLists = false;
      await page.getByRole("tab", { name: "Collected" }).press("Enter");
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.getByRole("searchbox", { name: "Search items" }).fill("blue");
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await expect.poll(() => rows(page)).toEqual(["Kind of Blue", "Blue Train"]);
      expect(await focusedControl(page), "nothing left waiting may take focus later").toBe(NOTHING_FOCUSED);
    });
  }

  test("a mark the server refuses leaves focus on the button, with the row's alert", async ({ page, api }) => {
    const collection = await seed(api);
    await page.route("**/api/collections/*/items/*", async (route) => {
      if (route.request().method() !== "PATCH") return await route.fallback();
      await route.fulfill({ status: 500, json: { message: "Internal Server Error" } });
    });
    await page.goto(`/collections/${collection.id}?show=remaining`);
    await expect.poll(() => rows(page)).toEqual(["Blue Train", "Giant Steps"]);

    const mark = page.getByRole("button", { name: markName("Blue Train") });
    await mark.focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("listitem").filter({ has: mark }).getByRole("alert")).toContainText(
      "Could not mark this item as collected.",
    );
    await expect(mark).toBeFocused();
    expect(await focusedControl(page)).toBe(`${markStop("Blue Train")}`);
  });

  /**
   * R13: three buttons beside a long name must not push a phone-width page
   * sideways. Set to 390px in both projects, so the desktop run checks it too.
   */
  test("a row with a long name and three actions fits a 390px screen", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(
      collection.id,
      {
        title: "The Complete Columbia Studio Recordings of the Miles Davis Quintet, January 1965 to June 1968",
        year: 1998,
      },
      "wanted",
    );
    await api.createItem(collection.id, { title: "Characteristically".repeat(4) }, "ordered");
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("button", { name: /^Mark collected/ })).toHaveCount(2);

    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      rows: Array.from(document.querySelectorAll(".item-row"), (row) => row.scrollWidth - row.clientWidth),
    }));
    expect(widths.scroll, "the page must not scroll sideways").toBeLessThanOrEqual(widths.inner);
    expect(widths.rows, "no row overflows its own box").toEqual([0, 0]);
  });
});
