import { describe, expect, it } from "vitest";
import {
  decodeHookAddress,
  decodePermissions,
  encodePermissions,
  findDependencyViolations,
  hasPermission,
  isValidHookAddress,
  maskHookBits,
  toBinaryString,
} from "../decode";
import {
  ALL_HOOK_MASK,
  DYNAMIC_FEE_FLAG,
  PERMISSIONS,
  PERMISSION_KEYS,
  type PermissionKey,
} from "../flags";

/** Builds an address whose low 14 bits equal `bits`, with a fixed high prefix. */
function addrWithBits(bits: bigint, prefix = "0xAbCdEf0123456789aBcDeF0123456789"): string {
  const low = (bits & ALL_HOOK_MASK).toString(16).padStart(8, "0");
  return `${prefix}${low}`;
}

const ALL_KEYS = PERMISSION_KEYS as readonly PermissionKey[];

describe("flag table integrity", () => {
  it("matches the 14 constants in v4-core Hooks.sol exactly", () => {
    // Transcribed from @uniswap/v4-core@1.0.2 src/libraries/Hooks.sol.
    const expected: Record<string, bigint> = {
      BEFORE_INITIALIZE_FLAG: 1n << 13n,
      AFTER_INITIALIZE_FLAG: 1n << 12n,
      BEFORE_ADD_LIQUIDITY_FLAG: 1n << 11n,
      AFTER_ADD_LIQUIDITY_FLAG: 1n << 10n,
      BEFORE_REMOVE_LIQUIDITY_FLAG: 1n << 9n,
      AFTER_REMOVE_LIQUIDITY_FLAG: 1n << 8n,
      BEFORE_SWAP_FLAG: 1n << 7n,
      AFTER_SWAP_FLAG: 1n << 6n,
      BEFORE_DONATE_FLAG: 1n << 5n,
      AFTER_DONATE_FLAG: 1n << 4n,
      BEFORE_SWAP_RETURNS_DELTA_FLAG: 1n << 3n,
      AFTER_SWAP_RETURNS_DELTA_FLAG: 1n << 2n,
      AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG: 1n << 1n,
      AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG: 1n << 0n,
    };

    expect(PERMISSIONS).toHaveLength(14);
    for (const p of PERMISSIONS) {
      expect(expected[p.solidityName], `unknown constant ${p.solidityName}`).toBeDefined();
      expect(p.flag, `${p.solidityName} value`).toBe(expected[p.solidityName]);
      expect(p.flag, `${p.solidityName} bit index`).toBe(1n << BigInt(p.bit));
    }
    expect(Object.keys(expected)).toHaveLength(PERMISSIONS.length);
  });

  it("uses ALL_HOOK_MASK = (1 << 14) - 1 and covers every bit exactly once", () => {
    expect(ALL_HOOK_MASK).toBe((1n << 14n) - 1n);
    expect(ALL_HOOK_MASK).toBe(0x3fffn);

    const union = PERMISSIONS.reduce((acc, p) => acc | p.flag, 0n);
    expect(union).toBe(ALL_HOOK_MASK);

    const bits = PERMISSIONS.map((p) => p.bit);
    expect(new Set(bits).size).toBe(14);
    expect([...bits].sort((a, b) => a - b)).toEqual([...Array(14).keys()]);
  });

  it("lists permissions in descending bit order, matching PERMISSION_KEYS", () => {
    expect(PERMISSIONS.map((p) => p.key)).toEqual([...ALL_KEYS]);
    for (let i = 1; i < PERMISSIONS.length; i++) {
      expect(PERMISSIONS[i]!.bit).toBe(PERMISSIONS[i - 1]!.bit - 1);
    }
  });

  it("declares a parent action flag for exactly the four returns-delta permissions", () => {
    const withParent = PERMISSIONS.filter((p) => p.requires !== undefined);
    expect(withParent.map((p) => p.key)).toEqual([
      "beforeSwapReturnsDelta",
      "afterSwapReturnsDelta",
      "afterAddLiquidityReturnsDelta",
      "afterRemoveLiquidityReturnsDelta",
    ]);
    expect(withParent.map((p) => p.requires)).toEqual([
      "beforeSwap",
      "afterSwap",
      "afterAddLiquidity",
      "afterRemoveLiquidity",
    ]);
    for (const p of withParent) expect(p.group).toBe("returnDelta");
  });
});

