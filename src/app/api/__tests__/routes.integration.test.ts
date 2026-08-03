import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { PROXY_SLOTS } from "@/lib/proxy";
import { createMockClient, EMPTY_SLOT, encodeInitializeLog, storageWord } from "@/lib/__tests__/mock-rpc";
import type { InspectResponse, PoolsResponse } from "@/lib/api-types";

// The routes construct their own viem client, so the factory is mocked to hand back a
// scripted transport. Everything downstream -- ABI decoding, risk analysis, response
// shaping -- is the real code path.
const mockState: {
  client: ReturnType<typeof createMockClient>["client"] | null;
  throwOnCreate: Error | null;
} = { client: null, throwOnCreate: null };

vi.mock("@/lib/inspect", async () => {
  const actual = await vi.importActual<typeof import("@/lib/inspect")>("@/lib/inspect");
  return {
    ...actual,
    createChainClient: () => {
      if (mockState.throwOnCreate) throw mockState.throwOnCreate;
      if (!mockState.client) throw new Error("mock client not configured");
      return mockState.client;
    },
  };
});

const { GET: inspectGET } = await import("../inspect/route");
const { GET: poolsGET } = await import("../pools/route");

// A live Base hook: beforeSwap + afterSwap + both swap-delta flags (0x00cc).
const SWAP_DELTA_HOOK = "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC";
// afterSwap only (0x0040).
const SIMPLE_HOOK = "0x44A0d07e76d5b3fA1bc2cfE3ac37073c9cf94040";
const IMPL = "0x1234567890abcdef1234567890abcdef12345678";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const BYTECODE = ("0x" + "60806040".repeat(50)) as Hex;

function inspectUrl(params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  return new Request(`http://localhost/api/inspect?${q}`);
}

function poolsUrl(params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  return new Request(`http://localhost/api/pools?${q}`);
}

const originalEnv = { ...process.env };

