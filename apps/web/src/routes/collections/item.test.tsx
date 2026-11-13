import type { Collection, Media } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { authenticatedRoute } from "../_authenticated.js";

vi.mock("../../lib/api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client.js")>();
  return {
    ApiError: actual.ApiError,
    getCollection: vi.fn(),
    getItem: vi.fn(),
    listMedia: vi.fn(),
    uploadMedia: vi.fn(),
    fetchMediaBlob: vi.fn(async () => new Blob(["webp"], { type: "image/webp" })),
    getToken: vi.fn(() => "test-token"),
  };
});

import { ApiError, getCollection, getItem, listMedia, uploadMedia } from "../../lib/api-client.js";
import { itemDetailRoute } from "./item.js";

const C = "00000000-0000-4000-8000-0000000000c1";
const I = "00000000-0000-4000-8000-0000000000a1";

const collection: Collection = {
  id: C,
  name: "Vinyl records",
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "year", type: "number", label: "Year", required: false },
  ],
  isFiniteSet: false,
  targetCount: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const item = {
  id: I,
  collectionId: C,
  status: "wanted" as const,
  fields: { title: "Kind of Blue", year: 1959 },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  primaryMedia: null,
};

function media(id: string, position: number): Media {
  return {
    id,
    itemId: I,
    kind: "image",
    source: "user-attached",
    mimeType: "image/webp",
    bytes: 100,
    width: 1200,
    height: 800,
    position,
    createdAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}

/** The shell's announcer: the root route renders the real shell. One node per message. */
function announced(): string[] {
  const region = document.querySelector<HTMLElement>('.visually-hidden[aria-live="polite"]');
  if (!region) throw new Error("no announcer");
  return [...region.children].map((node) => node.textContent ?? "");
}

function renderItemPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [`/collections/${C}/items/${I}`] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([authenticatedRoute.addChildren([itemDetailRoute])]),
    history,
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** The hidden file input behind "Add photos". */
function filesInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]:not([capture])');
  if (!input) throw new Error("no file input");
  return input;
}

function pick(files: File[]) {
  fireEvent.change(filesInput(), { target: { files } });
}

const photo = (name = "sleeve.jpg") => new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: "image/jpeg" });

