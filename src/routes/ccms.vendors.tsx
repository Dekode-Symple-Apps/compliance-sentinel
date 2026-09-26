import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { listCcmsVendors, saveCcmsVendor, seedCcmsVendors } from "@/lib/ccms.functions";
import { CcmsHeader, CARD, TH, TD } from "@/components/ccms-widgets";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ccms/vendors")({
  component: Vendors,
  head: () => ({ meta: [{ title: "Commercial CMS · Vendors" }] }),
});

const CATEGORIES: Record<string, string> = {
  supplier_material: "Supplier — material", supplier_pme: "Supplier — PME / rental / transport", services: "Services (testing, maintenance)",
  subcontractor: "Subcontractor", consultant: "Consultant", agent: "Agent", it_service: "IT service provider",
};
const BLANK = { name: "", registration_no: "", category: "subcontractor", status: "approved", dd_valid_until: "", risk_rating: "low", related_party: false, related_party_note: "", cidb_grade: "", contact_name: "", contact_email: "", notes: "" };
const INPUT = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm";

function Vendors() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCcmsVendors);
  const saveFn = useServerFn(saveCcmsVendor);
  const seedFn = useServerFn(seedCcmsVendors);
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ["ccms-vendors"], queryFn: () => listFn() });
  const [edit, setEdit] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date();

  async function save() {
    setBusy(true);
    try {
      await saveFn({ data: { ...edit, dd_valid_until: edit.dd_valid_until || null } });
      toast.success("Vendor saved"); setEdit(null); qc.invalidateQueries({ queryKey: ["ccms-vendors"] });
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); } finally { setBusy(false); }
  }
  async function seed() {
    setBusy(true);
    try { const r: any = await seedFn(); toast.success(`${r.inserted} sample vendors added`); qc.invalidateQueries({ queryKey: ["ccms-vendors"] }); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  }

  return (
    <AppShell>
      <CcmsHeader subtitle="Vendor list — interim, until the Vendor Management module is built"
        action={<Button className="gap-1.5" onClick={() => setEdit({ ...BLANK })}><Plus className="size-4" /> Add vendor</Button>} />
      <div className="p-6 space-y-4 bg-white min-h-full">
        <p className="text-sm text-gray-600 max-w-3xl">A contract request can only name an approved vendor. A blacklisted vendor cannot be named at all; expired due diligence, a high risk rating or a related-party link each raise a flag that changes the approval route.</p>
        {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
        <div className={CARD}>
          {isLoading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            : rows.length === 0 ? (
              <div className="p-6 text-sm text-gray-600 space-y-3">
                <p>No vendors yet.</p>
                <Button variant="outline" className="gap-1.5" onClick={seed} disabled={busy}><Sparkles className="size-4" /> Add six sample vendors</Button>
                <p className="text-gray-500">Fictitious companies covering the cases the rules treat differently: approved, expired due diligence, related party, high risk and blacklisted.</p>
              </div>
            ) : (
              <table className="w-full">
                <thead><tr className="border-b border-gray-200"><th className={TH}>Vendor</th><th className={TH}>Category</th><th className={TH}>Status</th><th className={TH}>Due diligence</th><th className={TH}>Risk</th><th className={TH}>Related party</th><th className={TH}></th></tr></thead>
                <tbody>
                  {rows.map((v: any) => {
                    const expired = v.dd_valid_until && new Date(v.dd_valid_until) < today;
                    return (
                      <tr key={v.id} className="border-b border-gray-100 last:border-0">
                        <td className={TD}><div className="font-medium">{v.name}</div><div className="text-sm text-gray-600">{v.registration_no || "—"}{v.cidb_grade ? ` · CIDB ${v.cidb_grade}` : ""}</div></td>
                        <td className={TD}>{CATEGORIES[v.category] ?? v.category ?? "—"}</td>
                        <td className={TD}><span className={cn("text-sm font-semibold", v.status === "approved" ? "text-emerald-700" : v.status === "blacklisted" ? "text-red-700" : "text-amber-700")}>{v.status.replace("_", " ")}</span></td>
                        <td className={TD}><span className={expired ? "text-red-700 font-semibold" : ""}>{v.dd_valid_until ? `${expired ? "Expired" : "Valid until"} ${v.dd_valid_until}` : "—"}</span></td>
                        <td className={TD}><span className={v.risk_rating === "high" ? "text-red-700 font-semibold" : ""}>{v.risk_rating}</span></td>
                        <td className={TD}>{v.related_party ? <span className="text-red-700">Yes</span> : "No"}{v.related_party_note && <div className="text-sm text-gray-600">{v.related_party_note}</div>}</td>
                        <td className={TD + " text-right"}><Button size="sm" variant="outline" onClick={() => setEdit({ ...BLANK, ...v, dd_valid_until: v.dd_valid_until ?? "" })}>Edit</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader><DialogTitle>{edit?.id ? "Edit vendor" : "Add vendor"}</DialogTitle><DialogDescription>One master record per company, keyed on its SSM number.</DialogDescription></DialogHeader>
          {edit && (
            <div className="grid grid-cols-2 gap-3">
              <L label="Company name" span><input className={INPUT} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></L>
              <L label="SSM registration no."><input className={INPUT} value={edit.registration_no ?? ""} onChange={(e) => setEdit({ ...edit, registration_no: e.target.value })} /></L>
              <L label="Category"><select className={INPUT} value={edit.category ?? ""} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></L>
              <L label="Status"><select className={INPUT} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{["approved", "pending", "on_hold", "blacklisted"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></L>
              <L label="Due diligence valid until"><input type="date" className={INPUT} value={edit.dd_valid_until ?? ""} onChange={(e) => setEdit({ ...edit, dd_valid_until: e.target.value })} /></L>
              <L label="Risk rating"><select className={INPUT} value={edit.risk_rating} onChange={(e) => setEdit({ ...edit, risk_rating: e.target.value })}>{["low", "medium", "high"].map((s) => <option key={s}>{s}</option>)}</select></L>
              <L label="CIDB grade"><input className={INPUT} value={edit.cidb_grade ?? ""} onChange={(e) => setEdit({ ...edit, cidb_grade: e.target.value })} placeholder="e.g. G7" /></L>
              <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.related_party} onChange={(e) => setEdit({ ...edit, related_party: e.target.checked })} /> On the related-party list</label>
              {edit.related_party && <L label="Related-party link" span><input className={INPUT} value={edit.related_party_note ?? ""} onChange={(e) => setEdit({ ...edit, related_party_note: e.target.value })} placeholder="e.g. A director of the Company holds 30%" /></L>}
              <L label="Contact name"><input className={INPUT} value={edit.contact_name ?? ""} onChange={(e) => setEdit({ ...edit, contact_name: e.target.value })} /></L>
              <L label="Contact email"><input className={INPUT} value={edit.contact_email ?? ""} onChange={(e) => setEdit({ ...edit, contact_email: e.target.value })} /></L>
              <div className="col-span-2 flex gap-2 pt-2"><Button onClick={save} disabled={busy || !edit.name.trim()}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Save"}</Button><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function L({ label, span, children }: { label: string; span?: boolean; children: React.ReactNode }) {
  return <div className={span ? "col-span-2" : ""}><label className="block text-sm font-medium text-gray-800 mb-1">{label}</label>{children}</div>;
}
