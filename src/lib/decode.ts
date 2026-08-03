import {
  ALL_HOOK_MASK,
  DYNAMIC_FEE_FLAG,
  GROUP_DESCRIPTIONS,
  GROUP_LABELS,
  HOOK_FLAG_BITS,
  PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  permissionsInGroup,
  type PermissionGroup,
  type PermissionKey,
  type PermissionMeta,
} from "./flags";

export type PermissionMap = Record<PermissionKey, boolean>;

export interface PermissionCell {
  readonly meta: PermissionMeta;
  readonly active: boolean;
}

export interface PermissionGroupView {
  readonly group: PermissionGroup;
  readonly label: string;
  readonly description: string;
  readonly cells: readonly PermissionCell[];
  readonly activeCount: number;
}

export interface FlagDependencyViolation {
  /** The returns-delta permission that is set. */
  readonly flag: PermissionKey;
  /** The parent permission that is required but missing. */
  readonly requires: PermissionKey;
  readonly message: string;
}

export interface HookAddressValidity {
  /**
   * Whether `Hooks.isValidHookAddress` would accept this address for a pool with a
   * static (non-dynamic) fee. An address failing this can never be used as a hook on
   * such a pool -- the PoolManager reverts with `HookAddressNotValid`.
   */
  readonly validForStaticFee: boolean;
  /** Whether the address would be accepted for a dynamic-fee pool. */
  readonly validForDynamicFee: boolean;
  /** At least one of the 14 permission bits is set. */
  readonly hasAnyFlag: boolean;
  /** Returns-delta flags set without their parent action flag. */
  readonly violations: readonly FlagDependencyViolation[];
  /**
   * True when the address has no permission bits at all, so it is only usable as a
   * hook on a dynamic-fee pool (where it is called solely to supply the fee).
   */
  readonly requiresDynamicFee: boolean;
}

export interface DecodedHook {
  /** The address exactly as supplied (already checksummed by `parseAddress`). */
  readonly address: string;
  /** The lower 14 bits of the address: `uint160(addr) & ALL_HOOK_MASK`. */
  readonly maskedBits: bigint;
  /** Masked bits as hex, e.g. `0x28cc`. */
  readonly maskedHex: string;
  /** Masked bits as a 14-character binary string, MSB (bit 13) first. */
  readonly maskedBinary: string;
  /** Decimal form of the masked bits. */
  readonly maskedDecimal: string;
  readonly permissions: PermissionMap;
  readonly active: readonly PermissionMeta[];
  readonly activeCount: number;
  readonly groups: readonly PermissionGroupView[];
  readonly validity: HookAddressValidity;
}

/** Converts an address string to its numeric value. Assumes valid 0x-prefixed hex. */
function addressToBigInt(address: string): bigint {
  return BigInt(address);
}

/**
 * Mirrors `Hooks.hasPermission(IHooks self, uint160 flag)`:
 * `uint160(address(self)) & flag != 0`.
 */
export function hasPermission(address: string, flag: bigint): boolean {
  return (addressToBigInt(address) & flag) !== 0n;
}

/** Extracts the permission bits from an address: `uint160(addr) & ALL_HOOK_MASK`. */
export function maskHookBits(address: string): bigint {
  return addressToBigInt(address) & ALL_HOOK_MASK;
}

/** Decodes the 14 permission booleans from an address. */
export function decodePermissions(address: string): PermissionMap {
  const value = addressToBigInt(address);
  const out = {} as PermissionMap;
  for (const p of PERMISSIONS) {
    out[p.key] = (value & p.flag) !== 0n;
  }
  return out;
}

/**
 * Renders the masked bits as a fixed-width binary string, bit 13 -> bit 0.
 * Index 0 of the string corresponds to PERMISSIONS[0] (beforeInitialize).
 */
export function toBinaryString(bits: bigint): string {
  return bits.toString(2).padStart(HOOK_FLAG_BITS, "0");
}

/**
 * Checks the returns-delta dependency rules from `Hooks.isValidHookAddress`:
 * a hook may only carry a returns-delta flag if it also carries the corresponding
 * action flag.
 */
export function findDependencyViolations(
  permissions: PermissionMap,
): readonly FlagDependencyViolation[] {
  const violations: FlagDependencyViolation[] = [];
  for (const p of PERMISSIONS) {
    if (p.requires === undefined) continue;
    if (permissions[p.key] && !permissions[p.requires]) {
      violations.push({
        flag: p.key,
        requires: p.requires,
        message: `${p.label} is set but ${p.requires} is not. Hooks.isValidHookAddress rejects this combination.`,
      });
    }
  }
  return violations;
}

/**
 * Full port of `Hooks.isValidHookAddress(IHooks self, uint24 fee)`.
 *
 * @param address the hook address
 * @param fee the LP fee of the pool the hook would be used with
 */
export function isValidHookAddress(address: string, fee: number): boolean {
  const permissions = decodePermissions(address);
  if (findDependencyViolations(permissions).length > 0) return false;

  const isDynamicFee = fee === DYNAMIC_FEE_FLAG;

  // If there is no hook contract set, then fee cannot be dynamic.
  if (addressToBigInt(address) === 0n) return !isDynamicFee;

  // If a hook contract is set, it must have at least 1 flag set, or have a dynamic fee.
  return maskHookBits(address) > 0n || isDynamicFee;
}

function analyzeValidity(address: string, permissions: PermissionMap): HookAddressValidity {
  const violations = findDependencyViolations(permissions);
  const hasAnyFlag = maskHookBits(address) > 0n;
  const isZero = addressToBigInt(address) === 0n;
  const dependenciesOk = violations.length === 0;

  return {
    validForStaticFee: dependenciesOk && (isZero || hasAnyFlag),
    validForDynamicFee: dependenciesOk && !isZero,
    hasAnyFlag,
    violations,
    requiresDynamicFee: !isZero && !hasAnyFlag && dependenciesOk,
  };
}

/**
 * Decodes everything derivable from a hook address alone -- no network access.
 *
 * This is the heart of the tool: in v4 the permission set is not stored anywhere, it
 * IS the address, so this function needs no chain data to be authoritative.
 */
export function decodeHookAddress(address: string): DecodedHook {
  const permissions = decodePermissions(address);
  const maskedBits = maskHookBits(address);
  const active = PERMISSIONS.filter((p) => permissions[p.key]);

  const groups: PermissionGroupView[] = PERMISSION_GROUPS.map((group) => {
    const cells = permissionsInGroup(group).map((meta) => ({
      meta,
      active: permissions[meta.key],
    }));
    return {
      group,
      label: GROUP_LABELS[group],
      description: GROUP_DESCRIPTIONS[group],
      cells,
      activeCount: cells.filter((c) => c.active).length,
    };
  });

  return {
    address,
    maskedBits,
    maskedHex: `0x${maskedBits.toString(16).padStart(4, "0")}`,
    maskedBinary: toBinaryString(maskedBits),
    maskedDecimal: maskedBits.toString(10),
    permissions,
    active,
    activeCount: active.length,
    groups,
    validity: analyzeValidity(address, permissions),
  };
}

/**
 * Builds the lowest 14 bits that a given permission set would require. Useful for
 * showing users what address suffix a hook with these permissions must be mined to.
 */
export function encodePermissions(permissions: Partial<PermissionMap>): bigint {
  let bits = 0n;
  for (const p of PERMISSIONS) {
    if (permissions[p.key]) bits |= p.flag;
  }
  return bits;
}

/** The permission keys, re-exported so consumers can iterate without importing flags. */
export { PERMISSION_KEYS };
