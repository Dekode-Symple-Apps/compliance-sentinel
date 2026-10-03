import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { CcmsHeader, CARD, TH, TD, Section } from "@/components/ccms-widgets";
import { APPROVAL_BANDS, CONTRACT_TYPES, LOA_ITEMS, SLA_DAYS, TEMPLATES, templateFile, templateStatus } from "@/lib/ccms";
import { Download, Search } from "lucide-react";

export const Route = createFileRoute("/ccms/templates/")({
  component: Templates,
  head: () => ({ meta: [{ title: "Commercial CMS · Templates" }] }),
});

function Templates() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return TEMPLATES.filter((t) => (type === "all" || t.contractTypes.includes(type)) &&
      (!needle || [t.code, t.title, t.owner].some((v) => v.toLowerCase().includes(needle))));
  }, [q, type]);
  const uncovered = Object.entries(CONTRACT_TYPES).filter(([k, v]) => v.side === "vendor" && !v.repositoryOnly && !TEMPLATES.some((t) => t.contractTypes.includes(k)));

  return (
    <AppShell>
      <CcmsHeader subtitle="Template library" />
      <div className="p-6 space-y-4 bg-white min-h-full">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm">
              <option value="all">All Contract Types</option>
              {Object.entries(CONTRACT_TYPES).filter(([, v]) => !v.repositoryOnly).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5">
              <Search className="size-4 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, title, owner" className="w-64 text-sm focus:outline-none" />
            </div>
          </div>

          <div className={CARD}>
            {rows.length === 0 ? <p className="p-6 text-sm text-gray-500">No templates.</p> : (
              <table className="w-full">
                <thead><tr className="border-b border-gray-200">
                  <th className={TH}>Code</th><th className={TH}>Template</th><th className={TH}>Contract Type</th><th className={TH}>Version</th>
                  <th className={TH}>Effective</th><th className={TH}>Clauses</th><th className={TH}>Status</th><th className={TH}></th>
                </tr></thead>
                <tbody>
                  {rows.map((t) => {
                    const st = templateStatus(t.status);
                    const locked = t.clauses.filter((c) => c.locked).length;
                    return (
                      <tr key={t.id} onClick={() => nav({ to: "/ccms/templates/$templateId", params: { templateId: t.id } })}
                        className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                        <td className={TD + " whitespace-nowrap"}><Link to="/ccms/templates/$templateId" params={{ templateId: t.id }} onClick={(e) => e.stopPropagation()} className="font-medium text-blue-700 hover:underline">{t.code}</Link></td>
                        <td className={TD}><div className="font-medium">{t.title}</div><div className="text-sm text-gray-600">{t.owner}</div></td>
                        <td className={TD}>{t.contractTypes.map((k) => CONTRACT_TYPES[k]?.label).join(", ")}</td>
                        <td className={TD}>v{t.version}</td>
                        <td className={TD + " whitespace-nowrap"}>{t.effectiveDate}</td>
                        <td className={TD}>{t.clauses.length}{locked ? <span className="text-gray-500"> · {locked} locked</span> : null}</td>
                        <td className={TD}><span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span></td>
                        <td className={TD + " text-right"} onClick={(e) => e.stopPropagation()}>
                          <Button asChild size="sm" variant="outline" className="gap-1.5"><a href={templateFile(t)} download><Download className="size-4" /> .docx</a></Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {uncovered.length > 0 && type === "all" && !q && (
            <p className="text-sm text-gray-500">No template: {uncovered.map(([, v]) => v.label).join(", ")} — reviewed as non-standard.</p>
          )}

          <Section title="Approval Rules" summary="Approval matrix, service levels, Letter of Award items">
            <div className="grid md:grid-cols-2">
              <div className="p-4 border-b md:border-b-0 md:border-r border-gray-200">
                <div className="text-sm font-semibold text-gray-900">Approval matrix</div>
                <table className="w-full mt-2"><tbody>
                  {APPROVAL_BANDS.map((b) => (
                    <tr key={b.label} className="border-b border-gray-100 last:border-0"><td className="py-1.5 text-sm text-gray-700">Up to {Number.isFinite(b.upToMyr) ? `RM${b.upToMyr.toLocaleString()}` : "any amount"}</td><td className="py-1.5 text-sm font-medium text-gray-900">{b.label}</td></tr>
                  ))}
                </tbody></table>
                <p className="mt-2 text-sm text-gray-600">Related party: Audit & Risk Management Committee, then non-interested Board. IT service: Legal, then Board.</p>
                <div className="mt-3 text-sm font-semibold text-gray-900">Service levels · working days</div>
                <p className="text-sm text-gray-700">Contract Executive {SLA_DAYS.contract_executive} · Legal {SLA_DAYS.legal} · Finance {SLA_DAYS.finance} · Approval {SLA_DAYS.approval}</p>
                <p className="mt-3 text-xs text-gray-500">Placeholders pending Lim Seong Hai's approval matrix.</p>
              </div>
              <div className="p-4">
                <div className="text-sm font-semibold text-gray-900">Letter of Award · mandatory items</div>
                <ol className="mt-2 list-decimal pl-5 space-y-0.5">{LOA_ITEMS.map((i) => <li key={i.id} className="text-sm text-gray-800">{i.label} <span className="text-gray-500">— {i.hint}</span></li>)}</ol>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </AppShell>
  );
}
