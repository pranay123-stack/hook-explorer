/**
 * Hook permission flags, transcribed verbatim from Uniswap v4-core.
 *
 * Source: `@uniswap/v4-core@1.0.2` -> `src/libraries/Hooks.sol`
 *
 * In Uniswap v4 a hook's permissions are NOT stored in contract storage. They are
 * encoded in the least-significant 14 bits of the hook contract's own address, and
 * the PoolManager reads them straight off the address on every call. That is why a
 * hook must be deployed to a "mined" address (via CREATE2 salt search) whose low
 * bits spell out exactly the permissions the contract intends to implement.
 *
 * From the Hooks.sol natspec:
 *   "V4 decides whether to invoke specific hooks by inspecting the least significant
 *    bits of the address that the hooks contract is deployed to."
 */

/** `uint160 internal constant ALL_HOOK_MASK = uint160((1 << 14) - 1);` */
export const ALL_HOOK_MASK = 0x3fffn;

/** Number of address bits that carry permission data. */
export const HOOK_FLAG_BITS = 14;

/**
 * A pool fee of exactly `0b1000_0000...` signals a dynamic-fee pool.
 * Source: `LPFeeLibrary.sol` -> `uint24 public constant DYNAMIC_FEE_FLAG = 0x800000;`
 */
export const DYNAMIC_FEE_FLAG = 0x800000;

/** Source: `LPFeeLibrary.sol` -> `uint24 public constant MAX_LP_FEE = 1000000;` */
export const MAX_LP_FEE = 1_000_000;

/** The 14 permission identifiers, in descending bit order (bit 13 -> bit 0). */
export const PERMISSION_KEYS = [
  "beforeInitialize",
  "afterInitialize",
  "beforeAddLiquidity",
  "afterAddLiquidity",
  "beforeRemoveLiquidity",
  "afterRemoveLiquidity",
  "beforeSwap",
  "afterSwap",
  "beforeDonate",
  "afterDonate",
  "beforeSwapReturnsDelta",
  "afterSwapReturnsDelta",
  "afterAddLiquidityReturnsDelta",
  "afterRemoveLiquidityReturnsDelta",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Display groupings used by the UI. */
export type PermissionGroup = "initialize" | "liquidity" | "swap" | "donate" | "returnDelta";

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  "initialize",
  "liquidity",
  "swap",
  "donate",
  "returnDelta",
] as const;

export const GROUP_LABELS: Record<PermissionGroup, string> = {
  initialize: "Initialize",
  liquidity: "Liquidity",
  swap: "Swap",
  donate: "Donate",
  returnDelta: "Return Delta",
};

export const GROUP_DESCRIPTIONS: Record<PermissionGroup, string> = {
  initialize: "Runs when a pool using this hook is first created.",
  liquidity: "Runs when liquidity is added to or removed from the pool.",
  swap: "Runs on every swap routed through the pool.",
  donate: "Runs when fees are donated directly to in-range liquidity providers.",
  returnDelta:
    "Lets the hook return a balance delta, changing the token amounts a user actually pays or receives.",
};

export interface PermissionMeta {
  readonly key: PermissionKey;
  /** Bit index within the address, 0-13. */
  readonly bit: number;
  /** `1n << BigInt(bit)` -- the mask value from Hooks.sol. */
  readonly flag: bigint;
  /** Solidity constant name, for traceability back to the source. */
  readonly solidityName: string;
  /** Human label for the UI. */
  readonly label: string;
  readonly group: PermissionGroup;
  readonly description: string;
  /**
   * For returns-delta flags, the permission that must also be set for the address to
   * be a valid hook address. Mirrors `Hooks.isValidHookAddress`.
   */
  readonly requires?: PermissionKey;
}

/**
 * The full flag table. Order matches PERMISSION_KEYS (bit 13 -> bit 0), which is also
 * the order the bits appear when the masked value is printed as a 14-char binary string.
 */
