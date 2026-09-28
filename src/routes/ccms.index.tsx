import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { listCcmsContracts } from "@/lib/ccms.functions";
import { CcmsHeader, StatusBadge, FlagChips, CARD, TH, TD, fmtMoney, waitingOn, PRIORITY_TINT } from "@/components/ccms-widgets";
import { CONTRACT_TYPES, contractAlerts, byPriority, priorityOf } from "@/lib/ccms";
import { cn } from "@/lib/utils";
import { Plus, Loader2 } from "lucide-react";

export const Route = createFileRoute("/ccms/")({
  component: CcmsDashboard,
  head: () => ({ meta: [{ title: "Commercial CMS · Dashboard" }] }),
});

function CcmsDashboard() {
  const listFn = useServerFn(listCcmsContracts);
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ["ccms-contracts"], queryFn: () => listFn(), staleTime: 15_000 });

  const open = rows.filter((c: any) => !["approved", "signed", "stamped", "rejected", "closed", "active"].includes(c.status));
  // Everything with a date on it: expiry, stamping window, lapsing bonds, client letters.
  const alerts = rows.flatMap((c: any) => contractAlerts(c).map((a) => ({ ...a, c }))).sort((a: any, b: any) => a.days - b.days);
  const stat = [
    { label: "Open requests", value: open.length },
    { label: "In review", value: rows.filter((c: any) => c.status === "in_review").length },
    { label: "Signing & stamping", value: rows.filter((c: any) => ["approved", "signed", "stamped"].includes(c.status)).length },
    { label: "Awaiting approval", value: rows.filter((c: any) => c.status === "pending_approval" || c.status === "pending_committee").length },
    { label: "Past service level", value: open.filter((c: any) => waitingOn(c)?.overdue).length, alert: true },
    { label: "High-severity flags", value: open.filter((c: any) => (c.flags ?? []).some((f: any) => ["related_party", "deviation", "dd_expired", "vendor_not_approved", "loa_items_missing", "work_order_cap", "high_risk_vendor"].includes(f.key))).length, alert: true },
  ];
  // Highest priority first: past service level or blocked, then decisions due.
  const attention = rows.filter((c: any) => priorityOf(c).rank <= 2).sort(byPriority).slice(0, 10);

  return (
    <AppShell>
      <CcmsHeader subtitle="Vendor and client contracts — review, flag and approve"
        action={<Button asChild className="gap-1.5"><Link to="/ccms/new"><Plus className="size-4" /> New request</Link></Button>} />
      <div className="p-6 space-y-6 bg-white min-h-full">
        {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {stat.map((s) => (
            <div key={s.label} className={CARD + " p-4"}>
              <div className="text-sm text-gray-600">{s.label}</div>
              <div className={"mt-1 text-2xl font-semibold " + (s.alert && s.value ? "text-red-700" : "text-gray-900")}>{isLoading ? "…" : s.value}</div>
            </div>
          ))}
        </div>

        {alerts.length > 0 && (
          <section className={CARD}>
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">Alerts · {alerts.length}</h2>
              <p className="text-sm text-gray-600">Expiring within 30 days, stamping deadlines, lapsing bonds and insurance, unanswered client letters.</p>
            </div>
            <ul className="divide-y divide-gray-100">
              {alerts.map((a: any, i: number) => (
                <li key={i} className={cn("px-4 py-2.5 flex items-center gap-3 text-sm", a.severity === "high" ? PRIORITY_TINT[1] : PRIORITY_TINT[2])}>
                  <span className={a.severity === "high" ? "text-red-700 font-semibold w-24" : "text-amber-700 font-semibold w-24"}>{({ expiry: "Expiry", stamping: "Stamping", security: "Bond / policy", confirmation: "Client letter" } as Record<string, string>)[a.kind]}</span>
                  <Link to="/ccms/$contractId" params={{ contractId: a.c.id }} className="font-medium text-blue-700 hover:underline w-32">{a.c.reference_number}</Link>
                  <span className="text-gray-900 flex-1">{a.text}</span>
                  <span className="text-gray-600 truncate max-w-72">{a.c.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={CARD}>
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900">Needs attention</h2>
            <p className="text-sm text-gray-600">Urgent first (past service level, blocked, expiring), then decisions due.</p>
          </div>
          {isLoading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            : attention.length === 0 ? <p className="p-6 text-sm text-gray-500">Nothing needs attention.</p>
            : (
              <table className="w-full">
                <thead><tr className="border-b border-gray-200"><th className={TH}>Reference</th><th className={TH}>Request</th><th className={TH}>Status</th><th className={TH}>Needs</th><th className={TH}>Flags</th><th className={TH + " text-right"}>Value</th></tr></thead>
                <tbody>
                  {attention.map((c: any) => {
                    const p = priorityOf(c);
                    return (
                      <tr key={c.id} className={cn("border-b border-gray-100 last:border-0", PRIORITY_TINT[p.rank])}>
                        <td className={TD}><Link to="/ccms/$contractId" params={{ contractId: c.id }} className="font-medium text-blue-700 hover:underline">{c.reference_number}</Link></td>
                        <td className={TD}><div className="font-medium">{c.title}</div><div className="text-sm text-gray-600">{CONTRACT_TYPES[c.contract_type]?.label} · {c.counterparty_name}</div></td>
                        <td className={TD}><StatusBadge status={c.status} contract={c} /></td>
                        <td className={TD}><span className={p.rank === 1 ? "text-red-800" : "text-amber-800"}>{p.reason}</span></td>
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
