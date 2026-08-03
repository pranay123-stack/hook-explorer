import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { inspectContract, readProxySlots } from "../inspect";
import { PROXY_SLOTS } from "../proxy";
import { scanPoolsForHook } from "../pools";
import { createMockClient, EMPTY_SLOT, encodeInitializeLog, storageWord } from "./mock-rpc";

const HOOK = "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC" as Address;
const OTHER_HOOK = "0x44A0d07e76d5b3fA1bc2cfE3ac37073c9cf94040" as Address;
const IMPL = "0x1234567890abcdef1234567890abcdef12345678";
const POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b" as Address;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";

const REAL_BYTECODE = ("0x" + "60806040523480156100105760".repeat(20)) as Hex;

describe("inspectContract (integration, mocked RPC)", () => {
  it("reports a plain deployed contract with no proxy indicators", async () => {
    const { client, calls } = createMockClient({
      eth_getCode: () => REAL_BYTECODE,
      eth_getStorageAt: () => EMPTY_SLOT,
    });

    const result = await inspectContract(client, HOOK);

    expect(result.hasBytecode).toBe(true);
    expect(result.bytecodeSize).toBe((REAL_BYTECODE.length - 2) / 2);
    expect(result.proxy.isProxy).toBe(false);
    expect(result.proxy.slots).toEqual({});

    expect(calls.filter((c) => c.method === "eth_getCode")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "eth_getStorageAt")).toHaveLength(4);
  });

  it("detects an EIP-1967 proxy from the implementation slot", async () => {
    const { client } = createMockClient({
      eth_getCode: () => REAL_BYTECODE,
      eth_getStorageAt: (_address, slot) =>
        slot.toLowerCase() === PROXY_SLOTS.eip1967Implementation ? storageWord(IMPL) : EMPTY_SLOT,
    });

    const result = await inspectContract(client, HOOK);

    expect(result.proxy.isProxy).toBe(true);
    expect(result.proxy.slots.eip1967Implementation).toBe(IMPL);
    expect(result.proxy.implementation).toBe(IMPL);
  });

  it("detects an EIP-1967 admin alongside the implementation", async () => {
    const admin = "0x00000000000000000000000000000000000000aa";
    const { client } = createMockClient({
      eth_getCode: () => REAL_BYTECODE,
      eth_getStorageAt: (_address, slot) => {
        const s = slot.toLowerCase();
        if (s === PROXY_SLOTS.eip1967Implementation) return storageWord(IMPL);
        if (s === PROXY_SLOTS.eip1967Admin) return storageWord(admin);
        return EMPTY_SLOT;
      },
    });

    const result = await inspectContract(client, HOOK);
    expect(result.proxy.slots.eip1967Implementation).toBe(IMPL);
    expect(result.proxy.slots.eip1967Admin).toBe(admin);
  });

  it("detects an EIP-1167 minimal proxy from bytecode alone", async () => {
    const minimal = `0x363d3d373d3d3d363d73${IMPL.slice(2)}5af43d82803e903d91602b57fd5bf3` as Hex;
    const { client } = createMockClient({
      eth_getCode: () => minimal,
      eth_getStorageAt: () => EMPTY_SLOT,
    });

    const result = await inspectContract(client, HOOK);
    expect(result.bytecodeSize).toBe(45);
    expect(result.proxy.minimalProxyTarget).toBe(IMPL);
    expect(result.proxy.isProxy).toBe(true);
  });

  it("reports an address with no code and skips the storage reads", async () => {
    const { client, calls } = createMockClient({
      eth_getCode: () => "0x",
      eth_getStorageAt: () => EMPTY_SLOT,
    });

    const result = await inspectContract(client, HOOK);

    expect(result.hasBytecode).toBe(false);
    expect(result.bytecodeSize).toBe(0);
    expect(result.proxy.isProxy).toBe(false);
    // No point probing proxy slots on an address with no contract.
    expect(calls.filter((c) => c.method === "eth_getStorageAt")).toHaveLength(0);
  });

  it("queries exactly the address it was given", async () => {
    const { client, calls } = createMockClient({
      eth_getCode: () => REAL_BYTECODE,
      eth_getStorageAt: () => EMPTY_SLOT,
    });

    await inspectContract(client, HOOK);

    const getCode = calls.find((c) => c.method === "eth_getCode")!;
    expect((getCode.params[0] as string).toLowerCase()).toBe(HOOK.toLowerCase());
  });

  it("propagates an RPC failure on eth_getCode rather than reporting a false empty", async () => {
    // Silently treating an RPC error as "no bytecode" would raise a bogus critical risk.
    const { client } = createMockClient({
      eth_getCode: () => {
        throw new Error("rate limited");
      },
    });

    await expect(inspectContract(client, HOOK)).rejects.toThrow();
  });
});

