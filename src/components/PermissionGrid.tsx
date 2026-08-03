import type { DecodedHook } from "@/lib/decode";

const GROUP_ACCENT: Record<string, string> = {
  initialize: "text-sky-300",
  liquidity: "text-emerald-300",
  swap: "text-hook-soft",
  donate: "text-amber-300",
  returnDelta: "text-violet-300",
};

/**
 * The 14 permissions, grouped by lifecycle stage. Inactive permissions are shown
 * greyed rather than hidden -- knowing what a hook explicitly cannot do is as useful
 * as knowing what it can.
 */
export function PermissionGrid({ decoded }: { decoded: DecodedHook }) {
  return (
    <section aria-labelledby="permissions-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="permissions-heading" className="text-lg font-semibold">
          Hook permissions
        </h2>
        <p className="text-sm text-ink-400">
          <span className="tnum font-medium text-ink-100">{decoded.activeCount}</span> of 14 active
        </p>
      </div>

      {/* items-start: without it every card stretches to the tallest in its row, which
          left large empty voids under the short groups (Initialize, Donate). */}
      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {decoded.groups.map((group) => (
          <div key={group.group} className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3
                className={`text-sm font-semibold tracking-wide uppercase ${GROUP_ACCENT[group.group] ?? "text-ink-300"}`}
              >
                {group.label}
              </h3>
              <span className="tnum shrink-0 rounded-md bg-ink-800 px-1.5 py-0.5 text-xs text-ink-300">
                {group.activeCount}/{group.cells.length}
              </span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-ink-400">{group.description}</p>

            <ul className="space-y-1.5">
              {group.cells.map(({ meta, active }) => (
                <li key={meta.key}>
                  <div
                    className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${
                      active ? "bg-ink-800/80" : "opacity-40"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        active ? "bg-hook-pink" : "border border-ink-600 bg-transparent"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <code className="truncate font-mono text-[13px] text-ink-100">
                          {meta.label}
                        </code>
                        <span className="tnum shrink-0 font-mono text-[11px] text-ink-400">
                          bit {meta.bit}
                        </span>
                      </div>
                      <span className="sr-only">{active ? "active" : "not active"}</span>
                      {active ? (
                        <p className="mt-0.5 text-[11px] leading-snug text-ink-400">
                          {meta.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
