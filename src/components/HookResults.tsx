"use client";

import { useEffect, useState } from "react";
import { BitsView } from "./BitsView";
import { OnchainPanel } from "./OnchainPanel";
import { PermissionGrid } from "./PermissionGrid";
import { PoolsTable, type PoolsState } from "./PoolsTable";
import { RiskPanel } from "./RiskPanel";
import { ShareBar } from "./ShareBar";
import type { ChainConfig } from "@/lib/chains";
import type { DecodedHook } from "@/lib/decode";
import type { InspectResponse, InspectSuccess, PoolsResponse } from "@/lib/api-types";

type InspectState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: InspectSuccess };

/**
 * Results for one (address, chain) pair.
 *
 * The parent mounts this with a key of `address-chain`, so switching hooks remounts it
 * with fresh initial state rather than resetting state from inside an effect. That is
 * why both states can start as "loading" here: this component only ever exists for a
 * single target, and its effect fires exactly once for that target.
 */
export function HookResults({ decoded, chain }: { decoded: DecodedHook; chain: ChainConfig }) {
  const [inspect, setInspect] = useState<InspectState>({ status: "loading" });
  const [pools, setPools] = useState<PoolsState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const query = `address=${decoded.address}&chain=${chain.slug}`;

    fetch(`/api/inspect?${query}`, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as InspectResponse;
        setInspect(
          body.ok ? { status: "ready", data: body } : { status: "error", message: body.error },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInspect({
          status: "error",
          message: error instanceof Error ? error.message : "Request failed.",
        });
      });

    // Pools are fetched separately so a slow log scan never delays the decoded output.
    fetch(`/api/pools?${query}`, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as PoolsResponse;
        setPools(
          body.ok ? { status: "ready", data: body } : { status: "error", message: body.error },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPools({
          status: "error",
          message: error instanceof Error ? error.message : "Pool scan failed.",
        });
      });

    return () => controller.abort();
  }, [decoded.address, chain.slug]);

  return (
    <div className="space-y-8">
      <ShareBar address={decoded.address} chain={chain} />

      {decoded.validity.violations.length > 0 ? (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <h2 className="text-sm font-semibold text-red-200">
            This address cannot be used as a hook
          </h2>
          <ul className="mt-2 space-y-1">
            {decoded.validity.violations.map((v) => (
              <li key={v.flag} className="text-xs text-red-200/90">
                {v.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <PermissionGrid decoded={decoded} />

      {/*
        min-w-0 on both grid children is load-bearing. Grid items default to
        `min-width: auto`, so they refuse to shrink below their min-content width --
        the bit table would push the track wider than the viewport and defeat its own
        overflow-x-auto, spilling the whole page sideways on mobile.
      */}
      <div className="grid gap-8 lg:grid-cols-2">
        <BitsView decoded={decoded} />

        <div className="min-w-0 space-y-8">
          {inspect.status === "loading" ? (
            <div
              role="status"
              className="rounded-xl border border-ink-700 bg-ink-900/60 p-6 text-center"
            >
              <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-ink-600 border-t-hook-pink" />
              <p className="text-sm text-ink-300">Reading on-chain state…</p>
            </div>
          ) : null}

          {inspect.status === "error" ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
              <p className="text-sm text-red-200">{inspect.message}</p>
              <p className="mt-1 text-xs text-ink-400">
                The permissions above are decoded from the address itself, so they remain accurate
                regardless of this failure.
              </p>
            </div>
          ) : null}

          {inspect.status === "ready" ? (
            <>
              <OnchainPanel data={inspect.data} decoded={decoded} />
              <RiskPanel
                findings={inspect.data.risk.findings}
                highestSeverity={inspect.data.risk.highestSeverity}
              />
            </>
          ) : null}
        </div>
      </div>

      <PoolsTable state={pools} chain={chain} />
    </div>
  );
}
