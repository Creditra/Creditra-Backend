import { describe, it, expect, vi, afterEach } from "vitest";
import { ExternalApiRiskProvider } from "../ExternalApiRiskProvider.js";

const WALLET = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGZBW3JXDC55CYIXB5NAXMCEKJA";

describe("ExternalApiRiskProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has name "external"', () => {
    const provider = new ExternalApiRiskProvider({
      baseUrl: "https://risk.example.com",
      apiKey: "key",
    });
    expect(provider.name).toBe("external");
  });

  it("throws when constructed without baseUrl", () => {
    expect(
      () => new ExternalApiRiskProvider({ baseUrl: "", apiKey: "key" }),
    ).toThrow("ExternalApiRiskProvider requires baseUrl and apiKey.");
  });

  it("throws when constructed without apiKey", () => {
    expect(
      () =>
        new ExternalApiRiskProvider({
          baseUrl: "https://risk.example.com",
          apiKey: "",
        }),
    ).toThrow("ExternalApiRiskProvider requires baseUrl and apiKey.");
  });

  it("returns score and factors on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          score: 72,
          factors: [{ name: "on_chain_activity", value: 0.72, weight: 1.0 }],
        }),
      }),
    );

    const provider = new ExternalApiRiskProvider({
      baseUrl: "https://risk.example.com",
      apiKey: "secret",
    });

    const result = await provider.evaluate(WALLET);

    expect(result.score).toBe(72);
    expect(result.factors).toHaveLength(1);
  });

  it("clamps score to [0, 100]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ score: 150, factors: [] }),
      }),
    );

    const provider = new ExternalApiRiskProvider({
      baseUrl: "https://risk.example.com",
      apiKey: "secret",
    });

    const result = await provider.evaluate(WALLET);
    expect(result.score).toBe(100);
  });

  it("throws on non-OK HTTP response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    );

    const provider = new ExternalApiRiskProvider({
      baseUrl: "https://risk.example.com",
      apiKey: "secret",
    });

    await expect(provider.evaluate(WALLET)).rejects.toThrow("HTTP 403");
  });

  it("throws when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    const provider = new ExternalApiRiskProvider({
      baseUrl: "https://risk.example.com",
      apiKey: "secret",
    });

    await expect(provider.evaluate(WALLET)).rejects.toThrow("network error");
  });

  it("sends Authorization header with bearer token", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ score: 50, factors: [] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new ExternalApiRiskProvider({
      baseUrl: "https://risk.example.com",
      apiKey: "my-secret-key",
    });

    await provider.evaluate(WALLET);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer my-secret-key",
    );
  });
});
