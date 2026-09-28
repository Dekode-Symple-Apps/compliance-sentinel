import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { createVmsRequest } from "@/lib/vms.functions";
import { listVmsVendors } from "@/lib/vms.functions";
import { CcmsHeader, CARD, useCcmsRole, friendlyError } from "@/components/ccms-widgets";
import { VENDOR_CATEGORIES, daysTo } from "@/lib/vms";
import { RequiredDocsChecklist } from "@/components/vms-docs-checklist";
import { LSH_ENTITIES } from "@/lib/ccms";
import { Loader2 } from "lucide-react";
import { FillButton } from "@/components/ccms-actions";
import { recallCompanies, rememberCompany, recallForm, rememberForm } from "@/lib/ccms-prefill";

export const Route = createFileRoute("/vms/new")({
  // ?vendor=<id> opens re-due diligence on that vendor (from Monitoring).
  validateSearch: (s: Record<string, unknown>): { vendor?: string } => (typeof s.vendor === "string" ? { vendor: s.vendor } : {}),
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
  const { vendor: startVendor } = Route.useSearch();
  const picked = kind === "redd" ? vendors.find((x: any) => x.id === f.vendor_id) ?? null : null;
  const category = kind === "subcontractor" ? "subcontractor" : picked?.category ?? f.category;

  /** Start from the vendor's record: entity, contact and why it is due. */
  function pickVendor(id: string) {
    const v: any = vendors.find((x: any) => x.id === id);
    if (!v) { set("vendor_id", id); return; }
    const d = v.dd_valid_until ? daysTo(v.dd_valid_until) : null;
    setF((p: any) => ({ ...p, vendor_id: v.id, entity: v.entity || p.entity, category: v.category || p.category,
      contact_name: v.contact_name ?? "", contact_email: v.contact_email ?? "",
      justification: d == null ? "Periodic re-due diligence." : d < 0 ? `Due diligence lapsed on ${v.dd_valid_until}${v.compliance_hold ? "; vendor on compliance hold" : ""}.` : `Due diligence expires on ${v.dd_valid_until}.` }));
  }
  useEffect(() => {
    if (!startVendor || !vendors.length) return;
    setKind("redd"); pickVendor(startVendor);
  }, [startVendor, vendors.length]);

  // Recent companies (this browser only): choosing one fills the rest of the form.
  const [companies, setCompanies] = useState<Record<string, any>[]>([]);
  useEffect(() => { if (kind !== "redd") setCompanies(recallCompanies(kind)); }, [kind]);
  const FIELDS = ["company_name", "registration_no", "entity", "category", "goods_services", "annual_spend", "justification", "project", "trade", "expected_value", "contact_name", "contact_email"];
  function applyCompany(p: Record<string, any>) {
    setF((prev: any) => ({ ...prev, ...Object.fromEntries(FIELDS.filter((k) => p[k] != null && p[k] !== "").map((k) => [k, String(p[k])])),
      ...(kind === "subcontractor" ? { category: "subcontractor" } : {}) }));
  }
  function onCompanyName(v: string) {
    const hit = companies.find((p) => p.company_name.toLowerCase() === v.trim().toLowerCase());
    if (hit) applyCompany(hit); else set("company_name", v);
  }
  function fillLast() {
    if (kind === "redd") {
      const id = recallForm("vms:redd")?.f?.vendor_id;
      if (id && vendors.some((v: any) => v.id === id)) pickVendor(id);
      else toast.message("Nothing saved yet — the vendor is remembered after the first re-due diligence request.");
      return;
    }
    if (companies[0]) applyCompany(companies[0]);
  }

  async function submit() {
    setBusy(true);
    try {
      const v = kind === "redd" ? vendors.find((x: any) => x.id === f.vendor_id) : null;
      const r: any = await createFn({ data: {
        kind: kind === "subcontractor" ? "subcontractor" : "onboarding", acting_role: role,
        vendor_id: v?.id ?? null, company_name: v?.name ?? f.company_name, registration_no: v?.registration_no ?? (f.registration_no || null),
        entity: f.entity, category: v?.category ?? category, goods_services: f.goods_services || v?.goods_services || null,
        justification: kind === "redd" ? `Re-due diligence${f.justification ? `: ${f.justification}` : ""}` : f.justification || null,
        annual_spend: f.annual_spend === "" ? null : Number(f.annual_spend), urgency: f.urgency,
        project: f.project || null, trade: f.trade || null, expected_value: f.expected_value === "" ? null : Number(f.expected_value),
        contact_name: f.contact_name || v?.contact_name || null, contact_email: f.contact_email || v?.contact_email || null,
      } });
      if (kind === "redd") rememberForm("vms:redd", { f: { vendor_id: f.vendor_id } });
      else rememberCompany({ kind, ...Object.fromEntries(FIELDS.map((k) => [k, f[k]])) });
      qc.invalidateQueries({ queryKey: ["vms-requests"] });
      nav({ to: "/vms/$requestId", params: { requestId: r.id } });
    } catch (e: any) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  }

  return (
    <AppShell>
      <CcmsHeader title="Vendor Management" subtitle="New request" />
      <div className="p-6 bg-white min-h-full">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 max-w-6xl">
          <div className={CARD + " p-5 space-y-4"}>
            <div className="flex flex-wrap gap-2">
              {([["onboarding", "New Vendor"], ["subcontractor", "Subcontractor Pre-qualification"], ["redd", "Re-Due Diligence"]] as const).map(([k, l]) => (
                <button key={k} onClick={() => setKind(k)} className={"rounded-md border px-3 py-1.5 text-sm " + (kind === k ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>{l}</button>
              ))}
              <div className="ml-auto self-center"><FillButton onClick={fillLast} /></div>
            </div>
            {kind === "redd" ? (
              <div className="space-y-3">
                <div><label className={LABEL}>Vendor</label>
                  <select className={INPUT} value={f.vendor_id} onChange={(e) => pickVendor(e.target.value)}>
                    <option value="">Select…</option>
                    {vendors.filter((v: any) => ["approved", "conditional", "on_hold"].includes(v.status) || v.id === f.vendor_id).map((v: any) => <option key={v.id} value={v.id}>{v.name}{v.dd_valid_until ? ` · due diligence to ${v.dd_valid_until}` : ""}</option>)}
                  </select>
                </div>
                {picked && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-gray-200 bg-gray-50/50 p-3 text-sm">
                    {([["Vendor code", picked.vendor_code], ["SSM no.", picked.registration_no], ["Category", VENDOR_CATEGORIES[picked.category] ?? picked.category], ["Status", `${picked.status}${picked.compliance_hold ? " · on hold" : ""}`],
                      ["Due diligence to", picked.dd_valid_until], ["Risk rating", picked.risk_rating], ["Related party", picked.related_party ? "Yes" : "No"], ["TIN", picked.tin]] as [string, any][]).map(([k, v]) => (
                      <div key={k}><span className="text-gray-500">{k}</span> <span className={"ml-1 " + (k === "Status" && picked.compliance_hold ? "text-red-700" : "text-gray-900")}>{v || "—"}</span></div>
                    ))}
                    {picked.hold_reason && <div className="col-span-2 text-red-700">{picked.hold_reason}</div>}
                  </div>
                )}
                {picked && !picked.category && (
                  <div><label className={LABEL}>Category <span className="text-red-700">*</span></label><select className={INPUT} value={f.category} onChange={(e) => set("category", e.target.value)}>{Object.entries(VENDOR_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div><label className={LABEL}>Company name</label>
                  <input className={INPUT} list="vms-companies" value={f.company_name} onChange={(e) => onCompanyName(e.target.value)} placeholder="Type, or pick a recent company" />
                  <datalist id="vms-companies">{companies.map((p) => <option key={p.company_name} value={p.company_name} />)}</datalist>
                  {!f.company_name && companies.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {companies.slice(0, 3).map((p) => (
                        <button key={p.company_name} type="button" onClick={() => applyCompany(p)} title="Fill the form with this company's details"
                          className="max-w-full truncate rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-left text-xs text-gray-600 hover:border-gray-500 hover:text-gray-900">↺ {p.company_name}</button>
                      ))}
                    </div>
                  )}
                </div>
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
            {(kind !== "redd" || picked) && (
              <div className="grid grid-cols-2 gap-4">
                <div><label className={LABEL}>Vendor contact name</label><input className={INPUT} value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} /></div>
                <div><label className={LABEL}>Vendor contact email</label><input className={INPUT} value={f.contact_email} onChange={(e) => set("contact_email", e.target.value)} /></div>
              </div>
            )}
            <Button onClick={submit} disabled={busy || (kind === "redd" && !picked)}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Submit Request"}</Button>
          </div>
          <aside className={CARD + " p-4 h-fit"}>
            <h2 className="text-sm font-semibold text-gray-900">Required Documents</h2>
            <p className="text-sm text-gray-600">{VENDOR_CATEGORIES[category]}</p>
            <div className="mt-3"><RequiredDocsChecklist category={category} /></div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
