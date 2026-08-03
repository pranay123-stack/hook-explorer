import { describe, expect, it, vi } from "vitest";
import {
  buildSourceCodeUrl,
  fetchVerification,
  getExplorerApiKey,
  parseSourceCodeResponse,
} from "../explorer";

const ADDRESS = "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC";

/** Builds a fetch stub returning a JSON body. */
function jsonFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("getExplorerApiKey", () => {
  it("reads the key from the environment", () => {
    expect(getExplorerApiKey({ ETHERSCAN_API_KEY: "abc123" })).toBe("abc123");
  });

  it("trims surrounding whitespace", () => {
    expect(getExplorerApiKey({ ETHERSCAN_API_KEY: "  abc123 \n" })).toBe("abc123");
  });

  it("returns undefined when unset or blank", () => {
    expect(getExplorerApiKey({})).toBeUndefined();
    expect(getExplorerApiKey({ ETHERSCAN_API_KEY: "" })).toBeUndefined();
    expect(getExplorerApiKey({ ETHERSCAN_API_KEY: "   " })).toBeUndefined();
  });
});

describe("buildSourceCodeUrl", () => {
  it("targets the Etherscan V2 endpoint with a chainid parameter", () => {
    const url = new URL(buildSourceCodeUrl(8453, ADDRESS, "KEY"));
    expect(url.origin + url.pathname).toBe("https://api.etherscan.io/v2/api");
    expect(url.searchParams.get("chainid")).toBe("8453");
    expect(url.searchParams.get("module")).toBe("contract");
    expect(url.searchParams.get("action")).toBe("getsourcecode");
    expect(url.searchParams.get("address")).toBe(ADDRESS);
    expect(url.searchParams.get("apikey")).toBe("KEY");
  });

  it("uses one host for every supported chain", () => {
    // V2 is what lets a single ETHERSCAN_API_KEY cover Etherscan/Basescan/Arbiscan/Uniscan.
    for (const chainId of [1, 8453, 130, 42161]) {
      const url = new URL(buildSourceCodeUrl(chainId, ADDRESS, "KEY"));
      expect(url.host).toBe("api.etherscan.io");
      expect(url.searchParams.get("chainid")).toBe(String(chainId));
    }
  });

  it("url-encodes the key", () => {
    const url = buildSourceCodeUrl(1, ADDRESS, "a b&c");
    expect(url).toContain("apikey=a+b%26c");
  });
});

