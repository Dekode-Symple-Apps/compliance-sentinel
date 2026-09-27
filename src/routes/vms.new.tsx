import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { createVmsRequest } from "@/lib/vms.functions";
import { listVmsVendors } from "@/lib/vms.functions";
import { CcmsHeader, CARD, useCcmsRole } from "@/components/ccms-widgets";
import { VENDOR_CATEGORIES, docsFor } from "@/lib/vms";
import { LSH_ENTITIES } from "@/lib/ccms";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/vms/new")({
  component: NewVmsRequest,
  head: () => ({ meta: [{ title: "Vendor Management · New request" }] }),
});

const LABEL = "block text-sm font-medium text-gray-800 mb-1";
const INPUT = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";

function NewVmsRequest() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [role] = useCcmsRole();
  const createFn = useServerFn(createVmsRequest);
  const vendorsFn = useServerFn(listVmsVendors);
  const { data: vendors = [] } = useQuery({ queryKey: ["vms-vendors"], queryFn: () => vendorsFn() });
  const [kind, setKind] = useState<"onboarding" | "subcontractor" | "redd">("onboarding");
  const [f, setF] = useState<any>({ company_name: "", registration_no: "", entity: LSH_ENTITIES[1], category: "supplier_material", goods_services: "", justification: "", annual_spend: "", urgency: "normal", project: "", trade: "", expected_value: "", contact_name: "", contact_email: "", vendor_id: "" });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const [busy, setBusy] = useState(false);
  const category = kind === "subcontractor" ? "subcontractor" : f.category;

  async function submit() {
    setBusy(true);
    try {
      const v = kind === "redd" ? vendors.find((x: any) => x.id === f.vendor_id) : null;
      const r: any = await createFn({ data: {
        kind: kind === "subcontractor" ? "subcontractor" : "onboarding", acting_role: role,
        vendor_id: v?.id ?? null, company_name: v?.name ?? f.company_name, registration_no: v?.registration_no ?? (f.registration_no || null),
        entity: f.entity, category: v?.category ?? category, goods_services: f.goods_services || null,
        justification: kind === "redd" ? `Re-due diligence${f.justification ? `: ${f.justification}` : ""}` : f.justification || null,
        annual_spend: f.annual_spend === "" ? null : Number(f.annual_spend), urgency: f.urgency,
        project: f.project || null, trade: f.trade || null, expected_value: f.expected_value === "" ? null : Number(f.expected_value),
        contact_name: f.contact_name || v?.contact_name || null, contact_email: f.contact_email || v?.contact_email || null,
      } });
      qc.invalidateQueries({ queryKey: ["vms-requests"] });
      nav({ to: "/vms/$requestId", params: { requestId: r.id } });
    } catch (e: any) { toast.error(e?.message ?? "Could not create the request"); } finally { setBusy(false); }
  }

  return (
    <AppShell>
      <CcmsHeader title="Vendor Management" subtitle="New request" />
      <div className="p-6 bg-white min-h-full">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 max-w-6xl">
          <div className={CARD + " p-5 space-y-4"}>
            <div className="flex flex-wrap gap-2">
              {([["onboarding", "New vendor (VMS-01)"], ["subcontractor", "Subcontractor pre-qualification (VMS-02)"], ["redd", "Re-due diligence of a vendor"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setKind(k)} className={"rounded-md border px-3 py-1.5 text-sm " + (kind === k ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>{l}</button>
              ))}
            </div>
            {kind === "redd" ? (
              <div><label className={LABEL}>Vendor</label>
                <select className={INPUT} value={f.vendor_id} onChange={(e) => set("vendor_id", e.target.value)}>
                  <option value="">Select…</option>
                  {vendors.filter((v: any) => ["approved", "conditional", "on_hold"].includes(v.status)).map((v: any) => <option key={v.id} value={v.id}>{v.name}{v.dd_valid_until ? ` — due diligence to ${v.dd_valid_until}` : ""}</option>)}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div><label className={LABEL}>Company name</label><input className={INPUT} value={f.company_name} onChange={(e) => set("company_name", e.target.value)} /></div>
                <div><label className={LABEL}>SSM registration no.</label><input className={INPUT} value={f.registration_no} onChange={(e) => set("registration_no", e.target.value)} /></div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div><label className={LABEL}>Entity</label><select className={INPUT} value={f.entity} onChange={(e) => set("entity", e.target.value)}>{LSH_ENTITIES.map((x) => <option key={x}>{x}</option>)}</select></div>
              {kind === "onboarding" && <div><label className={LABEL}>Category <span className="text-red-700">*</span></label><select className={INPUT} value={f.category} onChange={(e) => set("category", e.target.value)}>{Object.entries(VENDOR_CATEGORIES).filter(([k]) => k !== "subcontractor").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>}
            </div>
            {kind === "subcontractor" ? (
              <div className="grid grid-cols-3 gap-4">
                <div><label className={LABEL}>Trade <span className="text-red-700">*</span></label><input className={INPUT} value={f.trade} onChange={(e) => set("trade", e.target.value)} placeholder="e.g. Piling" /></div>
                <div><label className={LABEL}>Project <span className="text-red-700">*</span></label><input className={INPUT} value={f.project} onChange={(e) => set("project", e.target.value)} /></div>
                <div><label className={LABEL}>Expected value (RM)</label><input className={INPUT} type="number" value={f.expected_value} onChange={(e) => set("expected_value", e.target.value)} /></div>
              </div>
            ) : kind === "onboarding" && (
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2"><label className={LABEL}>Goods or services</label><input className={INPUT} value={f.goods_services} onChange={(e) => set("goods_services", e.target.value)} /></div>
                <div><label className={LABEL}>Annual spend (RM)</label><input className={INPUT} type="number" value={f.annual_spend} onChange={(e) => set("annual_spend", e.target.value)} /></div>
              </div>
            )}
            <div><label className={LABEL}>Justification {kind === "onboarding" && <span className="text-red-700">*</span>}</label><textarea className={INPUT + " min-h-16"} value={f.justification} onChange={(e) => set("justification", e.target.value)} /></div>
            {kind !== "redd" && (
              <div className="grid grid-cols-2 gap-4">
                <div><label className={LABEL}>Vendor contact name</label><input className={INPUT} value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} /></div>
                <div><label className={LABEL}>Vendor contact email</label><input className={INPUT} value={f.contact_email} onChange={(e) => set("contact_email", e.target.value)} /></div>
              </div>
            )}
            <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Submit request"}</Button>
          </div>
          <aside className={CARD + " p-4 h-fit"}>
            <h2 className="text-sm font-semibold text-gray-900">What the vendor will be asked for</h2>
            <p className="text-sm text-gray-600">{VENDOR_CATEGORIES[category]}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {docsFor(category).map((d) => <li key={d.id}><span className={d.level === "M" ? "font-semibold text-gray-900" : "text-gray-600"}>{d.label}</span> <span className="text-xs text-gray-500">{d.level === "M" ? "mandatory" : d.level === "C" ? "if relevant" : "suggested"}{d.expires ? " · tracked expiry" : ""}</span></li>)}
            </ul>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
