// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HookExplorer } from "../HookExplorer";

/**
 * Mounts the app with the real client reconciler.
 *
 * This exists because server rendering cannot catch a whole class of React errors.
 * Duplicate sibling keys, hook-order violations and invalid nesting are only detected
 * by the client reconciler, so `renderToStaticMarkup` is structurally blind to them --
 * a duplicate-key bug shipped past the render tests for exactly this reason.
 *
 * The core assertion is that mounting produces no React console error at all.
 */

// React refuses to run act() without this flag and logs an error, which would
// otherwise show up as a false positive in the "no console errors" assertions.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerPush = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParams,
}));

let container: HTMLDivElement;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  routerPush.mockClear();
  searchParams = new URLSearchParams();
  container = document.createElement("div");
  document.body.appendChild(container);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  // The effects fire real requests; keep them off the network and pending.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

function mount() {
  root = createRoot(container);
  act(() => {
    root.render(<HookExplorer />);
  });
}

/** React console errors, as plain strings. */
function reactErrors(): string[] {
  return consoleError.mock.calls.map((c: unknown[]) => c.map(String).join(" "));
}

describe("HookExplorer mounts cleanly", () => {
  it("renders the landing state with no React errors", () => {
    mount();
    expect(reactErrors()).toEqual([]);
    expect(container.textContent).toContain("Or try one of these live hooks");
  });

  it("renders a decoded hook with no React errors", () => {
    // The exact case that produced a duplicate-key error in the browser: a URL whose
    // address is already checksummed, so the form and results keys collide unless
    // they are namespaced.
    searchParams = new URLSearchParams({
      address: "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC",
      chain: "base",
    });
    mount();

    expect(reactErrors()).toEqual([]);
    expect(container.textContent).toContain("Hook permissions");
  });

  it("does not emit a duplicate-key warning for any supported chain", () => {
    for (const [address, chain] of [
      ["0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC", "base"],
      ["0x44A0d07e76d5b3fA1bc2cfE3ac37073c9cf94040", "base"],
      ["0xBc6e5aBDa425309c2534Bc2bC92562F5419ce8Cc", "unichain"],
      ["0x23321f11a6d44Fd1ab790044FdFDE5758c902FDc", "base"],
    ] as const) {
      consoleError.mockClear();
      searchParams = new URLSearchParams({ address, chain });
      mount();

      const dupes = reactErrors().filter((e) => e.includes("same key"));
      expect(dupes, `duplicate key for ${address} on ${chain}`).toEqual([]);

      act(() => root.unmount());
    }
  });

  it("mounts cleanly for a lowercase address in the URL", () => {
    searchParams = new URLSearchParams({
      address: "0x335c39d5ab526092e9e8619987b4f6b5b77ac0cc",
      chain: "base",
    });
    mount();
    expect(reactErrors()).toEqual([]);
  });

  it("mounts cleanly for an invalid address without rendering results", () => {
    searchParams = new URLSearchParams({ address: "0xnot-an-address", chain: "base" });
    mount();

    expect(reactErrors()).toEqual([]);
    expect(container.textContent).toContain("non-hexadecimal");
    expect(container.textContent).not.toContain("Hook permissions");
  });

  it("mounts cleanly for an address with an invalid flag combination", () => {
    // afterSwapReturnsDelta with no afterSwap.
    searchParams = new URLSearchParams({
      address: "0x0000000000000000000000000000000000000004",
      chain: "base",
    });
    mount();

    expect(reactErrors()).toEqual([]);
    expect(container.textContent).toContain("cannot be used as a hook");
  });

  it("falls back to the default chain for an unknown chain param", () => {
    searchParams = new URLSearchParams({
      address: "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC",
      chain: "polygon",
    });
    mount();

    expect(reactErrors()).toEqual([]);
    expect(container.textContent).toContain("Ethereum");
  });
});

describe("HookExplorer requests", () => {
  it("fetches inspect and pools for a valid address", () => {
    searchParams = new URLSearchParams({
      address: "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC",
      chain: "base",
    });
    mount();

    const urls = (fetch as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]!);
    expect(urls.some((u) => u.startsWith("/api/inspect?"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/pools?"))).toBe(true);
    for (const u of urls) {
      expect(u).toContain("chain=base");
      expect(u).toContain("0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC");
    }
  });

  it("makes no request when the address is invalid", () => {
    searchParams = new URLSearchParams({ address: "0x123", chain: "base" });
    mount();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("makes no request on the landing page", () => {
    mount();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("offers a way back to the landing page from a result", () => {
    searchParams = new URLSearchParams({
      address: "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC",
      chain: "base",
    });
    mount();

    const home = [...container.querySelectorAll("a")].filter((a) => a.getAttribute("href") === "/");
    expect(home.length).toBeGreaterThan(0);
    expect(home.some((a) => a.textContent?.includes("New search"))).toBe(true);
  });

  it("navigates to a checksummed URL when an example is clicked", () => {
    mount();
    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Swap-delta hook"),
    );
    expect(button).toBeDefined();

    act(() => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(routerPush).toHaveBeenCalledWith(
      "/?address=0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC&chain=base",
      { scroll: false },
    );
  });
});
