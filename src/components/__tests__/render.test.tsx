import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionGrid } from "../PermissionGrid";
import { BitsView } from "../BitsView";
import { RiskPanel } from "../RiskPanel";
import { OnchainPanel } from "../OnchainPanel";
import { PoolsTable, type PoolsState } from "../PoolsTable";
import { decodeHookAddress } from "@/lib/decode";
import { analyzeRisk } from "@/lib/risk";
import { analyzeProxy } from "@/lib/proxy";
import { CHAINS } from "@/lib/chains";
import { PERMISSIONS } from "@/lib/flags";
import type { InspectSuccess, PoolsSuccess } from "@/lib/api-types";

/**
 * Renders the presentational components to static markup.
 *
 * These are not snapshot tests. They assert that each component actually produces the
 * decoded values in its output -- the layer between correct data and a correct screen,
 * which typecheck and build alone do not prove.
 */
function render(el: React.ReactElement): string {
  return renderToStaticMarkup(el);
}

/** Decodes the entities React escapes into, so assertions can use plain prose. */
function unescape(s: string): string {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Strips tags so assertions match visible text rather than markup. */
function text(html: string): string {
  return unescape(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

/**
 * Strips tags without inserting a separator. Needed where a single logical string is
 * split across adjacent inline elements -- BitsView renders each bit in its own span.
 */
function tight(html: string): string {
  return unescape(html.replace(/<[^>]+>/g, ""));
}

// A live Base hook: beforeSwap + afterSwap + both swap-delta flags (0x00cc).
const SWAP_DELTA = decodeHookAddress("0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC");
// afterSwap only (0x0040).
const SIMPLE = decodeHookAddress("0x44A0d07e76d5b3fA1bc2cfE3ac37073c9cf94040");

describe("PermissionGrid", () => {
  it("renders without crashing", () => {
    expect(render(<PermissionGrid decoded={SWAP_DELTA} />).length).toBeGreaterThan(100);
  });

  it("lists all 14 permission labels regardless of which are active", () => {
    // Inactive permissions are shown greyed, not hidden -- knowing what a hook cannot
    // do is as useful as knowing what it can.
    const out = text(render(<PermissionGrid decoded={SIMPLE} />));
    for (const p of PERMISSIONS) {
      expect(out, `${p.label} missing from grid`).toContain(p.label);
    }
  });

  it("renders the five lifecycle group headings", () => {
    const out = text(render(<PermissionGrid decoded={SWAP_DELTA} />));
    for (const label of ["Initialize", "Liquidity", "Swap", "Donate", "Return Delta"]) {
      expect(out).toContain(label);
    }
  });

  it("reports the active count in the heading", () => {
    expect(text(render(<PermissionGrid decoded={SWAP_DELTA} />))).toContain("4");
    expect(text(render(<PermissionGrid decoded={SIMPLE} />))).toContain("1");
  });

  it("marks active permissions and only those as active for screen readers", () => {
    const html = render(<PermissionGrid decoded={SIMPLE} />);
    // One active permission, thirteen inactive.
    expect(html.match(/>active</g) ?? []).toHaveLength(1);
    expect(html.match(/>not active</g) ?? []).toHaveLength(13);
  });

  it("shows per-group active counts", () => {
    // SWAP_DELTA: 0/2 initialize, 0/4 liquidity, 2/2 swap, 0/2 donate, 2/4 return-delta.
    const out = text(render(<PermissionGrid decoded={SWAP_DELTA} />));
    expect(out).toContain("2/2");
    expect(out).toContain("2/4");
    expect(out).toContain("0/2");
  });

  it("renders a hook with every permission set", () => {
    const all = decodeHookAddress(`0x${"a".repeat(36)}3fff`);
    const html = render(<PermissionGrid decoded={all} />);
    expect(html.match(/>active</g) ?? []).toHaveLength(14);
  });

  it("renders a hook with no permissions", () => {
    const none = decodeHookAddress(`0x${"a".repeat(36)}0000`);
    const html = render(<PermissionGrid decoded={none} />);
    expect(html.match(/>not active</g) ?? []).toHaveLength(14);
  });
});

describe("BitsView", () => {
  it("renders the binary string, hex, and decimal forms", () => {
    const html = render(<BitsView decoded={SWAP_DELTA} />);
    const out = text(html);
    expect(out).toContain("0x00cc");
    expect(out).toContain("204"); // decimal of 0xcc
    // Each bit is its own span, so the string only reads correctly untokenised.
    expect(tight(html)).toContain("00000011001100");
  });

  it("splits the address so the permission-carrying suffix is highlighted", () => {
    const html = render(<BitsView decoded={SWAP_DELTA} />);
    // The last four characters are rendered in their own highlighted span.
    expect(html).toContain("0x335c39D5AB526092E9e8619987b4f6B5B77a");
    expect(html).toContain("c0cC");
  });

  it("renders one table row per permission with its bit index and mask", () => {
    const out = text(render(<BitsView decoded={SWAP_DELTA} />));
    for (const p of PERMISSIONS) {
      expect(out).toContain(p.label);
      expect(out).toContain(`0x${p.flag.toString(16).padStart(4, "0")}`);
    }
  });

  it("renders the bit values matching the decoded permissions", () => {
    const html = render(<BitsView decoded={SIMPLE} />);
    // 0x0040 -- exactly one bit set out of fourteen table rows.
    const cells = html.match(/font-semibold[^>]*>([01])</g) ?? [];
    const ones = cells.filter((c) => c.endsWith(">1<"));
    expect(ones).toHaveLength(1);
  });

  it("renders a flagless address as all zeros", () => {
    const none = decodeHookAddress(`0x${"a".repeat(36)}0000`);
    expect(tight(render(<BitsView decoded={none} />))).toContain("00000000000000");
  });
});

describe("RiskPanel", () => {
  it("always shows the not-an-audit disclaimer, including when clean", () => {
    for (const findings of [[], analyzeRisk(riskInput(SWAP_DELTA)).findings]) {
      const out = text(render(<RiskPanel findings={findings} highestSeverity={null} />));
      expect(out).toContain("heuristics, not an audit");
    }
  });

  it("renders each finding's title, detail, and guidance", () => {
    const report = analyzeRisk(riskInput(SWAP_DELTA));
    const out = text(render(<RiskPanel {...report} />));

    expect(report.findings.length).toBeGreaterThan(0);
    for (const f of report.findings) {
      expect(out).toContain(f.title);
      expect(out).toContain(f.guidance.slice(0, 40));
    }
    expect(out).toContain("What to check");
  });

  it("renders the severity chip for each finding", () => {
    const report = analyzeRisk(riskInput(SWAP_DELTA, { bytecodeSize: 0 }));
    const out = text(render(<RiskPanel {...report} />));
    expect(out).toContain("Critical");
    expect(out).toContain("High");
  });

  it("distinguishes mechanical facts from heuristics in the UI", () => {
    const report = analyzeRisk(riskInput(SWAP_DELTA, { bytecodeSize: 0 }));
    const out = text(render(<RiskPanel {...report} />));
    // no_bytecode is mechanical, so it carries the "Verified fact" marker.
    expect(out).toContain("Verified fact");
  });

  it("renders an all-clear state when there are no findings", () => {
    const out = text(render(<RiskPanel findings={[]} highestSeverity={null} />));
    expect(out).toContain("No heuristic flags raised");
  });

  it("shows the highest severity when one is present", () => {
    const out = text(render(<RiskPanel findings={[]} highestSeverity="high" />));
    expect(out).toContain("Highest");
    expect(out).toContain("High");
  });
});

describe("OnchainPanel", () => {
  it("renders a healthy verified contract", () => {
    const html = render(<OnchainPanel data={inspectData()} decoded={SWAP_DELTA} />);
    const out = text(html);
    expect(out).toContain("17406 bytes");
    expect(out).toContain("MyHook");
    expect(out).toContain("none detected");
    // The explorer link lives in an href attribute, so assert against the markup.
    expect(html).toContain(`href="https://basescan.org/address/${SWAP_DELTA.address}"`);
  });

  it("renders the no-contract state", () => {
    const data = inspectData({
      onchain: { hasBytecode: false, bytecodeSize: 0, proxy: { isProxy: false, slots: {} } },
    });
    expect(text(render(<OnchainPanel data={data} decoded={SWAP_DELTA} />))).toContain(
      "no contract at this address",
    );
  });

  it("renders proxy slot targets when a proxy is detected", () => {
    const impl = "0x1234567890abcdef1234567890abcdef12345678";
    const data = inspectData({
      onchain: {
        hasBytecode: true,
        bytecodeSize: 900,
        proxy: {
          isProxy: true,
          slots: { eip1967Implementation: impl },
          implementation: impl,
        },
      },
    });
    const out = text(render(<OnchainPanel data={data} decoded={SWAP_DELTA} />));
    expect(out).toContain("EIP-1967 implementation");
    expect(out).toContain(impl);
    expect(out).toContain("detected");
  });

  it("reports unknown rather than false when the RPC failed", () => {
    // The critical distinction: a failed read must not read as "no contract".
    const data = inspectData({
      onchain: {
        hasBytecode: false,
        bytecodeSize: 0,
        proxy: { isProxy: false, slots: {} },
        error: "Could not reach the Base RPC: timeout",
      },
    });
    const out = text(render(<OnchainPanel data={data} decoded={SWAP_DELTA} />));
    expect(out).toContain("unknown");
    expect(out).toContain("Could not reach");
    expect(out).not.toContain("no contract at this address");
  });

  it("renders the verification-unavailable reason", () => {
    const data = inspectData({
      verification: { status: "unknown", reason: "ETHERSCAN_API_KEY is not set." },
    });
    const out = text(render(<OnchainPanel data={data} decoded={SWAP_DELTA} />));
    expect(out).toContain("not checked");
    expect(out).toContain("ETHERSCAN_API_KEY");
  });

  it("flags an address that cannot be used as a hook", () => {
    // afterSwapReturnsDelta without afterSwap.
    const invalid = decodeHookAddress(`0x${"a".repeat(36)}0004`);
    const out = text(render(<OnchainPanel data={inspectData()} decoded={invalid} />));
    expect(out).toContain("invalid flag combination");
  });

  it("flags a flagless hook as dynamic-fee only", () => {
    const flagless = decodeHookAddress(`0x${"a".repeat(36)}0000`);
    const out = text(render(<OnchainPanel data={inspectData()} decoded={flagless} />));
    expect(out).toContain("dynamic-fee pools only");
  });
});

describe("PoolsTable", () => {
  const chain = CHAINS.base;

  it("renders the loading state with an explanation of why it is slow", () => {
    const out = text(render(<PoolsTable state={{ status: "loading" }} chain={chain} />));
    expect(out).toContain("Scanning PoolManager Initialize events");
    expect(out).toContain("not an indexed event topic");
  });

  it("renders the error state and points at the RPC env var", () => {
    const state: PoolsState = { status: "error", message: "rate limited" };
    const out = text(render(<PoolsTable state={state} chain={chain} />));
    expect(out).toContain("rate limited");
    expect(out).toContain("RPC_URL_BASE");
  });

  it("renders pool rows with token, fee, tick spacing, and block", () => {
    const out = text(render(<PoolsTable state={poolsState()} chain={chain} />));
    expect(out).toContain("0.30%");
    expect(out).toContain("60");
    expect(out).toContain("49471380");
    expect(out).toContain("Token 0");
  });

  it("renders a dynamic-fee pool as 'dynamic' rather than a huge percentage", () => {
    const state = poolsState({ fee: 0x800000, dynamicFee: true });
    const out = text(render(<PoolsTable state={state} chain={chain} />));
    expect(out).toContain("dynamic");
    expect(out).not.toContain("838.86%");
  });

  it("never presents an empty result as 'this hook has no pools'", () => {
    // The scan only covers a window, so absence of evidence is not evidence of absence.
    const state = poolsState();
    const empty: PoolsState = {
      status: "ready",
      data: { ...(state as { data: PoolsSuccess }).data, pools: [] },
    };
    const out = text(render(<PoolsTable state={empty} chain={chain} />));
    expect(out).toContain("in the scanned range");
    expect(out).toContain("Older pools may exist outside this window");
  });

  it("always reports the scanned block range alongside results", () => {
    const out = text(render(<PoolsTable state={poolsState()} chain={chain} />));
    expect(out).toContain("49372538");
    expect(out).toContain("49480537");
  });

  it("reports failed chunks so partial coverage is visible", () => {
    const state = poolsState();
    const withFailures: PoolsState = {
      status: "ready",
      data: { ...(state as { data: PoolsSuccess }).data, chunksScanned: 10, chunksFailed: 2 },
    };
    const out = text(render(<PoolsTable state={withFailures} chain={chain} />));
    expect(out).toContain("2 further ranges rejected by the RPC");
  });

  describe("when the RPC rejected every range request", () => {
    // Observed on Ethereum's public endpoint, which refuses any historical log query:
    // 0 ranges succeeded, 12 failed. Nothing was read, so this is not an empty result.
    const allFailed: PoolsState = {
      status: "ready",
      data: {
        ...(poolsState() as { data: PoolsSuccess }).data,
        pools: [],
        chunksScanned: 0,
        chunksFailed: 12,
      },
    };

    it("never claims a range was scanned", () => {
      const out = text(render(<PoolsTable state={allFailed} chain={chain} />));
      expect(out).not.toContain("This scan covered blocks");
      expect(out).not.toContain("Best-effort scan of");
    });

    it("does not report a found-count or a block range in the heading", () => {
      // "0 found · blocks 25566181–25674180" asserts both a count and a coverage
      // window, and neither exists when nothing was read.
      const out = text(render(<PoolsTable state={allFailed} chain={chain} />));
      expect(out).not.toContain("0 found");
      expect(out).not.toContain("49372538");
      expect(out).toContain("not searched");
    });

    it("never presents the failure as 'no pools found'", () => {
      // The whole promise of this panel is that an empty result means "none in the
      // window", never "this hook has no pools". With nothing read, neither holds.
      const out = text(render(<PoolsTable state={allFailed} chain={chain} />));
      expect(out).not.toContain("No pools using this hook were found");
      expect(out).not.toContain("Older pools may exist outside this window");
    });

    it("says the check did not run and that the answer is unknown", () => {
      const out = text(render(<PoolsTable state={allFailed} chain={chain} />));
      expect(out).toContain("no blocks were searched");
      expect(out).toContain("This is not a result");
      expect(out).toContain("unknown whether this hook has pools");
    });

    it("names the env var that would fix it", () => {
      const out = text(render(<PoolsTable state={allFailed} chain={chain} />));
      expect(out).toContain(chain.rpcEnvVar);
    });

    it("reports the attempt count without the broken '0 ranges' phrasing", () => {
      const out = text(render(<PoolsTable state={allFailed} chain={chain} />));
      expect(out).toContain("12 range requests attempted, all rejected");
      expect(out).not.toContain("0 block range");
    });

    it("reassures that the rest of the page is unaffected", () => {
      const out = text(render(<PoolsTable state={allFailed} chain={chain} />));
      expect(out).toContain("Everything else on this page is unaffected");
    });

    it("still renders normally when at least one range succeeded", () => {
      // One success is a real, if thin, result -- the empty-state copy applies again.
      const onePartial: PoolsState = {
        status: "ready",
        data: {
          ...(poolsState() as { data: PoolsSuccess }).data,
          pools: [],
          chunksScanned: 1,
          chunksFailed: 11,
        },
      };
      const out = text(render(<PoolsTable state={onePartial} chain={chain} />));
      expect(out).toContain("No pools using this hook were found");
      expect(out).toContain("Best-effort scan of 1 block range");
      expect(out).toContain("11 further ranges rejected");
    });
  });

  it("renders nothing but the heading when idle", () => {
    const out = text(render(<PoolsTable state={{ status: "idle" }} chain={chain} />));
    expect(out).toContain("Associated pools");
    expect(out).not.toContain("Scanning");
  });
});

// --- fixtures ------------------------------------------------------------------

function riskInput(
  decoded: ReturnType<typeof decodeHookAddress>,
  overrides: { bytecodeSize?: number } = {},
) {
  return {
    decoded,
    bytecodeSize: overrides.bytecodeSize ?? 8000,
    proxy: analyzeProxy({}, "0x6080604052"),
    verification: "verified" as const,
  };
}

function inspectData(overrides: Partial<InspectSuccess> = {}): InspectSuccess {
  return {
    ok: true,
    address: SWAP_DELTA.address,
    chain: "base",
    chainId: 8453,
    explorerUrl: `https://basescan.org/address/${SWAP_DELTA.address}`,
    onchain: {
      hasBytecode: true,
      bytecodeSize: 17406,
      proxy: { isProxy: false, slots: {} },
    },
    verification: { status: "verified", contractName: "MyHook" },
    risk: { findings: [], highestSeverity: null, counts: cleanCounts() },
    ...overrides,
  };
}

function cleanCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function poolsState(poolOverrides: Record<string, unknown> = {}): PoolsState {
  return {
    status: "ready",
    data: {
      ok: true,
      address: SWAP_DELTA.address,
      chain: "base",
      poolManager: CHAINS.base.poolManager,
      pools: [
        {
          poolId: "0x52e80f0ab802875bf60523c3584bd67508eb6719e13b1a955f745b7409c27f8d",
          currency0: "0x0000000000000000000000000000000000000000",
          currency1: "0xB2000000000000000000007545bEb39B9615958a",
          fee: 3000,
          tickSpacing: 60,
          hooks: SWAP_DELTA.address as `0x${string}`,
          blockNumber: "49471380",
          transactionHash: `0x${"ab".repeat(32)}`,
          dynamicFee: false,
          ...poolOverrides,
        },
      ],
      scannedFrom: "49372538",
      scannedTo: "49480537",
      chunksScanned: 12,
      chunksFailed: 0,
      truncated: true,
      hitResultLimit: false,
    },
  };
}