beforeEach(() => {
  mockState.client = null;
  mockState.throwOnCreate = null;
  // Default to no explorer key, so verification degrades unless a test opts in.
  delete process.env.ETHERSCAN_API_KEY;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("unexpected network call");
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("GET /api/inspect - validation", () => {
  it("rejects a missing address", async () => {
    const res = await inspectGET(inspectUrl({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as InspectResponse;
    expect(body.ok).toBe(false);
    if (!body.ok) expect(body.code).toBe("empty");
  });

  it("rejects a malformed address", async () => {
    const res = await inspectGET(inspectUrl({ address: "0xnope" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) expect(body.code).toBe("bad_characters");
  });

  it("rejects an address of the wrong length", async () => {
    const res = await inspectGET(inspectUrl({ address: `0x${"a".repeat(39)}` }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) expect(body.code).toBe("bad_length");
  });

  it("rejects an unsupported chain rather than silently using the default", async () => {
    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK, chain: "polygon" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) {
      expect(body.code).toBe("unsupported_chain");
      expect(body.error).toContain("polygon");
    }
  });

  it("validates the address before touching the network", async () => {
    // mockState.client is null, so any RPC use would throw.
    const res = await inspectGET(inspectUrl({ address: "not-an-address" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/inspect - decoding", () => {
  beforeEach(() => {
    mockState.client = createMockClient({
      eth_getCode: () => BYTECODE,
      eth_getStorageAt: () => EMPTY_SLOT,
    }).client;
  });

  it("returns the decoded permissions and on-chain state for a real hook", async () => {
    const res = await inspectGET(inspectUrl({ address: SWAP_DELTA_HOOK, chain: "base" }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as InspectResponse;
    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.address).toBe(SWAP_DELTA_HOOK);
    expect(body.chain).toBe("base");
    expect(body.chainId).toBe(8453);
    expect(body.onchain.hasBytecode).toBe(true);
    expect(body.onchain.bytecodeSize).toBe(200);
    expect(body.onchain.proxy.isProxy).toBe(false);
    expect(body.explorerUrl).toBe(`https://basescan.org/address/${SWAP_DELTA_HOOK}`);
  });

  it("flags swap-delta control in the risk report", async () => {
    const res = await inspectGET(inspectUrl({ address: SWAP_DELTA_HOOK, chain: "base" }));
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");

    expect(body.risk.findings.map((f) => f.code)).toContain("swap_delta_control");
    expect(body.risk.highestSeverity).toBe("high");
  });

  it("normalizes a lowercase address to checksummed form", async () => {
    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK.toLowerCase() }));
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");
    expect(body.address).toBe(SIMPLE_HOOK);
  });

  it("defaults to Ethereum when no chain is given", async () => {
    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK }));
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");
    expect(body.chain).toBe("ethereum");
    expect(body.chainId).toBe(1);
  });

  it("reports a clean hook with no findings beyond the verification notice", async () => {
    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK, chain: "base" }));
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");

    expect(body.risk.findings.map((f) => f.code)).toEqual(["verification_unavailable"]);
    expect(body.risk.highestSeverity).toBeNull();
  });
});

describe("GET /api/inspect - on-chain conditions", () => {
  it("raises a critical finding when the address has no bytecode", async () => {
    mockState.client = createMockClient({ eth_getCode: () => "0x" }).client;

    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK, chain: "base" }));
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");

    expect(body.onchain.hasBytecode).toBe(false);
    expect(body.risk.findings.map((f) => f.code)).toContain("no_bytecode");
    expect(body.risk.highestSeverity).toBe("critical");
  });

  it("detects an EIP-1967 proxy and reports the implementation", async () => {
    mockState.client = createMockClient({
      eth_getCode: () => BYTECODE,
      eth_getStorageAt: (_a, slot) =>
        slot.toLowerCase() === PROXY_SLOTS.eip1967Implementation ? storageWord(IMPL) : EMPTY_SLOT,
    }).client;

    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK, chain: "base" }));
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");

    expect(body.onchain.proxy.isProxy).toBe(true);
    expect(body.onchain.proxy.implementation).toBe(IMPL);
    expect(body.risk.findings.map((f) => f.code)).toContain("upgradeable_proxy");
  });

  it("still returns decoded permissions when the RPC is unreachable", async () => {
    // Address decoding needs no network, so an RPC outage must not fail the request.
    mockState.throwOnCreate = new Error("connect ECONNREFUSED");

    const res = await inspectGET(inspectUrl({ address: SWAP_DELTA_HOOK, chain: "base" }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");

    expect(body.onchain.error).toContain("Could not reach");
    // The permission-derived heuristic still fires...
    expect(body.risk.findings.map((f) => f.code)).toContain("swap_delta_control");
    // ...but a failed read must not be reported as "no contract deployed".
    expect(body.risk.findings.map((f) => f.code)).not.toContain("no_bytecode");
  });

  it("degrades gracefully when the RPC rejects the getCode call", async () => {
    mockState.client = createMockClient({
      eth_getCode: () => {
        throw new Error("rate limited");
      },
    }).client;

    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK, chain: "base" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");
    expect(body.onchain.error).toBeDefined();
    expect(body.risk.findings.map((f) => f.code)).not.toContain("no_bytecode");
  });
});