describe("readProxySlots (integration, mocked RPC)", () => {
  it("reads all four standard slots", async () => {
    const seen: string[] = [];
    const { client } = createMockClient({
      eth_getStorageAt: (_address, slot) => {
        seen.push(slot.toLowerCase());
        return EMPTY_SLOT;
      },
    });

    await readProxySlots(client, HOOK);

    expect(seen.sort()).toEqual(
      [
        PROXY_SLOTS.eip1967Implementation,
        PROXY_SLOTS.eip1967Admin,
        PROXY_SLOTS.eip1967Beacon,
        PROXY_SLOTS.eip1822Proxiable,
      ].sort(),
    );
  });

  it("degrades a failing slot read to null instead of throwing", async () => {
    const { client } = createMockClient({
      eth_getStorageAt: (_address, slot) => {
        if (slot.toLowerCase() === PROXY_SLOTS.eip1967Admin) {
          throw new Error("method not supported");
        }
        return storageWord(IMPL);
      },
    });

    const slots = await readProxySlots(client, HOOK);
    expect(slots.eip1967Admin).toBeNull();
    expect(slots.eip1967Implementation).toBe(storageWord(IMPL));
  });

  it("survives a node that rejects eth_getStorageAt entirely", async () => {
    const { client } = createMockClient({
      eth_getStorageAt: () => {
        throw new Error("unsupported");
      },
    });

    const slots = await readProxySlots(client, HOOK);
    expect(Object.values(slots).every((v) => v === null)).toBe(true);
  });
});

