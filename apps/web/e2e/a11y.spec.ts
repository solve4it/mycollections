import type { Page } from "@playwright/test";
import { type ApiFixture, expect, expectNoAccessibilityViolations, test } from "./fixtures.js";

/**
 * The WCAG 2.1 AA baseline for #24: every route the app has, scanned in a real
 * browser at two viewports and both color schemes (see `playwright.config.ts`).
 *
 * Every scan is preceded by two assertions — the URL, and a locator that only
 * exists on the screen under test. Without them a scan is worthless rather than
 * merely weak: axe reports no violations just as happily on a redirect to
 * /setup, on a loading skeleton, or on an empty `#root` before React has rendered.
 */

const FIELDS = [
  { id: "title", label: "Title", type: "text", required: true },
  { id: "year", label: "Year", type: "number" },
  { id: "signed", label: "Signed", type: "boolean" },
];

test.describe("accessibility of the setup screen", () => {
  // The screen only exists without a token, and the shared context seeds one.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("asking for a token", async ({ page }) => {
    await page.goto("/setup");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByLabel("API Token")).toBeVisible();
    // The shell's nav renders here too (#369 asked for it to be scanned), so a
    // change that dropped it from this screen must not quietly shrink the scan.
    // Not named: which nav is shown depends on the viewport.
    await expect(page.getByRole("navigation").first()).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });
});

test.describe("keyboard access", () => {
  /**
   * The skip link is the app's bypass mechanism (WCAG 2.4.1), and a bypass that
   * moves the viewport without moving focus is not one: the next Tab continues
   * from wherever focus still is — the top of the nav — so the link the user
   * pressed changed nothing for them.
   *
   * Asserted on `toBeFocused` rather than on the URL fragment, which is what the
   * browser updates either way. Chromium is the browser this suite runs, and it
   * discriminates: without `tabindex="-1"` on <main> it sets only the sequential
   * focus navigation starting point and leaves document.activeElement on <body>.
   */
  test("the skip link moves focus into the main landmark", async ({ page }) => {
    await page.goto("/collections");
    await expect(page).toHaveURL(/\/collections$/);

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink, "the skip link must be the first thing Tab reaches").toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator("main#main-content")).toBeFocused();
  });

  /**
   * Every other scan in this file arrives by `page.goto`, which is a real page
   * load — the one thing that never happens to someone using the app. This is
   * the first spec to audit a client-side navigation, which is where the title
   * changes, the live region speaks, and nothing at all reaches a screen reader
   * unless the shell arranges it.
   */
  test("a client-side navigation renames the page and announces it", async ({ page, api }) => {
    await api.reset();

    await page.goto("/settings");
    await expect(page).toHaveTitle("Settings · MyCollections");
    // Empty on arrival: a live region that already holds its text when it is
    // inserted is announced by VoiceOver but usually not by NVDA or JAWS, and
    // announcing the page the user just opened is noise in any case.
    //
    // Scoped to the hidden region rather than to every polite one: pages own
    // polite regions too (the undo toast's, #308), and a bare attribute locator
    // would be ambiguous the moment one of them is on the screen under test.
    await expect(page.locator('.visually-hidden[aria-live="polite"]')).toBeEmpty();

    await page.getByRole("link", { name: "Collections" }).first().click();

    await expect(page).toHaveURL(/\/collections$/);
    await expect(page).toHaveTitle("Collections · MyCollections");
    await expect(page.locator('.visually-hidden[aria-live="polite"]')).toHaveText("Collections · MyCollections");

    // Scanned in the navigated-into state, which no other spec here reaches.
    await expectNoAccessibilityViolations(page);
  });

  /**
   * The focus half, in a real browser. `.screen` is keyed by pathname
   * (routes/__root.tsx), so following a link inside the content unmounts the
   * link itself and focus falls to <body> — where Tab starts over at the top of
   * the document. Clicking is how a keyboard user follows a link too: Enter on a
   * focused link fires the same navigation.
   */
  test("following a link inside the page hands focus to the page it opens", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });

    await page.goto("/collections");
    await page.getByRole("link", { name: /Vinyl records/ }).focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(`/collections/${collection.id}`);
    await expect(page.locator("main#main-content")).toBeFocused();
  });

  /**
   * The page a route cannot name on its own (#309): the collection's name is in
   * the API response, so the title and the announcement can only be right a
   * round trip after the navigation. No axe scan — this is the detail screen the
   * scans below already cover, in a state they already reach; what is under test
   * here is the naming, which only a client-side navigation exercises.
   */
  test("a collection names the page after itself", async ({ page, api }) => {
    await api.reset();
    await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    // A second collection, so a title taken from "the only collection there is"
    // could not pass either.
    const boardGames = await api.createCollection({ name: "Board games", fields: FIELDS });

    await page.goto("/collections");
    await page.getByRole("link", { name: /Board games/ }).click();

    await expect(page).toHaveURL(`/collections/${boardGames.id}`);
    await expect(page).toHaveTitle("Board games · MyCollections");
    // The announcement waits for the name rather than reading out the route's
    // "Collection" and correcting itself, which a screen reader would speak
    // twice.
    await expect(page.locator('.visually-hidden[aria-live="polite"]')).toHaveText("Board games · MyCollections");
  });

  /**
   * The negative half: the nav lives outside the keyed wrapper, so its links
   * survive the navigation and keep focus. Tabbing on from a nav link must
   * continue through the nav, not restart from the top of the content.
   */
  test("navigating from the nav leaves focus on the nav", async ({ page }) => {
    await page.goto("/collections");

    const settingsLink = page.getByRole("link", { name: "Settings" }).first();
    await settingsLink.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/settings$/);
    await expect(settingsLink).toBeFocused();
  });
});