describe("parseSourceCodeResponse", () => {
  it("reports a verified contract with its metadata", () => {
    const result = parseSourceCodeResponse({
      status: "1",
      message: "OK",
      result: [
        {
          SourceCode: "contract Counter {}",
          ContractName: "CounterHook",
          CompilerVersion: "v0.8.26+commit.8a97fa7a",
          Proxy: "0",
          Implementation: "",
        },
      ],
    });

    expect(result.status).toBe("verified");
    expect(result.contractName).toBe("CounterHook");
    expect(result.compilerVersion).toBe("v0.8.26+commit.8a97fa7a");
    expect(result.isProxy).toBe(false);
    expect(result.implementation).toBeUndefined();
  });

  it("reports unverified when SourceCode is empty despite a success status", () => {
    // The explorer returns status "1" for unverified contracts, so the empty
    // SourceCode field -- not the status code -- is what distinguishes them.
    const result = parseSourceCodeResponse({
      status: "1",
      message: "OK",
      result: [{ SourceCode: "", ABI: "Contract source code not verified", ContractName: "" }],
    });
    expect(result.status).toBe("unverified");
  });

  it("treats whitespace-only source as unverified", () => {
    const result = parseSourceCodeResponse({ status: "1", result: [{ SourceCode: "   \n " }] });
    expect(result.status).toBe("unverified");
  });

  it("surfaces an explorer-known proxy implementation", () => {
    const result = parseSourceCodeResponse({
      status: "1",
      result: [
        {
          SourceCode: "contract Proxy {}",
          ContractName: "ERC1967Proxy",
          Proxy: "1",
          Implementation: "0x1234567890abcdef1234567890abcdef12345678",
        },
      ],
    });
    expect(result.status).toBe("verified");
    expect(result.isProxy).toBe(true);
    expect(result.implementation).toBe("0x1234567890abcdef1234567890abcdef12345678");
  });

  it("degrades to unknown on a rate-limit response", () => {
    const result = parseSourceCodeResponse({
      status: "0",
      message: "NOTOK",
      result: "Max rate limit reached",
    });
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("Max rate limit reached");
  });

  it("degrades to unknown on an invalid API key", () => {
    const result = parseSourceCodeResponse({
      status: "0",
      message: "NOTOK",
      result: "Invalid API Key",
    });
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("Invalid API Key");
  });

  it("degrades to unknown for an empty result array", () => {
    expect(parseSourceCodeResponse({ status: "1", result: [] }).status).toBe("unknown");
  });

  it("degrades to unknown for malformed bodies", () => {
    for (const body of [null, undefined, "a string", 42, {}, { status: "1" }]) {
      const result = parseSourceCodeResponse(body);
      expect(result.status, JSON.stringify(body)).toBe("unknown");
      expect(result.reason!.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the message field when result carries no text", () => {
    const result = parseSourceCodeResponse({ status: "0", message: "NOTOK", result: "" });
    expect(result.reason).toContain("NOTOK");
  });
});

describe("fetchVerification", () => {
  it("returns unknown with a clear reason when no API key is configured", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchVerification(1, ADDRESS, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("ETHERSCAN_API_KEY");
    // Graceful degradation means not making the request at all.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns verified for a verified contract", async () => {
    const fetchImpl = jsonFetch({
      status: "1",
      result: [{ SourceCode: "contract A {}", ContractName: "A" }],
    });

    const result = await fetchVerification(8453, ADDRESS, { apiKey: "KEY", fetchImpl });
    expect(result.status).toBe("verified");
    expect(result.contractName).toBe("A");
  });

  it("requests the chain it was asked about", async () => {
    const fetchImpl = jsonFetch({ status: "1", result: [{ SourceCode: "x" }] });
    await fetchVerification(42161, ADDRESS, { apiKey: "KEY", fetchImpl });

    const url = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0]!;
    expect(new URL(url).searchParams.get("chainid")).toBe("42161");
  });

  it("degrades to unknown on a non-OK HTTP status", async () => {
    const fetchImpl = jsonFetch({}, { ok: false, status: 503 });
    const result = await fetchVerification(1, ADDRESS, { apiKey: "KEY", fetchImpl });
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("503");
  });

  it("degrades to unknown on a network error rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const result = await fetchVerification(1, ADDRESS, { apiKey: "KEY", fetchImpl });
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("ECONNREFUSED");
  });

  it("degrades to unknown when the body is not valid JSON", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    })) as unknown as typeof fetch;

    const result = await fetchVerification(1, ADDRESS, { apiKey: "KEY", fetchImpl });
    expect(result.status).toBe("unknown");
  });

  it("reports a timeout distinctly", async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;

    const result = await fetchVerification(1, ADDRESS, {
      apiKey: "KEY",
      fetchImpl,
      timeoutMs: 10,
    });
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("timed out");
  });

  it("passes an abort signal so a slow explorer cannot hang the request", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      return { ok: true, status: 200, json: async () => ({ status: "1", result: [{}] }) };
    }) as unknown as typeof fetch;

    await fetchVerification(1, ADDRESS, { apiKey: "KEY", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("never throws, whatever the explorer does", async () => {
    const failures = [
      () => {
        throw new Error("boom");
      },
      async () => ({ ok: false, status: 500, json: async () => ({}) }),
      async () => ({ ok: true, status: 200, json: async () => null }),
    ];

    for (const impl of failures) {
      const result = await fetchVerification(1, ADDRESS, {
        apiKey: "KEY",
        fetchImpl: impl as unknown as typeof fetch,
      });
      expect(result.status).toBe("unknown");
    }
  });
});
