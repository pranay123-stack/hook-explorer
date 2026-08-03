"use client";

import { useEffect, useState } from "react";
import { shortenAddress } from "@/lib/address";
import type { ChainConfig } from "@/lib/chains";

/**
 * Copy-the-link affordance. The whole app state lives in the query string, so the
 * current URL is always a complete, replayable result -- which is the point for
 * dropping a hook into a Discord thread.
 */
export function ShareBar({ address, chain }: { address: string; chain: ChainConfig }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      // Read the URL at click time rather than holding it in state: `window` does not
      // exist during SSR, and the address bar is already the source of truth.
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      // Clipboard access can be denied; the URL bar still holds the shareable link.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] tracking-wide text-ink-400 uppercase">Inspecting</p>
        <p className="truncate font-mono text-sm text-ink-100" title={address}>
          <span className="sm:hidden">{shortenAddress(address, 10, 8)}</span>
          <span className="hidden sm:inline">{address}</span>
          <span className="ml-2 text-ink-400">on {chain.label}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-300 transition-colors hover:border-hook-pink hover:text-hook-soft focus:ring-1 focus:ring-hook-soft focus:outline-none"
      >
        {copied ? "Copied ✓" : "Copy link"}
      </button>
    </div>
  );
}
