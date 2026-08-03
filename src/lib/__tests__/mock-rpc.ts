import { createPublicClient, custom, encodeAbiParameters, toEventSelector, type Hex } from "viem";
import type { PublicClient } from "viem";
import { INITIALIZE_EVENT } from "../pools";

/**
 * A scripted JSON-RPC transport.
 *
 * Integration tests run the real viem client -- real request encoding, real ABI
 * decoding -- against canned node responses, so the code under test is exercised end to
 * end without a network. Only the wire is faked.
 */
export interface MockRpcHandlers {
  eth_getCode?: (address: string) => Hex;
  eth_getStorageAt?: (address: string, slot: string) => Hex;
  eth_blockNumber?: () => Hex;
  eth_getLogs?: (params: {
    address?: string;
    topics?: unknown[];
    fromBlock?: string;
    toBlock?: string;
  }) => unknown[];
  eth_chainId?: () => Hex;
}

export interface MockRpc {
  client: PublicClient;
  /** Every request the client made, in order. */
  calls: Array<{ method: string; params: unknown[] }>;
}

export function createMockClient(handlers: MockRpcHandlers): MockRpc {
  const calls: Array<{ method: string; params: unknown[] }> = [];

  // No `chain` is configured on purpose. A chain with custom formatters (Base is an
  // OP-stack chain) specialises the client type so it no longer matches the plain
  // `PublicClient` the production code accepts. None of the methods under test need
  // chain-specific formatting, so the generic client is both simpler and more faithful.
  const client = createPublicClient({
    transport: custom(
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async request({ method, params }: { method: string; params: any }) {
          calls.push({ method, params: (params ?? []) as unknown[] });

          switch (method) {
            case "eth_chainId":
              return handlers.eth_chainId?.() ?? "0x2105"; // 8453
            case "eth_getCode": {
              if (!handlers.eth_getCode) throw new Error("eth_getCode not scripted");
              return handlers.eth_getCode(params[0]);
            }
            case "eth_getStorageAt": {
              if (!handlers.eth_getStorageAt) throw new Error("eth_getStorageAt not scripted");
              return handlers.eth_getStorageAt(params[0], params[1]);
            }
            case "eth_blockNumber": {
              if (!handlers.eth_blockNumber) throw new Error("eth_blockNumber not scripted");
              return handlers.eth_blockNumber();
            }
            case "eth_getLogs": {
              if (!handlers.eth_getLogs) throw new Error("eth_getLogs not scripted");
              return handlers.eth_getLogs(params[0] ?? {});
            }
            default:
              throw new Error(`Unexpected RPC method: ${method}`);
          }
        },
      },
      // viem retries failed requests with backoff by default. Tests script exact
      // failures and count them, so retries must be off for the counts to mean
      // anything -- and so a deliberately-failing request does not stall the suite.
      { retryCount: 0 },
    ),
    // Disable viem's request de-duplication/batching so `calls` reflects reality.
    batch: { multicall: false },
  });

  return { client, calls };
}

/** Left-pads an address into a 32-byte word, the way a node returns storage. */
export function storageWord(address: string): Hex {
  return `0x${address.replace(/^0x/, "").toLowerCase().padStart(64, "0")}` as Hex;
}

export const EMPTY_SLOT: Hex = `0x${"0".repeat(64)}`;

export const INITIALIZE_TOPIC0 = toEventSelector(INITIALIZE_EVENT);

/** Left-pads an address into an indexed-topic word. */
function addressTopic(address: string): Hex {
  return `0x${address.replace(/^0x/, "").toLowerCase().padStart(64, "0")}` as Hex;
}

export interface RawInitializeLog {
  poolId: Hex;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  blockNumber: bigint;
  transactionHash?: Hex;
  logIndex?: number;
}

/**
 * Encodes an Initialize event exactly as a node would return it, with `hooks` in the
 * data payload rather than a topic -- which is the whole reason hook filtering has to
 * happen client-side.
 */
export function encodeInitializeLog(input: RawInitializeLog) {
  const data = encodeAbiParameters(
    [
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
    ],
    [input.fee, input.tickSpacing, input.hooks as `0x${string}`, 79228162514264337593543950336n, 0],
  );

  return {
    address: "0x498581ff718922c3f8e6a244956af099b2652b2b",
    topics: [
      INITIALIZE_TOPIC0,
      input.poolId,
      addressTopic(input.currency0),
      addressTopic(input.currency1),
    ],
    data,
    blockNumber: `0x${input.blockNumber.toString(16)}`,
    blockHash: `0x${"cd".repeat(32)}`,
    transactionHash: input.transactionHash ?? `0x${"ab".repeat(32)}`,
    transactionIndex: "0x0",
    logIndex: `0x${(input.logIndex ?? 0).toString(16)}`,
    removed: false,
  };
}
