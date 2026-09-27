import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { listVmsVendors } from "@/lib/vms.functions";
import { CcmsHeader, CARD, TH, TD } from "@/components/ccms-widgets";
import { VENDOR_CATEGORIES } from "@/lib/vms";
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
              <thead><tr className="border-b border-gray-200"><th className={TH}>Vendor</th><th className={TH}>Category</th><th className={TH}>Status</th><th className={TH}>Due diligence</th><th className={TH}>Risk</th><th className={TH}>Notes</th></tr></thead>
              <tbody>
                {shown.map((v: any) => (
                  <tr key={v.id} className="border-b border-gray-100 last:border-0">
                    <td className={TD}><div className="font-medium">{v.name}</div><div className="text-sm text-gray-600">{[v.vendor_code, v.registration_no, v.cidb_grade && `CIDB ${v.cidb_grade}`].filter(Boolean).join(" · ")}</div></td>
                    <td className={TD}>{VENDOR_CATEGORIES[v.category] ?? v.category ?? "—"}{v.on_master_sub_list && <div className="text-xs text-emerald-700">Master Sub-Contractor List{v.list_review_date ? ` · review ${v.list_review_date}` : ""}</div>}</td>
                    <td className={TD}><span className={cn("font-semibold", v.compliance_hold ? "text-red-700" : ["approved", "conditional"].includes(v.status) ? "text-emerald-700" : ["blacklisted", "rejected"].includes(v.status) ? "text-red-700" : "text-amber-700")}>{v.compliance_hold ? "On hold" : v.status}</span>{v.compliance_hold && <div className="text-xs text-red-700">{v.hold_reason}</div>}</td>
                    <td className={TD}>{v.dd_valid_until ?? "—"}</td>
                    <td className={TD}>{v.risk_rating}{v.related_party ? <span className="text-red-700"> · related party</span> : ""}</td>
                    <td className={TD + " text-sm text-gray-700"}>{[v.conditions?.text && `Conditions: ${v.conditions.text} (due ${v.conditions.due})`, v.safeguards && `Safeguards: ${v.safeguards}`].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
