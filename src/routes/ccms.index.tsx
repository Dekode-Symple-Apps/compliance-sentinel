import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { listCcmsContracts } from "@/lib/ccms.functions";
import { CcmsHeader, StatusBadge, FlagChips, CARD, TH, TD, fmtMoney, waitingOn } from "@/components/ccms-widgets";
import { CONTRACT_TYPES } from "@/lib/ccms";
import { Plus, Loader2 } from "lucide-react";

export const Route = createFileRoute("/ccms/")({
  component: CcmsDashboard,
  head: () => ({ meta: [{ title: "Commercial CMS · Dashboard" }] }),
});

function CcmsDashboard() {
  const listFn = useServerFn(listCcmsContracts);
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ["ccms-contracts"], queryFn: () => listFn(), staleTime: 15_000 });

  const open = rows.filter((c: any) => !["approved", "rejected", "closed", "active"].includes(c.status));
  const stat = [
    { label: "Open requests", value: open.length },
    { label: "In review", value: rows.filter((c: any) => c.status === "in_review").length },
    { label: "Awaiting approval", value: rows.filter((c: any) => c.status === "pending_approval" || c.status === "pending_committee").length },
    { label: "Past service level", value: open.filter((c: any) => waitingOn(c)?.overdue).length, alert: true },
    { label: "High-severity flags", value: open.filter((c: any) => (c.flags ?? []).some((f: any) => ["related_party", "deviation", "dd_expired", "vendor_not_approved", "loa_items_missing", "work_order_cap", "high_risk_vendor"].includes(f.key))).length, alert: true },
  ];
  const attention = open
    .filter((c: any) => waitingOn(c)?.overdue || c.status === "returned" || (c.flags ?? []).length)
    .slice(0, 8);

  return (
    <AppShell>
      <CcmsHeader subtitle="Vendor and client contracts — review, flag and approve"
        action={<Button asChild className="gap-1.5"><Link to="/ccms/new"><Plus className="size-4" /> New request</Link></Button>} />
      <div className="p-6 space-y-6 bg-white min-h-full">
        {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stat.map((s) => (
            <div key={s.label} className={CARD + " p-4"}>
              <div className="text-sm text-gray-600">{s.label}</div>
              <div className={"mt-1 text-2xl font-semibold " + (s.alert && s.value ? "text-red-700" : "text-gray-900")}>{isLoading ? "…" : s.value}</div>
            </div>
          ))}
        </div>

        <section className={CARD}>
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900">Needs attention</h2>
            <p className="text-sm text-gray-600">Past their service level, returned, or carrying flags.</p>
          </div>
          {isLoading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            : attention.length === 0 ? <p className="p-6 text-sm text-gray-500">Nothing needs attention.</p>
            : (
              <table className="w-full">
                <thead><tr className="border-b border-gray-200"><th className={TH}>Reference</th><th className={TH}>Request</th><th className={TH}>Status</th><th className={TH}>Waiting on</th><th className={TH}>Flags</th><th className={TH + " text-right"}>Value</th></tr></thead>
                <tbody>
                  {attention.map((c: any) => {
                    const w = waitingOn(c);
                    return (
                      <tr key={c.id} className="border-b border-gray-100 last:border-0">
                        <td className={TD}><Link to="/ccms/$contractId" params={{ contractId: c.id }} className="font-medium text-blue-700 hover:underline">{c.reference_number}</Link></td>
                        <td className={TD}><div className="font-medium">{c.title}</div><div className="text-sm text-gray-600">{CONTRACT_TYPES[c.contract_type]?.label} · {c.counterparty_name}</div></td>
                        <td className={TD}><StatusBadge status={c.status} /></td>
                        <td className={TD}><span className={w?.overdue ? "text-red-700 font-semibold" : ""}>{w?.label ?? "—"}{w?.overdue ? " (overdue)" : ""}</span></td>
                        <td className={TD}><FlagChips flags={c.flags ?? []} max={3} /></td>
                        <td className={TD + " text-right tabular-nums"}>{fmtMoney(c.value, c.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </section>
      </div>
    </AppShell>
  );
}
