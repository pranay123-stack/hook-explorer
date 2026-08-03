import { parseAbiItem, type Address, type Log, type PublicClient } from "viem";
import { addressesEqual } from "./address";
import { DYNAMIC_FEE_FLAG } from "./flags";

/**
 * The v4 PoolManager `Initialize` event.
 * Source: `@uniswap/v4-core@1.0.2` -> `src/interfaces/IPoolManager.sol`
 *
 * Note which parameters are indexed: only `id`, `currency0` and `currency1`. The
 * `hooks` address sits in the *data* payload, NOT in a topic, so it is impossible to
 * filter by hook at the RPC layer. Every scan therefore fetches all Initialize logs in
 * a block range and filters client-side -- which is why pool discovery is inherently
 * range-limited and reported as best-effort.
 */
export const INITIALIZE_EVENT = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);

export interface PoolRecord {
  /** keccak256 of the abi-encoded PoolKey. */
  readonly poolId: string;
  readonly currency0: Address;
  readonly currency1: Address;
  /** LP fee in hundredths of a bip. 0x800000 signals a dynamic-fee pool. */
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: Address;
  readonly blockNumber: string;
  readonly transactionHash: string;
  /** True when `fee` is exactly DYNAMIC_FEE_FLAG. */
  readonly dynamicFee: boolean;
}

export interface ScanRange {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
}

export interface ScanPlan {
  readonly ranges: readonly ScanRange[];
  /** Lowest block the plan will reach. */
  readonly floor: bigint;
  /** Highest block the plan will reach. */
  readonly ceiling: bigint;
  /**
   * True when the plan stops short of block 0 because the request budget ran out --
   * i.e. older pools may exist that this scan will not see.
   */
  readonly truncated: boolean;
}

export interface ScanOptions {
  /** Blocks per `eth_getLogs` request. Public RPCs commonly cap this around 10k. */
  readonly chunkSize?: bigint;
  /** Maximum number of `eth_getLogs` requests, bounding latency and rate-limit burn. */
  readonly maxChunks?: number;
  /** Stop once this many distinct pools have been found. */
  readonly maxResults?: number;
  /** Lowest block to consider, e.g. the PoolManager deployment block. */
  readonly minBlock?: bigint;
}

export const DEFAULT_CHUNK_SIZE = 9_000n;
export const DEFAULT_MAX_CHUNKS = 12;
export const DEFAULT_MAX_RESULTS = 100;

/**
 * Plans a backwards scan from `latestBlock`, newest blocks first.
 *
 * Scanning backwards means the most recently created pools -- the ones a user is most
 * likely asking about -- show up first, and a truncated scan still returns something
 * useful rather than the oldest pools on the chain.
 */
export function planScan(latestBlock: bigint, options: ScanOptions = {}): ScanPlan {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const minBlock = options.minBlock ?? 0n;

  if (latestBlock < minBlock || chunkSize <= 0n || maxChunks <= 0) {
    return { ranges: [], floor: latestBlock, ceiling: latestBlock, truncated: false };
  }

  const ranges: ScanRange[] = [];
  let toBlock = latestBlock;

  for (let i = 0; i < maxChunks; i++) {
    const candidate = toBlock - chunkSize + 1n;
    const fromBlock = candidate > minBlock ? candidate : minBlock;
    ranges.push({ fromBlock, toBlock });
    if (fromBlock <= minBlock) break;
    toBlock = fromBlock - 1n;
  }

  const floor = ranges.length > 0 ? ranges[ranges.length - 1]!.fromBlock : latestBlock;

  return {
    ranges,
    floor,
    ceiling: latestBlock,
    truncated: floor > minBlock,
  };
}

/** The decoded shape viem produces for an Initialize log. */
type InitializeLog = Log<bigint, number, false, typeof INITIALIZE_EVENT, true>;

/**
 * Converts a decoded Initialize log into a PoolRecord.
 * Returns undefined if the log is missing fields (e.g. a pending log).
 */