describe("GET /api/inspect - explorer verification", () => {
  beforeEach(() => {
    mockState.client = createMockClient({
      eth_getCode: () => BYTECODE,
      eth_getStorageAt: () => EMPTY_SLOT,
    }).client;
  });

  it("degrades to unknown with no API key and makes no explorer request", async () => {
    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK, chain: "base" }));
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");

    expect(body.verification.status).toBe("unknown");
    expect(body.verification.reason).toContain("ETHERSCAN_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a verified contract when the explorer has source", async () => {
    process.env.ETHERSCAN_API_KEY = "TESTKEY";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: "1",
          result: [{ SourceCode: "contract H {}", ContractName: "MyHook" }],
        }),
      })),
    );

    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK, chain: "base" }));
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");

    expect(body.verification.status).toBe("verified");
    expect(body.verification.contractName).toBe("MyHook");
    expect(body.risk.findings.map((f) => f.code)).not.toContain("unverified_source");
  });

  it("raises a medium finding for an unverified contract", async () => {
    process.env.ETHERSCAN_API_KEY = "TESTKEY";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: "1", result: [{ SourceCode: "" }] }),
      })),
    );

    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK, chain: "base" }));
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");

    expect(body.verification.status).toBe("unverified");
    expect(body.risk.findings.map((f) => f.code)).toContain("unverified_source");
    expect(body.risk.highestSeverity).toBe("medium");
  });

  it("queries the explorer with the selected chain id", async () => {
    process.env.ETHERSCAN_API_KEY = "TESTKEY";
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "1", result: [{ SourceCode: "x" }] }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    await inspectGET(inspectUrl({ address: SIMPLE_HOOK, chain: "arbitrum" }));

    const url = new URL(fetchSpy.mock.calls[0]![0] as unknown as string);
    expect(url.searchParams.get("chainid")).toBe("42161");
    expect(url.searchParams.get("address")).toBe(SIMPLE_HOOK);
  });

  it("does not leak the API key into the response body", async () => {
    process.env.ETHERSCAN_API_KEY = "SUPERSECRET";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: "1", result: [{ SourceCode: "x" }] }),
      })),
    );

    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK, chain: "base" }));
    expect(JSON.stringify(await res.json())).not.toContain("SUPERSECRET");
  });

  it("survives an explorer outage without failing the request", async () => {
    process.env.ETHERSCAN_API_KEY = "TESTKEY";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("explorer down");
      }),
    );

    const res = await inspectGET(inspectUrl({ address: SIMPLE_HOOK, chain: "base" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as InspectResponse;
    if (!body.ok) throw new Error("expected success");
    expect(body.verification.status).toBe("unknown");
  });
});

