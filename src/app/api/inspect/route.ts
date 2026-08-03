import { NextResponse } from "next/server";
import { parseAddress } from "@/lib/address";
import { resolveChain, isChainSlug } from "@/lib/chains";
import { decodeHookAddress } from "@/lib/decode";
import { fetchVerification, getExplorerApiKey } from "@/lib/explorer";
import { createChainClient, inspectContract } from "@/lib/inspect";
import { analyzeProxy } from "@/lib/proxy";
import { analyzeRisk } from "@/lib/risk";
import type { ApiError, InspectResponse, ProxySummary } from "@/lib/api-types";

export const runtime = "nodejs";
// Contract bytecode is effectively immutable, so a short cache keeps repeated demo
// lookups off the public RPCs without ever showing meaningfully stale data.
export const revalidate = 0;

function bad(code: string, error: string, status: number) {
  return NextResponse.json<ApiError>({ ok: false, code, error }, { status });
}

/**
 * Inspects a hook address: decodes its permissions, reads its on-chain state, checks
 * source verification, and runs the risk heuristics.
 *
 * Permission decoding never fails, because it needs no network. If the RPC or the
 * explorer is unavailable the response still carries the decoded permissions with the
 * degraded checks clearly marked -- the address bits are the authoritative part.
 */
export async function GET(request: Request): Promise<NextResponse<InspectResponse>> {
  const params = new URL(request.url).searchParams;
  const rawAddress = params.get("address") ?? "";
  const rawChain = params.get("chain");

  if (rawChain !== null && !isChainSlug(rawChain)) {
    return bad("unsupported_chain", `Unsupported chain: ${rawChain}`, 400);
  }

  const parsed = parseAddress(rawAddress);
  if (!parsed.ok) {
    return bad(parsed.code, parsed.message, 400);
  }

  const chain = resolveChain(rawChain);
  const address = parsed.address;
  const decoded = decodeHookAddress(address);

  // On-chain read. A failure here degrades the response rather than failing it.
  let hasBytecode = false;
  let bytecodeSize = 0;
  let proxy = analyzeProxy({}, "0x");
  let onchainError: string | undefined;

  try {
    const client = createChainClient(chain);
    const inspection = await inspectContract(client, address);
    hasBytecode = inspection.hasBytecode;
    bytecodeSize = inspection.bytecodeSize;
    proxy = inspection.proxy;
  } catch (error) {
    onchainError =
      error instanceof Error
        ? `Could not reach the ${chain.label} RPC: ${error.message}`
        : `Could not reach the ${chain.label} RPC.`;
  }

  const verification = await fetchVerification(chain.chainId, address, {
    apiKey: getExplorerApiKey(),
  });

  // With no RPC reading, "no bytecode" is unknown rather than false -- reporting a
  // critical "no contract deployed" finding off a failed request would be wrong.
  const risk = analyzeRisk({
    decoded,
    bytecodeSize: onchainError ? 1 : bytecodeSize,
    proxy,
    verification: verification.status,
    ...(verification.reason ? { verificationReason: verification.reason } : {}),
  });

  const proxySummary: ProxySummary = {
    isProxy: proxy.isProxy,
    slots: proxy.slots,
    ...(proxy.minimalProxyTarget ? { minimalProxyTarget: proxy.minimalProxyTarget } : {}),
    ...(proxy.implementation ? { implementation: proxy.implementation } : {}),
  };

  return NextResponse.json<InspectResponse>({
    ok: true,
    address,
    chain: chain.slug,
    chainId: chain.chainId,
    explorerUrl: `${chain.explorerUrl}/address/${address}`,
    onchain: {
      hasBytecode,
      bytecodeSize,
      proxy: proxySummary,
      ...(onchainError ? { error: onchainError } : {}),
    },
    verification: {
      status: verification.status,
      ...(verification.contractName ? { contractName: verification.contractName } : {}),
      ...(verification.compilerVersion ? { compilerVersion: verification.compilerVersion } : {}),
      ...(verification.reason ? { reason: verification.reason } : {}),
    },
    risk,
  });
}
