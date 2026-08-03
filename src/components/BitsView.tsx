import type { DecodedHook } from "@/lib/decode";
import { PERMISSIONS } from "@/lib/flags";

/**
 * Shows the raw masked bits and lines them up with the address suffix they came from.
 *
 * This is the "show your working" panel: the whole premise of v4 hooks is that the
 * permission set IS the address, and seeing the last hex characters light up next to
 * the bit string is what makes that click.
 */
export function BitsView({ decoded }: { decoded: DecodedHook }) {
  const suffix = decoded.address.slice(-4);
  const prefix = decoded.address.slice(0, -4);

  return (
    // min-w-0 lets this shrink when it is a grid item; see HookResults.
    <section aria-labelledby="bits-heading" className="min-w-0 space-y-3">
      <h2 id="bits-heading" className="text-lg font-semibold">
        Raw masked bits
      </h2>

      <div className="space-y-4 rounded-xl border border-ink-700 bg-ink-900/60 p-4">
        <div>
          <p className="mb-2 text-xs tracking-wide text-ink-400 uppercase">
            address &amp; ALL_HOOK_MASK (0x3fff)
          </p>
          <p className="font-mono text-sm break-all">
            <span className="text-ink-600">{prefix}</span>
            <span className="rounded bg-hook-pink/20 px-1 font-semibold text-hook-soft">
              {suffix}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-ink-400">
            Only the highlighted characters matter. The lowest 14 bits carry the permissions;
            everything above them is ignored.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-400">Hex</dt>
            <dd className="tnum font-mono text-sm text-ink-100">{decoded.maskedHex}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Decimal</dt>
            <dd className="tnum font-mono text-sm text-ink-100">{decoded.maskedDecimal}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Active</dt>
            <dd className="tnum font-mono text-sm text-ink-100">{decoded.activeCount} / 14</dd>
          </div>
        </dl>

        {/*
          No min-width. A table cannot shrink below its own min-content width, and the
          longest cell (`afterRemoveLiquidityReturnDelta`) is one unbreakable token, so
          the natural floor is already correct and adapts if the labels change. A hard
          min-width was previously wider than the content and forced a scrollbar that
          served no purpose. `whitespace-nowrap` on the headers keeps multi-word labels
          on one line so that floor stays honest.
        */}
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full border-collapse">
            <caption className="sr-only">
              Each of the 14 permission bits, its index, value, and meaning
            </caption>
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-ink-400 uppercase">
                <th scope="col" className="pb-1 font-medium whitespace-nowrap">
                  Bit
                </th>
                <th scope="col" className="pb-1 font-medium whitespace-nowrap">
                  Value
                </th>
                <th scope="col" className="pb-1 font-medium whitespace-nowrap">
                  Mask
                </th>
                <th scope="col" className="pb-1 font-medium whitespace-nowrap">
                  Permission
                </th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs">
              {PERMISSIONS.map((meta) => {
                const active = decoded.permissions[meta.key];
                return (
                  <tr
                    key={meta.key}
                    className={`border-t border-ink-800 ${active ? "" : "text-ink-600"}`}
                  >
                    <td className="tnum py-1 pr-3">{meta.bit}</td>
                    <td
                      className={`tnum py-1 pr-3 font-semibold ${active ? "text-hook-soft" : ""}`}
                    >
                      {active ? "1" : "0"}
                    </td>
                    <td className="tnum py-1 pr-3 text-ink-400">
                      0x{meta.flag.toString(16).padStart(4, "0")}
                    </td>
                    <td className={`py-1 ${active ? "text-ink-100" : ""}`}>{meta.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <p className="mb-1 text-xs tracking-wide text-ink-400 uppercase">
            Binary (bit 13 → bit 0)
          </p>
          <p className="tnum font-mono text-base break-all">
            {decoded.maskedBinary.split("").map((bit, i) => (
              <span key={i} className={bit === "1" ? "font-bold text-hook-soft" : "text-ink-600"}>
                {bit}
              </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  );
}
