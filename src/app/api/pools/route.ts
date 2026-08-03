import { NextResponse } from "next/server";
import { parseAddress } from "@/lib/address";
import { isChainSlug, resolveChain } from "@/lib/chains";
import { createChainClient } from "@/lib/inspect";
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_MAX_CHUNKS,
  DEFAULT_MAX_RESULTS,
  scanPoolsForHook,
} from "@/lib/pools";
import type { ApiError, PoolsResponse } from "@/lib/api-types";

export const runtime = "nodejs";
export const revalidate = 0;

function bad(code: string, error: string, status: number) {
  return NextResponse.json<ApiError>({ ok: false, code, error }, { status });
}

/** Reads a positive-integer env var, falling back when unset or unparseable. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Lists pools using a given hook, by scanning PoolManager Initialize events.
 *
 * Separate from /api/inspect on purpose: the scan is slow and best-effort, while
 * decoding is instant and authoritative. Keeping them apart lets the UI render
 * permissions immediately and stream pools in behind their own loading state.
 */
export async function GET(request: Request): Promise<NextResponse<PoolsResponse>> {
  const params = new URL(request.url).searchParams;
  const rawChain = params.get("chain");

  if (rawChain !== null && !isChainSlug(rawChain)) {
    return bad("unsupported_chain", `Unsupported chain: ${rawChain}`, 400);
  }

  const parsed = parseAddress(params.get("address") ?? "");
  if (!parsed.ok) {
    return bad(parsed.code, parsed.message, 400);
  }

  const chain = resolveChain(rawChain);

  try {
    const client = createChainClient(chain);
    const result = await scanPoolsForHook(client, chain.poolManager, parsed.address, {
      chunkSize: BigInt(envInt("POOL_SCAN_CHUNK_SIZE", Number(DEFAULT_CHUNK_SIZE))),
      maxChunks: envInt("POOL_SCAN_MAX_CHUNKS", DEFAULT_MAX_CHUNKS),
      maxResults: envInt("POOL_SCAN_MAX_RESULTS", DEFAULT_MAX_RESULTS),
    });

    return NextResponse.json<PoolsResponse>({
      ok: true,
      address: parsed.address,
      chain: chain.slug,
      poolManager: chain.poolManager,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return bad("rpc_error", `Could not scan ${chain.label} for pools: ${message}`, 502);
  }
}
