import { checksumAddress, type Address } from "viem";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export type AddressErrorCode =
  "empty" | "bad_length" | "bad_characters" | "bad_checksum" | "zero_address";

export type AddressParseResult =
  { ok: true; address: Address } | { ok: false; code: AddressErrorCode; message: string };

const HEX_BODY = /^[0-9a-fA-F]*$/;

/**
 * Parses and normalizes user-supplied address input.
 *
 * Deliberately lenient about surrounding whitespace and a missing `0x` prefix, since
 * both are common when pasting out of a block explorer or Discord. Strict about
 * everything that actually matters: length, hex alphabet, and EIP-55 checksum.
 *
 * EIP-55 handling matches the widely-used convention -- an all-lowercase (or
 * all-uppercase) address carries no checksum information and is accepted as-is, while a
 * mixed-case address is treated as checksummed and must verify. That way a genuine typo
 * in a copied checksummed address is caught rather than silently accepted.
 */
export function parseAddress(raw: string): AddressParseResult {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, code: "empty", message: "Enter a hook contract address." };
  }

  const body = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;

  if (!HEX_BODY.test(body)) {
    return {
      ok: false,
      code: "bad_characters",
      message: "Address contains non-hexadecimal characters.",
    };
  }

  if (body.length !== 40) {
    return {
      ok: false,
      code: "bad_length",
      message: `Address must be 40 hex characters, got ${body.length}.`,
    };
  }

  const prefixed = `0x${body}` as Address;
  const hasLower = /[a-f]/.test(body);
  const hasUpper = /[A-F]/.test(body);
  const isMixedCase = hasLower && hasUpper;

  if (isMixedCase && checksumAddress(prefixed) !== prefixed) {
    return {
      ok: false,
      code: "bad_checksum",
      message: "Address failed its EIP-55 checksum. Check for a typo.",
    };
  }

  return { ok: true, address: checksumAddress(prefixed) };
}

/**
 * True when the address is the zero address. v4 treats `address(0)` as "no hook", so
 * it is a valid pool configuration but is never itself a hook contract.
 */
export function isZeroAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_ADDRESS;
}

/** Shortens an address for display, e.g. `0x1234...cdef`. */
export function shortenAddress(address: string, leading = 6, trailing = 4): string {
  if (address.length <= leading + trailing + 2) return address;
  return `${address.slice(0, leading)}…${address.slice(-trailing)}`;
}

/** Case-insensitive address equality, for comparing decoded log data. */
export function addressesEqual(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
