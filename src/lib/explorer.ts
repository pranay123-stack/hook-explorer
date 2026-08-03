/**
 * Etherscan V2 API client.
 *
 * V2 unifies every supported network behind one host and one API key, selected with a
 * `chainid` query parameter -- so Etherscan, Basescan, Arbiscan and Uniscan are all
 * reachable with a single `ETHERSCAN_API_KEY`.
 */
const ETHERSCAN_V2_ENDPOINT = "https://api.etherscan.io/v2/api";

export type VerificationStatus = "verified" | "unverified" | "unknown";

export interface VerificationResult {
  readonly status: VerificationStatus;
  /** Contract name reported by the explorer, when verified. */
  readonly contractName?: string;
  readonly compilerVersion?: string;
  /** Explorer-reported proxy flag and implementation, when it knows about one. */
  readonly isProxy?: boolean;
  readonly implementation?: string;
  /** Present when status is `unknown`: why the check could not run. */
  readonly reason?: string;
}

/** Shape of the `getsourcecode` result entry we care about. */
interface SourceCodeEntry {
  SourceCode?: string;
  ABI?: string;
  ContractName?: string;
  CompilerVersion?: string;
  Proxy?: string;
  Implementation?: string;
}

/** Reads the explorer API key, returning undefined when unset or blank. */
export function getExplorerApiKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const key = env.ETHERSCAN_API_KEY;
  if (typeof key !== "string" || key.trim().length === 0) return undefined;
  return key.trim();
}

/** Builds the `getsourcecode` request URL. Exported so tests can assert on it. */
export function buildSourceCodeUrl(chainId: number, address: string, apiKey: string): string {
  const params = new URLSearchParams({
    chainid: String(chainId),
    module: "contract",
    action: "getsourcecode",
    address,
    apikey: apiKey,
  });
  return `${ETHERSCAN_V2_ENDPOINT}?${params.toString()}`;
}

/**
 * Interprets a `getsourcecode` response body.
 *
 * The explorer reports an unverified contract as a success (`status: "1"`) with an
 * empty `SourceCode` field, so the emptiness of that field -- not the status code -- is
 * what distinguishes unverified from verified.
 */
export function parseSourceCodeResponse(body: unknown): VerificationResult {
  if (typeof body !== "object" || body === null) {
    return { status: "unknown", reason: "Block explorer returned an unreadable response." };
  }

  const envelope = body as { status?: unknown; message?: unknown; result?: unknown };

  // A rate-limit or bad-key response arrives as status "0" with a string result.
  if (envelope.status !== "1") {
    const message =
      typeof envelope.result === "string" && envelope.result.length > 0
        ? envelope.result
        : typeof envelope.message === "string"
          ? envelope.message
          : "Block explorer request was rejected.";
    return { status: "unknown", reason: `Block explorer: ${message}` };
  }

  if (!Array.isArray(envelope.result) || envelope.result.length === 0) {
    return { status: "unknown", reason: "Block explorer returned no result for this address." };
  }

  const entry = envelope.result[0] as SourceCodeEntry;
  const sourceCode = typeof entry.SourceCode === "string" ? entry.SourceCode.trim() : "";

  if (sourceCode.length === 0) {
    return { status: "unverified" };
  }

  const isProxy = entry.Proxy === "1";
  const implementation =
    typeof entry.Implementation === "string" && entry.Implementation.length > 0
      ? entry.Implementation
      : undefined;

  return {
    status: "verified",
    ...(entry.ContractName ? { contractName: entry.ContractName } : {}),
    ...(entry.CompilerVersion ? { compilerVersion: entry.CompilerVersion } : {}),
    isProxy,
    ...(implementation ? { implementation } : {}),
  };
}

export interface FetchVerificationOptions {
  readonly apiKey?: string | undefined;
  /** Injected for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Looks up source-verification status for an address.
 *
 * Degrades to `unknown` with a reason rather than throwing, for every failure mode:
 * no API key, network error, timeout, or a rejected request. A missing explorer key is
 * a reduced-capability mode, not an error -- the address decoding, which is the point
 * of the tool, works without it.
 */
export async function fetchVerification(
  chainId: number,
  address: string,
  options: FetchVerificationOptions = {},
): Promise<VerificationResult> {
  const apiKey = options.apiKey;
  if (!apiKey) {
    return {
      status: "unknown",
      reason:
        "ETHERSCAN_API_KEY is not set, so source verification was not checked. Everything else on this page still works.",
    };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(buildSourceCodeUrl(chainId, address, apiKey), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      return {
        status: "unknown",
        reason: `Block explorer returned HTTP ${response.status}.`,
      };
    }

    return parseSourceCodeResponse(await response.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "Block explorer request timed out."
        : `Block explorer request failed: ${message}`;
    return { status: "unknown", reason };
  } finally {
    clearTimeout(timer);
  }
}
