import type { Collection } from "@mycollections/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { authenticatedRoute } from "../_authenticated.js";
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
  targetCount: null,
  itemView: "list",
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

/**
 * Where a successful save navigates. A stand-in rather than the real detail
 * screen, which would need every item query mocked: without any route here the
 * navigation hit TanStack Router's not-found warning whenever it finished before
 * the test's cleanup — which it did only under the load of a full run.
 */
const detailStubRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/collections/$id",
  component: () => <p>Collection detail</p>,
});

const testRouteTree = rootRoute.addChildren([
  authenticatedRoute.addChildren([editCollectionRoute, collectionsRoute]),
  detailStubRoute,
]);

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

  // The lock is `aria-disabled`, never `disabled` (#368): a disabled control is
  // skipped by Tab, and this one carries the only explanation of why the type
  // cannot change — so `disabled` hid the rule from exactly the user who cannot
  // see the greyed-out select. `locked` reads the mark the app now sets.
  const locked = (select: HTMLSelectElement) => select.getAttribute("aria-disabled") === "true";

  it("leaves field types editable while the collection is empty", async () => {
    renderEdit();
    const types = (await screen.findAllByLabelText(/field type/i)) as HTMLSelectElement[];
    expect(types.some(locked)).toBe(false);
    expect(screen.queryByText(/cannot change the type/i)).not.toBeInTheDocument();
  });

  it("locks the type of existing fields once the collection holds an item", async () => {
    vi.mocked(listItems).mockResolvedValue([item("i1")]);
    renderEdit();
    await waitFor(() => {
      const types = screen.getAllByLabelText(/field type/i) as HTMLSelectElement[];
      expect(types.map(locked)).toEqual([true, true]);
    });
    expect(screen.getAllByText(/cannot change the type/i).length).toBeGreaterThan(0);
    // Reachable with its explanation: the hint is only any use to a keyboard
    // user if the control pointing at it is still a tab stop.
    const [first] = screen.getAllByLabelText(/field type/i) as HTMLSelectElement[];
    expect(first).toBeEnabled();
    expect(first).toHaveAccessibleDescription(/cannot change the type/i);
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
      expect(types.map(locked)).toEqual([true, true]);
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
      expect(types.map(locked)).toEqual([false, false]);
    });
  });

  it("leaves a newly added field's type editable even when existing types are locked", async () => {
    vi.mocked(listItems).mockResolvedValue([item("i1")]);
    renderEdit();
    await waitFor(() => {
      const [first] = screen.getAllByLabelText(/field type/i) as HTMLSelectElement[];
      expect(first && locked(first)).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    const types = screen.getAllByLabelText(/field type/i) as HTMLSelectElement[];
    expect(types.map(locked)).toEqual([true, true, false]);
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

  /**
   * Asserted on the words, not on the role (#347). This screen is editing *one*
   * collection, and it took the `collections` namespace's plural strings — "Could
   * not load collections. Your collections are safe." — for as long as the
   * assertion here was `toBeInTheDocument()`.
   */
  it("reports a failed load in the singular, instead of an empty editor", async () => {
    vi.mocked(getCollection).mockRejectedValue(new Error("offline"));
    renderEdit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load this collection");
    expect(alert).toHaveTextContent("Your data is safe.");
    // The dashboard's copy, which is what this screen used to show. Named so the
    // failure says which string arrived rather than only that one did not.
    expect(alert, "the editor must not borrow the dashboard's plural copy").not.toHaveTextContent(
      "Could not load collections",
    );
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
  });

  // Found driving #42: `required` accepts a name of spaces, and the handler then
  // refused it without a word — Save changes did nothing at all.
  it("refuses a name of only spaces at the name box, saying why", async () => {
    renderEdit();
    const nameBox = (await screen.findByLabelText(/collection name/i)) as HTMLInputElement;
    fireEvent.change(nameBox, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(nameBox).toBeInvalid();
    expect(nameBox.validationMessage).toBe("Enter a name for the collection.");
    expect(updateCollection).not.toHaveBeenCalled();

    fireEvent.change(nameBox, { target: { value: "Books" } });
    expect(nameBox).toBeValid();
  });

  it("caps the name and description at the server's limits", async () => {
    renderEdit();
    expect(await screen.findByLabelText(/collection name/i)).toHaveAttribute("maxlength", "120");
    expect(screen.getByLabelText(/description/i)).toHaveAttribute("maxlength", "2000");
  });

  it("refuses a field label emptied to only spaces, saying why", async () => {
    renderEdit();
    const [title] = (await screen.findAllByLabelText(/field label/i)) as [HTMLInputElement];
    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(title).toBeInvalid();
    expect(title.validationMessage).toBe("Enter a label for this field.");
    expect(updateCollection).not.toHaveBeenCalled();
  });

  it("says why at Add field when every field has been removed, instead of doing nothing", async () => {
    renderEdit();
    await screen.findAllByLabelText(/field label/i);
    for (const remove of screen.getAllByRole("button", { name: /remove field/i })) fireEvent.click(remove);
    expect(screen.queryAllByLabelText(/field label/i)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    const addField = screen.getByRole("button", { name: /add field/i });
    expect(screen.getByRole("alert")).toHaveTextContent("A collection needs at least one field. Add one to continue.");
    expect(addField).toHaveFocus();
    expect(updateCollection).not.toHaveBeenCalled();
  });

  it("refuses a choice field whose options are cleared, saying why", async () => {
    vi.mocked(getCollection).mockResolvedValue({
      ...collection,
      fields: [
        { id: "title", type: "text", label: "Title", required: true },
        { id: "format", type: "multiselect", label: "Format", required: false, options: ["Hardback", "Paperback"] },
      ],
    });
    renderEdit();
    const options = (await screen.findByLabelText(/options/i)) as HTMLInputElement;
    expect(options).toHaveValue("Hardback, Paperback");
    expect(options).toBeRequired();
    fireEvent.change(options, { target: { value: " , " } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(options).toBeInvalid();
    expect(options.validationMessage).toBe("Add at least one option, separated by commas.");
    expect(updateCollection).not.toHaveBeenCalled();
  });

  it("shows only the no-fields alert after an earlier save failed", async () => {
    vi.mocked(updateCollection).mockRejectedValueOnce(new Error("API error 500"));
    renderEdit();
    await screen.findAllByLabelText(/field label/i);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the collection.");

    for (const remove of screen.getAllByRole("button", { name: /remove field/i })) fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
        "A collection needs at least one field. Add one to continue.",
      ]),
    );
    expect(updateCollection).toHaveBeenCalledTimes(1);
  });

  describe("a finite set's target count (#42)", () => {
    const FINITE = "Finite set (a fixed, known number of items)";
    const TARGET = "Number of items in the set";
    const finiteWithTarget: Collection = { ...collection, isFiniteSet: true, targetCount: 151 };
    const STORED_FIELDS = [
      { id: "title", type: "text", label: "Title", required: true },
      { id: "pages", type: "number", label: "Pages", required: false },
    ];

    /** What goes over the wire: the patch as `JSON.stringify` sends it. */
    function sentBody(): unknown {
      const [, input] = vi.mocked(updateCollection).mock.calls[0] as [string, unknown];
      return JSON.parse(JSON.stringify(input));
    }

    async function save() {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
      await waitFor(() => expect(updateCollection).toHaveBeenCalledTimes(1));
    }

    it("fills the target box with the stored target", async () => {
      vi.mocked(getCollection).mockResolvedValue(finiteWithTarget);
      renderEdit();
      expect(await screen.findByRole("spinbutton", { name: TARGET })).toHaveValue(151);
      expect(screen.getByRole("checkbox", { name: FINITE })).toBeChecked();
    });

    it("saves the stored target back unchanged, then returns to the collection", async () => {
      vi.mocked(getCollection).mockResolvedValue(finiteWithTarget);
      const { router } = renderEdit();
      await screen.findByRole("spinbutton", { name: TARGET });
      await save();
      expect(sentBody()).toEqual({
        name: "Books",
        description: "Shelf",
        fields: STORED_FIELDS,
        isFiniteSet: true,
        targetCount: 151,
      });
      expect(await screen.findByText("Collection detail")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(`/collections/${COLLECTION_ID}`);
    });

    it("saves a changed target", async () => {
      vi.mocked(getCollection).mockResolvedValue(finiteWithTarget);
      renderEdit();
      fireEvent.change(await screen.findByRole("spinbutton", { name: TARGET }), { target: { value: "165" } });
      await save();
      expect(sentBody()).toMatchObject({ isFiniteSet: true, targetCount: 165 });
    });

    it("clears the stored target when the box is emptied", async () => {
      vi.mocked(getCollection).mockResolvedValue(finiteWithTarget);
      renderEdit();
      fireEvent.change(await screen.findByRole("spinbutton", { name: TARGET }), { target: { value: "" } });
      await save();
      expect(sentBody()).toMatchObject({ isFiniteSet: true, targetCount: null });
    });

    it("clears the stored target when the collection stops being a finite set", async () => {
      vi.mocked(getCollection).mockResolvedValue(finiteWithTarget);
      renderEdit();
      await screen.findByRole("spinbutton", { name: TARGET });
      fireEvent.click(screen.getByRole("checkbox", { name: FINITE }));
      expect(screen.queryByRole("spinbutton", { name: TARGET })).not.toBeInTheDocument();
      await save();
      expect(sentBody()).toEqual({
        name: "Books",
        description: "Shelf",
        fields: STORED_FIELDS,
        isFiniteSet: false,
        targetCount: null,
      });
    });

    it("keeps a drafted target when finite is unchecked and checked again before saving", async () => {
      vi.mocked(getCollection).mockResolvedValue(finiteWithTarget);
      renderEdit();
      fireEvent.change(await screen.findByRole("spinbutton", { name: TARGET }), { target: { value: "165" } });
      fireEvent.click(screen.getByRole("checkbox", { name: FINITE }));
      fireEvent.click(screen.getByRole("checkbox", { name: FINITE }));
      expect(screen.getByRole("spinbutton", { name: TARGET })).toHaveValue(165);
      await save();
      expect(sentBody()).toMatchObject({ isFiniteSet: true, targetCount: 165 });
    });

    it("sends a null target for a collection that stays not a finite set", async () => {
      renderEdit();
      await screen.findAllByLabelText(/field label/i);
      expect(screen.queryByRole("spinbutton", { name: TARGET })).not.toBeInTheDocument();
      await save();
      expect(sentBody()).toEqual({
        name: "Books",
        description: "Shelf",
        fields: STORED_FIELDS,
        isFiniteSet: false,
        targetCount: null,
      });
    });

    it("makes a collection a finite set with a target, starting from an empty box", async () => {
      renderEdit();
      await screen.findAllByLabelText(/field label/i);
      fireEvent.click(screen.getByRole("checkbox", { name: FINITE }));
      const target = screen.getByRole("spinbutton", { name: TARGET });
      expect(target).toHaveValue(null);
      fireEvent.change(target, { target: { value: "102" } });
      await save();
      expect(sentBody()).toMatchObject({ isFiniteSet: true, targetCount: 102 });
    });

    it("does not save a target out of range", async () => {
      vi.mocked(getCollection).mockResolvedValue(finiteWithTarget);
      renderEdit();
      const target = await screen.findByRole("spinbutton", { name: TARGET });
      fireEvent.change(target, { target: { value: "100001" } });
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
      expect(target).toBeInvalid();
      expect(updateCollection).not.toHaveBeenCalled();
    });
  });
});
