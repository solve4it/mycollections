import { expect, test } from "./fixtures.js";

/**
 * The tab icon (#472): the docs site's mark from #332, linked from the page and
 * actually served — a link to a file the build never emitted is a 404 on every
 * route, and an empty tab.
 */
test("every page links the favicon, and the server sends it", async ({ page, request }) => {
  await page.goto("/collections");
  const href = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(href).toBe("/favicon.svg");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("type", "image/svg+xml");

  const response = await request.get(href as string);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
  expect(await response.text()).toContain("<title>MyCollections</title>");
});
