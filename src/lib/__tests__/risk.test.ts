import { describe, expect, it } from "vitest";
import { analyzeRisk, SEVERITIES, type RiskCode, type RiskInput } from "../risk";
import { decodeHookAddress } from "../decode";
import { analyzeProxy } from "../proxy";
import { ALL_HOOK_MASK, PERMISSIONS } from "../flags";
import type { Hex } from "viem";

const PREFIX = "0xAbCdEf0123456789aBcDeF0123456789";
const IMPL = "0x1234567890abcdef1234567890abcdef12345678";

function addrWithBits(bits: bigint): string {
  return `${PREFIX}${(bits & ALL_HOOK_MASK).toString(16).padStart(8, "0")}`;
}

function slotWord(address: string): Hex {
  return `0x${address.replace(/^0x/, "").toLowerCase().padStart(64, "0")}` as Hex;
}

/** A healthy baseline: real bytecode, no proxy, verified source. */
function input(bits: bigint, overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    decoded: decodeHookAddress(addrWithBits(bits)),
    bytecodeSize: 4096,
    proxy: analyzeProxy({}, "0x6080604052"),
    verification: "verified",
    ...overrides,
  };
}

function codes(input: RiskInput): RiskCode[] {
  return analyzeRisk(input).findings.map((f) => f.code);
}

const flag = (key: string) => PERMISSIONS.find((p) => p.key === key)!.flag;

describe("clean hooks produce no findings", () => {
  it("returns nothing for a verified, non-proxy afterSwap-only hook", () => {
    const report = analyzeRisk(input(flag("afterSwap")));
    expect(report.findings).toEqual([]);
    expect(report.highestSeverity).toBeNull();
    expect(report.counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  });

  it("returns nothing for a verified beforeSwap-only hook", () => {
    expect(codes(input(flag("beforeSwap")))).toEqual([]);
  });

  it("does not flag donate-only hooks", () => {
    expect(codes(input(flag("beforeDonate") | flag("afterDonate")))).toEqual([]);
  });

  it("does not flag initialize-only hooks", () => {
    expect(codes(input(flag("beforeInitialize") | flag("afterInitialize")))).toEqual([]);
  });
});

describe("no_bytecode", () => {
  it("fires as critical when the address holds no code", () => {
    const report = analyzeRisk(input(flag("beforeSwap"), { bytecodeSize: 0 }));
    const finding = report.findings.find((f) => f.code === "no_bytecode");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("critical");
    expect(finding!.heuristic).toBe(false);
    expect(report.highestSeverity).toBe("critical");
  });

  it("does not fire when bytecode is present", () => {
    expect(codes(input(flag("beforeSwap"), { bytecodeSize: 1 }))).not.toContain("no_bytecode");
  });

  it("suppresses unverified_source when there is no contract at all", () => {
    // Reporting "source not verified" for an empty address is noise, not signal.
    const c = codes(input(flag("beforeSwap"), { bytecodeSize: 0, verification: "unverified" }));
    expect(c).toContain("no_bytecode");
    expect(c).not.toContain("unverified_source");
  });

  it("suppresses no_permissions when there is no contract at all", () => {
    const c = codes(input(0n, { bytecodeSize: 0 }));
    expect(c).toContain("no_bytecode");
    expect(c).not.toContain("no_permissions");
  });
});

describe("invalid_flag_combination", () => {
  const pairs = [
    ["beforeSwapReturnsDelta", "beforeSwap"],
    ["afterSwapReturnsDelta", "afterSwap"],
    ["afterAddLiquidityReturnsDelta", "afterAddLiquidity"],
    ["afterRemoveLiquidityReturnsDelta", "afterRemoveLiquidity"],
  ] as const;

  for (const [child, parent] of pairs) {
    it(`fires as critical for ${child} without ${parent}`, () => {
      const report = analyzeRisk(input(flag(child)));
      const finding = report.findings.find((f) => f.code === "invalid_flag_combination");
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("critical");
      expect(finding!.heuristic).toBe(false);
      expect(finding!.title).toContain(child);
      expect(finding!.title).toContain(parent);
    });
  }

  it("reports one finding per violation", () => {
    const report = analyzeRisk(input(0b1111n));
    expect(report.findings.filter((f) => f.code === "invalid_flag_combination")).toHaveLength(4);
  });

  it("does not fire when the parent flag is present", () => {
    const c = codes(input(flag("beforeSwap") | flag("beforeSwapReturnsDelta")));
    expect(c).not.toContain("invalid_flag_combination");
  });
});

describe("swap_delta_control", () => {
  it("fires as high for beforeSwap + beforeSwapReturnDelta", () => {
    const report = analyzeRisk(input(flag("beforeSwap") | flag("beforeSwapReturnsDelta")));
    const finding = report.findings.find((f) => f.code === "swap_delta_control");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.heuristic).toBe(true);
    expect(finding!.detail).toContain("beforeSwapReturnDelta");
  });

  it("fires for afterSwap + afterSwapReturnDelta", () => {
    const report = analyzeRisk(input(flag("afterSwap") | flag("afterSwapReturnsDelta")));
    const finding = report.findings.find((f) => f.code === "swap_delta_control");
    expect(finding!.detail).toContain("afterSwapReturnDelta");
  });

  it("names both delta flags when both are present", () => {
    const bits =
      flag("beforeSwap") |
      flag("afterSwap") |
      flag("beforeSwapReturnsDelta") |
      flag("afterSwapReturnsDelta");
    const report = analyzeRisk(input(bits));
    const finding = report.findings.find((f) => f.code === "swap_delta_control")!;
    expect(finding.detail).toContain("beforeSwapReturnDelta and afterSwapReturnDelta");
  });

  it("emits a single finding even when both delta flags are set", () => {
    const bits =
      flag("beforeSwap") |
      flag("afterSwap") |
      flag("beforeSwapReturnsDelta") |
      flag("afterSwapReturnsDelta");
    expect(
      analyzeRisk(input(bits)).findings.filter((f) => f.code === "swap_delta_control"),
    ).toHaveLength(1);
  });

  it("does not fire for swap permissions without a delta flag", () => {
    expect(codes(input(flag("beforeSwap") | flag("afterSwap")))).not.toContain(
      "swap_delta_control",
    );
  });

  it("does not fire for liquidity delta flags alone", () => {
    const bits = flag("afterAddLiquidity") | flag("afterAddLiquidityReturnsDelta");
    expect(codes(input(bits))).not.toContain("swap_delta_control");
  });
});

