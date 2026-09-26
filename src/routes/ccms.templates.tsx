import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { CcmsHeader, CARD, TH, TD } from "@/components/ccms-widgets";
import { APPROVAL_BANDS, CONTRACT_TYPES, LOA_ITEMS, SLA_DAYS, TEMPLATES, templateFile } from "@/lib/ccms";
import { Download, Lock, ChevronDown, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/ccms/templates")({
  component: Templates,
  head: () => ({ meta: [{ title: "Commercial CMS · Templates" }] }),
});

function Templates() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <AppShell>
      <CcmsHeader subtitle="Approved templates and the rules drafts are checked against" />
      <div className="p-6 space-y-6 bg-white min-h-full max-w-6xl">
        {TEMPLATES.map((t) => (
          <section key={t.id} className={CARD}>
            <div className="px-4 py-3 border-b border-gray-200 flex items-start gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{t.code} · {t.title}</h2>
                <p className="text-sm text-gray-600">Version {t.version} · {t.effectiveDate} · {t.owner} · <span className="text-amber-700">{t.status}</span></p>
                <p className="text-sm text-gray-600">Used for: {t.contractTypes.map((k) => CONTRACT_TYPES[k]?.label).join(", ")}</p>
              </div>
              <Button asChild variant="outline" className="ml-auto gap-1.5"><a href={templateFile(t)} download><Download className="size-4" /> Word template</a></Button>
            </div>
            <p className="px-4 pt-3 text-sm text-gray-800">{t.usageNote}</p>
            <table className="w-full mt-2">
              <thead><tr className="border-y border-gray-200"><th className={TH}>Clause</th><th className={TH}>Status</th><th className={TH}>Approved position</th></tr></thead>
              <tbody>
                {t.clauses.map((c) => (
                  <Fragment key={c.id}>
                    <tr className="border-b border-gray-100 cursor-pointer" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <td className={TD + " w-72"}><span className="inline-flex items-center gap-1 font-medium">{open === c.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}{c.number}. {c.title}</span></td>
                      <td className={TD + " w-32"}>{c.locked ? <span className="inline-flex items-center gap-1 font-semibold text-red-800"><Lock className="size-3.5" /> Locked</span> : c.mandatory ? "Mandatory" : <span className="text-gray-500">Optional</span>}</td>
                      <td className={TD + " text-gray-700"}>{c.keyPosition}</td>
                    </tr>
                    {open === c.id && (
                      <tr className="border-b border-gray-100">
                        <td colSpan={3} className="px-10 py-3 space-y-2">{c.paragraphs.map((p, i) => <p key={i} className="text-sm text-gray-800">{p}</p>)}</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-gray-200">
              <div className="text-sm font-semibold text-gray-900">Assumptions to confirm before adoption</div>
              <ul className="mt-1 list-disc pl-5 text-sm text-gray-700 space-y-0.5">{t.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          </section>
        ))}

        <section className={CARD}>
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900">Working assumptions</h2>
            <p className="text-sm text-gray-600">Placeholders until Lim Seong Hai provides its own. Each is one edit in <code className="text-xs">src/lib/ccms.ts</code>.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-0">
            <div className="p-4 border-b md:border-b-0 md:border-r border-gray-200">
              <div className="text-sm font-semibold text-gray-900">Approval matrix (by value in ringgit)</div>
              <table className="w-full mt-2"><tbody>
                {APPROVAL_BANDS.map((b) => (
                  <tr key={b.label} className="border-b border-gray-100 last:border-0"><td className="py-1.5 text-sm text-gray-700">Up to {Number.isFinite(b.upToMyr) ? `RM${b.upToMyr.toLocaleString()}` : "any amount"}</td><td className="py-1.5 text-sm font-medium text-gray-900">{b.label}</td></tr>
                ))}
              </tbody></table>
              <p className="mt-2 text-sm text-gray-600">Related-party transactions: Audit & Risk Management Committee, then the non-interested Board. IT service agreements: Legal, then the Board.</p>
              <div className="mt-3 text-sm font-semibold text-gray-900">Service levels (working days)</div>
              <p className="text-sm text-gray-700">Contract Executive {SLA_DAYS.contract_executive} · Legal {SLA_DAYS.legal} · Finance {SLA_DAYS.finance} · each approval stage {SLA_DAYS.approval}</p>
            </div>
            <div className="p-4">
              <div className="text-sm font-semibold text-gray-900">Letter of Award — 12 mandatory items</div>
              <ol className="mt-2 list-decimal pl-5 space-y-0.5">{LOA_ITEMS.map((i) => <li key={i.id} className="text-sm text-gray-800">{i.label} <span className="text-gray-500">— {i.hint}</span></li>)}</ol>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
