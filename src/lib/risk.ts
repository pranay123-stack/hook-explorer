import type { DecodedHook } from "./decode";
import { PROXY_SLOT_LABELS, type ProxyIndicators, type ProxySlotName } from "./proxy";
import { shortenAddress } from "./address";

/**
 * Ordered from most to least severe. `info` entries are context, not findings -- they
 * describe a check that could not run rather than a problem with the hook.
 */
export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export type RiskCode =
  | "no_bytecode"
  | "invalid_flag_combination"
  | "swap_delta_control"
  | "upgradeable_proxy"
  | "minimal_proxy"
  | "beacon_proxy"
  | "liquidity_delta_control"
  | "unverified_source"
  | "proxy_admin_set"
  | "full_lifecycle_control"
  | "no_permissions"
  | "verification_unavailable";

export interface RiskFinding {
  readonly code: RiskCode;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  /**
   * What the user should actually check. Kept separate from `detail` so the UI can
   * present the finding and the follow-up action distinctly.
   */
  readonly guidance: string;
  /**
   * False for findings that are mechanically true rather than heuristic -- an empty
   * bytecode or an invalid flag combination is a fact, not a guess.
   */
  readonly heuristic: boolean;
}

/** Everything the analyzer needs. Deliberately plain data so it stays pure and testable. */
export interface RiskInput {
  readonly decoded: DecodedHook;
  /** Deployed runtime bytecode size in bytes. 0 means no contract. */
  readonly bytecodeSize: number;
  readonly proxy: ProxyIndicators;
  /**
   * Source verification status from the block explorer.
   * `unknown` means the check could not run (no API key, or the request failed).
   */
  readonly verification: "verified" | "unverified" | "unknown";
  /** Why verification is unknown, surfaced to the user so the gap is explicit. */
  readonly verificationReason?: string;
}

export interface RiskReport {
  readonly findings: readonly RiskFinding[];
  /** Highest severity present among non-info findings, or null when there are none. */
  readonly highestSeverity: Severity | null;
  readonly counts: Record<Severity, number>;
}

function severityOfProxySlot(slot: ProxySlotName): Severity {
  return slot === "eip1967Admin" ? "medium" : "high";
}

/**
 * Heuristic risk analyzer.
 *
 * IMPORTANT: this is a set of pattern checks over address bits, bytecode, and explorer
 * metadata. It is not an audit. A hook can pass every check here and still be malicious,
 * and plenty of legitimate hooks will trip the swap-delta and proxy checks by design --
 * those patterns are exactly how custom curves and upgradeable protocols are built.
 * The value is in making the powers a hook holds visible, not in passing judgement.
 */
