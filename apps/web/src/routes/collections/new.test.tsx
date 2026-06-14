import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rootRoute } from "../__root.js";
import { collectionsRoute } from "./index.js";
import { newCollectionRoute } from "./new.js";

vi.mock("../../lib/api-client.js", () => ({
  createCollection: vi.fn(),
  listCollections: vi.fn(() => Promise.resolve([])),
  getToken: vi.fn(() => "test-token"),
}));

import { createCollection } from "../../lib/api-client.js";

const testRouteTree = rootRoute.addChildren([newCollectionRoute, collectionsRoute]);

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function renderNew() {
  const qc = makeQueryClient();
  const history = createMemoryHistory({ initialEntries: ["/collections/new"] });
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
  vi.mocked(createCollection).mockResolvedValue({
    id: "00000000-0000-0000-0000-000000000099",
    name: "Books",
    fields: [{ id: "f1", label: "Title", type: "text", required: true }],
    isFiniteSet: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    deletedAt: null,
  });
});

afterEach(cleanup);

describe("NewCollectionPage", () => {
  it("renders the collection name input", async () => {
    renderNew();
    expect(await screen.findByLabelText(/collection name/i)).toBeInTheDocument();
  });

  it("starts with one field row", async () => {
    renderNew();
    expect(await screen.findByLabelText(/field label/i)).toBeInTheDocument();
  });

  it("adds a field row when 'Add field' is clicked", async () => {
    renderNew();
    await screen.findByLabelText(/field label/i);
    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    expect(screen.getAllByLabelText(/field label/i)).toHaveLength(2);
  });

  it("removes a field row when 'Remove' is clicked", async () => {
    renderNew();
    await screen.findByLabelText(/field label/i);
    fireEvent.click(screen.getByRole("button", { name: /add field/i }));
    expect(screen.getAllByLabelText(/field label/i)).toHaveLength(2);
    const [firstRemove] = screen.getAllByRole("button", { name: /remove field/i });
    fireEvent.click(firstRemove as HTMLElement);
    expect(screen.getAllByLabelText(/field label/i)).toHaveLength(1);
  });

  it("submits a valid collection with one field", async () => {
    renderNew();
    fireEvent.change(await screen.findByLabelText(/collection name/i), { target: { value: "Books" } });
    fireEvent.change(screen.getByLabelText(/field label/i), { target: { value: "Title" } });
    fireEvent.click(screen.getByRole("button", { name: /create collection/i }));
    await waitFor(() => expect(createCollection).toHaveBeenCalledTimes(1));
    expect(createCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Books",
        fields: [expect.objectContaining({ id: expect.any(String), label: "Title", type: "text", required: false })],
      }),
      expect.anything(),
    );
  });

  it("includes options for a select field", async () => {
    renderNew();
    fireEvent.change(await screen.findByLabelText(/collection name/i), { target: { value: "Games" } });
    fireEvent.change(screen.getByLabelText(/field label/i), { target: { value: "Platform" } });
    fireEvent.change(screen.getByLabelText(/field type/i), { target: { value: "select" } });
    fireEvent.change(screen.getByLabelText(/options/i), { target: { value: "PC, Switch, PS5" } });
    fireEvent.click(screen.getByRole("button", { name: /create collection/i }));
    await waitFor(() => expect(createCollection).toHaveBeenCalledTimes(1));
    expect(createCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: [expect.objectContaining({ label: "Platform", type: "select", options: ["PC", "Switch", "PS5"] })],
      }),
      expect.anything(),
    );
  });

  it("does not submit when name is empty", async () => {
    renderNew();
    await screen.findByLabelText(/field label/i);
    fireEvent.change(screen.getByLabelText(/field label/i), { target: { value: "Title" } });
    fireEvent.click(screen.getByRole("button", { name: /create collection/i }));
    expect(createCollection).not.toHaveBeenCalled();
  });
});