describe("GET /api/pools", () => {
  const poolA = `0x${"aa".repeat(32)}` as Hex;
  const poolB = `0x${"bb".repeat(32)}` as Hex;

  it("rejects a malformed address", async () => {
    const res = await poolsGET(poolsUrl({ address: "0x123" }));
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported chain", async () => {
    const res = await poolsGET(poolsUrl({ address: SIMPLE_HOOK, chain: "solana" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as PoolsResponse;
    if (!body.ok) expect(body.code).toBe("unsupported_chain");
  });

  it("returns pools that use the hook and omits those that do not", async () => {
    mockState.client = createMockClient({
      eth_blockNumber: () => "0x2710",
      eth_getLogs: () => [
        encodeInitializeLog({
          poolId: poolA,
          currency0: USDC,
          currency1: WETH,
          fee: 3000,
          tickSpacing: 60,
          hooks: SWAP_DELTA_HOOK,
          blockNumber: 9_000n,
        }),
        encodeInitializeLog({
          poolId: poolB,
          currency0: USDC,
          currency1: WETH,
          fee: 500,
          tickSpacing: 10,
          hooks: SIMPLE_HOOK,
          blockNumber: 9_100n,
        }),
      ],
    }).client;

    const res = await poolsGET(poolsUrl({ address: SWAP_DELTA_HOOK, chain: "base" }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as PoolsResponse;
    if (!body.ok) throw new Error("expected success");

    expect(body.pools).toHaveLength(1);
    expect(body.pools[0]!.poolId).toBe(poolA);
    expect(body.pools[0]!.fee).toBe(3000);
    expect(body.pools[0]!.tickSpacing).toBe(60);
    expect(body.poolManager).toBe("0x498581fF718922c3f8e6A244956aF099B2652b2b");
  });

  it("reports the scanned range and chunk counts so the user sees coverage", async () => {
    // A realistic chain height: the default budget covers only a recent slice of it,
    // so the response must say so rather than implying it searched everything.
    mockState.client = createMockClient({
      eth_blockNumber: () => "0x2FAF080", // 50,000,000
      eth_getLogs: () => [],
    }).client;

    const res = await poolsGET(poolsUrl({ address: SIMPLE_HOOK, chain: "base" }));
    const body = (await res.json()) as PoolsResponse;
    if (!body.ok) throw new Error("expected success");

    expect(body.pools).toEqual([]);
    expect(body.scannedTo).toBe("50000000");
    expect(Number(body.scannedFrom)).toBeLessThan(50_000_000);
    expect(body.chunksScanned).toBeGreaterThan(0);
    expect(body.truncated).toBe(true);
  });

  it("reports a complete scan as not truncated on a short chain", async () => {
    mockState.client = createMockClient({
      eth_blockNumber: () => "0x186a0", // 100,000 -- within the default budget
      eth_getLogs: () => [],
    }).client;

    const res = await poolsGET(poolsUrl({ address: SIMPLE_HOOK, chain: "base" }));
    const body = (await res.json()) as PoolsResponse;
    if (!body.ok) throw new Error("expected success");

    expect(body.scannedFrom).toBe("0");
    expect(body.truncated).toBe(false);
  });

  it("honours the scan-size env overrides", async () => {
    process.env.POOL_SCAN_CHUNK_SIZE = "100";
    process.env.POOL_SCAN_MAX_CHUNKS = "2";

    const ranges: Array<[string, string]> = [];
    mockState.client = createMockClient({
      eth_blockNumber: () => "0x2710", // 10000
      eth_getLogs: (p) => {
        ranges.push([p.fromBlock as string, p.toBlock as string]);
        return [];
      },
    }).client;

    const res = await poolsGET(poolsUrl({ address: SIMPLE_HOOK, chain: "base" }));
    const body = (await res.json()) as PoolsResponse;
    if (!body.ok) throw new Error("expected success");

    expect(ranges).toHaveLength(2);
    expect(BigInt(ranges[0]![1]!) - BigInt(ranges[0]![0]!) + 1n).toBe(100n);
    expect(body.scannedFrom).toBe("9801");
  });

  it("ignores an unparseable env override rather than scanning nothing", async () => {
    process.env.POOL_SCAN_MAX_CHUNKS = "not-a-number";
    mockState.client = createMockClient({
      eth_blockNumber: () => "0x2710",
      eth_getLogs: () => [],
    }).client;

    const res = await poolsGET(poolsUrl({ address: SIMPLE_HOOK, chain: "base" }));
    const body = (await res.json()) as PoolsResponse;
    if (!body.ok) throw new Error("expected success");
    expect(body.chunksScanned).toBeGreaterThan(0);
  });

  it("returns 502 when the RPC is unreachable", async () => {
    mockState.throwOnCreate = new Error("ECONNREFUSED");
    const res = await poolsGET(poolsUrl({ address: SIMPLE_HOOK, chain: "base" }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as PoolsResponse;
    if (!body.ok) expect(body.code).toBe("rpc_error");
  });

  it("returns a partial result when some chunks fail", async () => {
    let n = 0;
    mockState.client = createMockClient({
      eth_blockNumber: () => "0x2710",
      eth_getLogs: () => {
        n += 1;
        if (n === 1) throw new Error("range too wide");
        return [
          encodeInitializeLog({
            poolId: poolA,
            currency0: USDC,
            currency1: WETH,
            fee: 100,
            tickSpacing: 1,
            hooks: SIMPLE_HOOK,
            blockNumber: 5_000n,
          }),
        ];
      },
    }).client;

    const res = await poolsGET(poolsUrl({ address: SIMPLE_HOOK, chain: "base" }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as PoolsResponse;
    if (!body.ok) throw new Error("expected success");
    expect(body.chunksFailed).toBe(1);
    expect(body.pools).toHaveLength(1);
  });

  it("serialises block numbers as strings so bigints survive JSON", async () => {
    mockState.client = createMockClient({
      eth_blockNumber: () => "0x2710",
      eth_getLogs: () => [
        encodeInitializeLog({
          poolId: poolA,
          currency0: USDC,
          currency1: WETH,
          fee: 3000,
          tickSpacing: 60,
          hooks: SIMPLE_HOOK,
          blockNumber: 9_000n,
        }),
      ],
    }).client;

    const res = await poolsGET(poolsUrl({ address: SIMPLE_HOOK, chain: "base" }));
    const body = (await res.json()) as PoolsResponse;
    if (!body.ok) throw new Error("expected success");
    expect(typeof body.pools[0]!.blockNumber).toBe("string");
    expect(body.pools[0]!.blockNumber).toBe("9000");
  });
});