export function analyzeRisk(input: RiskInput): RiskReport {
  const { decoded, proxy, verification } = input;
  const p = decoded.permissions;
  const findings: RiskFinding[] = [];

  // --- Mechanical facts (not heuristics) -----------------------------------------

  if (input.bytecodeSize === 0) {
    findings.push({
      code: "no_bytecode",
      severity: "critical",
      title: "No contract deployed at this address",
      detail:
        "eth_getCode returned empty. This address holds no bytecode on the selected chain -- it is either an externally owned account, an address on a different chain, or a contract that has not been deployed yet.",
      guidance:
        "Confirm you have the right chain selected. A pool cannot be initialized with a hook that has no code.",
      heuristic: false,
    });
  }

  for (const violation of decoded.validity.violations) {
    findings.push({
      code: "invalid_flag_combination",
      severity: "critical",
      title: `Invalid flag combination: ${violation.flag} without ${violation.requires}`,
      detail: `The address sets the ${violation.flag} bit but not ${violation.requires}. Hooks.isValidHookAddress rejects this, so the PoolManager will revert with HookAddressNotValid for any pool using this hook.`,
      guidance:
        "This address can never be used as a hook. If you expected it to work, the deployment address was mined incorrectly.",
      heuristic: false,
    });
  }

  if (!decoded.validity.hasAnyFlag && input.bytecodeSize > 0) {
    findings.push({
      code: "no_permissions",
      severity: "low",
      title: "No hook permissions encoded in this address",
      detail:
        "None of the 14 permission bits are set. The PoolManager will never call this contract, so it can only be attached to a pool that uses a dynamic fee (fee == 0x800000), where it is consulted solely for the fee.",
      guidance:
        "If this was meant to be an active hook, its deployment address was not mined for the intended permissions.",
      heuristic: false,
    });
  }

  // --- Permission-derived heuristics ---------------------------------------------

  const swapDeltaFlags: string[] = [];
  if (p.beforeSwapReturnsDelta) swapDeltaFlags.push("beforeSwapReturnDelta");
  if (p.afterSwapReturnsDelta) swapDeltaFlags.push("afterSwapReturnDelta");

  if (swapDeltaFlags.length > 0 && (p.beforeSwap || p.afterSwap)) {
    findings.push({
      code: "swap_delta_control",
      severity: "high",
      title: "Hook can alter swap amounts",
      detail: `This hook holds ${swapDeltaFlags.join(" and ")}, which lets it return a balance delta that changes the token amounts a swapper actually pays or receives. This is the mechanism behind custom curves and no-op hooks, and it is also how a hook would skim value from a swap.`,
      guidance:
        "Read the hook's beforeSwap/afterSwap implementation and confirm how the returned delta is computed. Check for an owner-controlled fee or an unbounded delta.",
      heuristic: true,
    });
  }

  const liquidityDeltaFlags: string[] = [];
  if (p.afterAddLiquidityReturnsDelta) liquidityDeltaFlags.push("afterAddLiquidityReturnDelta");
  if (p.afterRemoveLiquidityReturnsDelta)
    liquidityDeltaFlags.push("afterRemoveLiquidityReturnDelta");

  if (liquidityDeltaFlags.length > 0) {
    findings.push({
      code: "liquidity_delta_control",
      severity: "medium",
      title: "Hook can alter liquidity amounts",
      detail: `This hook holds ${liquidityDeltaFlags.join(" and ")}, letting it adjust the token amounts charged to or returned to liquidity providers.`,
      guidance:
        "Check how the hook computes this delta on withdrawal in particular -- it sits between an LP and their funds.",
      heuristic: true,
    });
  }

  const gatesEverything =
    p.beforeSwap && p.afterSwap && p.beforeAddLiquidity && p.beforeRemoveLiquidity;
  if (gatesEverything) {
    findings.push({
      code: "full_lifecycle_control",
      severity: "low",
      title: "Hook intercepts every pool action",
      detail:
        "beforeSwap, afterSwap, beforeAddLiquidity and beforeRemoveLiquidity are all set, so no swap or liquidity change can happen without this contract running first.",
      guidance:
        "Any revert or unbounded gas use in this hook halts the pool. Check whether liquidity can still be withdrawn if the hook misbehaves.",
      heuristic: true,
    });
  }

  // --- Bytecode and proxy heuristics ---------------------------------------------

  if (proxy.minimalProxyTarget) {
    findings.push({
      code: "minimal_proxy",
      severity: "high",
      title: "EIP-1167 minimal proxy",
      detail: `The deployed bytecode is a minimal proxy that delegates every call to ${proxy.minimalProxyTarget}. The code at this address tells you nothing about the hook's behaviour.`,
      guidance: `Inspect the implementation at ${shortenAddress(proxy.minimalProxyTarget)} instead.`,
      heuristic: true,
    });
  }

  for (const [slot, target] of Object.entries(proxy.slots) as [ProxySlotName, string][]) {
    if (slot === "eip1967Beacon") {
      findings.push({
        code: "beacon_proxy",
        severity: "high",
        title: "Beacon proxy pattern",
        detail: `The EIP-1967 beacon slot points at ${target}. The implementation is resolved from that beacon at call time, so the hook's logic can be swapped by whoever controls it.`,
        guidance: "Find out who controls the beacon and whether upgrades are timelocked.",
        heuristic: true,
      });
      continue;
    }

    if (slot === "eip1967Admin") {
      findings.push({
        code: "proxy_admin_set",
        severity: severityOfProxySlot(slot),
        title: "Proxy admin is set",
        detail: `The EIP-1967 admin slot holds ${target}. That account can replace the implementation behind this hook.`,
        guidance:
          "Check whether the admin is an EOA, a multisig, or a timelock. An EOA admin means a single key can change the hook's behaviour.",
        heuristic: true,
      });
      continue;
    }

    findings.push({
      code: "upgradeable_proxy",
      severity: severityOfProxySlot(slot),
      title: `Upgradeable proxy detected (${PROXY_SLOT_LABELS[slot]})`,
      detail: `The ${PROXY_SLOT_LABELS[slot]} slot holds ${target}. The permission bits in the address are fixed forever, but the code implementing those callbacks can be replaced after deployment.`,
      guidance:
        "Verify the current implementation, then check who can upgrade it and under what delay.",
      heuristic: true,
    });
  }

  // --- Explorer verification -----------------------------------------------------

  if (verification === "unverified" && input.bytecodeSize > 0) {
    findings.push({
      code: "unverified_source",
      severity: "medium",
      title: "Source code is not verified",
      detail:
        "The block explorer has no verified source for this contract, so its behaviour cannot be reviewed without decompiling the bytecode.",
      guidance:
        "Treat an unverified hook as opaque. The permission bits still tell you what it is allowed to do, but not what it does.",
      heuristic: false,
    });
  }

  if (verification === "unknown") {
    findings.push({
      code: "verification_unavailable",
      severity: "info",
      title: "Source verification not checked",
      detail:
        input.verificationReason ??
        "The block explorer lookup did not run, so verification status is unknown.",
      guidance: "Set ETHERSCAN_API_KEY to enable this check.",
      heuristic: false,
    });
  }

  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const f of findings) counts[f.severity] += 1;

  const actionable = findings.filter((f) => f.severity !== "info");
  const highestSeverity = actionable.length > 0 ? actionable[0]!.severity : null;

  return { findings, highestSeverity, counts };
}
