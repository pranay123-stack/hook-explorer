import type { PoolRecord } from "./pools";
import type { RiskFinding, Severity } from "./risk";
import type { ProxySlotName } from "./proxy";

/** Serialisable proxy summary sent to the client. */
export interface ProxySummary {
  readonly isProxy: boolean;
  readonly slots: Partial<Record<ProxySlotName, string>>;
  readonly minimalProxyTarget?: string;
  readonly implementation?: string;
}

export interface InspectSuccess {
  readonly ok: true;
  readonly address: string;
  readonly chain: string;
  readonly chainId: number;
  readonly explorerUrl: string;
  readonly onchain: {
    readonly hasBytecode: boolean;
    readonly bytecodeSize: number;
    readonly proxy: ProxySummary;
    /** Present when the RPC could not be reached; everything else still renders. */
    readonly error?: string;
  };
  readonly verification: {
    readonly status: "verified" | "unverified" | "unknown";
    readonly contractName?: string;
    readonly compilerVersion?: string;
    readonly reason?: string;
  };
  readonly risk: {
    readonly findings: readonly RiskFinding[];
    readonly highestSeverity: Severity | null;
    readonly counts: Record<Severity, number>;
  };
}

export interface ApiError {
  readonly ok: false;
  readonly error: string;
  readonly code: string;
}

export type InspectResponse = InspectSuccess | ApiError;

export interface PoolsSuccess {
  readonly ok: true;
  readonly address: string;
  readonly chain: string;
  readonly poolManager: string;
  readonly pools: readonly PoolRecord[];
  readonly scannedFrom: string;
  readonly scannedTo: string;
  readonly chunksScanned: number;
  readonly chunksFailed: number;
  readonly truncated: boolean;
  readonly hitResultLimit: boolean;
}

export type PoolsResponse = PoolsSuccess | ApiError;
