import { describe, expect, it } from "vitest";
import type { AuthorizationRequest } from "./authorization-flow.js";
import { FakeAuthorizationFlow } from "./authorization-flow.js";

const request: AuthorizationRequest = {
  authorizationEndpoint: "https://idp.example/authorize",
  clientId: "client-1",
  redirectUri: "http://127.0.0.1:0/callback",
  scopes: ["openid", "email"],
  codeChallenge: "challenge-1",
  state: "state-1",
  nonce: "nonce-1",
};

describe("FakeAuthorizationFlow", () => {
  it("echoes back the request state with a canned code", async () => {
    const flow = new FakeAuthorizationFlow({ code: "auth-code-1" });
    const response = await flow.authorize(request);
    expect(response).toEqual({
      code: "auth-code-1",
      state: "state-1",
      redirectUri: "http://127.0.0.1:0/callback",
    });
  });

  it("records the requests it received", async () => {
    const flow = new FakeAuthorizationFlow({ code: "auth-code-1" });
    await flow.authorize(request);
    expect(flow.requests).toHaveLength(1);
    expect(flow.requests[0]?.codeChallenge).toBe("challenge-1");
  });

  it("can simulate a CSRF-style state mismatch", async () => {
    const flow = new FakeAuthorizationFlow({ code: "auth-code-1", returnedState: "attacker-state" });
    const response = await flow.authorize(request);
    expect(response.state).toBe("attacker-state");
  });

  it("can simulate the user cancelling the flow", async () => {
    const flow = new FakeAuthorizationFlow({ error: new Error("user cancelled") });
    await expect(flow.authorize(request)).rejects.toThrow("user cancelled");
  });
});
