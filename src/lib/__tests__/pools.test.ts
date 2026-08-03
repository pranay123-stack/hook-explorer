import { describe, expect, it } from "vitest";
import { toEventSelector } from "viem";
import {
  DEFAULT_CHUNK_SIZE,
  filterPoolsByHook,
  formatFee,
  INITIALIZE_EVENT,
  planScan,
  toPoolRecord,
} from "../pools";
import { DYNAMIC_FEE_FLAG } from "../flags";

const HOOK = "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC";
const OTHER_HOOK = "0x44A0d07e76d5b3fA1bc2cfE3ac37073c9cf94040";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";

/** Builds a decoded Initialize log of the shape viem produces. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function log(overrides: Record<string, unknown> = {}): any {
  const {
    poolId = "0x" + "11".repeat(32),
    hooks = HOOK,
    fee = 3000,
    tickSpacing = 60,
    blockNumber = 100n,
    currency0 = USDC,
    currency1 = WETH,
    transactionHash = "0x" + "ab".repeat(32),
  } = overrides as Record<string, never>;

  return {
    blockNumber,
    transactionHash,
    args: { id: poolId, currency0, currency1, fee, tickSpacing, hooks, sqrtPriceX96: 1n, tick: 0 },
  };
}

describe("INITIALIZE_EVENT", () => {
  // The parsed ABI is a discriminated union of literal types, so widen it before
  // inspecting `indexed`, which only some members declare.
  const inputs = INITIALIZE_EVENT.inputs as readonly {
    name?: string;
    type: string;
    indexed?: boolean;
  }[];

  it("indexes only id, currency0 and currency1", () => {
    // This is why hook filtering has to happen client-side: `hooks` is not a topic.
    const indexed = inputs.filter((i) => i.indexed).map((i) => i.name);
    expect(indexed).toEqual(["id", "currency0", "currency1"]);

    const nonIndexed = inputs.filter((i) => !i.indexed).map((i) => i.name);
    expect(nonIndexed).toEqual(["fee", "tickSpacing", "hooks", "sqrtPriceX96", "tick"]);
  });

  it("declares the parameter types from IPoolManager.sol", () => {
    expect(inputs.map((i) => i.type)).toEqual([
      "bytes32", // PoolId
      "address", // Currency
      "address", // Currency
      "uint24",
      "int24",
      "address", // IHooks
      "uint160",
      "int24",
    ]);
  });

  it("has a stable topic0", () => {
    const selector = toEventSelector(
      "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)",
    );
    expect(toEventSelector(INITIALIZE_EVENT)).toBe(selector);
    expect(selector).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("planScan", () => {
  it("walks backwards from the latest block in fixed chunks", () => {
    const plan = planScan(100_000n, { chunkSize: 1_000n, maxChunks: 3 });
    expect(plan.ranges).toEqual([
      { fromBlock: 99_001n, toBlock: 100_000n },
      { fromBlock: 98_001n, toBlock: 99_000n },
      { fromBlock: 97_001n, toBlock: 98_000n },
    ]);
    expect(plan.ceiling).toBe(100_000n);
    expect(plan.floor).toBe(97_001n);
  });

  it("produces contiguous, non-overlapping ranges", () => {
    const plan = planScan(50_000n, { chunkSize: 700n, maxChunks: 10 });
    for (let i = 1; i < plan.ranges.length; i++) {
      expect(plan.ranges[i]!.toBlock).toBe(plan.ranges[i - 1]!.fromBlock - 1n);
    }
    for (const r of plan.ranges) {
      expect(r.toBlock - r.fromBlock + 1n).toBeLessThanOrEqual(700n);
      expect(r.fromBlock).toBeLessThanOrEqual(r.toBlock);
    }
  });

  it("marks the plan truncated when the budget runs out before block 0", () => {
    const plan = planScan(1_000_000n, { chunkSize: 1_000n, maxChunks: 2 });
    expect(plan.truncated).toBe(true);
    expect(plan.floor).toBe(998_001n);
  });

  it("is not truncated when the scan reaches the floor", () => {
    const plan = planScan(500n, { chunkSize: 1_000n, maxChunks: 5 });
    expect(plan.ranges).toEqual([{ fromBlock: 0n, toBlock: 500n }]);
    expect(plan.truncated).toBe(false);
    expect(plan.floor).toBe(0n);
  });

  it("stops at minBlock instead of descending past it", () => {
    const plan = planScan(10_000n, { chunkSize: 1_000n, maxChunks: 100, minBlock: 9_500n });
    expect(plan.ranges).toEqual([{ fromBlock: 9_500n, toBlock: 10_000n }]);
    expect(plan.truncated).toBe(false);
    expect(plan.floor).toBe(9_500n);
  });

  it("clamps the final chunk to minBlock rather than overshooting", () => {
    const plan = planScan(10_000n, { chunkSize: 4_000n, maxChunks: 10, minBlock: 3_000n });
    expect(plan.ranges.at(-1)!.fromBlock).toBe(3_000n);
    expect(plan.ranges.every((r) => r.fromBlock >= 3_000n)).toBe(true);
  });

  it("never emits more than maxChunks ranges", () => {
    for (const maxChunks of [1, 5, 12, 40]) {
      const plan = planScan(10_000_000n, { chunkSize: 100n, maxChunks });
      expect(plan.ranges.length).toBe(maxChunks);
    }
  });

  it("returns an empty plan for degenerate inputs", () => {
    expect(planScan(100n, { maxChunks: 0 }).ranges).toEqual([]);
    expect(planScan(100n, { chunkSize: 0n }).ranges).toEqual([]);
    expect(planScan(100n, { minBlock: 200n }).ranges).toEqual([]);
  });

  it("handles a single-block chain", () => {
    const plan = planScan(0n, { chunkSize: 1_000n, maxChunks: 5 });
    expect(plan.ranges).toEqual([{ fromBlock: 0n, toBlock: 0n }]);
    expect(plan.truncated).toBe(false);
  });

  it("defaults to a chunk size public RPCs generally accept", () => {
    expect(DEFAULT_CHUNK_SIZE).toBeLessThanOrEqual(10_000n);
    const plan = planScan(1_000_000n);
    expect(plan.ranges[0]!.toBlock - plan.ranges[0]!.fromBlock + 1n).toBe(DEFAULT_CHUNK_SIZE);
  });

  it("covers exactly chunkSize blocks per full range", () => {
    const plan = planScan(9_999n, { chunkSize: 1_000n, maxChunks: 3 });
    for (const r of plan.ranges) {
      expect(r.toBlock - r.fromBlock + 1n).toBe(1_000n);
    }
  });
});

describe("toPoolRecord", () => {
  it("maps a decoded log into a pool record", () => {
    const record = toPoolRecord(log())!;
    expect(record).toMatchObject({
      currency0: USDC,
      currency1: WETH,
      fee: 3000,
      tickSpacing: 60,
      hooks: HOOK,
      dynamicFee: false,
    });
    expect(record.blockNumber).toBe("100");
  });

  it("serialises bigint block numbers as strings for JSON transport", () => {
    const record = toPoolRecord(log({ blockNumber: 21_000_000n }))!;
    expect(record.blockNumber).toBe("21000000");
    expect(typeof record.blockNumber).toBe("string");
  });

  it("marks a dynamic-fee pool", () => {
    expect(toPoolRecord(log({ fee: DYNAMIC_FEE_FLAG }))!.dynamicFee).toBe(true);
    expect(toPoolRecord(log({ fee: 0 }))!.dynamicFee).toBe(false);
  });

  it("handles a zero-fee pool", () => {
    const record = toPoolRecord(log({ fee: 0 }))!;
    expect(record.fee).toBe(0);
    expect(record.dynamicFee).toBe(false);
  });

  it("returns undefined for a pending log with no block number", () => {
    expect(toPoolRecord(log({ blockNumber: null }))).toBeUndefined();
    expect(toPoolRecord(log({ transactionHash: null }))).toBeUndefined();
  });

  it("returns undefined when required args are missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partial: any = { blockNumber: 1n, transactionHash: "0xab", args: { id: "0x00" } };
    expect(toPoolRecord(partial)).toBeUndefined();
  });
});

describe("filterPoolsByHook", () => {
  it("keeps only pools using the given hook", () => {
    const logs = [
      log({ poolId: "0xaa", hooks: HOOK }),
      log({ poolId: "0xbb", hooks: OTHER_HOOK }),
      log({ poolId: "0xcc", hooks: HOOK }),
    ];
    const pools = filterPoolsByHook(logs, HOOK);
    expect(pools.map((p) => p.poolId)).toEqual(["0xaa", "0xcc"]);
  });

  it("matches case-insensitively", () => {
    const pools = filterPoolsByHook([log({ hooks: HOOK.toLowerCase() })], HOOK.toUpperCase());
    expect(pools).toHaveLength(1);
  });

  it("returns an empty array when no pool uses the hook", () => {
    expect(filterPoolsByHook([log({ hooks: OTHER_HOOK })], HOOK)).toEqual([]);
    expect(filterPoolsByHook([], HOOK)).toEqual([]);
  });

  it("de-duplicates by pool id", () => {
    // The same pool can appear twice if chunk ranges overlap or a chunk is retried.
    const logs = [log({ poolId: "0xaa" }), log({ poolId: "0xaa" }), log({ poolId: "0xbb" })];
    expect(filterPoolsByHook(logs, HOOK)).toHaveLength(2);
  });

  it("sorts newest block first", () => {
    const logs = [
      log({ poolId: "0xaa", blockNumber: 10n }),
      log({ poolId: "0xbb", blockNumber: 30n }),
      log({ poolId: "0xcc", blockNumber: 20n }),
    ];
    expect(filterPoolsByHook(logs, HOOK).map((p) => p.blockNumber)).toEqual(["30", "20", "10"]);
  });

  it("sorts correctly across block numbers beyond Number.MAX_SAFE_INTEGER", () => {
    const big = 2n ** 60n;
    const logs = [
      log({ poolId: "0xaa", blockNumber: big }),
      log({ poolId: "0xbb", blockNumber: big + 5n }),
    ];
    expect(filterPoolsByHook(logs, HOOK).map((p) => p.poolId)).toEqual(["0xbb", "0xaa"]);
  });

  it("skips malformed logs without discarding the rest", () => {
    const logs = [log({ poolId: "0xaa" }), log({ poolId: "0xbb", blockNumber: null })];
    expect(filterPoolsByHook(logs, HOOK).map((p) => p.poolId)).toEqual(["0xaa"]);
  });

  it("does not match the zero address against a real hook", () => {
    const zero = "0x0000000000000000000000000000000000000000";
    expect(filterPoolsByHook([log({ hooks: zero })], HOOK)).toEqual([]);
  });
});

describe("formatFee", () => {
  it("renders standard fee tiers as percentages", () => {
    expect(formatFee(100)).toBe("0.01%");
    expect(formatFee(500)).toBe("0.05%");
    expect(formatFee(3000)).toBe("0.30%");
    expect(formatFee(10_000)).toBe("1.00%");
    expect(formatFee(0)).toBe("0.00%");
  });

  it("renders the dynamic-fee sentinel as 'dynamic' rather than a huge percentage", () => {
    expect(formatFee(DYNAMIC_FEE_FLAG)).toBe("dynamic");
    expect(formatFee(0x800000)).toBe("dynamic");
  });

  it("renders the maximum LP fee", () => {
    expect(formatFee(1_000_000)).toBe("100.00%");
  });
});
