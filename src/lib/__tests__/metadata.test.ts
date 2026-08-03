import { describe, expect, it } from "vitest";
import { BASE_DESCRIPTION, BASE_TITLE, buildMetadata, resolveSiteUrl } from "../metadata";

const SWAP_DELTA = "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC"; // 0x00cc
const SIMPLE = "0x44A0d07e76d5b3fA1bc2cfE3ac37073c9cf94040"; // 0x0040

describe("buildMetadata - no valid address", () => {
  it("falls back to the site title on the landing page", () => {
    const m = buildMetadata({});
    expect(m.title).toBe(BASE_TITLE);
    expect(m.description).toBe(BASE_DESCRIPTION);
  });

  it("falls back for a malformed address rather than throwing", () => {
    for (const address of ["0x123", "not-an-address", "", "0x"]) {
      expect(buildMetadata({ address }).title, address).toBe(BASE_TITLE);
    }
  });

  it("falls back for an address failing its checksum", () => {
    const corrupted = `0x${"a" + SWAP_DELTA.slice(3)}`;
    expect(buildMetadata({ address: corrupted }).title).toBe(BASE_TITLE);
  });

  it("sets Open Graph tags on the fallback too", () => {
    const og = buildMetadata({}).openGraph;
    expect(og?.title).toBe(BASE_TITLE);
    expect(og).toHaveProperty("description", BASE_DESCRIPTION);
  });
});

describe("buildMetadata - decoded hook", () => {
  it("titles the page with the shortened address and chain", () => {
    const m = buildMetadata({ address: SWAP_DELTA, chain: "base" });
    expect(m.title).toBe("0x335c…c0cC on Base — Hook Explorer");
  });

  it("describes the active permissions by name", () => {
    const m = buildMetadata({ address: SWAP_DELTA, chain: "base" });
    expect(m.description).toBe(
      "4 of 14 hook permissions active: beforeSwap, afterSwap, beforeSwapReturnDelta, afterSwapReturnDelta.",
    );
  });

  it("handles a hook with a single permission", () => {
    const m = buildMetadata({ address: SIMPLE, chain: "base" });
    expect(m.description).toBe("1 of 14 hook permissions active: afterSwap.");
  });

  it("explains a flagless address instead of listing nothing", () => {
    const m = buildMetadata({ address: `0x${"a".repeat(36)}0000`, chain: "base" });
    expect(m.description).toContain("encodes no hook permissions");
    expect(m.description).toContain("never call it");
  });

  it("names each supported chain", () => {
    const cases: Array<[string, string]> = [
      ["ethereum", "Ethereum"],
      ["base", "Base"],
      ["unichain", "Unichain"],
      ["arbitrum", "Arbitrum One"],
    ];
    for (const [slug, label] of cases) {
      expect(buildMetadata({ address: SIMPLE, chain: slug }).title).toContain(`on ${label}`);
    }
  });

  it("falls back to the default chain for an unknown chain param", () => {
    expect(buildMetadata({ address: SIMPLE, chain: "polygon" }).title).toContain("on Ethereum");
    expect(buildMetadata({ address: SIMPLE }).title).toContain("on Ethereum");
  });

  it("normalizes a lowercase address before titling", () => {
    const m = buildMetadata({ address: SWAP_DELTA.toLowerCase(), chain: "base" });
    expect(m.title).toBe("0x335c…c0cC on Base — Hook Explorer");
  });

  it("mirrors title and description into Open Graph", () => {
    const m = buildMetadata({ address: SWAP_DELTA, chain: "base" });
    expect(m.openGraph?.title).toBe(m.title);
    expect(m.openGraph).toHaveProperty("description", m.description);
  });

  it("tolerates repeated query params by taking the first", () => {
    // Next hands duplicated params through as an array.
    const m = buildMetadata({ address: [SIMPLE, SWAP_DELTA], chain: ["base", "unichain"] });
    expect(m.title).toBe("0x44A0…4040 on Base — Hook Explorer");
  });

  it("produces a description short enough to unfurl cleanly", () => {
    // An all-permissions hook is the longest possible description.
    const m = buildMetadata({ address: `0x${"a".repeat(36)}3fff`, chain: "base" });
    expect(String(m.description).length).toBeLessThan(500);
    expect(m.description).toContain("14 of 14");
  });
});

describe("resolveSiteUrl", () => {
  it("prefers an explicit override", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://hooks.example" })).toBe(
      "https://hooks.example",
    );
  });

  it("strips a trailing slash so URL joining stays predictable", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://hooks.example/" })).toBe(
      "https://hooks.example",
    );
  });

  it("prefers Vercel's stable production domain over the deployment URL", () => {
    // A preview deployment must not bake its throwaway hostname into shared links.
    const url = resolveSiteUrl({
      VERCEL_PROJECT_PRODUCTION_URL: "hook-explorer.vercel.app",
      VERCEL_URL: "hook-explorer-abc123.vercel.app",
    });
    expect(url).toBe("https://hook-explorer.vercel.app");
  });

  it("falls back to the deployment URL when no production domain is set", () => {
    expect(resolveSiteUrl({ VERCEL_URL: "abc123.vercel.app" })).toBe("https://abc123.vercel.app");
  });

  it("falls back to localhost outside a deployment", () => {
    expect(resolveSiteUrl({})).toBe("http://localhost:3000");
  });

  it("ignores blank values", () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "   ", VERCEL_URL: "" })).toBe(
      "http://localhost:3000",
    );
  });

  it("always produces a parseable absolute URL", () => {
    for (const env of [
      {},
      { VERCEL_URL: "x.vercel.app" },
      { NEXT_PUBLIC_SITE_URL: "https://a.b" },
    ]) {
      expect(() => new URL(resolveSiteUrl(env))).not.toThrow();
    }
  });
});
