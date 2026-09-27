import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { listAmsAssets } from "@/lib/ams.functions";
import { CcmsHeader, CARD, TH, TD } from "@/components/ccms-widgets";
import { ASSET_STATE_LABEL, assetAlerts, assetCompliance, classById, itemStatus, ITEM_STATUS_LABEL } from "@/lib/ams";
import { Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ams/")({
  component: AmsDashboard,
  head: () => ({ meta: [{ title: "Asset Monitoring · Dashboard" }] }),
});


function AmsDashboard() {
  const listFn = useServerFn(listAmsAssets);
  const { data, isLoading } = useQuery({ queryKey: ["ams-assets"], queryFn: () => listFn() });
  const [report, setReport] = useState<"alerts" | "machinery">("alerts");
  const assets: any[] = data?.assets ?? [];
  const items: any[] = data?.items ?? [];
  const states = useMemo(() => Object.fromEntries(assets.map((a) => [a.id, assetCompliance(items.filter((i) => i.asset_id === a.id))])), [assets, items]);
  const alerts = assetAlerts(assets, items);
  const cert = items.filter((i) => ["cf_pma", "cf_pmt", "cf_pmd", "cf_confirm", "dosh_reg"].includes(i.requirement) && i.applicable);
  const count = (s: string) => Object.values(states).filter((x: any) => x.state === s).length;

  return (
    <AppShell>
      <CcmsHeader title="Asset Monitoring" subtitle="Class-driven compliance, verified evidence, deployment control"
        action={<Button asChild className="gap-1.5"><Link to="/ams/new"><Plus className="size-4" /> Register asset</Link></Button>} />
      <div className="p-6 space-y-6 bg-white min-h-full">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[["Assets", assets.length, false], ["Compliant", count("compliant"), false], ["Due soon", count("due_soon"), true], ["Overdue", count("overdue"), true], ["Compliance hold", count("hold"), true]].map(([l, v, al]: any) => (
            <div key={l} className={CARD + " p-4"}><div className="text-sm text-gray-600">{l}</div><div className={"mt-1 text-2xl font-semibold " + (al && v ? "text-red-700" : "text-gray-900")}>{isLoading ? "…" : v}</div></div>
          ))}
        </div>

        <div className="flex gap-2">
          {([["alerts", "Alerts and escalations"], ["machinery", "Master Machinery Certification List"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setReport(k)} className={cn("rounded-md border px-3 py-1.5 text-sm", report === k ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>{l}</button>
          ))}
        </div>

        {report === "alerts" ? (
          <section className={CARD}>
            <div className="px-4 py-3 border-b border-gray-200"><h2 className="text-sm font-semibold text-gray-900">Alerts · {alerts.length}</h2><p className="text-sm text-gray-600">Insurance 30 days, road tax 15, PUSPAKOM 14, certificate of fitness 30, calibration 30. Overdue more than 3 days escalates to the Head of Department.</p></div>
            {alerts.length === 0 ? <p className="p-4 text-sm text-gray-500">Nothing due.</p> : (
              <table className="w-full"><thead><tr className="border-b border-gray-200"><th className={TH}>When</th><th className={TH}>Asset</th><th className={TH}>Item</th><th className={TH}>Owner</th><th className={TH}>Escalation</th></tr></thead><tbody>
                {alerts.map((a, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className={TD + " w-32"}><span className={cn("font-semibold", a.overdue ? "text-red-700" : a.days <= 7 ? "text-amber-700" : "text-gray-700")}>{a.overdue ? `${-a.days}d overdue` : `${a.days} days`}</span></td>
                    <td className={TD}><Link to="/ams/$assetId" params={{ assetId: a.asset_id }} className="text-blue-700 hover:underline">{a.asset}</Link></td>
                    <td className={TD}>{a.item}</td><td className={TD}>{a.owner}</td>
                    <td className={TD}>{a.escalated ? <span className="text-gray-700">Recorded</span> : a.escalate ? <span className="text-red-700 font-semibold">Head of Department to act</span> : "—"}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </section>
        ) : (
          <section className={CARD}>
            <div className="px-4 py-3 border-b border-gray-200"><h2 className="text-sm font-semibold text-gray-900">Master Machinery Certification List</h2></div>
            <table className="w-full"><thead><tr className="border-b border-gray-200"><th className={TH}>Asset</th><th className={TH}>Class</th><th className={TH}>Item</th><th className={TH}>Reference</th><th className={TH}>Valid to</th><th className={TH}>Status</th></tr></thead><tbody>
              {cert.map((i) => {
                const a = assets.find((x) => x.id === i.asset_id);
                const st = itemStatus(i);
                return (
                  <tr key={i.id} className="border-b border-gray-100 last:border-0">
                    <td className={TD}><Link to="/ams/$assetId" params={{ assetId: a.id }} className="text-blue-700 hover:underline">{a.asset_code}</Link> {a.name}</td>
                    <td className={TD}>{classById(a.asset_class)?.label}</td><td className={TD}>{i.label}</td><td className={TD}>{i.reference ?? "—"}</td><td className={TD}>{i.expiry_date ?? "—"}</td>
                    <td className={TD}><span className={cn(st === "expired" ? "text-red-700 font-semibold" : st === "expiring" ? "text-amber-700" : st === "compliant" ? "text-emerald-700" : "text-gray-600")}>{ITEM_STATUS_LABEL[st]}</span></td>
                  </tr>
                );
              })}
            </tbody></table>
          </section>
        )}

        <section className={CARD}>
          <div className="px-4 py-3 border-b border-gray-200 flex items-center"><h2 className="text-sm font-semibold text-gray-900">On compliance hold</h2><Link to="/ams/assets" className="ml-auto text-sm text-blue-700 hover:underline">Register →</Link></div>
          <ul className="divide-y divide-gray-100">
            {assets.filter((a) => states[a.id]?.state === "hold").map((a) => (
              <li key={a.id} className="px-4 py-2.5 text-sm"><Link to="/ams/$assetId" params={{ assetId: a.id }} className="font-medium text-blue-700 hover:underline">{a.asset_code}</Link> {a.name} <span className="text-red-700">— {states[a.id].reasons.join("; ")}</span></li>
            ))}
            {count("hold") === 0 && <li className="px-4 py-3 text-sm text-gray-500">None. {ASSET_STATE_LABEL.hold} blocks deployment and new assignments.</li>}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
