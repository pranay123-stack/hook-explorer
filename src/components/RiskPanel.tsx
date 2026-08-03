import type { RiskFinding, Severity } from "@/lib/risk";

const SEVERITY_STYLES: Record<Severity, { chip: string; border: string; label: string }> = {
  critical: {
    chip: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
    border: "border-red-500/30",
    label: "Critical",
  },
  high: {
    chip: "bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30",
    border: "border-orange-500/30",
    label: "High",
  },
  medium: {
    chip: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
    border: "border-amber-500/25",
    label: "Medium",
  },
  low: {
    chip: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30",
    border: "border-sky-500/25",
    label: "Low",
  },
  info: {
    chip: "bg-ink-700 text-ink-300 ring-1 ring-ink-600",
    border: "border-ink-700",
    label: "Info",
  },
};

export function SeverityChip({ severity }: { severity: Severity }) {
  const style = SEVERITY_STYLES[severity];
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${style.chip}`}
    >
      {style.label}
    </span>
  );
}

/**
 * Risk findings, most severe first.
 *
 * The disclaimer is deliberately prominent and non-dismissable. These are pattern
 * checks over address bits and bytecode -- several of them fire on entirely legitimate
 * hooks by design, because a custom-curve hook genuinely does hold the power to change
 * swap amounts. Presenting this as anything close to an audit verdict would be worse
 * than showing nothing.
 */
export function RiskPanel({
  findings,
  highestSeverity,
}: {
  findings: readonly RiskFinding[];
  highestSeverity: Severity | null;
}) {
  return (
    <section aria-labelledby="risk-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="risk-heading" className="text-lg font-semibold">
          Risk heuristics
        </h2>
        {highestSeverity ? (
          <div className="flex items-center gap-2 text-sm text-ink-400">
            <span>Highest:</span>
            <SeverityChip severity={highestSeverity} />
          </div>
        ) : null}
      </div>

      <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-200/90">
        <strong className="font-semibold">These are heuristics, not an audit.</strong> They are
        pattern checks over the address bits, deployed bytecode, and explorer metadata. Many
        legitimate hooks trip these flags by design — holding a returns-delta permission is exactly
        how custom curves work. A hook can pass every check here and still be malicious. Read the
        source before trusting a hook with funds.
      </p>

      {findings.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
          <p className="text-sm text-emerald-200">
            No heuristic flags raised. The hook is deployed, its source is verified, it shows no
            proxy indicators, and it holds no permission that lets it alter swap or liquidity
            amounts.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {findings.map((finding) => {
            const style = SEVERITY_STYLES[finding.severity];
            return (
              <li
                key={`${finding.code}-${finding.title}`}
                className={`rounded-xl border bg-ink-900/60 p-4 ${style.border}`}
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <SeverityChip severity={finding.severity} />
                  <h3 className="text-sm font-semibold text-ink-100">{finding.title}</h3>
                  {!finding.heuristic ? (
                    <span
                      className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] tracking-wide text-ink-400 uppercase"
                      title="Mechanically verifiable, not a guess"
                    >
                      Verified fact
                    </span>
                  ) : null}
                </div>
                <p className="text-xs leading-relaxed text-ink-300">{finding.detail}</p>
                <p className="mt-2 border-l-2 border-ink-700 pl-2 text-xs leading-relaxed text-ink-400">
                  <span className="font-medium text-ink-300">What to check: </span>
                  {finding.guidance}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
