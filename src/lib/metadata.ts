import type { Metadata } from "next";
import { parseAddress, shortenAddress } from "./address";
import { resolveChain } from "./chains";
import { decodeHookAddress } from "./decode";

export const BASE_TITLE = "Hook Explorer — Uniswap v4";
export const BASE_DESCRIPTION =
  "Paste a Uniswap v4 hook address to decode its permissions, inspect its on-chain state, review risk heuristics, and find the pools that use it.";

/** Untrusted query-string shape, as Next hands it to `generateMetadata`. */
export type SearchParamsRecord = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Builds the page metadata for a given query string.
 *
 * Because the whole app state lives in the URL, the title and description can describe
 * the specific hook being viewed. That is what makes a pasted link useful in a Discord
 * thread: the unfurled preview says what the hook can actually do, rather than repeating
 * the site name.
 *
 * Kept as a pure function separate from the route so it can be tested without Next.
 */
export function buildMetadata(params: SearchParamsRecord): Metadata {
  const parsed = parseAddress(first(params.address));

  if (!parsed.ok) {
    return {
      title: BASE_TITLE,
      description: BASE_DESCRIPTION,
      openGraph: { title: BASE_TITLE, description: BASE_DESCRIPTION, type: "website" },
    };
  }

  const chain = resolveChain(first(params.chain));
  const decoded = decodeHookAddress(parsed.address);

  const title = `${shortenAddress(parsed.address)} on ${chain.label} — Hook Explorer`;

  const description =
    decoded.activeCount === 0
      ? `This address encodes no hook permissions, so the PoolManager will never call it. Decoded from ${parsed.address} on ${chain.label}.`
      : `${decoded.activeCount} of 14 hook permissions active: ${decoded.active
          .map((p) => p.label)
          .join(", ")}.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}
