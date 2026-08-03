import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  CHAIN_LIST,
  CHAIN_SLUGS,
  CHAINS,
  chainById,
  chainBySlug,
  DEFAULT_CHAIN,
  explorerAddressUrl,
  isChainSlug,
  resolveChain,
  resolveRpcUrl,
  usingCustomRpc,
} from "../chains";

describe("chain registry", () => {
  it("covers exactly the four supported chains", () => {
    expect(CHAIN_SLUGS).toEqual(["ethereum", "base", "unichain", "arbitrum"]);
    expect(CHAIN_LIST).toHaveLength(4);
  });

  it("matches each chain's canonical chain id", () => {
    expect(CHAINS.ethereum.chainId).toBe(1);
    expect(CHAINS.base.chainId).toBe(8453);
    expect(CHAINS.unichain.chainId).toBe(130);
    expect(CHAINS.arbitrum.chainId).toBe(42161);
  });

  it("agrees with the viem chain definition it wraps", () => {
    for (const c of CHAIN_LIST) {
      expect(c.chain.id, c.slug).toBe(c.chainId);
    }
  });

  it("uses the documented PoolManager addresses", () => {
    // Source: https://docs.uniswap.org/contracts/v4/deployments
    expect(CHAINS.ethereum.poolManager).toBe("0x000000000004444c5dc75cB358380D2e3dE08A90");
    expect(CHAINS.base.poolManager).toBe("0x498581fF718922c3f8e6A244956aF099B2652b2b");
    expect(CHAINS.unichain.poolManager).toBe("0x1F98400000000000000000000000000000000004");
    expect(CHAINS.arbitrum.poolManager).toBe("0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32");
  });

  it("stores PoolManager addresses in valid EIP-55 checksummed form", () => {
    for (const c of CHAIN_LIST) {
      expect(getAddress(c.poolManager), c.slug).toBe(c.poolManager);
    }
  });

  it("gives every chain a distinct PoolManager, slug, and chain id", () => {
    expect(new Set(CHAIN_LIST.map((c) => c.poolManager.toLowerCase())).size).toBe(4);
    expect(new Set(CHAIN_LIST.map((c) => c.slug)).size).toBe(4);
    expect(new Set(CHAIN_LIST.map((c) => c.chainId)).size).toBe(4);
  });

  it("gives every chain a distinct RPC env var and https default endpoint", () => {
    expect(new Set(CHAIN_LIST.map((c) => c.rpcEnvVar)).size).toBe(4);
    for (const c of CHAIN_LIST) {
      expect(c.rpcEnvVar, c.slug).toMatch(/^RPC_URL_[A-Z]+$/);
      expect(c.defaultRpcUrl, c.slug).toMatch(/^https:\/\//);
      expect(c.explorerUrl, c.slug).toMatch(/^https:\/\//);
      expect(c.explorerUrl.endsWith("/"), c.slug).toBe(false);
    }
  });

  it("keys each entry by its own slug", () => {
    for (const slug of CHAIN_SLUGS) {
      expect(CHAINS[slug].slug).toBe(slug);
    }
  });

  it("defaults to a supported chain", () => {
    expect(isChainSlug(DEFAULT_CHAIN)).toBe(true);
  });
});

describe("isChainSlug", () => {
  it("accepts every supported slug", () => {
    for (const slug of CHAIN_SLUGS) expect(isChainSlug(slug)).toBe(true);
  });

  it("rejects unknown or non-string values", () => {
    for (const bad of ["polygon", "", "ETHEREUM", null, undefined, 1, {}, []]) {
      expect(isChainSlug(bad), String(bad)).toBe(false);
    }
  });
});

describe("resolveChain", () => {
  it("resolves a valid slug", () => {
    expect(resolveChain("base").slug).toBe("base");
    expect(resolveChain("unichain").chainId).toBe(130);
  });

  it("falls back to the default for untrusted input", () => {
    for (const bad of [null, undefined, "", "solana", 42, {}]) {
      expect(resolveChain(bad).slug).toBe(DEFAULT_CHAIN);
    }
  });
});

describe("chainBySlug and chainById", () => {
  it("looks up by slug", () => {
    expect(chainBySlug("arbitrum").label).toBe("Arbitrum One");
  });

  it("looks up by chain id", () => {
    expect(chainById(8453)?.slug).toBe("base");
    expect(chainById(1)?.slug).toBe("ethereum");
  });

  it("returns undefined for an unsupported chain id", () => {
    expect(chainById(137)).toBeUndefined();
    expect(chainById(0)).toBeUndefined();
  });
});

describe("explorerAddressUrl", () => {
  it("builds an explorer link per chain", () => {
    const addr = "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC";
    expect(explorerAddressUrl(CHAINS.ethereum, addr)).toBe(`https://etherscan.io/address/${addr}`);
    expect(explorerAddressUrl(CHAINS.base, addr)).toBe(`https://basescan.org/address/${addr}`);
    expect(explorerAddressUrl(CHAINS.unichain, addr)).toBe(`https://uniscan.xyz/address/${addr}`);
    expect(explorerAddressUrl(CHAINS.arbitrum, addr)).toBe(`https://arbiscan.io/address/${addr}`);
  });
});

describe("resolveRpcUrl", () => {
  it("falls back to the public default when the env var is unset", () => {
    expect(resolveRpcUrl(CHAINS.base, {})).toBe("https://mainnet.base.org");
  });

  it("prefers a configured endpoint", () => {
    const env = { RPC_URL_BASE: "https://base.example.com/key" };
    expect(resolveRpcUrl(CHAINS.base, env)).toBe("https://base.example.com/key");
  });

  it("trims whitespace around a configured endpoint", () => {
    const env = { RPC_URL_BASE: "  https://base.example.com/key \n" };
    expect(resolveRpcUrl(CHAINS.base, env)).toBe("https://base.example.com/key");
  });

  it("ignores an empty or whitespace-only env var", () => {
    expect(resolveRpcUrl(CHAINS.base, { RPC_URL_BASE: "" })).toBe(CHAINS.base.defaultRpcUrl);
    expect(resolveRpcUrl(CHAINS.base, { RPC_URL_BASE: "   " })).toBe(CHAINS.base.defaultRpcUrl);
  });

  it("reads only its own chain's env var", () => {
    const env = { RPC_URL_ETHEREUM: "https://eth.example.com" };
    expect(resolveRpcUrl(CHAINS.base, env)).toBe(CHAINS.base.defaultRpcUrl);
    expect(resolveRpcUrl(CHAINS.ethereum, env)).toBe("https://eth.example.com");
  });
});

describe("usingCustomRpc", () => {
  it("is false when falling back to the public endpoint", () => {
    expect(usingCustomRpc(CHAINS.base, {})).toBe(false);
  });

  it("is true when an override is configured", () => {
    expect(usingCustomRpc(CHAINS.base, { RPC_URL_BASE: "https://x.example" })).toBe(true);
  });

  it("is false when the override happens to equal the default", () => {
    expect(usingCustomRpc(CHAINS.base, { RPC_URL_BASE: CHAINS.base.defaultRpcUrl })).toBe(false);
  });
});
