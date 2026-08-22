import type { Collection } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { collectionsRoute } from "./index.js";

vi.mock("../../lib/api-client.js", () => ({
  getCollection: vi.fn(),
  updateCollection: vi.fn(),
  listItems: vi.fn(),
  listTrash: vi.fn(),
  listCollections: vi.fn(() => Promise.resolve([])),
  getToken: vi.fn(() => "test-token"),
}));

import { getCollection, listItems, listTrash, updateCollection } from "../../lib/api-client.js";
import { editCollectionRoute } from "./edit.js";

const COLLECTION_ID = "00000000-0000-0000-0000-0000000000c1";

const collection: Collection = {
  id: COLLECTION_ID,
  name: "Books",
  description: "Shelf",
  fields: [
    { id: "title", type: "text", label: "Title", required: true },
    { id: "pages", type: "number", label: "Pages", required: false },
  ],
  isFiniteSet: false,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  deletedAt: null,
};

function item(id: string, deletedAt: string | null = null) {
  return {
    id,
    collectionId: COLLECTION_ID,
    status: "owned" as const,
    fields: { title: "Dune" },
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    deletedAt,
  };
}

const testRouteTree = rootRoute.addChildren([editCollectionRoute, collectionsRoute]);

function renderEdit() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const history = createMemoryHistory({ initialEntries: [`/collections/${COLLECTION_ID}/edit`] });
  const router = createRouter({ routeTree: testRouteTree, history });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

beforeEach(() => {
  localStorage.setItem("api_token", "test-token");
  vi.resetAllMocks();
  vi.mocked(getCollection).mockResolvedValue(collection);
  vi.mocked(updateCollection).mockResolvedValue(collection);
  vi.mocked(listItems).mockResolvedValue([]);
  vi.mocked(listTrash).mockResolvedValue({ collections: [], items: [] });
});

afterEach(cleanup);

describe("EditCollectionPage", () => {
  it("loads the collection into the editor", async () => {
    renderEdit();
    expect(await screen.findByLabelText(/collection name/i)).toHaveValue("Books");
    expect(screen.getByLabelText(/description/i)).toHaveValue("Shelf");
    const labels = screen.getAllByLabelText(/field label/i) as HTMLInputElement[];
    expect(labels.map((input) => input.value)).toEqual(["Title", "Pages"]);
    const types = screen.getAllByLabelText(/field type/i) as HTMLSelectElement[];
    expect(types.map((select) => select.value)).toEqual(["text", "number"]);
  });

  it("saves relabelled fields under their original ids, and a new field under a fresh id", async () => {
    renderEdit();
    const labels = (await screen.findAllByLabelText(/field label/i)) as HTMLInputElement[];
    fireEvent.change(labels[0] as HTMLElement, { target: { value: "Name" } });
    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    const withNew = screen.getAllByLabelText(/field label/i) as HTMLInputElement[];
    fireEvent.change(withNew[2] as HTMLElement, { target: { value: "Year" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(1));
    const [id, payload] = vi.mocked(updateCollection).mock.calls[0] as [string, { fields: { id: string }[] }];
    expect(id).toBe(COLLECTION_ID);
    expect(payload.fields).toEqual([
      { id: "title", type: "text", label: "Name", required: true },
      { id: "pages", type: "number", label: "Pages", required: false },
      { id: expect.any(String), type: "text", label: "Year", required: false },
    ]);
    // The added field must not collide with the ids values are already filed under.
    expect(payload.fields[2]?.id).not.toBe("title");
    expect(payload.fields[2]?.id).not.toBe("pages");
  });

  it("drops a removed field from the saved schema", async () => {
    renderEdit();
    await screen.findAllByLabelText(/field label/i);
    const removes = screen.getAllByRole("button", { name: /remove field/i });
    fireEvent.click(removes[1] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(1));
    const [, payload] = vi.mocked(updateCollection).mock.calls[0] as [string, { fields: { id: string }[] }];
    expect(payload.fields.map((f) => f.id)).toEqual(["title"]);
  });

  it("leaves field types editable while the collection is empty", async () => {
    renderEdit();
    const types = (await screen.findAllByLabelText(/field type/i)) as HTMLSelectElement[];
    expect(types.every((select) => select.disabled)).toBe(false);
    expect(screen.queryByText(/cannot change the type/i)).not.toBeInTheDocument();
  });

  it("locks the type of existing fields once the collection holds an item", async () => {
    vi.mocked(listItems).mockResolvedValue([item("i1")]);
    renderEdit();
    await waitFor(() => {
      const types = screen.getAllByLabelText(/field type/i) as HTMLSelectElement[];
      expect(types.map((select) => select.disabled)).toEqual([true, true]);
    });
    expect(screen.getAllByText(/cannot change the type/i).length).toBeGreaterThan(0);
  });

  it("locks types when the collection's only item is in the trash", async () => {
    vi.mocked(listItems).mockResolvedValue([]);
    vi.mocked(listTrash).mockResolvedValue({
      collections: [],
      items: [{ ...item("i1", "2024-02-01T00:00:00.000Z"), collectionName: "Books" }],
    });
    renderEdit();
    await waitFor(() => {
      const types = screen.getAllByLabelText(/field type/i) as HTMLSelectElement[];
      expect(types.map((select) => select.disabled)).toEqual([true, true]);
    });
  });

  it("ignores trashed items belonging to a different collection", async () => {
    vi.mocked(listTrash).mockResolvedValue({
      collections: [],
      items: [
        {
          ...item("i1", "2024-02-01T00:00:00.000Z"),
          collectionId: "00000000-0000-0000-0000-0000000000ff",
          collectionName: "Movies",
        },
      ],
    });
    renderEdit();
    await waitFor(() => {
      const types = screen.getAllByLabelText(/field type/i) as HTMLSelectElement[];
      expect(types.map((select) => select.disabled)).toEqual([false, false]);
    });
  });

  it("leaves a newly added field's type editable even when existing types are locked", async () => {
    vi.mocked(listItems).mockResolvedValue([item("i1")]);
    renderEdit();
    await waitFor(() => {
      const types = screen.getAllByLabelText(/field type/i) as HTMLSelectElement[];
      expect(types[0]?.disabled).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    const types = screen.getAllByLabelText(/field type/i) as HTMLSelectElement[];
    expect(types.map((select) => select.disabled)).toEqual([true, true, false]);
  });

  it("warns that values under a removed field are kept rather than deleted", async () => {
    renderEdit();
    await screen.findAllByLabelText(/field label/i);
    expect(screen.getByText(/values are kept/i)).toBeInTheDocument();
  });

  it("surfaces a failed save without leaving the page", async () => {
    vi.mocked(updateCollection).mockRejectedValue(new Error("nope"));
    const { router } = renderEdit();
    await screen.findAllByLabelText(/field label/i);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
    expect(router.state.location.pathname).toBe(`/collections/${COLLECTION_ID}/edit`);
  });

  it("reports a failed load instead of an empty editor", async () => {
    vi.mocked(getCollection).mockRejectedValue(new Error("offline"));
    renderEdit();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
  });
});
