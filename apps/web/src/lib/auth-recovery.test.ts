import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../router.js", () => ({ router: { navigate: vi.fn() } }));

import { router } from "../router.js";
import { ApiError, UnauthorizedError } from "./api-client.js";
import { recoverFromAuthError } from "./auth-recovery.js";

beforeEach(() => {
  localStorage.setItem("api_token", "stale-token");
  vi.clearAllMocks();
});

describe("recoverFromAuthError", () => {
  it("clears the stored token and redirects to /setup on a 401", () => {
    recoverFromAuthError(new UnauthorizedError());
    expect(localStorage.getItem("api_token")).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith({ to: "/setup" });
  });

  it("ignores non-401 API errors", () => {
    recoverFromAuthError(new ApiError(500));
    expect(localStorage.getItem("api_token")).toBe("stale-token");
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("ignores arbitrary errors", () => {
    recoverFromAuthError(new Error("network"));
    expect(localStorage.getItem("api_token")).toBe("stale-token");
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
