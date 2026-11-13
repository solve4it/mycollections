import type { Page } from "@playwright/test";
import { E2E_API_TOKEN, WEB_URL } from "../playwright.config.js";
import { expect, test } from "./fixtures.js";

/**
 * Dragging a photo to a new place (#37). A pointer layer over the order the
 * Move buttons change — `keyboard.spec.ts` covers those — so this spec only
 * proves the drag itself: real layout, real mouse events, which jsdom cannot
 * give dnd-kit.
 */

const FIELDS = [{ id: "title", label: "Title", type: "text", required: true }];

async function order(page: Page): Promise<(string | null)[]> {
  return page
    .locator(".image-gallery [data-media-id]")
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("data-media-id")));
}

/** Presses on one photo and lets go over another, moving in steps as a hand would. */
async function dragPhoto(page: Page, from: number, to: number): Promise<void> {
  const handles = page.locator(".image-drag-handle");
  const start = await handles.nth(from).boundingBox();
  const end = await handles.nth(to).boundingBox();
  if (!start || !end) throw new Error("a photo has no box to drag from or to");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
}

test.describe("dragging photos", () => {
  test("a photo dragged onto another takes its place, is saved, and is announced", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue" });
    const a = await api.uploadImage(collection.id, item.id);
    const b = await api.uploadImage(collection.id, item.id);
    const c = await api.uploadImage(collection.id, item.id);
    await page.goto(`/collections/${collection.id}/items/${item.id}`);
    await expect(page.locator(".image-gallery img")).toHaveCount(3);

    await dragPhoto(page, 0, 2);
    await expect.poll(() => order(page)).toEqual([b.id, c.id, a.id]);
    // Spoken through the shell's announcer — dnd-kit's own announcements are off.
    await expect(page.locator('.visually-hidden[aria-live="polite"]')).toContainText("Moved to position 3 of 3.");
    // The first photo is the cover, so the cover changed with it.
    await expect(page.locator("[data-media-id] .image-cover-badge").locator("xpath=ancestor::li")).toHaveAttribute(
      "data-media-id",
      b.id,
    );

    // Saved, not just drawn: a reload shows the same order.
    await page.reload();
    await expect(page.locator(".image-gallery img")).toHaveCount(3);
    expect(await order(page)).toEqual([b.id, c.id, a.id]);
  });

  test("a click on a photo's buttons is still a click, not the start of a drag", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue" });
    const a = await api.uploadImage(collection.id, item.id);
    const b = await api.uploadImage(collection.id, item.id);
    await page.goto(`/collections/${collection.id}/items/${item.id}`);
    await expect(page.locator(".image-gallery img")).toHaveCount(2);

    await page.getByRole("button", { name: "Move photo 1 of 2 later" }).click();
    await expect.poll(() => order(page)).toEqual([b.id, a.id]);
  });

  test("a drop where it started changes nothing and sends nothing", async ({ page, api }) => {
    await api.reset();
    const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
    const item = await api.createItem(collection.id, { title: "Kind of Blue" });
    const a = await api.uploadImage(collection.id, item.id);
    const b = await api.uploadImage(collection.id, item.id);
    await page.goto(`/collections/${collection.id}/items/${item.id}`);
    await expect(page.locator(".image-gallery img")).toHaveCount(2);

    const sent: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/media/order")) sent.push(request.method());
    });
    await dragPhoto(page, 0, 0);
    expect(await order(page)).toEqual([a.id, b.id]);
    expect(sent).toEqual([]);
  });

  /**
   * Touch, where photos mostly come from: a press held past 250ms then moved.
   * Playwright has no touch drag, so the touches go in through Chrome's own
   * input domain, as a finger's would.
   */
  test("a photo held and dragged by touch takes the new place too", async ({ browser, api }) => {
    // A context of its own, since touch is fixed per context; it carries the
    // token the shared one seeds, and the base URL.
    const context = await browser.newContext({
      hasTouch: true,
      viewport: { width: 390, height: 844 },
      baseURL: WEB_URL,
      storageState: {
        cookies: [],
        origins: [{ origin: WEB_URL, localStorage: [{ name: "api_token", value: E2E_API_TOKEN }] }],
      },
    });
    const page = await context.newPage();
    try {
      await api.reset();
      const collection = await api.createCollection({ name: "Vinyl records", fields: FIELDS });
      const item = await api.createItem(collection.id, { title: "Kind of Blue" });
      const a = await api.uploadImage(collection.id, item.id);
      const b = await api.uploadImage(collection.id, item.id);
      await page.goto(`/collections/${collection.id}/items/${item.id}`);
      await expect(page.locator(".image-gallery img")).toHaveCount(2);

      const handles = page.locator(".image-drag-handle");
      const start = await handles.nth(0).boundingBox();
      const end = await handles.nth(1).boundingBox();
      if (!start || !end) throw new Error("a photo has no box");
      const cdp = await context.newCDPSession(page);
      const at = (box: { x: number; y: number; width: number; height: number }) => [
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      ];
      // A quick swipe is a scroll, not a drag: without the hold nothing moves.
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(start) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(end) });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(300);
      expect(await order(page), "a swipe without a hold must not reorder").toEqual([a.id, b.id]);

      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(start) });
      await page.waitForTimeout(400);
      for (let step = 1; step <= 10; step++) {
        const x = start.x + start.width / 2 + ((end.x - start.x) * step) / 10;
        const y = start.y + start.height / 2 + ((end.y - start.y) * step) / 10;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(() => order(page)).toEqual([b.id, a.id]);
    } finally {
      await context.close();
    }
  });
});
