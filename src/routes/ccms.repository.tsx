import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { listCcmsContracts } from "@/lib/ccms.functions";
import { CcmsHeader, CARD, TH, TD, fmtMoney } from "@/components/ccms-widgets";
import { CONTRACT_TYPES, daysBetween, paymentReady } from "@/lib/ccms";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ccms/repository")({
  component: Repository,
  head: () => ({ meta: [{ title: "Commercial CMS · Repository" }] }),
});

/** Every signed contract, vendor and client alike — soonest to expire first. */
function Repository() {
  const listFn = useServerFn(listCcmsContracts);
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ["ccms-contracts"], queryFn: () => listFn(), staleTime: 15_000 });
  const [q, setQ] = useState("");
  const [side, setSide] = useState<"all" | "vendor" | "client">("all");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((c: any) => c.status === "active" || c.status === "closed")
      .filter((c: any) => side === "all" || c.side === side)
      .filter((c: any) => !needle || [c.reference_number, c.title, c.counterparty_name, c.project, c.entity].some((v) => String(v ?? "").toLowerCase().includes(needle)))
      .sort((a: any, b: any) => String(a.expiry_date ?? "9999").localeCompare(String(b.expiry_date ?? "9999")));
  }, [rows, q, side]);
  const expiring = shown.filter((c: any) => c.expiry_date && daysBetween(new Date(), c.expiry_date) <= 30).length;

  return (
    <AppShell>
      <CcmsHeader subtitle="Contract repository — signed and stamped contracts, alerted 30 days before expiry" />
      <div className="p-6 space-y-4 bg-white min-h-full">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-700">{shown.length} contract{shown.length === 1 ? "" : "s"}{expiring ? <span className="text-red-700 font-semibold"> · {expiring} expiring within 30 days</span> : null}</span>
          <select value={side} onChange={(e) => setSide(e.target.value as any)} className="ml-auto rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm">
            <option value="all">Vendor and client</option><option value="vendor">Vendor contracts</option><option value="client">Client contracts</option>
          </select>
          <div className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5">
            <Search className="size-4 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-60 text-sm focus:outline-none" />
          </div>
        </div>
        {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
        <div className={CARD}>
          {isLoading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            : shown.length === 0 ? <p className="p-6 text-sm text-gray-500">Nothing in the repository yet. A contract arrives here once it is signed, stamped and its key terms are confirmed.</p>
            : (
              <table className="w-full">
                <thead><tr className="border-b border-gray-200">
                  <th className={TH}>Contract</th><th className={TH}>Counterparty</th><th className={TH + " text-right"}>Value</th>
                  <th className={TH}>Period</th><th className={TH}>Expiry</th><th className={TH}>Payment-ready</th>
                </tr></thead>
                <tbody>
                  {shown.map((c: any) => {
                    const d = c.expiry_date ? daysBetween(new Date(), c.expiry_date) : null;
                    return (
                      <tr key={c.id} className="border-b border-gray-100 last:border-0">
                        <td className={TD}><Link to="/ccms/$contractId" params={{ contractId: c.id }} className="font-medium text-blue-700 hover:underline">{c.reference_number}</Link><div className="text-sm text-gray-900">{c.title}</div><div className="text-sm text-gray-600">{CONTRACT_TYPES[c.contract_type]?.label} · {c.side === "client" ? "client" : "vendor"}</div></td>
                        <td className={TD}>{c.counterparty_name}</td>
                        <td className={TD + " text-right tabular-nums"}>{fmtMoney(c.repository?.value ?? c.value, c.repository?.currency ?? c.currency)}</td>
                        <td className={TD + " text-gray-700"}>{c.repository?.start_date ?? c.start_date ?? "—"} to {c.expiry_date ?? "—"}</td>
                        <td className={TD}>{d == null ? "—" : <span className={cn(d <= 7 ? "text-red-700 font-semibold" : d <= 30 ? "text-amber-700 font-semibold" : "text-gray-700")}>{d < 0 ? `expired ${-d}d ago` : `${d} days`}</span>}</td>
                        <td className={TD}>{(c.securities ?? []).length === 0 ? "—" : paymentReady(c.securities) ? <span className="text-emerald-700">Yes</span> : <span className="text-amber-700">Incomplete</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </AppShell>
  );
}