test.describe("accessibility", () => {
  test("the collections list with no collections", async ({ page, api }) => {
    await api.reset();

    await page.goto("/collections");
    await expect(page).toHaveURL(/\/collections$/);
    await expect(page.getByRole("heading", { level: 1, name: "No collections yet" })).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test("the collections list with collections", async ({ page, api }) => {
    await api.reset();
    await api.createCollection({ name: "Vinyl records", description: "Shelf by the window", fields: FIELDS });
    await api.createCollection({ name: "Board games", fields: FIELDS });

    await page.goto("/collections");
    await expect(page).toHaveURL(/\/collections$/);
    await expect(page.getByRole("link", { name: /Vinyl records/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Board games/ })).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  /**
   * A finite set's progress on its card (#42), at every state the bar has: an
   * empty set, part-way, exactly complete, and over the target — the last two
   * carrying the Complete badge — beside a finite set with no target, which
   * shows nothing. The words are asserted before the scan because they are the
   * content; the bar only repeats them.
   */
  test("the collections list with finite sets at 0%, part-way, complete and over their target", async ({
    page,
    api,
  }) => {
    await api.reset();
    const finite = async (name: string, target: number | null, owned: number, wanted = 0) => {
      const collection = await api.createCollection({ name, fields: FIELDS, isFiniteSet: true, targetCount: target });
      for (let n = 0; n < owned; n++) await api.createItem(collection.id, { title: `${name} ${n + 1}` }, "owned");
      for (let n = 0; n < wanted; n++)
        await api.createItem(collection.id, { title: `${name} want ${n + 1}` }, "wanted");
    };
    await finite("Empty set", 4, 0, 1);
    await finite("Part-way set", 4, 1, 2);
    await finite("Complete set", 2, 2);
    await finite("Over set", 2, 3);
    await finite("Stamp album", null, 1);

    await page.goto("/collections");
    await expect(page).toHaveURL(/\/collections$/);
    const card = (name: string) => page.getByRole("link", { name: new RegExp(name) });
    await expect(card("Empty set").locator(".collection-progress")).toHaveText("0 of 4 collected");
    await expect(card("Part-way set").locator(".collection-progress")).toHaveText("1 of 4 collected");
    await expect(card("Complete set").locator(".collection-progress")).toHaveText("2 of 2 collectedComplete");
    await expect(card("Over set").locator(".collection-progress")).toHaveText("3 of 2 collectedComplete");
    await expect(card("Stamp album").locator(".collection-progress")).toHaveCount(0);

    await expectNoAccessibilityViolations(page);
  });

  test("the new collection form", async ({ page }) => {
    await page.goto("/collections/new");
    await expect(page).toHaveURL(/\/collections\/new$/);
    await expect(page.getByLabel("Collection name")).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  /** The target box (#42), a state the route-level scan above never enters: it only exists once finite is checked. */
  test("the new collection form as a finite set with a target", async ({ page }) => {
    await page.goto("/collections/new");
    await expect(page).toHaveURL(/\/collections\/new$/);
    await page.getByRole("checkbox", { name: "Finite set (a fixed, known number of items)" }).check();
    const target = page.getByRole("spinbutton", { name: "Number of items in the set" });
    await target.fill("102");
    await expect(target).toHaveValue("102");
    await expect(target).toHaveAccessibleDescription(
      "Optional. A whole number from 1 to 100,000 — leave it empty if you do not know it yet.",
    );

    await expectNoAccessibilityViolations(page);
  });

  /** The one refusal the form shows itself (#42): no field left, said at Add field. */
  test("the new collection form refusing a submit with no field", async ({ page }) => {
    await page.goto("/collections/new");
    await expect(page).toHaveURL(/\/collections\/new$/);
    await page.getByLabel("Collection name").fill("Vinyl records");
    await page.getByRole("button", { name: "Remove field" }).click();
    await page.getByRole("button", { name: "Create collection" }).click();
    await expect(page.getByRole("alert")).toHaveText("A collection needs at least one field. Add one to continue.");
    await expect(page.getByRole("button", { name: "Add field" })).toHaveAccessibleDescription(
      "A collection needs at least one field. Add one to continue.",
    );

    await expectNoAccessibilityViolations(page);
  });

  test("the collection editor of a finite set with a target", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({
      name: "Pokémon Base Set",
      fields: FIELDS,
      isFiniteSet: true,
      targetCount: 102,
    });

    await page.goto(`/collections/${collection.id}/edit`);
    await expect(page).toHaveURL(`/collections/${collection.id}/edit`);
    await expect(page.getByRole("checkbox", { name: "Finite set (a fixed, known number of items)" })).toBeChecked();
    await expect(page.getByRole("spinbutton", { name: "Number of items in the set" })).toHaveValue("102");

    await expectNoAccessibilityViolations(page);
  });

  test("a collection with items", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959, signed: true }, "owned");
    await api.createItem(collection.id, { title: "Blue Train", year: 1958, signed: false }, "wanted");

    await page.goto(`/collections/${collection.id}`);
    await expect(page).toHaveURL(`/collections/${collection.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Vinyl records" })).toBeVisible();
    await expect(page.getByText("Kind of Blue")).toBeVisible();

    // What the nav claims, on a page that is inside a section rather than being
    // one (#355). No rule in axe can see this — `aria-current` is valid markup
    // with any value — so it is asserted beside the scan rather than by it.
    await expect(page.locator('[aria-current="page"]'), "nothing here is the page the user is on").toHaveCount(0);
    await expect(page.locator('.sidebar-nav a[href="/collections"]')).toHaveAttribute("aria-current", "true");

    await expectNoAccessibilityViolations(page);
  });

  /**
   * A search in force and a search that matched nothing (#41) — the two states
   * the search box adds, neither reachable from a route-level scan. The count
   * line is plain text, so the check beside the scan is that it is *not* a live
   * region; the announcer speaks it. The landmark is asserted here because jsdom
   * cannot: it has no implicit role for `<search>`.
   */
  test("a collection with a search in force, and one that matched nothing", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959, signed: true }, "owned");
    await api.createItem(collection.id, { title: "Blue Train", year: 1958, signed: false }, "wanted");
    await api.createItem(collection.id, { title: "Giant Steps", year: 1960, signed: false }, "owned");

    await page.goto(`/collections/${collection.id}?q=blue`);
    await expect(page.getByRole("search")).toContainText("Search items");
    await expect(page.getByText("2 items match “blue”")).toBeVisible();
    await expect(page.locator(".item-count")).not.toHaveAttribute("aria-live");
    await expect(page.getByRole("searchbox", { name: "Search items" })).toHaveValue("blue");
    await expectNoAccessibilityViolations(page);

    await page.getByRole("searchbox", { name: "Search items" }).fill("sonic");
    await expect(page.getByText("No items match “sonic”")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear search" })).toBeVisible();
    await expect(page.locator('.visually-hidden[aria-live="polite"] > *').last()).toHaveText("No items match “sonic”");
    await expectNoAccessibilityViolations(page);
  });

  /**
   * The filter panel open, filters in force as chips, and filters that match
   * nothing (#41) — three states no route-level scan reaches.
   */
  test("a collection with its filter panel open, filters applied, and filters matching nothing", async ({
    page,
    api,
  }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959, signed: true }, "owned");
    await api.createItem(collection.id, { title: "Blue Train", year: 1958, signed: false }, "wanted");

    await page.goto(`/collections/${collection.id}`);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await expect(page.getByRole("form", { name: "Filters" })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.getByRole("radio", { name: "Yes" }).check();
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("button", { name: "Remove filter Signed: yes" })).toBeVisible();
    await expect(page.getByText("1 item matches")).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.getByRole("spinbutton", { name: "Minimum" }).fill("2000");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByText("No items match these filters")).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  /** Tags in use on the collection editor (#41), and a removal asking to confirm. */
  test("the collection editor's tags in use, and a tag removal asking to confirm", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({
      name: "Vinyl records",
      fields: [
        { id: "title", label: "Title", type: "text", required: true },
        { id: "tags", label: "Tags", type: "tags" },
      ],
    });
    await api.createItem(collection.id, { title: "Kind of Blue", tags: ["signed", "mono"] }, "owned");

    await page.goto(`/collections/${collection.id}/edit`);
    await expect(page.getByRole("region", { name: "Tags in use: Tags" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rename “signed”" })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.getByRole("button", { name: "Remove “mono”" }).click();
    await expect(page.getByText("Remove “mono” from 1 item? This cannot be undone.")).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  /**
   * The state with two item forms on the screen at once (#369): a row's editor,
   * open above the add-item form, both built from the same fields. They shared
   * DOM ids, so every label resolved to the editor — its controls were named
   * twice and the add form's not at all. axe files both symptoms under
   * `incomplete` rather than `violations` (`duplicate-id-aria`,
   * `form-field-multiple-labels`), which the fixture fails on too; the gap was
   * only that no scan ever opened the editor.
   */
  test("a collection with a row's editor open", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959, signed: true }, "owned");
    await api.createItem(collection.id, { title: "Blue Train", year: 1958, signed: false }, "wanted");

    await page.goto(`/collections/${collection.id}`);
    await expect(page).toHaveURL(`/collections/${collection.id}`);
    await page.getByRole("button", { name: "Edit “Kind of Blue”" }).click();
    const editor = page.getByRole("form", { name: "Editing “Kind of Blue”" });
    await expect(editor).toBeVisible();

    // Each control named once, by its own form's label — the names axe cannot
    // be asked about directly, asserted where a screen reader would read them.
    const addForm = page.locator("section.add-item");
    for (const form of [editor, addForm]) {
      await expect(form.getByRole("combobox", { name: "Status", exact: true })).toHaveCount(1);
      await expect(form.getByRole("textbox", { name: "Title", exact: true })).toHaveCount(1);
      await expect(form.getByRole("spinbutton", { name: "Year", exact: true })).toHaveCount(1);
      await expect(form.getByRole("checkbox", { name: "Signed", exact: true })).toHaveCount(1);
    }
    await expect(editor.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("Kind of Blue");
    await expect(addForm.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("");

    await expectNoAccessibilityViolations(page);
  });

  /** The header's two finite-set states (#42): a bar measured from the counts route, and the hint asking for a target. */
  test("a finite set's header with its progress, and one with no target yet", async ({ page, api }) => {
    await api.reset();
    const sized = await api.createCollection({ name: "Coin set", fields: FIELDS, isFiniteSet: true, targetCount: 3 });
    await api.createItem(sized.id, { title: "Penny" }, "owned");
    await api.createItem(sized.id, { title: "Nickel" }, "wanted");
    const unsized = await api.createCollection({ name: "Stamp set", fields: FIELDS, isFiniteSet: true });

    await page.goto(`/collections/${sized.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Coin set" })).toBeVisible();
    await expect(page.locator(".collection-detail .collection-progress")).toHaveText("1 of 3 collected");
    await expectNoAccessibilityViolations(page);

    await page.goto(`/collections/${unsized.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Stamp set" })).toBeVisible();
    const hint = page.getByText("Add how many items the set has in Edit collection to see your progress.");
    await expect(hint).toBeVisible();
    await expect(hint).not.toHaveAttribute("aria-live");
    await expect(page.locator(".collection-detail .collection-progress")).toHaveCount(0);
    await expectNoAccessibilityViolations(page);
  });

  /**
   * Each status tab (#42), reached the way a user reaches it — by the tab, not
   * by the URL — so the scan covers the selected state that clicking leaves.
   * The panel's name follows the selected tab, which axe cannot judge.
   */
  test("a collection under each status tab", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 }, "owned");
    await api.createItem(collection.id, { title: "Blue Train", year: 1958 }, "wanted");
    await api.createItem(collection.id, { title: "Giant Steps", year: 1960 }, "ordered");

    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("tab", { name: "All", selected: true })).toBeVisible();
    await expect(page.getByRole("tabpanel", { name: "All" }).getByRole("listitem")).toHaveCount(3);
    await expectNoAccessibilityViolations(page);

    await page.getByRole("tab", { name: "Collected" }).click();
    await expect(page).toHaveURL(`/collections/${collection.id}?show=collected`);
    const collected = page.getByRole("tabpanel", { name: "Collected" });
    await expect(collected.getByRole("listitem")).toHaveCount(1);
    await expect(collected.locator(".item-count")).toHaveText("1 item collected");
    await expectNoAccessibilityViolations(page);

    await page.getByRole("tab", { name: "Remaining" }).click();
    await expect(page).toHaveURL(`/collections/${collection.id}?show=remaining`);
    const remaining = page.getByRole("tabpanel", { name: "Remaining" });
    await expect(remaining.getByRole("listitem")).toHaveCount(2);
    await expect(remaining.locator(".item-count")).toHaveText("2 items remaining");
    await expectNoAccessibilityViolations(page);
  });

  /**
   * The Remaining tab with nothing in it, in each of its three voices (R7):
   * nothing to measure against, short of the target, and complete. Never "No
   * items yet", which would claim the collection is empty.
   */
  test("an empty Remaining tab: no target, short of the target, and complete", async ({ page, api }) => {
    await api.reset();
    const plain = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(plain.id, { title: "Kind of Blue" }, "owned");
    const short = await api.createCollection({ name: "Coin set", fields: FIELDS, isFiniteSet: true, targetCount: 5 });
    await api.createItem(short.id, { title: "Penny" }, "owned");
    await api.createItem(short.id, { title: "Nickel" }, "owned");
    const done = await api.createCollection({ name: "Stamp set", fields: FIELDS, isFiniteSet: true, targetCount: 1 });
    await api.createItem(done.id, { title: "Penny Black" }, "owned");

    for (const [collection, title] of [
      [plain, "Nothing on your wanted list"],
      [short, "3 more to find"],
      [done, "All collected"],
    ] as const) {
      await page.goto(`/collections/${collection.id}?show=remaining`);
      await expect(page.getByRole("heading", { level: 1, name: collection.name })).toBeVisible();
      const panel = page.getByRole("tabpanel", { name: "Remaining" });
      await expect(panel.locator(".empty-state-title")).toHaveText(title);
      // The panel is described by its empty state, which axe cannot judge.
      await expect(panel).toHaveAccessibleDescription(new RegExp(`^${title} `));
      await expect(page.getByText("No items yet")).toHaveCount(0);
      await expectNoAccessibilityViolations(page);
    }
  });

  /**
   * A search whose matches are all in another tab (#42): the empty state says
   * so and offers a button that selects All — a state with a control of its
   * own, so it gets a scan, and the button is pressed to prove where it goes.
   */
  test("a search that matches only under another tab", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue" }, "owned");
    await api.createItem(collection.id, { title: "Blue Train" }, "wanted");

    await page.goto(`/collections/${collection.id}?show=remaining&q=kind`);
    const panel = page.getByRole("tabpanel", { name: "Remaining" });
    await expect(panel.locator(".empty-state-title")).toHaveText("No remaining items match “kind”");
    await expect(panel).toHaveAccessibleDescription("No remaining items match “kind” 1 item matches under All.");
    await expectNoAccessibilityViolations(page);

    await page.getByRole("button", { name: "Show them under All" }).press("Enter");
    await expect(page).toHaveURL(`/collections/${collection.id}?q=kind`);
    await expect(page.getByRole("tab", { name: "All", selected: true })).toBeFocused();
    await expect(page.getByRole("tabpanel", { name: "All" }).getByRole("listitem")).toHaveCount(1);
  });

  /**
   * Wanted and ordered rows (#42, D8): a dashed and a dotted border in the
   * status colors, muted values, and Mark collected beside Edit and Delete.
   * Both projects scan it, so both color schemes and the phone width where the
   * row wraps. The computed styles are asserted too: axe judges the text, not
   * whether the line pattern is there or whether the row was faded.
   */
  test("wanted and ordered rows, with Mark collected", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959 }, "owned");
    await api.createItem(collection.id, { title: "Blue Train", year: 1958 }, "wanted");
    await api.createItem(collection.id, { title: "Giant Steps", year: 1960 }, "ordered");

    await page.goto(`/collections/${collection.id}`);
    await expect(page.getByRole("button", { name: "Mark collected “Blue Train”" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark collected “Giant Steps”" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Mark collected “Kind of Blue”/ })).toHaveCount(0);

    const style = (title: string) =>
      page.locator(".item-row", { has: page.getByRole("button", { name: `Edit “${title}”` }) }).evaluate((row) => {
        const computed = getComputedStyle(row);
        return { border: computed.borderTopStyle, opacity: computed.opacity, filter: computed.filter };
      });
    expect(await style("Blue Train")).toEqual({ border: "dashed", opacity: "1", filter: "none" });
    expect(await style("Giant Steps")).toEqual({ border: "dotted", opacity: "1", filter: "none" });
    expect(await style("Kind of Blue")).toEqual({ border: "solid", opacity: "1", filter: "none" });

    await expectNoAccessibilityViolations(page);
  });

  /**
   * A mark the server refuses (#42, D9): the row's own alert, inserted with its
   * message inside, and focus left on the button for the retry.
   */
  test("a failed Mark collected", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Blue Train", year: 1958 }, "wanted");
    await page.route("**/api/collections/*/items/*", async (route) => {
      if (route.request().method() !== "PATCH") return await route.fallback();
      await route.fulfill({ status: 500, json: { message: "Internal Server Error" } });
    });

    await page.goto(`/collections/${collection.id}`);
    const mark = page.getByRole("button", { name: "Mark collected “Blue Train”" });
    await mark.focus();
    await page.keyboard.press("Enter");

    const alert = page.getByRole("listitem").getByRole("alert");
    await expect(alert).toHaveText(
      "Could not mark this item as collected. Its status has not changed — check that the app's server is running, then try again.",
    );
    await expect(mark).toBeFocused();
    await expectNoAccessibilityViolations(page);
  });

  test("a collection with no items", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Board games", fields: FIELDS });

    await page.goto(`/collections/${collection.id}`);
    await expect(page).toHaveURL(`/collections/${collection.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Board games" })).toBeVisible();
    await expect(page.getByText("No items yet")).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test("the collection editor", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });

    await page.goto(`/collections/${collection.id}/edit`);
    await expect(page).toHaveURL(`/collections/${collection.id}/edit`);
    await expect(page.getByLabel("Collection name")).toHaveValue("Vinyl records");

    await expectNoAccessibilityViolations(page);
  });

  /**
   * The editor of a collection that already has items, which is a different
   * screen from the one above: a field whose stored values would not convert
   * has its type locked, and the lock renders a hint the select points at
   * (#368). Never scanned before, because the editor's other scan seeds a
   * collection with no items and so never locks anything.
   */
  test("the collection editor with a locked field type", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue" });

    await page.goto(`/collections/${collection.id}/edit`);
    await expect(page.getByLabel("Collection name")).toHaveValue("Vinyl records");
    await expect(
      page.getByRole("combobox", { name: "Field type" }).first(),
      "the collection must have items, or nothing is locked and this scans the screen above",
    ).toHaveAttribute("aria-disabled", "true");

    await expectNoAccessibilityViolations(page);
  });

  test("settings, with something in the trash", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue" });
    await api.deleteItem(collection.id, item.id);

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByText("Kind of Blue")).toBeVisible();

    // #299: every control hangs off an <h2>, so heading navigation reaches all
    // of them. axe cannot see this — an ungrouped control breaks no rule, it
    // just sits outside the outline a screen reader walks — so it is asserted
    // here, on the rendered page, as well as in the unit test.
    const preferences = page.locator("section.settings-interface");
    await expect(preferences.getByRole("heading", { level: 2, name: "Interface" })).toBeVisible();
    await expect(preferences.getByLabel("Language")).toBeVisible();
    await expect(preferences.getByLabel("Theme")).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  /**
   * A route-level sweep only ever sees each screen's resting state, and the
   * states worth auditing are the ones a component swaps in: this one replaces
   * the trigger with a `role="alert"` prompt and moves focus. Scanning it keeps
   * the baseline from being read as "the app is AA" when it means "the app's
   * resting states are".
   */
  test("a destructive action with its confirmation open", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue" });
    await api.deleteItem(collection.id, item.id);

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);
    await page.getByRole("button", { name: "Delete forever “Kind of Blue”" }).click();
    await expect(page.getByRole("alert")).toContainText("This cannot be undone.");

    // The first thing this sweep found: at 390px the actions column sized itself
    // to the prompt, overflowed the card and squeezed the name to zero width, so
    // the question named an item the user could no longer see. Asserted on
    // geometry rather than left to axe, which could only report that it was
    // unable to decide the contrast of the text underneath.
    const row = page.locator(".trash-list .trash-row").first();
    const rowWidth = (await row.boundingBox())?.width ?? 0;
    const actionsWidth = (await row.locator(".trash-actions").boundingBox())?.width ?? 0;
    await expect(row.locator(".trash-name")).toHaveText("Kind of Blue");
    expect(actionsWidth, "the confirmation overflows the row it belongs to").toBeLessThanOrEqual(rowWidth);

    await expectNoAccessibilityViolations(page);
  });

  /**
   * The other state no route-level scan reaches, and the one with a deadline on
   * it: the undo toast, up over a collection (#308).
   *
   * The assertions before the scan are the announcement's mechanism, in a real
   * browser rather than in jsdom — the region is in the document and empty
   * *before* the delete, and the words arrive in it afterwards. A region
   * inserted with its text already inside is announced by VoiceOver but usually
   * not by NVDA or JAWS, which is what made this the one message in the app a
   * large share of screen-reader users never heard.
   */
  test("the undo toast, open over a collection", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959, signed: true }, "owned");

    await page.goto(`/collections/${collection.id}`);
    await expect(page).toHaveURL(`/collections/${collection.id}`);
    await expect(page.getByText("Kind of Blue")).toBeVisible();

    const region = page.locator(".undo-toast-live");
    await expect(region).toHaveAttribute("aria-live", "polite");
    await expect(region, "the region must be on the page, and empty, before the delete").toBeEmpty();

    await page.getByRole("button", { name: "Delete “Kind of Blue”" }).click();

    await expect(region).toContainText("Deleted “Kind of Blue”");
    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();

    // The toast dismisses itself after 10s, and two axe passes plus their
    // reporting is not obviously inside that. Hovering holds the window open for
    // as long as the pointer stays — Playwright parks it — so the scan cannot
    // race the timer. Hover rather than focus: `onBlur` is a bubbling focusout,
    // so anything that moved focus afterwards would restart the countdown.
    await undo.hover();

    await expectNoAccessibilityViolations(page);
  });

  /**
   * The two full-page load failures (#347) — the states no scan reached, and the
   * screens whose copy nothing was asserting. The editor is scanned as well as
   * the detail screen because the editor is the one that was wrong, and this is
   * the only place either is proven in a browser: a query failure cannot be
   * reproduced by driving Chrome directly, since React Query pauses retries
   * while `document.visibilityState` is "hidden" and a driven tab always is.
   *
   * Seven seconds because `lib/query-client.ts` overrides only `networkMode`, so
   * React Query's default three retries apply and the failure surface arrives
   * that long after the navigation rather than with it. Waited out rather than
   * skipped: `page.clock` does not carry the retry timers here, and a scan that
   * silently stopped reaching this state would be worse than a slow one.
   *
   * That latency is also why these screens keep announcing themselves through
   * `role="alert"` rather than by taking focus the way the crash screen below
   * does — by the time they mount, focus has long since settled somewhere else
   * (#346, closed).
   *
   * The collection request is aborted and its `/items` left alone: the glob
   * matches `/api/collections/<id>` and not the path below it.
   */
  test("a collection that will not load, on both screens that need it", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await page.route("**/api/collections/*", (route) => route.abort());

    await page.goto(`/collections/${collection.id}`);
    await expect(page).toHaveURL(`/collections/${collection.id}`);

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Could not load this collection", { timeout: 20_000 });
    await expect(alert, "one collection must not be reported in the plural").not.toContainText(
      "Could not load collections",
    );

    // The other half of the #349 split, and the only place it is proven in a
    // browser: this surface shares a component with the crash screen below,
    // which *does* take focus. A load failure must not — it arrives seven
    // seconds after the navigation, with focus wherever the user left it, so
    // moving it here would be a hazard rather than a recovery. The assertion is
    // on the body still holding focus rather than merely on the alert not having
    // it, so a surface that handed focus to something else inside itself could
    // not pass either.
    await expect(alert, "a load failure announces through the role, it does not seize focus").not.toBeFocused();
    await expect(page.locator("body")).toBeFocused();

    await expectNoAccessibilityViolations(page);

    // The editor, which took the dashboard's plural copy for a single collection
    // until #347. Same markup, so no second axe pass — the words are the point.
    await page.goto(`/collections/${collection.id}/edit`);
    await expect(page).toHaveURL(`/collections/${collection.id}/edit`);
    await expect(alert).toContainText("Could not load this collection", { timeout: 20_000 });
    await expect(alert, "the editor edits one collection, not the list").not.toContainText(
      "Could not load collections",
    );
  });

  /**
   * The state a route-level sweep can never reach because it is not a state the
   * app is supposed to have: a screen that threw while rendering (#319).
   *
   * Provoked with a poisoned payload rather than a throwing test route, because
   * this suite runs the production bundle (`playwright.config.ts` builds and
   * previews it) and a route that exists only for a test does not exist in it.
   * `collection.fields.map` in `routes/collections/$id.tsx` throws on null, and
   * nothing between the response and the render validates the shape. The glob
   * matches `/api/collections/<id>` and not its `/items`, so everything else on
   * the screen loads exactly as it always does.
   *
   * Worth a scan of its own on two counts: the error surface is the one screen
   * with no author watching it, and before #319 what rendered here was the
   * router's built-in fallback — unstyled, untranslated, outside the shell, and
   * holding the error message.
   */
  test("a screen that crashed while rendering", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959, signed: true }, "owned");

    await page.route("**/api/collections/*", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), fields: null } });
    });

    await page.goto(`/collections/${collection.id}`);
    await expect(page).toHaveURL(`/collections/${collection.id}`);

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Something went wrong");

    // Not the announcement — the inserted role="alert" is (#347) — but the crash
    // orphaned focus to <body>, and this is what stops the user's tab order
    // restarting at the top of the document.
    await expect(alert, "the crash orphaned focus, so the surface must take it").toBeFocused();

    // The internals stay off the screen. Asserted on the runtime's own words for
    // this throw, so a fallback that leaked the message could not pass.
    await expect(page.locator("body")).not.toContainText("Cannot read properties of null");
    await expect(page.getByRole("button", { name: "Show Error" })).toHaveCount(0);

    // The route's boundary replaces the screen, not the app: the cabinet is
    // still standing around it. Asserted on the shell rather than on a named
    // nav, because which of the two the user has depends on the viewport this
    // project runs at.
    await expect(page.locator(".shell")).toBeVisible();
    await expect(page.locator("main#main-content")).toContainText("Something went wrong");

    await expectNoAccessibilityViolations(page);

    // The way out, operated the way a keyboard user operates it.
    await page.getByRole("link", { name: "Back to collections" }).press("Enter");
    await expect(page).toHaveURL(/\/collections$/);
    await expect(page.getByRole("link", { name: /Vinyl records/ })).toBeVisible();
  });

  /**
   * The address that is not in the cabinet (#344), which is the one screen in
   * the app a user reaches by getting something wrong rather than by following
   * a link.
   *
   * Scanned in a browser because that is where the claim lives: the route has
   * to be *reachable* by typing a URL, which means the preview server's SPA
   * fallback has to hand `/nope` to index.html and the router has to rank the
   * splat below every real route. Neither is visible to a test that renders the
   * route tree in jsdom.
   *
   * The assertion before the scan is what makes it worth having: axe is just as
   * happy on the router's own untranslated `<p>Not Found</p>`, which is exactly
   * what this replaced.
   */
  test("an address with no page behind it", async ({ page }) => {
    await page.goto("/nope");
    await expect(page).toHaveURL(/\/nope$/);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    // WCAG 2.4.2, and the half that was missing entirely: without a route of
    // its own the fallback declared no `titleKey`, so the document kept
    // whatever name the previous screen had given it.
    await expect(page).toHaveTitle("Page not found · MyCollections");

    // A 404 is not an error, so it must not be wearing the app's danger
    // treatment — which in this app hangs off the role rather than a class
    // (`src/styles/alerts.integration.test.ts`), so the role is what to assert.
    await expect(page.getByRole("alert"), "a wrong address is not an alert").toHaveCount(0);
    // The app is still standing around it: the address was wrong, not the app.
    await expect(page.locator(".shell")).toBeVisible();

    // And it does not seize focus. `FailureSurface` does, because a crash
    // orphans focus in the same tick; arriving at a wrong address does not, and
    // on a hard load nothing has been focused yet — so taking it here would put
    // the skip link and the whole nav behind the user's first Tab. Asserted on
    // <body> still holding focus rather than on the screen merely not having it,
    // so a surface that handed focus to something inside itself would fail too.
    await expect(page.locator("body")).toBeFocused();

    await expectNoAccessibilityViolations(page);

    // Geometry, because axe cannot see it: this screen's actions sit in a
    // wrapping flex row, and at 390px a row that refused to wrap would push the
    // page sideways rather than stack. Asserted on the document rather than on
    // the row, so anything else that overflowed would fail here too. (The same
    // sweep caught exactly this in the trash row, above.)
    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement;
      return root ? root.scrollWidth - root.clientWidth : 0;
    });
    expect(overflow, "the not-found screen must not scroll the page sideways").toBeLessThanOrEqual(0);

    // The way out, operated the way a keyboard user operates it.
    const out = page.getByRole("link", { name: "Back to collections" });
    // 44px is the floor for a touch target, and the primary action on the one
    // screen a user reaches by mistake is the worst place to miss it.
    expect((await out.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await out.press("Enter");
    await expect(page).toHaveURL(/\/collections$/);
  });

  /**
   * The half of the 404 that `/nope` cannot show (#354): a wrong address *below*
   * a real section, where `Link`'s prefix matching had three links telling a
   * screen-reader user that `/collections` was the page they were on — both nav
   * links, and the recovery button they were about to press.
   *
   * In the browser sweep rather than only in jsdom because this is the one
   * assertion that survives someone deleting a unit test, and because axe cannot
   * help: `aria-current="page"` is valid markup on any link, so no rule sees it
   * pointing at the wrong page. The collection need not exist — the splat
   * catches the unknown segment below `/collections/<id>` either way, and the
   * prefix is the whole of the bug.
   */
  test("a wrong address below a section claims no current page", async ({ page }) => {
    await page.goto("/collections/11111111-1111-1111-1111-111111111111/nope");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();

    await expect(page.locator("[aria-current]"), "nothing on a 404 is the page the user is on").toHaveCount(0);
  });

  /**
   * The same screen arrived at the way that actually announces anything: a
   * client-side navigation. A typed URL is a real page load, which the browser
   * announces itself and which the shell deliberately stays silent for, so the
   * spec above proves the title and this one proves the voice.
   *
   * Driven with Back rather than with an injected `<a href>`: a plain anchor is
   * a page load, so it would prove the opposite of what it looks like. Back is
   * also the honest scenario — someone who lands on a dead link and reaches for
   * the browser's own way out.
   */
  test("a dead link reached without a page load is announced", async ({ page }) => {
    await page.goto("/nope");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();

    const region = page.locator('.visually-hidden[aria-live="polite"]');
    // Empty on arrival: a live region that already holds its text when it is
    // inserted is announced by VoiceOver but usually not by NVDA or JAWS, and
    // the page the user just loaded is not news.
    await expect(region, "the announcer must be on the page, and empty, on arrival").toBeEmpty();

    // One node per message (#41): each announcement is an addition of its own,
    // and the previous one stays until its lifetime is up.
    const messages = region.locator(":scope > *");

    await page.getByRole("link", { name: "Back to collections" }).click();
    await expect(page).toHaveURL(/\/collections$/);
    await expect(messages).toHaveText(["Collections · MyCollections"]);

    await page.goBack();

    await expect(page).toHaveURL(/\/nope$/);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    // The new node is the assertion: a 404 that announced nothing would leave
    // "Collections · MyCollections" as the last thing said, on a page that is
    // no longer the collections list.
    await expect(messages).toHaveText(["Collections · MyCollections", "Page not found · MyCollections"]);
  });

  /**
   * The two Settings states no route-level sweep reaches, and the two regions
   * #326 gave a persistent host (#308's rule, applied to the rest of the app).
   *
   * The assertions before each scan are the announcement's mechanism, in a real
   * browser rather than in jsdom, which has no accessibility tree at all: the
   * region is on the page and empty *before* the action, and the words arrive in
   * that region afterwards. A region inserted with its text already inside it is
   * announced by VoiceOver but usually not by NVDA or JAWS.
   *
   * Both locators are class-scoped for the reason the navigation spec above
   * records: /settings now owns three polite regions — the shell's announcer,
   * the import's and the trash's — so a bare `[aria-live]` locator is ambiguous.
   */
  test("the import's result, announced on Settings", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    await api.createItem(collection.id, { title: "Kind of Blue", year: 1959, signed: true }, "owned");
    // Taken from the server, then restored into an empty database, so the file
    // the picker is handed is one the app itself produced.
    const backup = await api.exportDocument();
    await api.reset();

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);

    const region = page.locator(".import-live");
    await expect(region).toHaveAttribute("aria-live", "polite");
    await expect(region, "the region must be on the page, and empty, before the import").toBeEmpty();

    await page.getByLabel("Choose backup file").setInputFiles({
      name: "mycollections-export.json",
      mimeType: "application/json",
      buffer: Buffer.from(backup),
    });

    await expect(region).toContainText("Imported 1 collections and 1 items");
    await expectNoAccessibilityViolations(page);
  });

  /**
   * Mirrors `TRASH_CONFIRMATION_MS` in `src/components/TrashSection.tsx`, rather
   * than importing it: these specs run in Node, and one import from `src/` pulls
   * the app's whole module graph — `import.meta.env` included — in with it.
   */
  const TRASH_CONFIRMATION_MS = 10_000;

  /** Mirrors `CELEBRATION_MS` in `src/routes/collections/$id.tsx`, for the reason given above. */
  const CELEBRATION_MS = 10_000;

  /** Seeds a set one item short of its target of 2, and opens it. */
  async function oneShortOfComplete(page: Page, api: ApiFixture) {
    await api.reset();
    const collection = await api.createCollection({
      name: "Coins",
      fields: FIELDS,
      isFiniteSet: true,
      targetCount: 2,
    });
    await api.createItem(collection.id, { title: "Penny", year: 1909 }, "owned");
    await api.createItem(collection.id, { title: "Dime", year: 1916 }, "wanted");
    await page.goto(`/collections/${collection.id}`);
    await expect(page).toHaveURL(`/collections/${collection.id}`);
    await expect(page.locator(".collection-progress")).toContainText("1 of 2 collected");
  }

  /**
   * The celebration's message has no control, so it must not take one away
   * for ten seconds. Scrolls the add form's Title box under the middle of the
   * message, then asks what the pointer would hit there: the box, not the
   * message. Returns that point, for a real click to prove the same.
   */
  async function controlUnderMessage(page: Page) {
    const title = page.locator(".add-item").getByRole("textbox", { name: "Title" });
    return title.evaluate((input) => {
      const message = document.querySelector(".celebration")?.getBoundingClientRect();
      if (!message) throw new Error("no celebration on screen");
      const x = message.left + message.width / 2;
      const y = message.top + message.height / 2;
      const box = input.getBoundingClientRect();
      window.scrollBy(0, box.top + box.height / 2 - y);
      const moved = input.getBoundingClientRect();
      return {
        x,
        y,
        covered: moved.left <= x && x <= moved.right && moved.top <= y && y <= moved.bottom,
        hitsControl: document.elementFromPoint(x, y) === input,
      };
    });
  }

  /**
   * The scan of a celebrating page. `color-contrast` cannot run on the
   * message: it has `pointer-events: none`, so `elementsFromPoint` — how axe
   * finds a text's background — skips it, and the rule can only say "could
   * not decide". Its contrast is computed instead, for both themes, in
   * `toast.integration.test.ts` (the toast's ink and manila on `--cabinet`).
   * Every other rule still runs on the message, and contrast still runs on
   * the rest of the page.
   */
  const scanCelebrating = (page: Page) => expectNoAccessibilityViolations(page, { contrastExclude: ".celebration" });

  /** What the header's Complete badge is animating, if anything, and for how long. */
  function badgeMotion(page: Page) {
    return page.locator(".collection-progress-badge").evaluate((badge) => {
      const computed = getComputedStyle(badge);
      return { name: computed.animationName, seconds: Number.parseFloat(computed.animationDuration) };
    });
  }

  /**
   * Completing a finite set (#42): the celebration's region, empty before the
   * action and filled by it — one message, carrying the mark's own words —
   * scanned while it holds, then emptied in place when its window is up. The
   * clock is frozen for the same reason as the emptied trash's below.
   */
  test("a finite set completed by Mark collected, celebrated, and cleared when its window is up", async ({
    page,
    api,
  }) => {
    await page.clock.install();
    // The suite runs with reduced motion (playwright.config.ts); the stamp is
    // what this spec is about, so motion is back on until the scan.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await oneShortOfComplete(page, api);

    const region = page.locator(".celebration-live");
    await expect(region).toHaveAttribute("aria-live", "polite");
    await expect(region).not.toHaveAttribute("role");
    await expect(region, "the region must be on the page, and empty, before the set is completed").toBeEmpty();

    await page.getByRole("button", { name: "Mark collected “Dime”" }).click();

    await expect(region).toHaveText("Marked “Dime” as collected. Coins is complete!");
    await expect(page.locator(".collection-progress")).toContainText("2 of 2 collected");
    await expect(page.locator(".collection-progress-badge")).toHaveText("Complete");
    // Focus is where Mark collected always sends it; only the words changed.
    await expect(page.getByRole("button", { name: "Edit “Dime”" })).toBeFocused();
    // One message: the shell's announcer is not told about the mark as well.
    await expect(page.locator('.visually-hidden[aria-live="polite"]')).not.toContainText("Marked");
    expect(await badgeMotion(page)).toEqual({ name: "stamp-in", seconds: 0.48 });
    // Settled pixels for the scan, as everywhere else in the suite: the toast
    // entrance's opacity fade would leave axe's contrast check undecided.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await scanCelebrating(page);

    // Neither the region nor the message takes the pointer: what it covers
    // stays usable for the whole window, at both viewports.
    const point = await controlUnderMessage(page);
    expect(point, "the Title box must be under the message, and be what the pointer hits").toMatchObject({
      covered: true,
      hitsControl: true,
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator(".add-item").getByRole("textbox", { name: "Title" })).toBeFocused();
    await expect(region, "the click went through; the message is still up").toContainText("Coins is complete!");

    await page.clock.fastForward(CELEBRATION_MS + 1_000);
    await expect(region, "the celebration must not outlive its window").toBeEmpty();
    await expect(region).toHaveAttribute("aria-live", "polite");
    // The badge stays — the set is still complete — but stops stamping.
    await expect(page.locator(".collection-progress-badge")).toHaveText("Complete");
    expect((await badgeMotion(page)).name).toBe("none");
  });

  /** The same completion for someone who asked for less motion: the words, and no stamp. */
  test("a finite set completed with reduced motion: the celebration without the stamp", async ({ page, api }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await oneShortOfComplete(page, api);

    await page.getByRole("button", { name: "Mark collected “Dime”" }).click();

    await expect(page.locator(".celebration-live")).toHaveText("Marked “Dime” as collected. Coins is complete!");
    const motion = await badgeMotion(page);
    // The opt-out keeps the animation (so animationend still fires) and takes
    // its duration to 0.01ms — no frame of it is ever seen.
    expect(motion.name).toBe("stamp-in");
    expect(motion.seconds).toBeLessThan(0.001);

    await scanCelebrating(page);
  });

  test("the emptied trash, announced on Settings, and cleared when its window is up", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue" });
    await api.deleteItem(collection.id, item.id);

    // The confirmation retires itself after TRASH_CONFIRMATION_MS (#336), and the
    // axe scan below is the slowest thing in this spec — on a loaded runner it
    // could finish after the message had gone and still pass, scanning an empty
    // region and proving nothing. Freezing the clock removes the race instead of
    // narrowing it, and then lets the self-clear be proven in a real browser,
    // which jsdom cannot do for a live region at all.
    await page.clock.install();

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByText("Kind of Blue")).toBeVisible();

    const region = page.locator(".trash-live");
    await expect(region).toHaveAttribute("aria-live", "polite");
    await expect(region, "the region must be on the page, and empty, before the trash is emptied").toBeEmpty();

    // The trigger is replaced by its own confirmation, so the same name is
    // clicked twice: once to ask, once to answer.
    const emptyTrash = page.getByRole("button", { name: "Empty trash" });
    await emptyTrash.click();
    await emptyTrash.click();

    await expect(region).toContainText("Emptied the trash: removed 0 collections and 1 item.");
    await expectNoAccessibilityViolations(page);

    await page.clock.fastForward(TRASH_CONFIRMATION_MS + 1_000);
    await expect(region, "the confirmation must not outlive its window").toBeEmpty();
    // The region itself stays: one that is torn down when it has nothing to say
    // is one that arrives with its text already inside it next time (#326).
    await expect(region).toHaveAttribute("aria-live", "polite");
  });
});
