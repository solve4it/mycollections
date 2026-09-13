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

    await page.getByRole("button", { name: "Delete" }).first().click();

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