describe("decodePermissions - every flag individually", () => {
  // Each permission, set on its own, must light up exactly itself.
  for (const p of PERMISSIONS) {
    it(`decodes ${p.key} (bit ${p.bit}, ${p.solidityName})`, () => {
      const address = addrWithBits(p.flag);
      const decoded = decodePermissions(address);

      expect(decoded[p.key]).toBe(true);
      for (const other of ALL_KEYS) {
        if (other === p.key) continue;
        expect(decoded[other], `${other} must stay off`).toBe(false);
      }
      expect(maskHookBits(address)).toBe(p.flag);
      expect(hasPermission(address, p.flag)).toBe(true);
    });
  }

  it("returns all false for an address with no permission bits", () => {
    const decoded = decodePermissions(addrWithBits(0n));
    for (const key of ALL_KEYS) expect(decoded[key]).toBe(false);
  });

  it("returns all true when every permission bit is set", () => {
    const decoded = decodePermissions(addrWithBits(ALL_HOOK_MASK));
    for (const key of ALL_KEYS) expect(decoded[key]).toBe(true);
  });
});

describe("decodePermissions - exhaustive over the full 14-bit space", () => {
  // 16384 combinations: cheap enough to verify the decoder against an independent
  // reference implementation for every possible permission set.
  it("agrees with a direct bit test for all 2^14 combinations", () => {
    for (let bits = 0; bits < 1 << 14; bits++) {
      const address = addrWithBits(BigInt(bits));
      const decoded = decodePermissions(address);
      for (const p of PERMISSIONS) {
        const expected = (bits & Number(p.flag)) !== 0;
        if (decoded[p.key] !== expected) {
          throw new Error(`bits=${bits} key=${p.key}: expected ${expected}, got ${decoded[p.key]}`);
        }
      }
    }
  });

  it("round-trips through encodePermissions for all 2^14 combinations", () => {
    for (let bits = 0; bits < 1 << 14; bits++) {
      const address = addrWithBits(BigInt(bits));
      const decoded = decodePermissions(address);
      expect(encodePermissions(decoded)).toBe(BigInt(bits));
    }
  });
});

