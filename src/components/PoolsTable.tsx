"use client";

import type { PoolsSuccess } from "@/lib/api-types";
import { formatFee } from "@/lib/pools";
import { shortenAddress } from "@/lib/address";
import type { ChainConfig } from "@/lib/chains";

export type PoolsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: PoolsSuccess };

function TokenLink({ chain, address }: { chain: ChainConfig; address: string }) {
  return (
    <a
      href={`${chain.explorerUrl}/address/${address}`}
      target="_blank"
      rel="noreferrer noopener"
      className="font-mono text-xs text-ink-100 underline decoration-ink-600 underline-offset-2 hover:text-hook-soft"
    >
      {shortenAddress(address, 8, 6)}
    </a>
  );
}

/**
 * Pools whose PoolKey names this hook.
 *
 * Always renders the scanned block range alongside the results. Because `hooks` is not
 * an indexed parameter on the Initialize event, this scan can only ever cover a bounded
 * window of recent blocks -- so "no pools found" must never be presented as "this hook
 * has no pools".
 */
export function PoolsTable({ state, chain }: { state: PoolsState; chain: ChainConfig }) {
  return (
    <section aria-labelledby="pools-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="pools-heading" className="text-lg font-semibold">
          Associated pools
        </h2>
        {state.status === "ready" ? (
          <p className="tnum text-xs text-ink-400">
            {state.data.pools.length} found · blocks {state.data.scannedFrom}–{state.data.scannedTo}
          </p>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <div
          role="status"
          className="rounded-xl border border-ink-700 bg-ink-900/60 p-6 text-center"
        >
          <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-ink-600 border-t-hook-pink" />
          <p className="text-sm text-ink-300">Scanning PoolManager Initialize events…</p>
          <p className="mt-1 text-xs text-ink-400">
            The hook address is not an indexed event topic, so this walks recent blocks and filters
            client-side. It can take a few seconds.
          </p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <p className="text-sm text-red-200">{state.message}</p>
          <p className="mt-1 text-xs text-ink-400">
            Public RPC endpoints often rate-limit log queries. Setting {chain.rpcEnvVar} to a
            dedicated endpoint makes this far more reliable.
          </p>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          {state.data.pools.length === 0 ? (
            <div className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
              <p className="text-sm text-ink-300">
                No pools using this hook were found in the scanned range.
              </p>
              <p className="mt-1 text-xs text-ink-400">
                This scan covered blocks {state.data.scannedFrom}–{state.data.scannedTo} on{" "}
                {chain.label}
                {state.data.truncated
                  ? ", which is only a recent slice of the chain. Older pools may exist outside this window."
                  : "."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-ink-700 bg-ink-900/60">
              {/* Same reasoning as the bit table: natural min-content width, no magic
                  number, with nowrap headers so multi-word labels stay on one line. */}
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">
                  Pools initialized with this hook, newest first
                </caption>
                <thead>
                  <tr className="border-b border-ink-700 text-[11px] tracking-wide text-ink-400 uppercase">
                    <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                      Token 0
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                      Token 1
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                      Fee
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                      Tick spacing
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                      Block
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.pools.map((pool) => (
                    <tr key={pool.poolId} className="border-b border-ink-800 last:border-b-0">
                      <td className="px-3 py-2">
                        <TokenLink chain={chain} address={pool.currency0} />
                      </td>
                      <td className="px-3 py-2">
                        <TokenLink chain={chain} address={pool.currency1} />
                      </td>
                      <td className="tnum px-3 py-2 text-sm">
                        {pool.dynamicFee ? (
                          <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-xs text-violet-300">
                            dynamic
                          </span>
                        ) : (
                          formatFee(pool.fee)
                        )}
                      </td>
                      <td className="tnum px-3 py-2 text-sm text-ink-300">{pool.tickSpacing}</td>
                      <td className="tnum px-3 py-2 font-mono text-xs text-ink-400">
                        {pool.blockNumber}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs leading-relaxed text-ink-400">
            Best-effort scan of {state.data.chunksScanned} block range
            {state.data.chunksScanned === 1 ? "" : "s"}
            {state.data.chunksFailed > 0
              ? `, ${state.data.chunksFailed} of which the RPC rejected`
              : ""}
            {state.data.truncated
              ? ". This is a partial view — the scan stops before the full chain history to stay within public RPC limits."
              : "."}
          </p>
        </>
      ) : null}
    </section>
  );
}
