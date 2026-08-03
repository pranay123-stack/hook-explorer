"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AddressForm } from "./AddressForm";
import { HookResults } from "./HookResults";
import { parseAddress } from "@/lib/address";
import { chainBySlug, DEFAULT_CHAIN, isChainSlug, type ChainSlug } from "@/lib/chains";
import { decodeHookAddress } from "@/lib/decode";

/** A few live hooks with contrasting permission sets, for one-click demos. */
const EXAMPLES: Array<{ label: string; address: string; chain: ChainSlug; note: string }> = [
  {
    label: "Swap-delta hook",
    address: "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC",
    chain: "base",
    note: "beforeSwap + afterSwap with both return-delta flags",
  },
  {
    label: "Full lifecycle",
    address: "0x23321f11a6d44Fd1ab790044FdFDE5758c902FDc",
    chain: "base",
    note: "10 of the 14 permissions",
  },
  {
    label: "afterSwap only",
    address: "0x44A0d07e76d5b3fA1bc2cfE3ac37073c9cf94040",
    chain: "base",
    note: "a single permission bit",
  },
  {
    label: "Unichain hook",
    address: "0xBc6e5aBDa425309c2534Bc2bC92562F5419ce8Cc",
    chain: "unichain",
    note: "initialize + liquidity + swap deltas",
  },
];

/**
 * Owns the URL, which is the single source of truth for what is being inspected.
 *
 * Nothing about the current hook is duplicated into component state: the query string
 * drives the render, so every result is linkable and the back button works. Results are
 * mounted under a key derived from the target, so switching hooks remounts them with
 * clean state instead of clearing state from an effect.
 */
export function HookExplorer() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlAddress = searchParams.get("address") ?? "";
  const urlChainRaw = searchParams.get("chain");
  const urlChain: ChainSlug = isChainSlug(urlChainRaw) ? urlChainRaw : DEFAULT_CHAIN;

  const [submitError, setSubmitError] = useState<string | null>(null);

  // Decoding is synchronous and needs no network, so permissions render on the first
  // paint straight from the URL, while the on-chain calls are still in flight.
  const parsed = parseAddress(urlAddress);
  const decoded = parsed.ok ? decodeHookAddress(parsed.address) : null;
  const chainConfig = chainBySlug(urlChain);

  // A bad address in the URL is worth reporting; an empty one is just the initial state.
  const urlError = urlAddress.trim().length > 0 && !parsed.ok ? parsed.message : null;
  const error = submitError ?? urlError;

  // A plain function, not useCallback: the React Compiler handles memoization here,
  // and a manual memo only fights it.
  function submit(address: string, chain: ChainSlug) {
    const check = parseAddress(address);
    if (!check.ok) {
      setSubmitError(check.message);
      return;
    }
    setSubmitError(null);
    router.push(`/?address=${check.address}&chain=${chain}`, { scroll: false });
  }

  return (
    <div className="space-y-8">
      {/*
        Both keys exist to remount on target change rather than reset state in an
        effect. They must be namespaced: these are siblings, and once the URL carries
        a checksummed address both would otherwise resolve to the same string, which
        React rejects as a duplicate sibling key.
      */}
      <AddressForm
        key={`form-${urlAddress}-${urlChain}`}
        address={urlAddress}
        chain={urlChain}
        error={error}
        onSubmit={submit}
      />

      {decoded ? (
        <HookResults
          key={`results-${decoded.address}-${urlChain}`}
          decoded={decoded}
          chain={chainConfig}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-400">Or try one of these live hooks:</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map((ex) => (
              <li key={ex.address}>
                <button
                  type="button"
                  onClick={() => submit(ex.address, ex.chain)}
                  className="w-full rounded-xl border border-ink-700 bg-ink-900/60 p-3 text-left transition-colors hover:border-hook-pink/50 hover:bg-ink-850"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-ink-100">{ex.label}</span>
                    <span className="text-[11px] text-ink-400">{chainBySlug(ex.chain).label}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-400">{ex.note}</p>
                  <code className="mt-1 block truncate font-mono text-[11px] text-ink-600">
                    {ex.address}
                  </code>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
