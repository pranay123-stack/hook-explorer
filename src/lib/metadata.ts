import type { Metadata } from "next";
import { parseAddress, shortenAddress } from "./address";
import { resolveChain } from "./chains";
import { decodeHookAddress } from "./decode";

export const BASE_TITLE = "Hook Explorer — Uniswap v4";
export const BASE_DESCRIPTION =
  "Paste a Uniswap v4 hook address to decode its permissions, inspect its on-chain state, review risk heuristics, and find the pools that use it.";

/** Untrusted query-string shape, as Next hands it to `generateMetadata`. */
export type SearchParamsRecord = Record<string, string | string[] | undefined>;

/**
 * Absolute origin for this deployment, used as `metadataBase`.
 *
 * Open Graph image URLs must be absolute or the unfurl loses its image, so this has to
 * resolve to something real in production. Precedence: an explicit override, then
 * Vercel's stable production domain, then the per-deployment URL, then localhost.
 */
export function resolveSiteUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  // Set by Vercel: the stable production domain, preferred over the deployment URL so
  // preview builds do not bake a throwaway hostname into shared links.
  const prod = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prod) return `https://${prod}`;

  const deployment = env.VERCEL_URL?.trim();
  if (deployment) return `https://${deployment}`;

  return "http://localhost:3000";
}

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
export const OG_ALT = "Uniswap v4 hook permissions decoded from the contract address";

/**
 * URL of the generated Open Graph card.
 *
 * Relative on purpose: Next resolves it against `metadataBase`, so the origin is
 * defined in exactly one place. The query string has to be carried explicitly here --
 * Next's `opengraph-image` convention only receives route segments, never search
 * params, so it could never see which hook to draw.
 */
export function ogImageUrl(address: string, chainSlug: string): string {
  const query = new URLSearchParams({ address, chain: chainSlug });
  return `/api/og?${query.toString()}`;
}

export function buildMetadata(params: SearchParamsRecord): Metadata {
  const parsed = parseAddress(first(params.address));

  if (!parsed.ok) {
    return {
      title: BASE_TITLE,
      description: BASE_DESCRIPTION,
      openGraph: {
        title: BASE_TITLE,
        description: BASE_DESCRIPTION,
        type: "website",
        images: [{ url: "/api/og", width: 1200, height: 630, alt: OG_ALT }],
      },
      twitter: {
        card: "summary_large_image",
        title: BASE_TITLE,
        description: BASE_DESCRIPTION,
        images: ["/api/og"],
      },
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

  const image = ogImageUrl(parsed.address, chain.slug);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: OG_ALT }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