describe("masking ignores the high 146 bits of the address", () => {
  it("produces identical permissions regardless of the address prefix", () => {
    const suffix = "28cc";
    const a = decodePermissions(`0x000000000000000000000000000000000000${suffix}`);
    const b = decodePermissions(`0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF${suffix}`);
    const c = decodePermissions(`0xdeadBEEFdeadBEEFdeadBEEFdeadBEEFdead${suffix}`);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("masks off bit 14 and above", () => {
    // 0xFFFF sets bits 0-15; only bits 0-13 are permission bits.
    expect(maskHookBits("0x000000000000000000000000000000000000FFFF")).toBe(0x3fffn);
    // 0x4000 is bit 14 alone -- no permissions at all.
    expect(maskHookBits("0x0000000000000000000000000000000000004000")).toBe(0n);
    const decoded = decodePermissions("0x0000000000000000000000000000000000004000");
    for (const key of ALL_KEYS) expect(decoded[key]).toBe(false);
  });

  it("handles the maximum address value", () => {
    const max = `0x${"f".repeat(40)}`;
    expect(maskHookBits(max)).toBe(ALL_HOOK_MASK);
    const decoded = decodePermissions(max);
    for (const key of ALL_KEYS) expect(decoded[key]).toBe(true);
  });

  it("handles the zero address", () => {
    expect(maskHookBits("0x0000000000000000000000000000000000000000")).toBe(0n);
  });
});

describe("known vector from the Hooks.sol natspec", () => {
  // The v4-core source documents this exact example:
  //   "a hooks contract deployed to address: 0x0000000000000000000000000000000000002400
  //    has the lowest bits '10 0100 0000 0000' which would cause the 'before initialize'
  //    and 'after add liquidity' hooks to be used."
  const address = "0x0000000000000000000000000000000000002400";

  it("decodes to beforeInitialize + afterAddLiquidity, exactly as documented", () => {
    const decoded = decodeHookAddress(address);
    expect(decoded.maskedBinary).toBe("10010000000000");
    expect(decoded.active.map((p) => p.key)).toEqual(["beforeInitialize", "afterAddLiquidity"]);
    expect(decoded.activeCount).toBe(2);
    expect(decoded.maskedHex).toBe("0x2400");
  });

  it("the documented bit string matches the natspec's '10 0100 0000 0000'", () => {
    expect(toBinaryString(0x2400n)).toBe("10010000000000");
    // Same string, regrouped the way the natspec writes it.
    expect("10010000000000".replace(/^(.{2})(.{4})(.{4})(.{4})$/, "$1 $2 $3 $4")).toBe(
      "10 0100 0000 0000",
    );
  });
});

describe("real deployed hook addresses", () => {
  // Collected by scanning PoolManager Initialize events on Base and Unichain mainnet.
  // Expectations were derived by hand from the address suffix, not from this decoder.
  const cases: Array<{
    address: string;
    chain: string;
    maskedHex: string;
    binary: string;
    active: PermissionKey[];
  }> = [
    {
      address: "0x44A0d07e76d5b3fA1bc2cfE3ac37073c9cf94040",
      chain: "base",
      maskedHex: "0x0040",
      binary: "00000001000000",
      active: ["afterSwap"],
    },
    {
      address: "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC",
      chain: "base",
      maskedHex: "0x00cc",
      binary: "00000011001100",
      active: ["beforeSwap", "afterSwap", "beforeSwapReturnsDelta", "afterSwapReturnsDelta"],
    },
    {
      address: "0xBc6e5aBDa425309c2534Bc2bC92562F5419ce8Cc",
      chain: "unichain",
      maskedHex: "0x28cc",
      binary: "10100011001100",
      active: [
        "beforeInitialize",
        "beforeAddLiquidity",
        "beforeSwap",
        "afterSwap",
        "beforeSwapReturnsDelta",
        "afterSwapReturnsDelta",
      ],
    },
    {
      address: "0x69D0ce9121d30487b07Cfb7d5EF50f9768f69080",
      chain: "unichain",
      maskedHex: "0x1080",
      binary: "01000010000000",
      active: ["afterInitialize", "beforeSwap"],
    },
    {
      address: "0x6398f3C67b03C4622BdAA48D9E340d66E23A1Bc0",
      chain: "unichain",
      maskedHex: "0x1bc0",
      binary: "01101111000000",
      active: [
        "afterInitialize",
        "beforeAddLiquidity",
        "beforeRemoveLiquidity",
        "afterRemoveLiquidity",
        "beforeSwap",
        "afterSwap",
      ],
    },
    {
      address: "0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544",
      chain: "base",
      maskedHex: "0x2544",
      binary: "10010101000100",
      active: [
        "beforeInitialize",
        "afterAddLiquidity",
        "afterRemoveLiquidity",
        "afterSwap",
        "afterSwapReturnsDelta",
      ],
    },
    {
      address: "0x84bBAB8cac69bF6711BA81f9915DC346f4cF2088",
      chain: "base",
      maskedHex: "0x2088",
      binary: "10000010001000",
      active: ["beforeInitialize", "beforeSwap", "beforeSwapReturnsDelta"],
    },
    {
      address: "0x23321f11a6d44Fd1ab790044FdFDE5758c902FDc",
      chain: "base",
      maskedHex: "0x2fdc",
      binary: "10111111011100",
      active: [
        "beforeInitialize",
        "beforeAddLiquidity",
        "afterAddLiquidity",
        "beforeRemoveLiquidity",
        "afterRemoveLiquidity",
        "beforeSwap",
        "afterSwap",
        "afterDonate",
        "beforeSwapReturnsDelta",
        "afterSwapReturnsDelta",
      ],
    },
  ];

  for (const c of cases) {
    it(`decodes ${c.address} on ${c.chain}`, () => {
      const decoded = decodeHookAddress(c.address);
      expect(decoded.maskedHex).toBe(c.maskedHex);
      expect(decoded.maskedBinary).toBe(c.binary);
      expect(decoded.active.map((p) => p.key)).toEqual(c.active);
      expect(decoded.activeCount).toBe(c.active.length);
    });

    it(`${c.address} is a valid hook address (it is live on ${c.chain})`, () => {
      // Every one of these is in production, so the PoolManager must have accepted it.
      const decoded = decodeHookAddress(c.address);
      expect(decoded.validity.violations).toEqual([]);
      expect(decoded.validity.validForStaticFee).toBe(true);
      expect(decoded.validity.hasAnyFlag).toBe(true);
    });
  }

  it("binary strings are self-consistent with the hex masks", () => {
    for (const c of cases) {
      expect(parseInt(c.binary, 2)).toBe(parseInt(c.maskedHex, 16));
    }
  });
});

describe("combinations", () => {
  it("decodes a two-flag combination", () => {
    const bits = (1n << 13n) | (1n << 0n);
    const decoded = decodePermissions(addrWithBits(bits));
    expect(decoded.beforeInitialize).toBe(true);
    expect(decoded.afterRemoveLiquidityReturnsDelta).toBe(true);
    expect(decoded.afterSwap).toBe(false);
  });

  it("decodes adjacent bits without bleeding into each other", () => {
    const decoded = decodePermissions(addrWithBits((1n << 7n) | (1n << 6n)));
    expect(decoded.beforeSwap).toBe(true);
    expect(decoded.afterSwap).toBe(true);
    expect(decoded.beforeDonate).toBe(false);
    expect(decoded.beforeRemoveLiquidity).toBe(false);
  });

  it("decodes every pair of flags correctly", () => {
    for (let i = 0; i < PERMISSIONS.length; i++) {
      for (let j = i + 1; j < PERMISSIONS.length; j++) {
        const a = PERMISSIONS[i]!;
        const b = PERMISSIONS[j]!;
        const decoded = decodePermissions(addrWithBits(a.flag | b.flag));
        expect(decoded[a.key], `${a.key} in pair with ${b.key}`).toBe(true);
        expect(decoded[b.key], `${b.key} in pair with ${a.key}`).toBe(true);
        const activeCount = ALL_KEYS.filter((k) => decoded[k]).length;
        expect(activeCount).toBe(2);
      }
    }
  });

  it("groups all-flags-set into the five display groups", () => {
    const decoded = decodeHookAddress(addrWithBits(ALL_HOOK_MASK));
    expect(decoded.groups.map((g) => g.group)).toEqual([
      "initialize",
      "liquidity",
      "swap",
      "donate",
      "returnDelta",
    ]);
    expect(decoded.groups.map((g) => g.cells.length)).toEqual([2, 4, 2, 2, 4]);
    expect(decoded.groups.map((g) => g.activeCount)).toEqual([2, 4, 2, 2, 4]);
    // Every one of the 14 permissions appears in exactly one group.
    const all = decoded.groups.flatMap((g) => g.cells.map((c) => c.meta.key));
    expect(new Set(all).size).toBe(14);
  });

  it("reports zero active counts per group for a flagless address", () => {
    const decoded = decodeHookAddress(addrWithBits(0n));
    expect(decoded.groups.every((g) => g.activeCount === 0)).toBe(true);
    expect(decoded.activeCount).toBe(0);
    expect(decoded.active).toEqual([]);
  });
});

describe("bit rendering", () => {
  it("always renders 14 characters", () => {
    expect(toBinaryString(0n)).toBe("00000000000000");
    expect(toBinaryString(1n)).toBe("00000000000001");
    expect(toBinaryString(ALL_HOOK_MASK)).toBe("11111111111111");
    expect(toBinaryString(0n)).toHaveLength(14);
  });

  it("orders the binary string so index 0 is PERMISSIONS[0]", () => {
    const decoded = decodeHookAddress(addrWithBits(1n << 13n));
    expect(decoded.maskedBinary[0]).toBe("1");
    expect(decoded.maskedBinary.slice(1)).toBe("0".repeat(13));
    expect(PERMISSIONS[0]!.key).toBe("beforeInitialize");
  });

  it("pads the hex mask to four digits", () => {
    expect(decodeHookAddress(addrWithBits(1n)).maskedHex).toBe("0x0001");
    expect(decodeHookAddress(addrWithBits(0n)).maskedHex).toBe("0x0000");
    expect(decodeHookAddress(addrWithBits(ALL_HOOK_MASK)).maskedHex).toBe("0x3fff");
  });

  it("reports the decimal form", () => {
    expect(decodeHookAddress(addrWithBits(0x2400n)).maskedDecimal).toBe("9216");
    expect(decodeHookAddress(addrWithBits(ALL_HOOK_MASK)).maskedDecimal).toBe("16383");
  });
});

describe("findDependencyViolations", () => {
  const pairs: Array<[PermissionKey, PermissionKey]> = [
    ["beforeSwapReturnsDelta", "beforeSwap"],
    ["afterSwapReturnsDelta", "afterSwap"],
    ["afterAddLiquidityReturnsDelta", "afterAddLiquidity"],
    ["afterRemoveLiquidityReturnsDelta", "afterRemoveLiquidity"],
  ];

  for (const [child, parent] of pairs) {
    it(`flags ${child} without ${parent}`, () => {
      const bits = PERMISSIONS.find((p) => p.key === child)!.flag;
      const violations = findDependencyViolations(decodePermissions(addrWithBits(bits)));
      expect(violations).toHaveLength(1);
      expect(violations[0]!.flag).toBe(child);
      expect(violations[0]!.requires).toBe(parent);
      expect(violations[0]!.message).toContain(parent);
    });

    it(`accepts ${child} when ${parent} is also set`, () => {
      const childFlag = PERMISSIONS.find((p) => p.key === child)!.flag;
      const parentFlag = PERMISSIONS.find((p) => p.key === parent)!.flag;
      const violations = findDependencyViolations(
        decodePermissions(addrWithBits(childFlag | parentFlag)),
      );
      expect(violations).toEqual([]);
    });
  }

  it("reports all four violations at once", () => {
    // Only the four returns-delta bits set, none of their parents.
    const bits = 0b1111n;
    const violations = findDependencyViolations(decodePermissions(addrWithBits(bits)));
    expect(violations).toHaveLength(4);
    expect(violations.map((v) => v.flag)).toEqual(pairs.map(([c]) => c));
  });

  it("finds no violations when every flag is set", () => {
    expect(findDependencyViolations(decodePermissions(addrWithBits(ALL_HOOK_MASK)))).toEqual([]);
  });

  it("finds no violations for an address with no flags", () => {
    expect(findDependencyViolations(decodePermissions(addrWithBits(0n)))).toEqual([]);
  });

  it("never reports a violation for a combination v4-core would accept", () => {
    // Cross-check the violation finder against the ported isValidHookAddress across
    // the whole 14-bit space: dependency violations must be exactly the cases where
    // isValidHookAddress fails for a non-zero address with at least one flag.
    for (let bits = 1; bits < 1 << 14; bits++) {
      const address = addrWithBits(BigInt(bits));
      const hasViolation = findDependencyViolations(decodePermissions(address)).length > 0;
      expect(isValidHookAddress(address, 3000)).toBe(!hasViolation);
    }
  });
});

describe("isValidHookAddress - port of Hooks.isValidHookAddress", () => {
  const STATIC_FEE = 3000;
  const ZERO = "0x0000000000000000000000000000000000000000";

  it("accepts the zero address with a static fee (no hook configured)", () => {
    expect(isValidHookAddress(ZERO, STATIC_FEE)).toBe(true);
  });

  it("rejects the zero address with a dynamic fee", () => {
    // "If there is no hook contract set, then fee cannot be dynamic."
    expect(isValidHookAddress(ZERO, DYNAMIC_FEE_FLAG)).toBe(false);
  });

  it("rejects a flagless non-zero address with a static fee", () => {
    expect(isValidHookAddress(addrWithBits(0n), STATIC_FEE)).toBe(false);
  });

  it("accepts a flagless non-zero address with a dynamic fee", () => {
    // A hook may carry no callbacks and exist purely to supply a dynamic fee.
    expect(isValidHookAddress(addrWithBits(0n), DYNAMIC_FEE_FLAG)).toBe(true);
  });

  it("accepts any single action flag with a static fee", () => {
    for (const p of PERMISSIONS) {
      if (p.requires !== undefined) continue;
      expect(isValidHookAddress(addrWithBits(p.flag), STATIC_FEE), p.key).toBe(true);
    }
  });

  it("rejects every lone returns-delta flag regardless of fee", () => {
    for (const p of PERMISSIONS) {
      if (p.requires === undefined) continue;
      expect(isValidHookAddress(addrWithBits(p.flag), STATIC_FEE), p.key).toBe(false);
      expect(isValidHookAddress(addrWithBits(p.flag), DYNAMIC_FEE_FLAG), p.key).toBe(false);
    }
  });

  it("treats only exactly 0x800000 as a dynamic fee", () => {
    expect(DYNAMIC_FEE_FLAG).toBe(0x800000);
    const flagless = addrWithBits(0n);
    expect(isValidHookAddress(flagless, 0x800000)).toBe(true);
    expect(isValidHookAddress(flagless, 0x800001)).toBe(false);
    expect(isValidHookAddress(flagless, 0x7fffff)).toBe(false);
    expect(isValidHookAddress(flagless, 0)).toBe(false);
  });

  it("ignores the fee when a dependency is violated", () => {
    const bad = addrWithBits(1n << 3n); // beforeSwapReturnsDelta alone
    expect(isValidHookAddress(bad, STATIC_FEE)).toBe(false);
    expect(isValidHookAddress(bad, DYNAMIC_FEE_FLAG)).toBe(false);
  });
});

describe("decodeHookAddress validity summary", () => {
  it("marks a flagless address as requiring a dynamic fee", () => {
    const v = decodeHookAddress(addrWithBits(0n)).validity;
    expect(v.hasAnyFlag).toBe(false);
    expect(v.requiresDynamicFee).toBe(true);
    expect(v.validForStaticFee).toBe(false);
    expect(v.validForDynamicFee).toBe(true);
    expect(v.violations).toEqual([]);
  });

  it("marks the zero address as not requiring a dynamic fee", () => {
    const v = decodeHookAddress("0x0000000000000000000000000000000000000000").validity;
    expect(v.validForStaticFee).toBe(true);
    expect(v.validForDynamicFee).toBe(false);
    expect(v.requiresDynamicFee).toBe(false);
  });

  it("marks a dependency-violating address invalid for both fee kinds", () => {
    const v = decodeHookAddress(addrWithBits(1n << 2n)).validity; // afterSwapReturnsDelta alone
    expect(v.validForStaticFee).toBe(false);
    expect(v.validForDynamicFee).toBe(false);
    expect(v.requiresDynamicFee).toBe(false);
    expect(v.violations).toHaveLength(1);
  });

  it("marks a well-formed hook valid for both fee kinds", () => {
    const v = decodeHookAddress(addrWithBits((1n << 7n) | (1n << 3n))).validity;
    expect(v.validForStaticFee).toBe(true);
    expect(v.validForDynamicFee).toBe(true);
    expect(v.requiresDynamicFee).toBe(false);
    expect(v.violations).toEqual([]);
  });
});

describe("encodePermissions", () => {
  it("returns 0 for an empty permission set", () => {
    expect(encodePermissions({})).toBe(0n);
  });

  it("encodes a single permission to its flag", () => {
    for (const p of PERMISSIONS) {
      expect(encodePermissions({ [p.key]: true }), p.key).toBe(p.flag);
    }
  });

  it("ignores explicitly false permissions", () => {
    expect(encodePermissions({ beforeSwap: true, afterSwap: false })).toBe(1n << 7n);
  });

  it("encodes the documented natspec example back to 0x2400", () => {
    expect(encodePermissions({ beforeInitialize: true, afterAddLiquidity: true })).toBe(0x2400n);
  });
});

describe("hasPermission", () => {
  it("mirrors the Solidity bitwise-and semantics", () => {
    const address = "0x000000000000000000000000000000000000280C";
    expect(hasPermission(address, 1n << 13n)).toBe(true); // 0x2000
    expect(hasPermission(address, 1n << 11n)).toBe(true); // 0x0800
    expect(hasPermission(address, 1n << 3n)).toBe(true); // 0x0008
    expect(hasPermission(address, 1n << 2n)).toBe(true); // 0x0004
    expect(hasPermission(address, 1n << 12n)).toBe(false);
    expect(hasPermission(address, 1n << 7n)).toBe(false);
  });

  it("returns true when any bit of a multi-bit mask matches", () => {
    // Matches Solidity's `& flag != 0`, which is an OR across the mask's bits.
    const onlyBeforeSwap = addrWithBits(1n << 7n);
    expect(hasPermission(onlyBeforeSwap, (1n << 7n) | (1n << 6n))).toBe(true);
    expect(hasPermission(onlyBeforeSwap, (1n << 6n) | (1n << 5n))).toBe(false);
  });
});
