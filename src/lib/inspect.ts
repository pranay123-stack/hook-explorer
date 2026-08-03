import { createPublicClient, http, type Address, type Hex, type PublicClient } from "viem";
import type { ChainConfig } from "./chains";
import { resolveRpcUrl } from "./chains";
import {
  analyzeProxy,
  bytecodeSize,
  PROXY_SLOTS,
  PROXY_SLOT_NAMES,
  type ProxyIndicators,
  type ProxySlotName,
} from "./proxy";

/** Builds a viem client for a chain, honouring the RPC env override. */
export function createChainClient(
  chain: ChainConfig,
  env: Record<string, string | undefined> = process.env,
): PublicClient {
  return createPublicClient({
    chain: chain.chain,
    transport: http(resolveRpcUrl(chain, env), { retryCount: 1, timeout: 12_000 }),
  });
}

export interface ContractInspection {
  readonly hasBytecode: boolean;
  readonly bytecodeSize: number;
  readonly proxy: ProxyIndicators;
}

/**
 * Reads the on-chain facts about a candidate hook: whether it holds code, how much,
 * and whether it looks like a proxy.
 *
 * Takes an injected client rather than building one, so tests can drive it with a
 * mock transport and no network.
 */
export async function inspectContract(
  client: PublicClient,
  address: Address,
): Promise<ContractInspection> {
  const bytecode = await client.getCode({ address });
  const size = bytecodeSize(bytecode);

  // An address with no code cannot be a proxy, so skip four storage reads.
  if (size === 0) {
    return {
      hasBytecode: false,
      bytecodeSize: 0,
      proxy: analyzeProxy({}, bytecode),
    };
  }

  const slotWords = await readProxySlots(client, address);
  return {
    hasBytecode: true,
    bytecodeSize: size,
    proxy: analyzeProxy(slotWords, bytecode),
  };
}

/**
 * Reads the four standard proxy storage slots.
 *
 * A node that rejects `eth_getStorageAt` yields a null slot rather than an error --
 * failing to read a slot should degrade proxy detection, not break the whole page.
 */
export async function readProxySlots(
  client: PublicClient,
  address: Address,
): Promise<Partial<Record<ProxySlotName, Hex | null>>> {
  const entries = await Promise.all(
    PROXY_SLOT_NAMES.map(async (name) => {
      try {
        const value = await client.getStorageAt({ address, slot: PROXY_SLOTS[name] });
        return [name, value ?? null] as const;
      } catch {
        return [name, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Partial<Record<ProxySlotName, Hex | null>>;
}
