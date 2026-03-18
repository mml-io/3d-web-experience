import { jest } from "@jest/globals";

import { fetchWebhookAuth } from "../src/webhookAuth";

describe("fetchWebhookAuth", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(response: {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }): jest.Mock<typeof global.fetch> {
    const mock = jest.fn<typeof global.fetch>().mockResolvedValue(response as Response);
    global.fetch = mock;
    return mock;
  }

  it("calls correct URL with Authorization header", async () => {
    const mock = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: "alice" }),
    });

    await fetchWebhookAuth("https://example.com/auth", "my-token");

    expect(mock).toHaveBeenCalledTimes(1);
    const calledUrl = mock.mock.calls[0][0] as URL;
    expect(calledUrl.origin).toBe("https://example.com");
    expect(calledUrl.pathname).toBe("/auth");
    expect(calledUrl.searchParams.get("token")).toBeNull();
    const calledOpts = mock.mock.calls[0][1] as RequestInit;
    expect((calledOpts.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-token");
  });

  it("returns username and characterDescription from valid response", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        username: "alice",
        characterDescription: { meshFileUrl: "https://example.com/avatar.glb" },
      }),
    });

    const result = await fetchWebhookAuth("https://example.com/auth", "tok");
    expect(result.username).toBe("alice");
    expect(result.characterDescription).toEqual({
      meshFileUrl: "https://example.com/avatar.glb",
    });
  });

  it("returns mmlAuthToken when provided", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        username: "alice",
        mmlAuthToken: "secret-jwt",
      }),
    });

    const result = await fetchWebhookAuth("https://example.com/auth", "tok");
    expect(result.mmlAuthToken).toBe("secret-jwt");
  });

  it("returns userId when provided", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        username: "alice",
        userId: "custom-user-id-123",
      }),
    });

    const result = await fetchWebhookAuth("https://example.com/auth", "tok");
    expect(result.userId).toBe("custom-user-id-123");
  });

  it("returns undefined userId when not provided", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: "alice" }),
    });

    const result = await fetchWebhookAuth("https://example.com/auth", "tok");
    expect(result.userId).toBeUndefined();
  });

  it("returns undefined characterDescription when not in response", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: "alice" }),
    });

    const result = await fetchWebhookAuth("https://example.com/auth", "tok");
    expect(result.characterDescription).toBeUndefined();
  });

  it("throws on non-200 response", async () => {
    mockFetch({
      ok: false,
      status: 403,
      json: async () => ({}),
    });

    await expect(fetchWebhookAuth("https://example.com/auth", "tok")).rejects.toThrow(
      "Webhook returned 403",
    );
  });

  it("includes error message from webhook error response body", async () => {
    mockFetch({
      ok: false,
      status: 403,
      json: async () => ({ message: "Token expired" }),
    });

    await expect(fetchWebhookAuth("https://example.com/auth", "tok")).rejects.toThrow(
      "Token expired",
    );
  });

  it("throws on non-JSON response", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    });

    await expect(fetchWebhookAuth("https://example.com/auth", "tok")).rejects.toThrow(
      "Invalid JSON response from auth webhook",
    );
  });

  it("throws when username is missing", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ characterDescription: {} }),
    });

    await expect(fetchWebhookAuth("https://example.com/auth", "tok")).rejects.toThrow(
      "must include a non-empty 'username' string",
    );
  });

  it("throws when username is empty string", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: "" }),
    });

    await expect(fetchWebhookAuth("https://example.com/auth", "tok")).rejects.toThrow(
      "must include a non-empty 'username' string",
    );
  });

  it("throws when username exceeds MAX_USERNAME_LENGTH (256 chars)", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: "A".repeat(257) }),
    });

    await expect(fetchWebhookAuth("https://example.com/auth", "tok")).rejects.toThrow(
      "exceeds maximum length",
    );
  });

  it("throws when response is a JSON array instead of an object", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => [{ username: "alice" }],
    });

    // Arrays pass the `typeof === "object"` guard but lack a top-level
    // `username` property, so the validation rejects them at the username check.
    await expect(fetchWebhookAuth("https://example.com/auth", "tok")).rejects.toThrow(
      "must include a non-empty 'username' string",
    );
  });

  it("passes an AbortSignal timeout to fetch", async () => {
    const mock = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ username: "test", userId: "u1" }),
    });

    await fetchWebhookAuth("https://example.com/auth", "token123");

    expect(mock).toHaveBeenCalledTimes(1);
    const callArgs = mock.mock.calls[0];
    expect(callArgs[1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on network failure", async () => {
    global.fetch = jest
      .fn<typeof global.fetch>()
      .mockRejectedValue(new Error("DNS resolution failed"));

    await expect(fetchWebhookAuth("https://example.com/auth", "tok")).rejects.toThrow(
      "Webhook request failed: DNS resolution failed",
    );
  });
});
