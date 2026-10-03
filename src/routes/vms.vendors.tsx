import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { toast } from "sonner";
import { allowVendorPayment, autocountSupplier, listVmsVendors } from "@/lib/vms.functions";
import { CcmsHeader, CARD, TH, TD, friendlyError, useCcmsRole } from "@/components/ccms-widgets";
import { VENDOR_CATEGORIES, vendorLight, type Light } from "@/lib/vms";
import { DEMO_SINGLE_USER, displayName } from "@/lib/ccms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vms/vendors")({
  component: VendorList,
  head: () => ({ meta: [{ title: "Vendor Management · Vendors" }] }),
});

/** The vendor master: selectable in contracts, assets and sourcing only when
 *  approved (or conditional) and not on hold. */
function VendorList() {
  const listFn = useServerFn(listVmsVendors);
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["vms-vendors"], queryFn: () => listFn() });
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "sub">("all");
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["vms-vendors"] });
  const [pay, setPay] = useState<any>(null);
  const shown = useMemo(() => rows.filter((v: any) => (only === "all" || v.on_master_sub_list) && (!q.trim() || [v.name, v.vendor_code, v.registration_no].some((x) => String(x ?? "").toLowerCase().includes(q.toLowerCase())))), [rows, q, only]);
  return (
    <AppShell>
      <CcmsHeader title="Vendor Management" subtitle="Vendor list and Master Sub-Contractor List" />
      <div className="p-6 space-y-4 bg-white min-h-full">
        <div className="flex items-center gap-2">
          {(["all", "sub"] as const).map((k) => <button key={k} onClick={() => setOnly(k)} className={cn("rounded-md border px-3 py-1.5 text-sm", only === k ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>{k === "all" ? "All vendors" : "Master Sub-Contractor List"}</button>)}
          <div className="ml-auto flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5"><Search className="size-4 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-56 text-sm focus:outline-none" /></div>
        </div>
        <div className={CARD}>
          {isLoading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div> : (
            <table className="w-full">
              <thead><tr className="border-b border-gray-200"><th className={TH}>Vendor</th><th className={TH}>Category</th><th className={TH}>Status</th><th className={TH}>Payment</th><th className={TH}>Due diligence</th><th className={TH}>Risk</th><th className={TH}>AutoCount</th><th className={TH}>Notes</th></tr></thead>
              <tbody>
                {shown.map((v: any) => (
                  <tr key={v.id} className="border-b border-gray-100 last:border-0">
                    <td className={TD}><div className="font-medium">{v.name}</div><div className="text-sm text-gray-600">{[v.vendor_code, v.registration_no, v.cidb_grade && `CIDB ${v.cidb_grade}`].filter(Boolean).join(" · ")}</div></td>
                    <td className={TD}>{VENDOR_CATEGORIES[v.category] ?? v.category ?? "—"}{v.on_master_sub_list && <div className="text-xs text-emerald-700">Master Sub-Contractor List{v.list_review_date ? ` · review ${v.list_review_date}` : ""}</div>}</td>
                    <td className={TD}><span className={cn("font-semibold", v.compliance_hold ? "text-red-700" : ["approved", "conditional"].includes(v.status) ? "text-emerald-700" : ["blacklisted", "rejected"].includes(v.status) ? "text-red-700" : "text-amber-700")}>{v.compliance_hold ? "On hold" : v.status}</span>{v.compliance_hold && <div className="text-xs text-red-700">{v.hold_reason}</div>}</td>
                    <td className={TD}><PaymentCell v={v} onPay={() => setPay(v)} /></td>
                    <td className={TD}>{v.dd_valid_until ?? "—"}</td>
                    <td className={TD}>{v.risk_rating}{v.related_party ? <span className="text-red-700"> · related party</span> : ""}</td>
                    <td className={TD}><AutoCountCell v={v} onDone={refresh} /></td>
                    <td className={TD + " text-sm text-gray-700"}>{[v.conditions?.text && `Conditions: ${v.conditions.text} (due ${v.conditions.due})`, v.safeguards && `Safeguards: ${v.safeguards}`].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {pay && <AllowPaymentDialog v={pay} onClose={() => setPay(null)} onDone={refresh} />}
    </AppShell>
  );
}

const DOT: Record<Light, string> = { green: "bg-emerald-500", yellow: "bg-amber-400", red: "bg-red-500" };

/** Green / yellow / red, with what is outstanding, and Finance's override. */
function PaymentCell({ v, onPay }: { v: any; onPay: () => void }) {
  const [role] = useCcmsRole();
  const l = vendorLight(v, v.verified_types ?? []);
  const finance = role === "finance" || role === "accounts" || DEMO_SINGLE_USER;
  return (
    <div className="text-sm">
      <span className="inline-flex items-center gap-1.5 font-medium" title={l.reasons.join("\n") || "Nothing outstanding"}><span className={cn("size-2.5 rounded-full", DOT[l.light])} />{l.label}</span>
      {l.reasons.length > 0 && <div className="text-xs text-gray-500">{l.reasons.slice(0, 2).join(" · ")}{l.reasons.length > 2 ? " …" : ""}</div>}
      {l.override
        ? <div className="text-xs text-emerald-700">Payment allowed by {displayName(l.override.by)}{l.override.expires ? ` to ${l.override.expires}` : ""}</div>
        : l.light !== "green" && finance && !["blacklisted", "rejected"].includes(v.status) && <button type="button" onClick={onPay} className="text-xs text-blue-700 hover:underline">Allow Payment…</button>}
    </div>
  );
}

function AllowPaymentDialog({ v, onClose, onDone }: { v: any; onClose: () => void; onDone: () => void }) {
  const fn = useServerFn(allowVendorPayment);
  const [role, setRole] = useCcmsRole();
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const l = vendorLight(v, v.verified_types ?? []);
  async function go() {
    setBusy(true);
    try {
      const acting = role === "finance" || role === "accounts" ? role : "finance";
      if (acting !== role && DEMO_SINGLE_USER) setRole(acting);
      await fn({ data: { vendor_id: v.id, reason, expires: expires || null, acting_role: acting } });
      toast.success("Payment allowed — the outstanding items stay on record"); onClose(); onDone();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader><DialogTitle>Allow payment: {v.name}</DialogTitle><DialogDescription>For urgent payments before onboarding is complete. The reason and what is still outstanding are kept on record.</DialogDescription></DialogHeader>
        <div className="space-y-3 text-sm">
          <div><div className="font-medium text-gray-900">Still outstanding</div><ul className="list-disc pl-5 text-gray-700">{l.reasons.map((x) => <li key={x}>{x}</li>)}</ul></div>
          <textarea className="w-full rounded-md border border-gray-300 px-3 py-2" rows={3} placeholder="Reason (e.g. urgent works on site; documents to follow within 14 days)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="block text-gray-700">Allowed until (optional)<input type="date" className="mt-1 block rounded-md border border-gray-300 px-2 py-1" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
          <Button disabled={busy || reason.trim().length < 10} onClick={go}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Allow Payment"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Purchasing asks for the supplier to be created in AutoCount; Finance approves. Simulated for now. */
function AutoCountCell({ v, onDone }: { v: any; onDone: () => void }) {
  const fn = useServerFn(autocountSupplier);
  const [role, setRole] = useCcmsRole();
  const [busy, setBusy] = useState(false);
  const a = v.autocount;
  async function act(action: "request" | "approve" | "decline") {
    setBusy(true);
    try {
      const want = action === "request" ? ["purchasing_executive", "purchasing_manager", "contract_executive"] : ["finance", "accounts"];
      const acting = want.includes(role) ? role : (want[0] as any);
      if (acting !== role && DEMO_SINGLE_USER) setRole(acting);
      const r: any = await fn({ data: { vendor_id: v.id, action, acting_role: acting } });
      toast.success(action === "request" ? "Sent to Finance to approve" : action === "approve" ? `Created in AutoCount: ${r.supplier_code}` : "Declined");
      onDone();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  }
  if (a?.status === "created") return <div className="text-sm"><span className="font-medium text-emerald-700">{a.supplier_code}</span><div className="text-xs text-gray-500" title="Simulated until the AutoCount API details are provided">Created · simulated</div></div>;
  if (a?.status === "requested") return (
    <div className="text-sm"><div className="text-amber-700">Waiting for Finance</div>
      <div className="flex gap-2 text-xs"><button type="button" disabled={busy} onClick={() => act("approve")} className="text-blue-700 hover:underline">Approve</button><button type="button" disabled={busy} onClick={() => act("decline")} className="text-gray-500 hover:underline">Decline</button></div></div>
  );
  if (!["approved", "conditional"].includes(v.status)) return <span className="text-gray-400">—</span>;
  return <button type="button" disabled={busy} onClick={() => act("request")} className="text-sm text-blue-700 hover:underline">{busy ? "…" : "Create Supplier"}</button>;
}
