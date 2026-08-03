import { describe, expect, it } from "vitest";
import { keccak256, toBytes, type Hex } from "viem";
import {
  addressFromSlot,
  analyzeProxy,
  bytecodeSize,
  detectMinimalProxy,
  isEmptyBytecode,
  PROXY_SLOTS,
  PROXY_SLOT_NAMES,
} from "../proxy";

const IMPL = "0x1234567890abcdef1234567890abcdef12345678";

/** Left-pads an address into a 32-byte storage word, as a node would return it. */
function slotWord(address: string): Hex {
  return `0x${address.replace(/^0x/, "").toLowerCase().padStart(64, "0")}` as Hex;
}

function minimalProxyBytecode(target: string): Hex {
  const body = target.replace(/^0x/, "").toLowerCase();
  return `0x363d3d373d3d3d363d73${body}5af43d82803e903d91602b57fd5bf3` as Hex;
}

describe("proxy slot constants", () => {
  it("derives the EIP-1967 slots as keccak256(label) - 1", () => {
    const derive = (label: string) =>
      `0x${(BigInt(keccak256(toBytes(label))) - 1n).toString(16).padStart(64, "0")}`;

    expect(PROXY_SLOTS.eip1967Implementation).toBe(derive("eip1967.proxy.implementation"));
    expect(PROXY_SLOTS.eip1967Admin).toBe(derive("eip1967.proxy.admin"));
    expect(PROXY_SLOTS.eip1967Beacon).toBe(derive("eip1967.proxy.beacon"));
  });

  it("uses keccak256('PROXIABLE') for the EIP-1822 slot", () => {
    expect(PROXY_SLOTS.eip1822Proxiable).toBe(keccak256(toBytes("PROXIABLE")));
  });

  it("exposes four distinct 32-byte slots", () => {
    expect(PROXY_SLOT_NAMES).toHaveLength(4);
    const values = PROXY_SLOT_NAMES.map((n) => PROXY_SLOTS[n]);
    expect(new Set(values).size).toBe(4);
    for (const v of values) expect(v).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("addressFromSlot", () => {
  it("extracts the low 20 bytes of a padded word", () => {
    expect(addressFromSlot(slotWord(IMPL))).toBe(IMPL);
  });

  it("returns undefined for an all-zero slot", () => {
    expect(addressFromSlot(`0x${"0".repeat(64)}`)).toBeUndefined();
  });

  it("returns undefined for null, undefined, and empty input", () => {
    expect(addressFromSlot(null)).toBeUndefined();
    expect(addressFromSlot(undefined)).toBeUndefined();
    expect(addressFromSlot("0x")).toBeUndefined();
  });

  it("ignores dirty high-order bytes", () => {
    // Some proxies leave junk above the address; only the low 20 bytes are meaningful.
    const dirty = `0x${"ff".repeat(12)}${IMPL.slice(2)}` as Hex;
    expect(addressFromSlot(dirty)).toBe(IMPL);
  });

  it("left-pads a short word from a non-conforming node", () => {
    expect(addressFromSlot(IMPL as Hex)).toBe(IMPL);
  });

  it("normalizes to lowercase", () => {
    expect(addressFromSlot(slotWord(IMPL.toUpperCase().replace("0X", "0x")))).toBe(IMPL);
  });
});

describe("detectMinimalProxy", () => {
  it("extracts the target from a canonical EIP-1167 proxy", () => {
    expect(detectMinimalProxy(minimalProxyBytecode(IMPL))).toBe(IMPL);
  });

  it("is case-insensitive about the bytecode", () => {
    const upper = minimalProxyBytecode(IMPL).toUpperCase().replace("0X", "0x") as Hex;
    expect(detectMinimalProxy(upper)).toBe(IMPL);
  });

  it("returns undefined for ordinary contract bytecode", () => {
    expect(detectMinimalProxy("0x608060405234801561001057600080fd5b50")).toBeUndefined();
  });

  it("returns undefined for empty or missing bytecode", () => {
    expect(detectMinimalProxy("0x")).toBeUndefined();
    expect(detectMinimalProxy(null)).toBeUndefined();
    expect(detectMinimalProxy(undefined)).toBeUndefined();
  });

  it("requires the suffix, not just the prefix", () => {
    const truncated = `0x363d3d373d3d3d363d73${IMPL.slice(2)}` as Hex;
    expect(detectMinimalProxy(truncated)).toBeUndefined();
  });

  it("rejects a proxy template pointing at the zero address", () => {
    expect(detectMinimalProxy(minimalProxyBytecode(`0x${"0".repeat(40)}`))).toBeUndefined();
  });

  it("does not match when the suffix is corrupted", () => {
    const corrupted = minimalProxyBytecode(IMPL).replace("5af43d82", "5af43d83") as Hex;
    expect(detectMinimalProxy(corrupted)).toBeUndefined();
  });
});

describe("bytecodeSize and isEmptyBytecode", () => {
  it("counts bytes, not hex characters", () => {
    expect(bytecodeSize("0x6080604052")).toBe(5);
    expect(bytecodeSize("0xff")).toBe(1);
  });

  it("treats 0x, null and undefined as empty", () => {
    expect(bytecodeSize("0x")).toBe(0);
    expect(bytecodeSize(null)).toBe(0);
    expect(bytecodeSize(undefined)).toBe(0);
    expect(isEmptyBytecode("0x")).toBe(true);
    expect(isEmptyBytecode(null)).toBe(true);
    expect(isEmptyBytecode(undefined)).toBe(true);
  });

  it("reports non-empty bytecode as not empty", () => {
    expect(isEmptyBytecode("0x60")).toBe(false);
  });
});

describe("analyzeProxy", () => {
  it("reports no proxy for a plain contract", () => {
    const r = analyzeProxy({}, "0x608060405234801561001057600080fd5b50");
    expect(r.isProxy).toBe(false);
    expect(r.slots).toEqual({});
    expect(r.implementation).toBeUndefined();
    expect(r.minimalProxyTarget).toBeUndefined();
  });

  it("detects an EIP-1967 implementation slot", () => {
    const r = analyzeProxy({ eip1967Implementation: slotWord(IMPL) }, "0x6080");
    expect(r.isProxy).toBe(true);
    expect(r.slots.eip1967Implementation).toBe(IMPL);
    expect(r.implementation).toBe(IMPL);
  });

  it("detects an EIP-1967 admin slot on its own", () => {
    const admin = "0x00000000000000000000000000000000000000aa";
    const r = analyzeProxy({ eip1967Admin: slotWord(admin) }, "0x6080");
    expect(r.isProxy).toBe(true);
    expect(r.slots.eip1967Admin).toBe(admin);
    // An admin alone does not tell us where the logic lives.
    expect(r.implementation).toBeUndefined();
  });

  it("detects a beacon slot and uses it as the implementation hint", () => {
    const beacon = "0x00000000000000000000000000000000000000bb";
    const r = analyzeProxy({ eip1967Beacon: slotWord(beacon) }, "0x6080");
    expect(r.isProxy).toBe(true);
    expect(r.implementation).toBe(beacon);
  });

  it("detects the EIP-1822 proxiable slot", () => {
    const r = analyzeProxy({ eip1822Proxiable: slotWord(IMPL) }, "0x6080");
    expect(r.isProxy).toBe(true);
    expect(r.slots.eip1822Proxiable).toBe(IMPL);
  });

  it("detects a minimal proxy from bytecode with no slots set", () => {
    const r = analyzeProxy({}, minimalProxyBytecode(IMPL));
    expect(r.isProxy).toBe(true);
    expect(r.minimalProxyTarget).toBe(IMPL);
    expect(r.implementation).toBe(IMPL);
  });

  it("prefers the EIP-1967 implementation slot over a minimal-proxy target", () => {
    const other = "0x00000000000000000000000000000000000000cc";
    const r = analyzeProxy(
      { eip1967Implementation: slotWord(IMPL) },
      minimalProxyBytecode(other),
    );
    expect(r.implementation).toBe(IMPL);
    expect(r.minimalProxyTarget).toBe(other);
  });

  it("ignores zero-valued slots", () => {
    const r = analyzeProxy(
      {
        eip1967Implementation: `0x${"0".repeat(64)}`,
        eip1967Admin: `0x${"0".repeat(64)}`,
        eip1967Beacon: null,
      },
      "0x6080",
    );
    expect(r.isProxy).toBe(false);
    expect(r.slots).toEqual({});
  });

  it("collects several slots at once", () => {
    const admin = "0x00000000000000000000000000000000000000aa";
    const r = analyzeProxy(
      { eip1967Implementation: slotWord(IMPL), eip1967Admin: slotWord(admin) },
      "0x6080",
    );
    expect(Object.keys(r.slots).sort()).toEqual(["eip1967Admin", "eip1967Implementation"]);
    expect(r.implementation).toBe(IMPL);
  });

  it("handles an address with no code at all", () => {
    const r = analyzeProxy({}, "0x");
    expect(r.isProxy).toBe(false);
    expect(bytecodeSize("0x")).toBe(0);
  });
});
