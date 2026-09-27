import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { getVmsMonitor, listVmsRequests, runVmsScan } from "@/lib/vms.functions";
import { CcmsHeader, CARD, TH, TD } from "@/components/ccms-widgets";
import { VMS_STATUS, credentialAlerts } from "@/lib/vms";
import { Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vms/")({
  component: VmsDashboard,
  head: () => ({ meta: [{ title: "Vendor Management · Dashboard" }] }),
});

function VmsDashboard() {
  const listFn = useServerFn(listVmsRequests);
  const monFn = useServerFn(getVmsMonitor);
  const scanFn = useServerFn(runVmsScan);
  const { data: reqs = [], isLoading } = useQuery({ queryKey: ["vms-requests"], queryFn: () => listFn() });
  const { data: mon, refetch } = useQuery({ queryKey: ["vms-monitor"], queryFn: () => monFn() });
  // The daily scan, run on opening: holds applied or released as credentials lapse or renew.
  useEffect(() => { scanFn().then((r: any) => { if (r?.held) refetch(); }).catch(() => {}); }, []);

  const open = reqs.filter((r: any) => !["approved", "conditional", "rejected"].includes(r.status));
  const alerts = mon ? credentialAlerts(mon.vendors, mon.documents) : [];
  const holds = (mon?.vendors ?? []).filter((v: any) => v.compliance_hold);
  const year = new Date().getFullYear();
  const coi = (mon?.coi ?? []).filter((c: any) => c.year === year);
  const stat = [
    { label: "Open requests", value: open.length },
    { label: "Awaiting vendor", value: reqs.filter((r: any) => r.status === "invited" || r.status === "returned").length },
    { label: "With Compliance", value: reqs.filter((r: any) => r.status === "compliance").length },
    { label: "Credentials expiring (60 days)", value: alerts.filter((a) => a.days >= 0).length, alert: true },
    { label: "On compliance hold", value: holds.length, alert: true },
  ];

  return (
    <AppShell>
      <CcmsHeader title="Vendor Management" subtitle="Onboarding, subcontractor pre-qualification, credential and conflict monitoring"
        action={<Button asChild className="gap-1.5"><Link to="/vms/new"><Plus className="size-4" /> New request</Link></Button>} />
      <div className="p-6 space-y-6 bg-white min-h-full">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stat.map((s) => (
            <div key={s.label} className={CARD + " p-4"}>
              <div className="text-sm text-gray-600">{s.label}</div>
              <div className={"mt-1 text-2xl font-semibold " + (s.alert && s.value ? "text-red-700" : "text-gray-900")}>{isLoading ? "…" : s.value}</div>
            </div>
          ))}
        </div>

        {holds.length > 0 && (
          <section className={CARD}>
            <div className="px-4 py-3 border-b border-gray-200"><h2 className="text-sm font-semibold text-gray-900">On compliance hold — no new awards, POs or renewals</h2></div>
            <ul className="divide-y divide-gray-100">{holds.map((v: any) => <li key={v.id} className="px-4 py-2.5 text-sm"><span className="font-medium text-gray-900">{v.name}</span> <span className="text-red-700">— {v.hold_reason}</span></li>)}</ul>
          </section>
        )}

        <section className={CARD}>
          <div className="px-4 py-3 border-b border-gray-200 flex items-center">
            <div><h2 className="text-sm font-semibold text-gray-900">Credential alerts</h2><p className="text-sm text-gray-600">At 60, 30 and 7 days, then daily once lapsed.</p></div>
            <Link to="/vms/monitoring" className="ml-auto text-sm text-blue-700 hover:underline">Monitoring →</Link>
          </div>
          {alerts.length === 0 ? <p className="p-4 text-sm text-gray-500">Nothing due in the next 60 days.</p> : (
            <table className="w-full"><tbody>
              {alerts.slice(0, 10).map((a, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className={TD + " w-28"}><span className={cn("font-semibold", a.stage === "overdue" || a.stage === "7" ? "text-red-700" : a.stage === "30" ? "text-amber-700" : "text-gray-700")}>{a.days < 0 ? `${-a.days}d overdue` : `${a.days} days`}</span></td>
                  <td className={TD}>{a.vendor}</td><td className={TD}>{a.item}{a.mandatory && <span className="text-xs text-gray-500"> · mandatory</span>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </section>

        <section className={CARD}>
          <div className="px-4 py-3 border-b border-gray-200 flex items-center">
            <h2 className="text-sm font-semibold text-gray-900">Open requests</h2>
            <Link to="/vms/requests" className="ml-auto text-sm text-blue-700 hover:underline">All requests →</Link>
          </div>
          {isLoading ? <div className="p-4 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            : open.length === 0 ? <p className="p-4 text-sm text-gray-500">None.</p> : (
              <table className="w-full"><thead><tr className="border-b border-gray-200"><th className={TH}>Reference</th><th className={TH}>Vendor</th><th className={TH}>Type</th><th className={TH}>Status</th></tr></thead><tbody>
                {open.slice(0, 10).map((r: any) => (
                  <tr key={r.id} className="border-b border-gray-100 last:border-0">
                    <td className={TD}><Link to="/vms/$requestId" params={{ requestId: r.id }} className="font-medium text-blue-700 hover:underline">{r.reference_number}</Link></td>
                    <td className={TD}>{r.company_name}</td><td className={TD}>{r.kind === "subcontractor" ? "Subcontractor pre-qualification" : "Onboarding"}</td>
                    <td className={TD}><span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", VMS_STATUS[r.status]?.tone)}>{VMS_STATUS[r.status]?.label ?? r.status}</span></td>
                  </tr>
                ))}
              </tbody></table>
            )}
        </section>

        <section className={CARD + " p-4 text-sm"}>
          <div className="font-semibold text-gray-900">{year} conflict-of-interest declarations</div>
          <p className="text-gray-700 mt-1">{coi.length ? `${coi.filter((c: any) => c.status === "submitted").length} of ${coi.length} registered · ${coi.filter((c: any) => c.declared).length} declared an interest · ${coi.filter((c: any) => c.status === "escalated").length} escalated` : "Campaign not started (issued 5 January, due 30 January)."}</p>
        </section>
      </div>
    </AppShell>
  );
}
