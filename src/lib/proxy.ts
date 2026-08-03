import type { Address, Hex } from "viem";
import { ZERO_ADDRESS } from "./address";

/**
 * Storage slots used by the common upgradeable-proxy standards. A hook that sits behind
 * one of these can have its logic replaced after deployment -- the address bits still
 * pin the permission set, but the code implementing those callbacks can change entirely.
 */
export const PROXY_SLOTS = {
  /** EIP-1967 implementation: `bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)` */
  eip1967Implementation: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  /** EIP-1967 admin: `bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1)` */
  eip1967Admin: "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
  /** EIP-1967 beacon: `bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1)` */
  eip1967Beacon: "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
  /** EIP-1822 (UUPS) logic slot: `keccak256("PROXIABLE")` */
  eip1822Proxiable: "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7",
} as const satisfies Record<string, Hex>;

export type ProxySlotName = keyof typeof PROXY_SLOTS;

export const PROXY_SLOT_NAMES = Object.keys(PROXY_SLOTS) as ProxySlotName[];

/** Human labels for the slots, used in risk messages. */
export const PROXY_SLOT_LABELS: Record<ProxySlotName, string> = {
  eip1967Implementation: "EIP-1967 implementation",
  eip1967Admin: "EIP-1967 admin",
  eip1967Beacon: "EIP-1967 beacon",
  eip1822Proxiable: "EIP-1822 (UUPS) proxiable",
};

/**
 * Runtime bytecode of an EIP-1167 minimal proxy, split around the 20-byte target.
 * Full form: 363d3d373d3d3d363d73<target>5af43d82803e903d91602b57fd5bf3
 */
const EIP1167_PREFIX = "363d3d373d3d3d363d73";
const EIP1167_SUFFIX = "5af43d82803e903d91602b57fd5bf3";

export interface ProxyIndicators {
  /** Non-zero values found in the standard proxy slots, keyed by slot name. */
  readonly slots: Partial<Record<ProxySlotName, Address>>;
  /** Target of an EIP-1167 minimal proxy, if the bytecode matches that template. */
  readonly minimalProxyTarget?: Address;
  /** True if any proxy indicator at all was found. */
  readonly isProxy: boolean;
  /**
   * The address the hook logic actually lives at, when determinable. Prefers the
   * EIP-1967 implementation slot, then the EIP-1167 target, then the beacon.
   */
  readonly implementation?: Address;
}

/**
 * Extracts an address from a 32-byte storage word. Proxy slots store the address in the
 * low 20 bytes, left-padded with zeros. Returns undefined for an empty or zero slot.
 */
export function addressFromSlot(word: Hex | null | undefined): Address | undefined {
  if (!word) return undefined;
  const hex = word.startsWith("0x") ? word.slice(2) : word;
  if (hex.length === 0) return undefined;
  // Tolerate short words from non-conforming nodes by left-padding to 32 bytes.
  const padded = hex.padStart(64, "0");
  const addr = `0x${padded.slice(24)}`.toLowerCase();
  if (addr === ZERO_ADDRESS) return undefined;
  return addr as Address;
}

/**
 * Detects the EIP-1167 minimal-proxy template and returns the address it delegates to.
 * A minimal proxy forwards every call elsewhere, so the deployed bytecode tells you
 * nothing about the hook's actual behaviour.
 */
export function detectMinimalProxy(bytecode: Hex | null | undefined): Address | undefined {
  if (!bytecode) return undefined;
  const hex = (bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode).toLowerCase();
  const start = hex.indexOf(EIP1167_PREFIX);
  if (start === -1) return undefined;

  const targetStart = start + EIP1167_PREFIX.length;
  const targetEnd = targetStart + 40;
  if (hex.length < targetEnd + EIP1167_SUFFIX.length) return undefined;
  if (!hex.startsWith(EIP1167_SUFFIX, targetEnd)) return undefined;

  const target = `0x${hex.slice(targetStart, targetEnd)}`;
  if (target === ZERO_ADDRESS) return undefined;
  return target as Address;
}

/**
 * Combines raw storage reads and bytecode into a proxy assessment.
 *
 * @param slotWords raw 32-byte values read from each PROXY_SLOTS entry
 * @param bytecode the deployed runtime bytecode
 */
export function analyzeProxy(
  slotWords: Partial<Record<ProxySlotName, Hex | null>>,
  bytecode: Hex | null | undefined,
): ProxyIndicators {
  const slots: Partial<Record<ProxySlotName, Address>> = {};
  for (const name of PROXY_SLOT_NAMES) {
    const addr = addressFromSlot(slotWords[name]);
    if (addr) slots[name] = addr;
  }

  const minimalProxyTarget = detectMinimalProxy(bytecode);
  const implementation = slots.eip1967Implementation ?? minimalProxyTarget ?? slots.eip1967Beacon;

  const result: ProxyIndicators = {
    slots,
    isProxy: Object.keys(slots).length > 0 || minimalProxyTarget !== undefined,
    ...(minimalProxyTarget !== undefined ? { minimalProxyTarget } : {}),
    ...(implementation !== undefined ? { implementation } : {}),
  };
  return result;
}

/** Size in bytes of deployed runtime bytecode. */
export function bytecodeSize(bytecode: Hex | null | undefined): number {
  if (!bytecode) return 0;
  const hex = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  return Math.floor(hex.length / 2);
}

/** True when the address holds no deployed code (an EOA, or nothing at all). */
export function isEmptyBytecode(bytecode: Hex | null | undefined): boolean {
  return bytecodeSize(bytecode) === 0;
}