describe("liquidity_delta_control", () => {
  it("fires as medium for afterAddLiquidityReturnDelta", () => {
    const bits = flag("afterAddLiquidity") | flag("afterAddLiquidityReturnsDelta");
    const report = analyzeRisk(input(bits));
    const finding = report.findings.find((f) => f.code === "liquidity_delta_control");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.detail).toContain("afterAddLiquidityReturnDelta");
  });

  it("fires for afterRemoveLiquidityReturnDelta", () => {
    const bits = flag("afterRemoveLiquidity") | flag("afterRemoveLiquidityReturnsDelta");
    expect(codes(input(bits))).toContain("liquidity_delta_control");
  });

  it("names both flags when both are set", () => {
    const bits =
      flag("afterAddLiquidity") |
      flag("afterRemoveLiquidity") |
      flag("afterAddLiquidityReturnsDelta") |
      flag("afterRemoveLiquidityReturnsDelta");
    const finding = analyzeRisk(input(bits)).findings.find(
      (f) => f.code === "liquidity_delta_control",
    )!;
    expect(finding.detail).toContain(
      "afterAddLiquidityReturnDelta and afterRemoveLiquidityReturnDelta",
    );
  });

  it("does not fire for plain liquidity permissions", () => {
    const bits = flag("beforeAddLiquidity") | flag("afterAddLiquidity");
    expect(codes(input(bits))).not.toContain("liquidity_delta_control");
  });
});

describe("full_lifecycle_control", () => {
  const bits =
    flag("beforeSwap") |
    flag("afterSwap") |
    flag("beforeAddLiquidity") |
    flag("beforeRemoveLiquidity");

  it("fires as low when swap and both liquidity gates are held", () => {
    const finding = analyzeRisk(input(bits)).findings.find(
      (f) => f.code === "full_lifecycle_control",
    );
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
  });

  it("does not fire when one gate is missing", () => {
    expect(codes(input(bits & ~flag("beforeRemoveLiquidity")))).not.toContain(
      "full_lifecycle_control",
    );
    expect(codes(input(bits & ~flag("afterSwap")))).not.toContain("full_lifecycle_control");
  });
});