describe("scanPoolsForHook (integration, mocked RPC)", () => {
  const poolA = `0x${"aa".repeat(32)}` as Hex;
  const poolB = `0x${"bb".repeat(32)}` as Hex;
  const poolC = `0x${"cc".repeat(32)}` as Hex;

  it("finds pools that use the hook and ignores the rest", async () => {
    const { client } = createMockClient({
      eth_blockNumber: () => "0x2710", // 10000
      eth_getLogs: () => [
        encodeInitializeLog({
          poolId: poolA,
          currency0: USDC,
          currency1: WETH,
          fee: 3000,
          tickSpacing: 60,
          hooks: HOOK,
          blockNumber: 9_990n,
        }),
        encodeInitializeLog({
          poolId: poolB,
          currency0: USDC,
          currency1: WETH,
          fee: 500,
          tickSpacing: 10,
          hooks: OTHER_HOOK,
          blockNumber: 9_991n,
        }),
      ],
    });

    const result = await scanPoolsForHook(client, POOL_MANAGER, HOOK, {
      chunkSize: 10_000n,
      maxChunks: 1,
    });

    expect(result.pools).toHaveLength(1);
    expect(result.pools[0]).toMatchObject({
      poolId: poolA,
      fee: 3000,
      tickSpacing: 60,
      dynamicFee: false,
      blockNumber: "9990",
    });
    // Confirms the ABI decode pulled `hooks` out of the data payload correctly.
    expect(result.pools[0]!.hooks.toLowerCase()).toBe(HOOK.toLowerCase());
    expect(result.pools[0]!.currency0.toLowerCase()).toBe(USDC.toLowerCase());
    expect(result.pools[0]!.currency1.toLowerCase()).toBe(WETH.toLowerCase());
  });

  it("filters by topic0 and PoolManager address, but never by hook", async () => {
    let seen: Record<string, unknown> = {};
    const { client } = createMockClient({
      eth_blockNumber: () => "0x2710",
      eth_getLogs: (params) => {
        seen = params as Record<string, unknown>;
        return [];
      },
    });

    await scanPoolsForHook(client, POOL_MANAGER, HOOK, { chunkSize: 10_000n, maxChunks: 1 });

    expect((seen.address as string).toLowerCase()).toBe(POOL_MANAGER.toLowerCase());
    const topics = seen.topics as string[];
    // Only topic0. Adding the hook as a topic would silently return nothing, since
    // `hooks` is not an indexed parameter.
    expect(topics).toHaveLength(1);
    expect(JSON.stringify(topics)).not.toContain(HOOK.slice(2).toLowerCase());
  });

  it("walks multiple chunks backwards and reports the covered range", async () => {
    const ranges: Array<[string, string]> = [];
    const { client } = createMockClient({
      eth_blockNumber: () => "0x186a0", // 100000
      eth_getLogs: (params) => {
        ranges.push([params.fromBlock as string, params.toBlock as string]);
        return [];
      },
    });

    const result = await scanPoolsForHook(client, POOL_MANAGER, HOOK, {
      chunkSize: 1_000n,
      maxChunks: 3,
    });

    expect(ranges).toHaveLength(3);
    expect(BigInt(ranges[0]![1]!)).toBe(100_000n);
    expect(BigInt(ranges[2]![0]!)).toBe(97_001n);
    expect(result.scannedTo).toBe("100000");
    expect(result.scannedFrom).toBe("97001");
    expect(result.chunksScanned).toBe(3);
    expect(result.chunksFailed).toBe(0);
    expect(result.truncated).toBe(true);
  });

  it("keeps scanning when a chunk fails and counts the failure", async () => {
    let n = 0;
    const { client } = createMockClient({
      eth_blockNumber: () => "0x2710",
      eth_getLogs: () => {
        n += 1;
        // Public RPCs reject an over-wide range like this rather than truncating it.
        if (n === 2) throw new Error("query returned more than 10000 results");
        return n === 3
          ? [
              encodeInitializeLog({
                poolId: poolC,
                currency0: USDC,
                currency1: WETH,
                fee: 100,
                tickSpacing: 1,
                hooks: HOOK,
                blockNumber: 8_500n,
              }),
            ]
          : [];
      },
    });

    const result = await scanPoolsForHook(client, POOL_MANAGER, HOOK, {
      chunkSize: 1_000n,
      maxChunks: 3,
    });

    expect(result.chunksFailed).toBe(1);
    expect(result.chunksScanned).toBe(2);
    // The surviving chunks still produced a usable answer.
    expect(result.pools.map((p) => p.poolId)).toEqual([poolC]);
  });

  it("returns an honest empty result when the hook has no pools", async () => {
    const { client } = createMockClient({
      eth_blockNumber: () => "0x2710",
      eth_getLogs: () => [],
    });

    const result = await scanPoolsForHook(client, POOL_MANAGER, HOOK, {
      chunkSize: 5_000n,
      maxChunks: 2,
    });

    expect(result.pools).toEqual([]);
    expect(result.chunksScanned).toBe(2);
    expect(result.chunksFailed).toBe(0);
  });

  it("decodes a dynamic-fee pool", async () => {
    const { client } = createMockClient({
      eth_blockNumber: () => "0x2710",
      eth_getLogs: () => [
        encodeInitializeLog({
          poolId: poolA,
          currency0: USDC,
          currency1: WETH,
          fee: 0x800000,
          tickSpacing: 200,
          hooks: HOOK,
          blockNumber: 9_000n,
        }),
      ],
    });

    const result = await scanPoolsForHook(client, POOL_MANAGER, HOOK, {
      chunkSize: 10_000n,
      maxChunks: 1,
    });

    expect(result.pools[0]!.fee).toBe(0x800000);
    expect(result.pools[0]!.dynamicFee).toBe(true);
  });

  it("stops early once maxResults distinct pools are found", async () => {
    let chunk = 0;
    const { client } = createMockClient({
      eth_blockNumber: () => "0x186a0",
      eth_getLogs: () => {
        chunk += 1;
        return [
          encodeInitializeLog({
            poolId: `0x${chunk.toString(16).padStart(64, "0")}` as Hex,
            currency0: USDC,
            currency1: WETH,
            fee: 3000,
            tickSpacing: 60,
            hooks: HOOK,
            blockNumber: BigInt(100_000 - chunk),
          }),
        ];
      },
    });

    const result = await scanPoolsForHook(client, POOL_MANAGER, HOOK, {
      chunkSize: 1_000n,
      maxChunks: 10,
      maxResults: 2,
    });

    expect(result.pools).toHaveLength(2);
    expect(result.hitResultLimit).toBe(true);
    expect(result.truncated).toBe(true);
    expect(chunk).toBe(2); // stopped instead of burning the remaining 8 requests
  });

  it("de-duplicates a pool seen in two chunks", async () => {
    const { client } = createMockClient({
      eth_blockNumber: () => "0x2710",
      eth_getLogs: () => [
        encodeInitializeLog({
          poolId: poolA,
          currency0: USDC,
          currency1: WETH,
          fee: 3000,
          tickSpacing: 60,
          hooks: HOOK,
          blockNumber: 9_000n,
        }),
      ],
    });

    const result = await scanPoolsForHook(client, POOL_MANAGER, HOOK, {
      chunkSize: 1_000n,
      maxChunks: 3,
    });

    expect(result.pools).toHaveLength(1);
  });

  it("reports a non-truncated scan when it reaches the minimum block", async () => {
    const { client } = createMockClient({
      eth_blockNumber: () => "0x3e8", // 1000
      eth_getLogs: () => [],
    });

    const result = await scanPoolsForHook(client, POOL_MANAGER, HOOK, {
      chunkSize: 5_000n,
      maxChunks: 5,
    });

    expect(result.scannedFrom).toBe("0");
    expect(result.truncated).toBe(false);
  });
});
