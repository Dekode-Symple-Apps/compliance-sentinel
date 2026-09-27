import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { createAmsAsset } from "@/lib/ams.functions";
import { listVmsVendors } from "@/lib/vms.functions";
import { CcmsHeader, CARD, useCcmsRole } from "@/components/ccms-widgets";
import { ASSET_CLASSES, REQUIREMENTS, classById, isFixedAsset } from "@/lib/ams";
import { LSH_ENTITIES } from "@/lib/ccms";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/ams/new")({
  component: NewAsset,
  head: () => ({ meta: [{ title: "Asset Monitoring · Register asset" }] }),
});

const LABEL = "block text-sm font-medium text-gray-800 mb-1";
const INPUT = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";

function NewAsset() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [role] = useCcmsRole();
  const createFn = useServerFn(createAmsAsset);
  const vendorsFn = useServerFn(listVmsVendors);
  const { data: vendors = [] } = useQuery({ queryKey: ["vms-vendors"], queryFn: () => vendorsFn().catch(() => []) });
  const [f, setF] = useState<any>({ asset_class: "lorry", name: "", entity: LSH_ENTITIES[1], department: "", location: "", make: "", model: "", year: "", registration_no: "", serial_no: "", ownership: "owned", source_ref: "", purchase_date: "", cost: "", useful_life_years: "", vendor_id: "", on_hire: "", off_hire: "", dosh_reg_no: "" });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const [busy, setBusy] = useState(false);
  const cls = classById(f.asset_class)!;
  const num = (v: string) => (v === "" ? null : Number(v));

  async function submit() {
    setBusy(true);
    try {
      const a: any = await createFn({ data: { ...f, acting_role: role, year: num(f.year), cost: num(f.cost), useful_life_years: num(f.useful_life_years),
        vendor_id: f.ownership === "rented" ? f.vendor_id || null : null, on_hire: f.on_hire || null, off_hire: f.off_hire || null, purchase_date: f.purchase_date || null } });
      qc.invalidateQueries({ queryKey: ["ams-assets"] });
      nav({ to: "/ams/$assetId", params: { assetId: a.id } });
    } catch (e: any) { toast.error(e?.message ?? "Could not register"); } finally { setBusy(false); }
  }

  return (
    <AppShell>
      <CcmsHeader title="Asset Monitoring" subtitle="Register an asset" />
      <div className="p-6 bg-white min-h-full">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 max-w-6xl">
          <div className={CARD + " p-5 space-y-4"}>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={LABEL}>Asset class</label><select className={INPUT} value={f.asset_class} onChange={(e) => set("asset_class", e.target.value)}>{ASSET_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
              <div><label className={LABEL}>Name</label><input className={INPUT} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. 10-tonne lorry, site B" /></div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div><label className={LABEL}>Entity</label><select className={INPUT} value={f.entity} onChange={(e) => set("entity", e.target.value)}>{LSH_ENTITIES.map((x) => <option key={x}>{x}</option>)}</select></div>
              <div><label className={LABEL}>Department</label><input className={INPUT} value={f.department} onChange={(e) => set("department", e.target.value)} /></div>
              <div><label className={LABEL}>Location</label><input className={INPUT} value={f.location} onChange={(e) => set("location", e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div><label className={LABEL}>Make</label><input className={INPUT} value={f.make} onChange={(e) => set("make", e.target.value)} /></div>
              <div><label className={LABEL}>Model</label><input className={INPUT} value={f.model} onChange={(e) => set("model", e.target.value)} /></div>
              <div><label className={LABEL}>Year</label><input className={INPUT} type="number" value={f.year} onChange={(e) => set("year", e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div><label className={LABEL}>Registration no.</label><input className={INPUT} value={f.registration_no} onChange={(e) => set("registration_no", e.target.value)} /></div>
              <div><label className={LABEL}>Serial no.</label><input className={INPUT} value={f.serial_no} onChange={(e) => set("serial_no", e.target.value)} /></div>
              {cls.items.dosh_reg && <div><label className={LABEL}>DOSH registration no.</label><input className={INPUT} value={f.dosh_reg_no} onChange={(e) => set("dosh_reg_no", e.target.value)} /></div>}
            </div>
            <div className="flex gap-2">{(["owned", "rented"] as const).map((o) => <button key={o} onClick={() => set("ownership", o)} className={"rounded-md border px-3 py-1.5 text-sm " + (f.ownership === o ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>{o === "owned" ? "Owned" : "Rented"}</button>)}</div>
            <div><label className={LABEL}>Source <span className="text-red-700">*</span></label><input className={INPUT} value={f.source_ref} onChange={(e) => set("source_ref", e.target.value)} placeholder={f.ownership === "owned" ? "Approved purchase no., or AutoCount Fixed Assets ref." : "Approved rental contract ref."} /></div>
            {f.ownership === "owned" ? (
              <div className="grid grid-cols-3 gap-4">
                <div><label className={LABEL}>Purchase date</label><input type="date" className={INPUT} value={f.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} /></div>
                <div><label className={LABEL}>Cost (RM) *</label><input type="number" className={INPUT} value={f.cost} onChange={(e) => set("cost", e.target.value)} /></div>
                <div><label className={LABEL}>Useful life (years) *</label><input type="number" className={INPUT} value={f.useful_life_years} onChange={(e) => set("useful_life_years", e.target.value)} /></div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <div><label className={LABEL}>Rental vendor *</label><select className={INPUT} value={f.vendor_id} onChange={(e) => set("vendor_id", e.target.value)}><option value="">Select…</option>{vendors.filter((v: any) => ["approved", "conditional"].includes(v.status) && !v.compliance_hold).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
                <div><label className={LABEL}>On hire *</label><input type="date" className={INPUT} value={f.on_hire} onChange={(e) => set("on_hire", e.target.value)} /></div>
                <div><label className={LABEL}>Off hire *</label><input type="date" className={INPUT} value={f.off_hire} onChange={(e) => set("off_hire", e.target.value)} /></div>
              </div>
            )}
            <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Register asset"}</Button>
          </div>
          <aside className={CARD + " p-4 h-fit text-sm"}>
            <h2 className="font-semibold text-gray-900">What {cls.label.toLowerCase()} must carry</h2>
            <ul className="mt-2 space-y-1">
              {Object.entries(cls.items).map(([rid, lvl]) => (
                <li key={rid}><span className={lvl === "M" ? "font-semibold text-gray-900" : "text-gray-600"}>{REQUIREMENTS[rid].label}</span> <span className="text-xs text-gray-500">{lvl === "M" ? "mandatory" : "if applicable"}{REQUIREMENTS[rid].blocking ? " · blocks deployment" : ""}{REQUIREMENTS[rid].lead ? ` · alert ${REQUIREMENTS[rid].lead} days` : ""}</span></li>
              ))}
            </ul>
            <p className="mt-3 text-gray-700">Driver: {cls.licence.length ? `licence class ${cls.licence.join(" / ")}${cls.licenceConditional ? " if driven on the road" : ""}` : "no driving licence"}{(cls.competency ?? []).length ? `; ${cls.competency!.map((c) => `${c.type}${c.mandatory ? "" : " (if required)"}`).join("; ")}` : ""}.</p>
            {f.ownership === "owned" && <p className="mt-2 text-gray-700">Fixed asset (AutoCount FA): {isFixedAsset({ ownership: "owned", cost: num(f.cost), useful_life_years: num(f.useful_life_years) }) ? "yes" : "no — over RM1,000 and 2+ years' life"}</p>}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