describe("no_permissions", () => {
  it("fires as low for a deployed contract with zero permission bits", () => {
    const report = analyzeRisk(input(0n));
    const finding = report.findings.find((f) => f.code === "no_permissions");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("low");
    expect(finding!.detail).toContain("0x800000");
  });

  it("does not fire when any flag is set", () => {
    expect(codes(input(flag("afterDonate")))).not.toContain("no_permissions");
  });
});

describe("proxy heuristics", () => {
  it("flags an EIP-1967 implementation slot as high", () => {
    const report = analyzeRisk(
      input(flag("beforeSwap"), {
        proxy: analyzeProxy({ eip1967Implementation: slotWord(IMPL) }, "0x6080"),
      }),
    );
    const finding = report.findings.find((f) => f.code === "upgradeable_proxy");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.detail).toContain(IMPL);
  });

  it("flags the EIP-1822 proxiable slot as high", () => {
    const c = codes(
      input(flag("beforeSwap"), {
        proxy: analyzeProxy({ eip1822Proxiable: slotWord(IMPL) }, "0x6080"),
      }),
    );
    expect(c).toContain("upgradeable_proxy");
  });

  it("flags a beacon proxy with its own finding", () => {
    const report = analyzeRisk(
      input(flag("beforeSwap"), {
        proxy: analyzeProxy({ eip1967Beacon: slotWord(IMPL) }, "0x6080"),
      }),
    );
    const finding = report.findings.find((f) => f.code === "beacon_proxy");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(report.findings.map((f) => f.code)).not.toContain("upgradeable_proxy");
  });

  it("flags a proxy admin at medium, below the implementation slot", () => {
    const report = analyzeRisk(
      input(flag("beforeSwap"), {
        proxy: analyzeProxy({ eip1967Admin: slotWord(IMPL) }, "0x6080"),
      }),
    );
    const finding = report.findings.find((f) => f.code === "proxy_admin_set");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
  });

  it("flags an EIP-1167 minimal proxy as high and names the target", () => {
    const bytecode = `0x363d3d373d3d3d363d73${IMPL.slice(2)}5af43d82803e903d91602b57fd5bf3` as Hex;
    const report = analyzeRisk(
      input(flag("beforeSwap"), { proxy: analyzeProxy({}, bytecode), bytecodeSize: 45 }),
    );
    const finding = report.findings.find((f) => f.code === "minimal_proxy");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("high");
    expect(finding!.detail).toContain(IMPL);
  });

  it("reports implementation and admin as separate findings", () => {
    const admin = "0x00000000000000000000000000000000000000aa";
    const c = codes(
      input(flag("beforeSwap"), {
        proxy: analyzeProxy(
          { eip1967Implementation: slotWord(IMPL), eip1967Admin: slotWord(admin) },
          "0x6080",
        ),
      }),
    );
    expect(c).toContain("upgradeable_proxy");
    expect(c).toContain("proxy_admin_set");
  });

  it("reports no proxy findings for a plain contract", () => {
    const c = codes(input(flag("beforeSwap"), { proxy: analyzeProxy({}, "0x6080604052") }));
    expect(c).not.toContain("upgradeable_proxy");
    expect(c).not.toContain("minimal_proxy");
    expect(c).not.toContain("beacon_proxy");
    expect(c).not.toContain("proxy_admin_set");
  });
});

describe("source verification", () => {
  it("flags unverified source as medium", () => {
    const report = analyzeRisk(input(flag("beforeSwap"), { verification: "unverified" }));
    const finding = report.findings.find((f) => f.code === "unverified_source");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("medium");
    expect(finding!.heuristic).toBe(false);
  });

  it("produces no verification finding when the source is verified", () => {
    const c = codes(input(flag("beforeSwap"), { verification: "verified" }));
    expect(c).not.toContain("unverified_source");
    expect(c).not.toContain("verification_unavailable");
  });

  it("degrades to an info finding when the check could not run", () => {
    const report = analyzeRisk(input(flag("beforeSwap"), { verification: "unknown" }));
    const finding = report.findings.find((f) => f.code === "verification_unavailable");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("info");
    // An unrunnable check must not raise the overall risk level.
    expect(report.highestSeverity).toBeNull();
  });

  it("surfaces the supplied reason for an unavailable check", () => {
    const report = analyzeRisk(
      input(flag("beforeSwap"), {
        verification: "unknown",
        verificationReason: "ETHERSCAN_API_KEY is not set.",
      }),
    );
    const finding = report.findings.find((f) => f.code === "verification_unavailable")!;
    expect(finding.detail).toBe("ETHERSCAN_API_KEY is not set.");
  });

  it("falls back to a default reason when none is supplied", () => {
    const report = analyzeRisk(input(flag("beforeSwap"), { verification: "unknown" }));
    const finding = report.findings.find((f) => f.code === "verification_unavailable")!;
    expect(finding.detail.length).toBeGreaterThan(0);
  });
});

