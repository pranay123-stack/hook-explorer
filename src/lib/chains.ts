import { arbitrum, base, mainnet, unichain } from "viem/chains";
import type { Address, Chain } from "viem";

/** URL-safe chain identifiers used in the shareable query string. */
export const CHAIN_SLUGS = ["ethereum", "base", "unichain", "arbitrum"] as const;
export type ChainSlug = (typeof CHAIN_SLUGS)[number];

export const DEFAULT_CHAIN: ChainSlug = "ethereum";

export interface ChainConfig {
  readonly slug: ChainSlug;
  readonly chainId: number;
  readonly label: string;
  readonly chain: Chain;
  /**
   * Uniswap v4 PoolManager. Source: https://docs.uniswap.org/contracts/v4/deployments
   * Each address was confirmed to hold bytecode on its chain.
   */
  readonly poolManager: Address;
  /** Human-facing block explorer, used for outbound links. */
  readonly explorerName: string;
  readonly explorerUrl: string;
  /** Env var that overrides the RPC endpoint for this chain. */
  readonly rpcEnvVar: string;
  /** Public fallback used when the env var is unset. */
  readonly defaultRpcUrl: string;
}

export const CHAINS: Record<ChainSlug, ChainConfig> = {
  ethereum: {
    slug: "ethereum",
    chainId: 1,
    label: "Ethereum",
    chain: mainnet,
    poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90",
    explorerName: "Etherscan",
    explorerUrl: "https://etherscan.io",
    rpcEnvVar: "RPC_URL_ETHEREUM",
    // Chosen over eth.llamarpc.com, which was unreachable during development.
    defaultRpcUrl: "https://ethereum-rpc.publicnode.com",
  },
  base: {
    slug: "base",
    chainId: 8453,
    label: "Base",
    chain: base,
    poolManager: "0x498581fF718922c3f8e6A244956aF099B2652b2b",
    explorerName: "Basescan",
    explorerUrl: "https://basescan.org",
    rpcEnvVar: "RPC_URL_BASE",
    defaultRpcUrl: "https://mainnet.base.org",
  },
  unichain: {
    slug: "unichain",
    chainId: 130,
    label: "Unichain",
    chain: unichain,
    poolManager: "0x1F98400000000000000000000000000000000004",
    explorerName: "Uniscan",
    explorerUrl: "https://uniscan.xyz",
    rpcEnvVar: "RPC_URL_UNICHAIN",
    defaultRpcUrl: "https://mainnet.unichain.org",
  },
  arbitrum: {
    slug: "arbitrum",
    chainId: 42161,
    label: "Arbitrum One",
    chain: arbitrum,
    poolManager: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32",
    explorerName: "Arbiscan",
    explorerUrl: "https://arbiscan.io",
    rpcEnvVar: "RPC_URL_ARBITRUM",
    defaultRpcUrl: "https://arb1.arbitrum.io/rpc",
  },
};

export const CHAIN_LIST: readonly ChainConfig[] = CHAIN_SLUGS.map((s) => CHAINS[s]);

/** Type guard for untrusted query-string input. */
export function isChainSlug(value: unknown): value is ChainSlug {
  return typeof value === "string" && (CHAIN_SLUGS as readonly string[]).includes(value);
}

/** Resolves a query-param value to a chain, falling back to the default. */
export function resolveChain(value: unknown): ChainConfig {
  return isChainSlug(value) ? CHAINS[value] : CHAINS[DEFAULT_CHAIN];
}

export function chainBySlug(slug: ChainSlug): ChainConfig {
  return CHAINS[slug];
}

export function chainById(chainId: number): ChainConfig | undefined {
  return CHAIN_LIST.find((c) => c.chainId === chainId);
}

/** Explorer deep link for an address. */
export function explorerAddressUrl(chain: ChainConfig, address: string): string {
  return `${chain.explorerUrl}/address/${address}`;
}

/**
 * Resolves the RPC endpoint for a chain.
 *
 * Precedence: chain-specific env var, then the public default. Public endpoints are
 * heavily rate-limited and cap `eth_getLogs` ranges, so operators are expected to set
 * their own; the defaults exist so the app is usable with zero configuration.
 */
export function resolveRpcUrl(
  chain: ChainConfig,
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = env[chain.rpcEnvVar];
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim();
  }
  return chain.defaultRpcUrl;
}

/** True when the operator supplied their own RPC rather than using the public default. */
export function usingCustomRpc(
  chain: ChainConfig,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveRpcUrl(chain, env) !== chain.defaultRpcUrl;
}
