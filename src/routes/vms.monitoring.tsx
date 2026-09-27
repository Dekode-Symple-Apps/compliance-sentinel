import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  assessVmsCoi, escalateVmsCoi, getVmsMonitor, recordVmsCoi, runVmsScan, startVmsCoiCampaign, uploadVmsRenewal, verifyVmsDocument,
} from "@/lib/vms.functions";
import { CcmsHeader, CARD, TH, TD, useCcmsRole, uploadToStorage } from "@/components/ccms-widgets";
import { DOC_TYPES, coiDates, credentialAlerts, daysTo } from "@/lib/vms";
import { displayName } from "@/lib/ccms";
import { Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vms/monitoring")({
  component: Monitoring,
  head: () => ({ meta: [{ title: "Vendor Management · Monitoring" }] }),
});

const INPUT = "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";

function Monitoring() {
  const [role] = useCcmsRole();
  const qc = useQueryClient();
  const monFn = useServerFn(getVmsMonitor);
  const scanFn = useServerFn(runVmsScan);
  const { data, isLoading } = useQuery({ queryKey: ["vms-monitor"], queryFn: () => monFn() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["vms-monitor"] });
  useEffect(() => { scanFn().then(() => refresh()).catch(() => {}); }, []);
  const [busy, setBusy] = useState(false);
  const run = async (p: () => Promise<unknown>, ok: string) => { setBusy(true); try { await p(); toast.success(ok); refresh(); } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); } };

  const renewFn = useServerFn(uploadVmsRenewal);
  const verifyFn = useServerFn(verifyVmsDocument);
  const startFn = useServerFn(startVmsCoiCampaign);
  const coiFn = useServerFn(recordVmsCoi);
  const assessFn = useServerFn(assessVmsCoi);
  const escFn = useServerFn(escalateVmsCoi);
  const [renew, setRenew] = useState({ vendor_id: "", doc_type: "insurance" });
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const [coiEdit, setCoiEdit] = useState<Record<string, any>>({});
  const year = new Date().getFullYear();

  if (isLoading || !data) return <AppShell><div className="p-10 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div></AppShell>;
  const { vendors, documents, coi } = data as any;
  const active = vendors.filter((v: any) => ["approved", "conditional"].includes(v.status));
  const alerts = credentialAlerts(vendors, documents);
  const pending = documents.filter((d: any) => d.status === "uploaded" && !d.request_id);
  const reDd = active.filter((v: any) => v.dd_valid_until && daysTo(v.dd_valid_until) <= 60);
  const thisYear = coi.filter((c: any) => c.year === year);
  const vname = (id: string) => vendors.find((v: any) => v.id === id)?.name ?? "—";

  return (
    <AppShell>
      <CcmsHeader title="Vendor Management" subtitle="Credential and conflict monitoring (VMS-03)" />
      <div className="p-6 space-y-5 bg-white min-h-full">
        <section className={CARD}>
          <div className="px-4 py-3 border-b border-gray-200"><h2 className="text-sm font-semibold text-gray-900">Expiring and lapsed — {alerts.length}</h2><p className="text-sm text-gray-600">Scanned on opening. A lapsed mandatory credential or due diligence puts the vendor on compliance hold: no new awards, purchase orders or renewals. No grace period.</p></div>
          {alerts.length === 0 ? <p className="p-4 text-sm text-gray-500">Nothing within 60 days.</p> : (
            <table className="w-full"><thead><tr className="border-b border-gray-200"><th className={TH}>When</th><th className={TH}>Vendor</th><th className={TH}>Item</th><th className={TH}>Hold</th></tr></thead><tbody>
              {alerts.map((a, i) => {
                const v = vendors.find((x: any) => x.id === a.vendor_id);
                return (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className={TD + " w-32"}><span className={cn("font-semibold", a.days < 0 || a.days <= 7 ? "text-red-700" : a.days <= 30 ? "text-amber-700" : "text-gray-700")}>{a.days < 0 ? `${-a.days}d overdue` : `${a.days} days`}</span></td>
                    <td className={TD}>{a.vendor}</td><td className={TD}>{a.item}{a.mandatory ? "" : <span className="text-xs text-gray-500"> · not mandatory</span>}</td>
                    <td className={TD}>{v?.compliance_hold ? <span className="text-red-700 font-semibold">On hold</span> : "—"}</td>
                  </tr>
                );
              })}
            </tbody></table>
          )}
        </section>

        <section className={CARD}>
          <div className="px-4 py-3 border-b border-gray-200"><h2 className="text-sm font-semibold text-gray-900">Renewals</h2><p className="text-sm text-gray-600">Upload the renewed licence, policy or certificate; verify it with its new expiry. The old one is kept, superseded, and the hold lifts once everything is current.</p></div>
          <div className="px-4 py-3 space-y-3 text-sm">
            {role === "purchasing_executive" ? (
              <div className="flex flex-wrap items-center gap-2">
                <select className={INPUT} value={renew.vendor_id} onChange={(e) => setRenew({ ...renew, vendor_id: e.target.value })}><option value="">Vendor…</option>{active.concat(vendors.filter((v: any) => v.compliance_hold)).filter((v: any, i: number, arr: any[]) => arr.findIndex((x) => x.id === v.id) === i).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                <select className={INPUT} value={renew.doc_type} onChange={(e) => setRenew({ ...renew, doc_type: e.target.value })}>{DOC_TYPES.filter((d) => d.expires).map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
                <label className={cn("inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 cursor-pointer", (busy || !renew.vendor_id) && "opacity-60 pointer-events-none")}>
                  <Upload className="size-4" /> Upload renewal
                  <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(async () => { const url = await uploadToStorage(`vms/vendor/${renew.vendor_id}`, f); await renewFn({ data: { ...renew, file_name: f.name, file_url: url, acting_role: role } }); }, "Uploaded — verify it below"); e.target.value = ""; }} />
                </label>
              </div>
            ) : <p className="text-gray-500">Switch "Acting as" to Purchasing Executive to upload and verify renewals.</p>}
            {pending.map((d: any) => (
              <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 p-2">
                <span className="font-medium">{vname(d.vendor_id)}</span><span className="text-gray-600">{DOC_TYPES.find((x) => x.id === d.doc_type)?.label}</span>
                <a href={d.file_url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{d.file_name}</a>
                {role === "purchasing_executive" && <>
                  <input type="date" className={INPUT + " ml-auto"} value={expiry[d.id] ?? ""} onChange={(e) => setExpiry({ ...expiry, [d.id]: e.target.value })} />
                  <Button size="sm" disabled={busy} onClick={() => run(() => verifyFn({ data: { document_id: d.id, action: "verify", expiry_date: expiry[d.id] || null, acting_role: role } }), "Verified — expiry rolled forward")}>Verify</Button>
                </>}
              </div>
            ))}
          </div>
        </section>

        <section className={CARD}>
          <div className="px-4 py-3 border-b border-gray-200"><h2 className="text-sm font-semibold text-gray-900">Re-due diligence — due within 60 days</h2></div>
          {reDd.length === 0 ? <p className="p-4 text-sm text-gray-500">None due.</p> : (
            <ul className="divide-y divide-gray-100">{reDd.map((v: any) => (
              <li key={v.id} className="px-4 py-2.5 text-sm flex items-center gap-3"><span className="font-medium">{v.name}</span><span className="text-gray-600">due diligence to {v.dd_valid_until}</span><Link to="/vms/new" className="ml-auto text-blue-700 hover:underline">Start re-due diligence →</Link></li>
            ))}</ul>
          )}
        </section>

        <section className={CARD}>
          <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-3">
            <div><h2 className="text-sm font-semibold text-gray-900">{year} conflict-of-interest declarations</h2><p className="text-sm text-gray-600">Issued 5 January, due 30 January. A declared interest goes to Compliance within 30 days; non-responders are escalated.</p></div>
            <div className="ml-auto flex gap-2">
              {role === "purchasing_manager" || role === "purchasing_executive" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => startFn({ data: { year, acting_role: role } }), "Declarations issued")}>Issue {year} campaign</Button> : null}
              {role === "purchasing_manager" && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => escFn({ data: { year, acting_role: role } }), "Escalated")}>Escalate non-responders</Button>}
            </div>
          </div>
          {thisYear.length === 0 ? <p className="p-4 text-sm text-gray-500">Not issued yet for {year} (due {coiDates(year).due}).</p> : (
            <table className="w-full"><thead><tr className="border-b border-gray-200"><th className={TH}>Vendor</th><th className={TH}>Status</th><th className={TH}>Declaration</th><th className={TH}></th></tr></thead><tbody>
              {thisYear.map((c: any) => {
                const e = coiEdit[c.id] ?? { declared: false, details: "", signatory: "", assessment: "", safeguards: "" };
                const set = (k: string, v: any) => setCoiEdit({ ...coiEdit, [c.id]: { ...e, [k]: v } });
                return (
                  <tr key={c.id} className="border-b border-gray-100 last:border-0 align-top">
                    <td className={TD}>{vname(c.vendor_id)}</td>
                    <td className={TD}><span className={cn(c.status === "escalated" ? "text-red-700 font-semibold" : c.status === "submitted" ? "text-emerald-700" : "text-amber-700")}>{c.status}</span>{c.status === "issued" && <div className="text-xs text-gray-500">due {c.due_date}</div>}</td>
                    <td className={TD}>{c.status === "submitted" ? (c.declared ? <span className="text-red-700">Interest declared — {c.details}{c.compliance_notified_at ? " · Compliance notified" : ""}{c.assessed_at ? ` · assessed by ${displayName(c.assessed_by)}${c.safeguards ? `, safeguards: ${c.safeguards}` : ""}` : ""}</span> : "No interest") : "—"}</td>
                    <td className={TD + " w-[420px]"}>
                      {c.status !== "submitted" && role === "purchasing_executive" && (
                        <div className="flex flex-wrap gap-1.5">
                          <label className="flex items-center gap-1"><input type="checkbox" checked={e.declared} onChange={(x) => set("declared", x.target.checked)} /> declared</label>
                          {e.declared && <input className={INPUT + " w-40"} placeholder="Person, relationship" value={e.details} onChange={(x) => set("details", x.target.value)} />}
                          <input className={INPUT + " w-32"} placeholder="Signed by" value={e.signatory} onChange={(x) => set("signatory", x.target.value)} />
                          <Button size="sm" disabled={busy} onClick={() => run(() => coiFn({ data: { coi_id: c.id, declared: e.declared, details: e.details || null, signatory: e.signatory, acting_role: role } }), "Registered")}>Register</Button>
                        </div>
                      )}
                      {c.status === "submitted" && c.declared && !c.assessed_at && role === "compliance" && (
                        <div className="flex flex-wrap gap-1.5">
                          <input className={INPUT + " w-40"} placeholder="Assessment" value={e.assessment} onChange={(x) => set("assessment", x.target.value)} />
                          <input className={INPUT + " w-40"} placeholder="Safeguards" value={e.safeguards} onChange={(x) => set("safeguards", x.target.value)} />
                          <Button size="sm" disabled={busy} onClick={() => run(() => assessFn({ data: { coi_id: c.id, assessment: e.assessment, safeguards: e.safeguards || null, acting_role: role } }), "Assessed")}>Assess</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody></table>
          )}
        </section>
      </div>
    </AppShell>
  );
}