describe("report shape", () => {
  it("sorts findings by descending severity", () => {
    const report = analyzeRisk(
      input(flag("beforeSwap") | flag("beforeSwapReturnsDelta"), {
        bytecodeSize: 0,
        verification: "unknown",
        proxy: analyzeProxy({ eip1967Implementation: slotWord(IMPL) }, "0x"),
      }),
    );
    const ranks = report.findings.map((f) => SEVERITIES.indexOf(f.severity));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(report.findings[0]!.severity).toBe("critical");
    expect(report.findings.at(-1)!.severity).toBe("info");
  });

  it("counts findings per severity", () => {
    const report = analyzeRisk(
      input(flag("beforeSwap") | flag("beforeSwapReturnsDelta"), {
        verification: "unverified",
        proxy: analyzeProxy({ eip1967Implementation: slotWord(IMPL) }, "0x6080"),
      }),
    );
    const total = SEVERITIES.reduce((n, s) => n + report.counts[s], 0);
    expect(total).toBe(report.findings.length);
    expect(report.counts.high).toBeGreaterThanOrEqual(2); // swap delta + proxy
    expect(report.counts.medium).toBeGreaterThanOrEqual(1); // unverified
  });

  it("ignores info findings when computing highestSeverity", () => {
    const report = analyzeRisk(input(flag("afterSwap"), { verification: "unknown" }));
    expect(report.findings.map((f) => f.code)).toEqual(["verification_unavailable"]);
    expect(report.highestSeverity).toBeNull();
  });

  it("marks each finding as heuristic or mechanical", () => {
    const report = analyzeRisk(
      input(flag("beforeSwap") | flag("beforeSwapReturnsDelta"), {
        bytecodeSize: 0,
        verification: "unverified",
      }),
    );
    const byCode = new Map(report.findings.map((f) => [f.code, f]));
    expect(byCode.get("no_bytecode")!.heuristic).toBe(false);
    expect(byCode.get("swap_delta_control")!.heuristic).toBe(true);
  });

  it("gives every finding a title, detail, and guidance", () => {
    const report = analyzeRisk(
      input(ALL_HOOK_MASK, {
        bytecodeSize: 0,
        verification: "unverified",
        proxy: analyzeProxy(
          { eip1967Implementation: slotWord(IMPL), eip1967Beacon: slotWord(IMPL) },
          "0x",
        ),
      }),
    );
    expect(report.findings.length).toBeGreaterThan(3);
    for (const f of report.findings) {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.detail.length).toBeGreaterThan(20);
      expect(f.guidance.length).toBeGreaterThan(10);
      expect(SEVERITIES).toContain(f.severity);
    }
  });

  it("is deterministic", () => {
    const i = input(flag("beforeSwap") | flag("beforeSwapReturnsDelta"), {
      verification: "unverified",
    });
    expect(analyzeRisk(i)).toEqual(analyzeRisk(i));
  });
});

describe("real hook: 0x335c...c0cC (Base) with swap deltas", () => {
  // A live Base hook holding beforeSwap + afterSwap + both swap-delta flags.
  const decoded = decodeHookAddress("0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC");

  it("is flagged for swap-amount control but nothing worse", () => {
    const report = analyzeRisk({
      decoded,
      bytecodeSize: 8000,
      proxy: analyzeProxy({}, "0x6080604052"),
      verification: "verified",
    });
    expect(report.findings.map((f) => f.code)).toEqual(["swap_delta_control"]);
    expect(report.highestSeverity).toBe("high");
  });

  it("stacks unverified source on top when the explorer has no source", () => {
    const report = analyzeRisk({
      decoded,
      bytecodeSize: 8000,
      proxy: analyzeProxy({}, "0x6080604052"),
      verification: "unverified",
    });
    expect(report.findings.map((f) => f.code)).toEqual(["swap_delta_control", "unverified_source"]);
  });
});