export function toPoolRecord(log: InitializeLog): PoolRecord | undefined {
  const { args } = log;
  if (
    args.id === undefined ||
    args.currency0 === undefined ||
    args.currency1 === undefined ||
    args.fee === undefined ||
    args.tickSpacing === undefined ||
    args.hooks === undefined
  ) {
    return undefined;
  }
  if (log.blockNumber === null || log.transactionHash === null) return undefined;

  return {
    poolId: args.id,
    currency0: args.currency0,
    currency1: args.currency1,
    fee: Number(args.fee),
    tickSpacing: Number(args.tickSpacing),
    hooks: args.hooks,
    blockNumber: log.blockNumber.toString(),
    transactionHash: log.transactionHash,
    dynamicFee: Number(args.fee) === DYNAMIC_FEE_FLAG,
  };
}

/**
 * Filters decoded Initialize logs down to those using a given hook, newest first,
 * de-duplicated by pool id.
 */
export function filterPoolsByHook(
  logs: readonly InitializeLog[],
  hook: string,
): readonly PoolRecord[] {
  const byId = new Map<string, PoolRecord>();
  for (const log of logs) {
    const record = toPoolRecord(log);
    if (!record) continue;
    if (!addressesEqual(record.hooks, hook)) continue;
    if (!byId.has(record.poolId)) byId.set(record.poolId, record);
  }
  return [...byId.values()].sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));
}

export interface PoolScanResult {
  readonly pools: readonly PoolRecord[];
  /** Block range actually covered, as `[from, to]` strings. */
  readonly scannedFrom: string;
  readonly scannedTo: string;
  /** Number of eth_getLogs requests that succeeded. */
  readonly chunksScanned: number;
  /** Number that failed (range too wide, rate limited). Reported, not thrown. */
  readonly chunksFailed: number;
  /** True when older blocks were not reached, so the result may be incomplete. */
  readonly truncated: boolean;
  /** True when the scan stopped early because maxResults was reached. */
  readonly hitResultLimit: boolean;
}

/**
 * Scans a PoolManager's Initialize events for pools using a given hook.
 *
 * Best-effort by construction. Individual chunk failures (public RPCs rejecting a
 * range, or rate-limiting) are counted and skipped rather than aborting the scan, so a
 * partial answer is still returned. The covered range is always reported so the caller
 * can tell the user exactly what was and was not searched.
 */
export async function scanPoolsForHook(
  client: PublicClient,
  poolManager: Address,
  hook: string,
  options: ScanOptions = {},
): Promise<PoolScanResult> {
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const latest = await client.getBlockNumber();
  const plan = planScan(latest, options);

  const collected: InitializeLog[] = [];
  let chunksScanned = 0;
  let chunksFailed = 0;
  let lowestReached = plan.ceiling;
  let hitResultLimit = false;

  for (const range of plan.ranges) {
    try {
      const logs = (await client.getLogs({
        address: poolManager,
        event: INITIALIZE_EVENT,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
      })) as InitializeLog[];
      collected.push(...logs);
      chunksScanned += 1;
    } catch {
      // A chunk can fail because the node caps the range or is rate-limiting. Keep
      // going: a partial result with an honest range beats no result at all.
      chunksFailed += 1;
    }
    lowestReached = range.fromBlock;

    if (filterPoolsByHook(collected, hook).length >= maxResults) {
      hitResultLimit = true;
      break;
    }
  }

  const pools = filterPoolsByHook(collected, hook).slice(0, maxResults);

  return {
    pools,
    scannedFrom: lowestReached.toString(),
    scannedTo: plan.ceiling.toString(),
    chunksScanned,
    chunksFailed,
    truncated: plan.truncated || hitResultLimit || lowestReached > (options.minBlock ?? 0n),
    hitResultLimit,
  };
}

/** Formats an LP fee for display: 3000 -> "0.30%", 0x800000 -> "dynamic". */
export function formatFee(fee: number): string {
  if (fee === DYNAMIC_FEE_FLAG) return "dynamic";
  return `${(fee / 10_000).toFixed(2)}%`;
}
