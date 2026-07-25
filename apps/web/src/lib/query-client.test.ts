import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "./query-client.js";

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("createQueryClient", () => {
  it("still fetches when the browser reports no internet connection", async () => {
    // The API runs on this machine, so `navigator.onLine` — which reports
    // *internet* reachability — must not gate requests. React Query's default
    // networkMode pauses the query here: it never fetches, never errors, and
    // leaves `data` undefined forever (issue #228).
    onlineManager.setOnline(false);
    const client = createQueryClient(() => {});

    const data = await client.fetchQuery({
      queryKey: ["local-api"],
      queryFn: async () => ["Books", "Vinyl"],
    });

    expect(data).toEqual(["Books", "Vinyl"]);
  });

  it("still runs mutations when the browser reports no internet connection", async () => {
    onlineManager.setOnline(false);
    const client = createQueryClient(() => {});

    const result = await client
      .getMutationCache()
      .build(client, { mutationFn: async (name: string) => `created ${name}` })
      .execute("Books");

    expect(result).toBe("created Books");
  });

  it("routes query failures to the shared error handler", async () => {
    const onError = vi.fn();
    const client = createQueryClient(onError);

    await expect(
      client.fetchQuery({
        queryKey: ["boom"],
        queryFn: async () => {
          throw new Error("upstream failed");
        },
        retry: false,
      }),
    ).rejects.toThrow("upstream failed");

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "upstream failed" });
  });

  it("routes mutation failures to the shared error handler", async () => {
    const onError = vi.fn();
    const client = createQueryClient(onError);

    await expect(
      client
        .getMutationCache()
        .build(client, {
          mutationFn: async () => {
            throw new Error("write failed");
          },
          retry: false,
        })
        .execute(undefined),
    ).rejects.toThrow("write failed");

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "write failed" });
  });
});
