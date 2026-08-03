import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HookExplorer } from "@/components/HookExplorer";
import { buildMetadata, type SearchParamsRecord } from "@/lib/metadata";

/**
 * Titles the page after the hook being viewed, so a browser tab, a bookmark, and an
 * unfurled link in chat all say which hook it is rather than just the site name.
 * Reading searchParams here makes the route server-rendered per request.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}): Promise<Metadata> {
  return buildMetadata(await searchParams);
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-md bg-hook-pink/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-hook-soft uppercase">
            Uniswap v4
          </span>
        </div>
        {/* The title doubles as the way home, which is where users look for it. */}
        <Link
          href="/"
          className="inline-block rounded focus:ring-2 focus:ring-hook-soft focus:outline-none"
        >
          <h1 className="text-3xl font-bold tracking-tight transition-colors hover:text-hook-soft sm:text-4xl">
            Hook Explorer
          </h1>
        </Link>
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
