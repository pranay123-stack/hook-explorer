import type { InspectSuccess } from "@/lib/api-types";
import { PROXY_SLOT_LABELS, type ProxySlotName } from "@/lib/proxy";
import type { DecodedHook } from "@/lib/decode";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-ink-800 py-2 first:border-t-0">
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="text-right text-sm break-all text-ink-100">{children}</dd>
    </div>
  );
}

function Status({ tone, children }: { tone: "good" | "bad" | "warn"; children: React.ReactNode }) {
  const cls =
    tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-amber-300";
  return <span className={`font-medium ${cls}`}>{children}</span>;
}

/** On-chain facts: bytecode presence, proxy indicators, and verification status. */
export function OnchainPanel({ data, decoded }: { data: InspectSuccess; decoded: DecodedHook }) {
  const { onchain, verification } = data;
  const proxySlots = Object.entries(onchain.proxy.slots) as [ProxySlotName, string][];

  return (
    <section aria-labelledby="onchain-heading" className="space-y-3">
      <h2 id="onchain-heading" className="text-lg font-semibold">
        On-chain state
      </h2>

      {onchain.error ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          {onchain.error} Permission decoding below is unaffected — it is derived from the address
          alone and needs no RPC.
        </p>
      ) : null}

      <dl className="rounded-xl border border-ink-700 bg-ink-900/60 px-4 py-2">
        <Row label="Deployed bytecode">
          {onchain.error ? (
            <span className="text-ink-400">unknown</span>
          ) : onchain.hasBytecode ? (
            <Status tone="good">
              yes <span className="tnum text-ink-400">({onchain.bytecodeSize} bytes)</span>
            </Status>
          ) : (
            <Status tone="bad">none — no contract at this address</Status>
          )}
        </Row>

        <Row label="Source verified">
          {verification.status === "verified" ? (
            <Status tone="good">
              yes{verification.contractName ? ` — ${verification.contractName}` : ""}
            </Status>
          ) : verification.status === "unverified" ? (
            <Status tone="warn">no</Status>
          ) : (
            <span className="text-ink-400">not checked</span>
          )}
        </Row>

        {verification.compilerVersion ? (
          <Row label="Compiler">
            <span className="font-mono text-xs">{verification.compilerVersion}</span>
          </Row>
        ) : null}

        <Row label="Proxy pattern">
          {onchain.proxy.isProxy ? (
            <Status tone="warn">detected</Status>
          ) : onchain.error ? (
            <span className="text-ink-400">unknown</span>
          ) : (
            <Status tone="good">none detected</Status>
          )}
        </Row>

        {proxySlots.map(([slot, target]) => (
          <Row key={slot} label={PROXY_SLOT_LABELS[slot]}>
            <code className="font-mono text-xs">{target}</code>
          </Row>
        ))}

        {onchain.proxy.minimalProxyTarget ? (
          <Row label="EIP-1167 target">
            <code className="font-mono text-xs">{onchain.proxy.minimalProxyTarget}</code>
          </Row>
        ) : null}

        <Row label="Valid hook address">
          {decoded.validity.violations.length > 0 ? (
            <Status tone="bad">no — invalid flag combination</Status>
          ) : decoded.validity.requiresDynamicFee ? (
            <Status tone="warn">dynamic-fee pools only</Status>
          ) : (
            <Status tone="good">yes</Status>
          )}
        </Row>
      </dl>

      {verification.status === "unknown" && verification.reason ? (
        <p className="text-xs text-ink-400">{verification.reason}</p>
      ) : null}

      <a
        href={data.explorerUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1 text-xs text-hook-soft underline underline-offset-2 hover:text-hook-pink"
      >
        View on block explorer ↗
      </a>
    </section>
  );
}