beforeEach(() => {
  vi.mocked(getCollection).mockResolvedValue(collection);
  vi.mocked(getItem).mockResolvedValue(item);
  vi.mocked(listMedia).mockResolvedValue([]);
  vi.stubGlobal(
    "URL",
    Object.assign(Object.create(URL), { createObjectURL: () => "blob:test/image", revokeObjectURL: () => {} }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the item page (#37)", () => {
  it("is named after the item, shows its values, and leads back to its collection by name", async () => {
    renderItemPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Kind of Blue" })).toBeInTheDocument();
    const details = document.querySelector("dl.item-details") as HTMLElement;
    const rows = [...details.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(rows).toEqual([
      ["Status", "Wanted"],
      ["Title", "Kind of Blue"],
      ["Year", "1959"],
    ]);
    const back = screen.getByRole("link", { name: "Back to Vinyl records" });
    expect(back).toHaveAttribute("href", `/collections/${C}`);
    await waitFor(() => expect(document.title).toMatch(/^Kind of Blue\b/));
  });

  it("says there are no photos yet", async () => {
    renderItemPage();
    expect(await screen.findByText("No photos yet.")).toBeInTheDocument();
  });

  it("lists the photos in order, each named for the item and its place, the first marked as the cover", async () => {
    vi.mocked(listMedia).mockResolvedValue([
      media("00000000-0000-4000-8000-0000000000a1", 0),
      media("00000000-0000-4000-8000-0000000000b2", 1),
    ]);
    renderItemPage();
    const gallery = await screen.findByRole("list");
    const tiles = within(gallery).getAllByRole("listitem");
    expect(tiles).toHaveLength(2);
    await waitFor(() =>
      expect(
        within(gallery)
          .getAllByRole("img")
          .map((img) => img.getAttribute("alt") ?? img.getAttribute("aria-label")),
      ).toEqual(["Photo 1 of 2 of “Kind of Blue”", "Photo 2 of 2 of “Kind of Blue”"]),
    );
    expect(within(tiles[0] as HTMLElement).getByText("Cover")).toBeInTheDocument();
    expect(within(tiles[1] as HTMLElement).queryByText("Cover")).toBeNull();
    // The thumbnail is fetched with the token and shown through an object URL.
    await waitFor(() => expect(within(gallery).getAllByRole("img")[0]).toHaveAttribute("src", "blob:test/image"));
  });

  it("uploads every picked file in turn, says so, and shows the new photos", async () => {
    vi.mocked(uploadMedia).mockImplementation(async () => media("00000000-0000-4000-8000-0000000000a1", 0));
    renderItemPage();
    await screen.findByText("No photos yet.");
    vi.mocked(listMedia).mockResolvedValue([
      media("00000000-0000-4000-8000-0000000000a1", 0),
      media("00000000-0000-4000-8000-0000000000b2", 1),
    ]);
    const sleeve = photo("sleeve.jpg");
    const label = photo("label.jpg");
    pick([sleeve, label]);
    await waitFor(() => expect(announced()).toEqual(["Adding 2 photos…", "Added 2 photos."]));
    expect(vi.mocked(uploadMedia).mock.calls).toEqual([
      [C, I, sleeve, "user-attached"],
      [C, I, label, "user-attached"],
    ]);
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
  });

  it("marks Add photos unavailable while an upload runs, without disabling it, and refuses a second pick", async () => {
    let finish: (value: Media) => void = () => {};
    vi.mocked(uploadMedia).mockImplementation(() => new Promise<Media>((resolve) => (finish = resolve)));
    renderItemPage();
    const add = await screen.findByRole("button", { name: "Add photos" });
    pick([photo()]);
    await waitFor(() => expect(add).toHaveAttribute("aria-disabled", "true"));
    expect(add).toBeEnabled();
    const click = vi.spyOn(filesInput(), "click");
    fireEvent.click(add);
    expect(click).not.toHaveBeenCalled();
    finish(media("00000000-0000-4000-8000-0000000000a1", 0));
    await waitFor(() => expect(add).not.toHaveAttribute("aria-disabled"));
  });

  it.each([
    [415, "1 file was not added: it is not a JPEG, PNG, GIF, WebP or AVIF image."],
    [413, "1 photo was not added: it is over 25 MB or 50 megapixels."],
    [503, "1 photo was not added: the server is busy with other photos. Try again in a moment."],
    [500, "1 photo was not added. Check that the app’s server is running, then try again."],
  ])("says why a %i refusal happened", async (status, message) => {
    vi.mocked(uploadMedia).mockRejectedValue(new ApiError(status));
    renderItemPage();
    await screen.findByText("No photos yet.");
    pick([photo()]);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(announced()).toEqual(["Adding 1 photo…"]);
  });

  it("stops at a full item rather than refusing every file after it", async () => {
    vi.mocked(uploadMedia).mockRejectedValue(new ApiError(409));
    renderItemPage();
    await screen.findByText("No photos yet.");
    pick([photo("a.jpg"), photo("b.jpg"), photo("c.jpg")]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This item already has as many photos as it can hold (50).",
    );
    expect(uploadMedia).toHaveBeenCalledTimes(1);
  });

  it("offers no camera on a device without a touch screen", async () => {
    renderItemPage();
    await screen.findByRole("button", { name: "Add photos" });
    expect(screen.queryByRole("button", { name: "Take photo" })).toBeNull();
  });

  it("offers the camera on a touch screen, and sends what it takes as a camera photo", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" }));
    vi.mocked(uploadMedia).mockResolvedValue(media("00000000-0000-4000-8000-0000000000a1", 0));
    renderItemPage();
    expect(await screen.findByRole("button", { name: "Take photo" })).toBeInTheDocument();
    const camera = document.querySelector<HTMLInputElement>(
      'input[type="file"][capture="environment"]',
    ) as HTMLInputElement;
    const shot = photo("camera.jpg");
    fireEvent.change(camera, { target: { files: [shot] } });
    await waitFor(() => expect(uploadMedia).toHaveBeenCalledWith(C, I, shot, "user-camera"));
  });

  it("explains a missing item rather than spinning", async () => {
    vi.mocked(getItem).mockRejectedValue(new ApiError(404));
    renderItemPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this item");
    // Named as it is ever going to be: the route's own title, not a wait for one.
    await waitFor(() => expect(document.title).toMatch(/^Item\b/));
  });
});
