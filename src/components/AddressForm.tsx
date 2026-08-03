"use client";

import { useState } from "react";
import { CHAIN_LIST, type ChainSlug } from "@/lib/chains";

export interface AddressFormProps {
  address: string;
  chain: ChainSlug;
  error: string | null;
  onSubmit: (address: string, chain: ChainSlug) => void;
}

export function AddressForm({ address, chain, error, onSubmit }: AddressFormProps) {
  const [draftAddress, setDraftAddress] = useState(address);
  const [draftChain, setDraftChain] = useState<ChainSlug>(chain);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draftAddress, draftChain);
      }}
      className="space-y-3"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          <label htmlFor="hook-address" className="mb-1.5 block text-xs text-ink-400">
            Hook contract address
          </label>
          <input
            id="hook-address"
            name="address"
            value={draftAddress}
            onChange={(e) => setDraftAddress(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "address-error" : undefined}
            className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 font-mono text-sm text-ink-100 placeholder:text-ink-600 focus:border-hook-pink focus:ring-1 focus:ring-hook-pink focus:outline-none"
          />
        </div>

        <div className="sm:w-44">
          <label htmlFor="chain" className="mb-1.5 block text-xs text-ink-400">
            Chain
          </label>
          <select
            id="chain"
            name="chain"
            value={draftChain}
            onChange={(e) => setDraftChain(e.target.value as ChainSlug)}
            className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-sm text-ink-100 focus:border-hook-pink focus:ring-1 focus:ring-hook-pink focus:outline-none"
          >
            {CHAIN_LIST.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="submit"
            className="w-full rounded-lg bg-hook-pink px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-hook-soft focus:ring-2 focus:ring-hook-soft focus:ring-offset-2 focus:ring-offset-ink-950 focus:outline-none sm:w-auto"
          >
            Decode
          </button>
        </div>
      </div>

      {error ? (
        <p id="address-error" role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </form>
  );
}
