import { Suspense } from "react";
import { HookExplorer } from "@/components/HookExplorer";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-md bg-hook-pink/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-hook-soft uppercase">
            Uniswap v4
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Hook Explorer</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-300">
          In Uniswap v4, a hook&apos;s permissions are not stored in the contract — they are encoded
          in the lowest 14 bits of its own address. Paste an address to decode exactly which
          callbacks the PoolManager will invoke, what powers that grants, and which pools use it.
        </p>
      </header>

      {/* useSearchParams needs a Suspense boundary during prerender. */}
      <Suspense
        fallback={
          <div className="h-24 animate-pulse rounded-xl border border-ink-700 bg-ink-900/60" />
        }
      >
        <HookExplorer />
      </Suspense>

      <footer className="mt-16 border-t border-ink-800 pt-6 text-xs leading-relaxed text-ink-400">
        <p>
          Flag values transcribed from{" "}
          <code className="font-mono text-ink-300">@uniswap/v4-core</code>{" "}
          <code className="font-mono text-ink-300">src/libraries/Hooks.sol</code>. Risk findings are
          heuristics, not an audit — read the source before trusting a hook with funds.
        </p>
      </footer>
    </main>
  );
}