export const PERMISSIONS: readonly PermissionMeta[] = [
  {
    key: "beforeInitialize",
    bit: 13,
    flag: 1n << 13n,
    solidityName: "BEFORE_INITIALIZE_FLAG",
    label: "beforeInitialize",
    group: "initialize",
    description: "Called before a pool is initialized. Can validate or reject pool parameters.",
  },
  {
    key: "afterInitialize",
    bit: 12,
    flag: 1n << 12n,
    solidityName: "AFTER_INITIALIZE_FLAG",
    label: "afterInitialize",
    group: "initialize",
    description: "Called after a pool is initialized. Often used to seed hook-side state.",
  },
  {
    key: "beforeAddLiquidity",
    bit: 11,
    flag: 1n << 11n,
    solidityName: "BEFORE_ADD_LIQUIDITY_FLAG",
    label: "beforeAddLiquidity",
    group: "liquidity",
    description: "Called before liquidity is added. Can gate who is allowed to provide liquidity.",
  },
  {
    key: "afterAddLiquidity",
    bit: 10,
    flag: 1n << 10n,
    solidityName: "AFTER_ADD_LIQUIDITY_FLAG",
    label: "afterAddLiquidity",
    group: "liquidity",
    description: "Called after liquidity is added. Commonly used to mint receipts or rewards.",
  },
  {
    key: "beforeRemoveLiquidity",
    bit: 9,
    flag: 1n << 9n,
    solidityName: "BEFORE_REMOVE_LIQUIDITY_FLAG",
    label: "beforeRemoveLiquidity",
    group: "liquidity",
    description: "Called before liquidity is removed. Can enforce lockups or withdrawal rules.",
  },
  {
    key: "afterRemoveLiquidity",
    bit: 8,
    flag: 1n << 8n,
    solidityName: "AFTER_REMOVE_LIQUIDITY_FLAG",
    label: "afterRemoveLiquidity",
    group: "liquidity",
    description: "Called after liquidity is removed. Commonly used to settle rewards.",
  },
  {
    key: "beforeSwap",
    bit: 7,
    flag: 1n << 7n,
    solidityName: "BEFORE_SWAP_FLAG",
    label: "beforeSwap",
    group: "swap",
    description:
      "Called before every swap. Can set a dynamic fee, gate access, or run custom pricing.",
  },
  {
    key: "afterSwap",
    bit: 6,
    flag: 1n << 6n,
    solidityName: "AFTER_SWAP_FLAG",
    label: "afterSwap",
    group: "swap",
    description: "Called after every swap. Commonly used for accounting, oracles, or MEV capture.",
  },
  {
    key: "beforeDonate",
    bit: 5,
    flag: 1n << 5n,
    solidityName: "BEFORE_DONATE_FLAG",
    label: "beforeDonate",
    group: "donate",
    description: "Called before a donation to in-range liquidity providers.",
  },
  {
    key: "afterDonate",
    bit: 4,
    flag: 1n << 4n,
    solidityName: "AFTER_DONATE_FLAG",
    label: "afterDonate",
    group: "donate",
    description: "Called after a donation to in-range liquidity providers.",
  },
  {
    key: "beforeSwapReturnsDelta",
    bit: 3,
    flag: 1n << 3n,
    solidityName: "BEFORE_SWAP_RETURNS_DELTA_FLAG",
    label: "beforeSwapReturnDelta",
    group: "returnDelta",
    description:
      "Lets beforeSwap return a delta that changes the swap amount. This is how custom curves and no-op hooks work -- and it means the hook can alter what a swapper pays.",
    requires: "beforeSwap",
  },
  {
    key: "afterSwapReturnsDelta",
    bit: 2,
    flag: 1n << 2n,
    solidityName: "AFTER_SWAP_RETURNS_DELTA_FLAG",
    label: "afterSwapReturnDelta",
    group: "returnDelta",
    description:
      "Lets afterSwap return a delta, so the hook can take or add to the swap output after the fact.",
    requires: "afterSwap",
  },
  {
    key: "afterAddLiquidityReturnsDelta",
    bit: 1,
    flag: 1n << 1n,
    solidityName: "AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG",
    label: "afterAddLiquidityReturnDelta",
    group: "returnDelta",
    description:
      "Lets afterAddLiquidity adjust the token amounts charged to the liquidity provider.",
    requires: "afterAddLiquidity",
  },
  {
    key: "afterRemoveLiquidityReturnsDelta",
    bit: 0,
    flag: 1n << 0n,
    solidityName: "AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG",
    label: "afterRemoveLiquidityReturnDelta",
    group: "returnDelta",
    description:
      "Lets afterRemoveLiquidity adjust the token amounts returned to the liquidity provider.",
    requires: "afterRemoveLiquidity",
  },
] as const;

/** Lookup table keyed by permission name. */
export const PERMISSION_BY_KEY: Record<PermissionKey, PermissionMeta> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, p]),
) as Record<PermissionKey, PermissionMeta>;

/** Permissions belonging to a display group, in bit order. */
export function permissionsInGroup(group: PermissionGroup): readonly PermissionMeta[] {
  return PERMISSIONS.filter((p) => p.group === group);
}
