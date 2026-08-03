import { describe, expect, it } from "vitest";
import {
  addressesEqual,
  isZeroAddress,
  parseAddress,
  shortenAddress,
  ZERO_ADDRESS,
} from "../address";

/** Narrows a successful parse, failing the test with a useful message otherwise. */
function expectOk(raw: string): string {
  const r = parseAddress(raw);
  if (!r.ok) throw new Error(`expected "${raw}" to parse, got ${r.code}: ${r.message}`);
  return r.address;
}

function expectErr(raw: string) {
  const r = parseAddress(raw);
  if (r.ok) throw new Error(`expected "${raw}" to be rejected, got ${r.address}`);
  return r;
}

// A genuine checksummed address (a live Base hook).
const CHECKSUMMED = "0x335c39D5AB526092E9e8619987b4f6B5B77ac0cC";
const LOWERCASE = CHECKSUMMED.toLowerCase();

describe("parseAddress - valid input", () => {
  it("accepts a correctly checksummed address unchanged", () => {
    expect(expectOk(CHECKSUMMED)).toBe(CHECKSUMMED);
  });

  it("accepts an all-lowercase address and returns it checksummed", () => {
    expect(expectOk(LOWERCASE)).toBe(CHECKSUMMED);
  });

  it("accepts an address with no 0x prefix", () => {
    expect(expectOk(CHECKSUMMED.slice(2))).toBe(CHECKSUMMED);
    expect(expectOk(LOWERCASE.slice(2))).toBe(CHECKSUMMED);
  });

  it("accepts an uppercase 0X prefix", () => {
    expect(expectOk(`0X${LOWERCASE.slice(2)}`)).toBe(CHECKSUMMED);
  });

  it("trims surrounding whitespace, including newlines from a paste", () => {
    expect(expectOk(`  ${CHECKSUMMED}  `)).toBe(CHECKSUMMED);
    expect(expectOk(`\n\t${CHECKSUMMED}\n`)).toBe(CHECKSUMMED);
  });

  it("accepts the zero address", () => {
    expect(expectOk(ZERO_ADDRESS)).toBe(ZERO_ADDRESS);
  });

  it("accepts an all-uppercase address body", () => {
    // EIP-55: "if the address is all caps or all lowercase, it is not checksummed."
    // An all-uppercase body therefore carries no checksum to verify.
    expect(expectOk(`0x${CHECKSUMMED.slice(2).toUpperCase()}`)).toBe(CHECKSUMMED);
  });

  it("accepts an all-digit address (no letters to checksum)", () => {
    const digits = `0x${"1".repeat(40)}`;
    expect(expectOk(digits)).toBe("0x1111111111111111111111111111111111111111");
  });

  it("is idempotent", () => {
    const once = expectOk(LOWERCASE);
    expect(expectOk(once)).toBe(once);
  });
});

describe("parseAddress - rejection", () => {
  it("rejects an empty string", () => {
    expect(expectErr("").code).toBe("empty");
    expect(expectErr("   ").code).toBe("empty");
    expect(expectErr("\n").code).toBe("empty");
  });

  it("rejects a bare 0x prefix", () => {
    // Empty body: reported as a length problem, since the characters are fine.
    expect(expectErr("0x").code).toBe("bad_length");
  });

  it("rejects an address that is too short", () => {
    const r = expectErr(`0x${"a".repeat(39)}`);
    expect(r.code).toBe("bad_length");
    expect(r.message).toContain("39");
  });

  it("rejects an address that is too long", () => {
    const r = expectErr(`0x${"a".repeat(41)}`);
    expect(r.code).toBe("bad_length");
    expect(r.message).toContain("41");
  });

  it("rejects a 64-char hash pasted by mistake", () => {
    expect(expectErr(`0x${"a".repeat(64)}`).code).toBe("bad_length");
  });

  it("rejects non-hex characters", () => {
    expect(expectErr(`0x${"g".repeat(40)}`).code).toBe("bad_characters");
    expect(expectErr(`0x${"z".repeat(40)}`).code).toBe("bad_characters");
  });

  it("reports bad characters before bad length", () => {
    // A short string of invalid characters is more usefully described as non-hex.
    expect(expectErr("0xnot-an-address").code).toBe("bad_characters");
  });

  it("rejects an ENS name", () => {
    expect(expectErr("vitalik.eth").code).toBe("bad_characters");
  });

  it("rejects internal whitespace", () => {
    expect(expectErr(`0x335c39D5AB526092E9e8 619987b4f6B5B77ac0cC`).code).toBe("bad_characters");
  });

  it("rejects a mixed-case address whose checksum does not verify", () => {
    // Flip one character's case: still valid hex, but no longer a valid EIP-55 address.
    const corrupted = `0x${"a" + CHECKSUMMED.slice(3)}`;
    const r = expectErr(corrupted);
    expect(r.code).toBe("bad_checksum");
    expect(r.message).toContain("EIP-55");
  });

  it("catches a single-character typo in a checksummed address", () => {
    // Change one hex digit; the checksum will almost certainly fail.
    const typo = `${CHECKSUMMED.slice(0, -1)}D`;
    expect(parseAddress(typo).ok).toBe(false);
  });

  it("returns a human-readable message for every failure mode", () => {
    for (const bad of ["", "0x", "0xzz", `0x${"a".repeat(39)}`, `0x${"a" + CHECKSUMMED.slice(3)}`]) {
      const r = parseAddress(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message.length).toBeGreaterThan(10);
        expect(r.message.endsWith(".")).toBe(true);
      }
    }
  });
});

describe("isZeroAddress", () => {
  it("recognises the zero address in any casing", () => {
    expect(isZeroAddress(ZERO_ADDRESS)).toBe(true);
    expect(isZeroAddress(ZERO_ADDRESS.toUpperCase().replace("0X", "0x"))).toBe(true);
  });

  it("rejects a non-zero address", () => {
    expect(isZeroAddress(CHECKSUMMED)).toBe(false);
    expect(isZeroAddress("0x0000000000000000000000000000000000000001")).toBe(false);
  });
});

describe("shortenAddress", () => {
  it("shortens a full address", () => {
    expect(shortenAddress(CHECKSUMMED)).toBe("0x335c…c0cC");
  });

  it("respects custom lengths", () => {
    expect(shortenAddress(CHECKSUMMED, 10, 6)).toBe("0x335c39D5…7ac0cC");
  });

  it("returns short input unchanged", () => {
    expect(shortenAddress("0x1234")).toBe("0x1234");
  });
});

describe("addressesEqual", () => {
  it("compares case-insensitively", () => {
    expect(addressesEqual(CHECKSUMMED, LOWERCASE)).toBe(true);
    expect(addressesEqual(LOWERCASE, CHECKSUMMED)).toBe(true);
  });

  it("distinguishes different addresses", () => {
    expect(addressesEqual(CHECKSUMMED, ZERO_ADDRESS)).toBe(false);
  });
});
