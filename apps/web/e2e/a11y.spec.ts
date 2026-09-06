import { expect, expectNoAccessibilityViolations, test } from "./fixtures.js";

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
    await expect(page.locator('[aria-live="polite"]')).toBeEmpty();

    await page.getByRole("link", { name: "Collections" }).first().click();

    await expect(page).toHaveURL(/\/collections$/);
    await expect(page).toHaveTitle("Collections · MyCollections");
    await expect(page.locator('[aria-live="polite"]')).toHaveText("Collections · MyCollections");

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

  test("the new collection form", async ({ page }) => {
    await page.goto("/collections/new");
    await expect(page).toHaveURL(/\/collections\/new$/);
    await expect(page.getByLabel("Collection name")).toBeVisible();

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

  test("settings, with something in the trash", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue" });
    await api.deleteItem(collection.id, item.id);

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByText("Kind of Blue")).toBeVisible();

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
    await page.getByRole("button", { name: "Delete forever" }).first().click();
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
});
