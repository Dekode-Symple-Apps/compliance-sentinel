import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { listCcmsContracts } from "@/lib/ccms.functions";
import { CcmsHeader, StatusBadge, FlagChips, CARD, TH, TD, fmtMoney, waitingOn } from "@/components/ccms-widgets";
import { CONTRACT_TYPES } from "@/lib/ccms";
import { Plus, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ccms/contracts")({
  component: CcmsContracts,
  head: () => ({ meta: [{ title: "Commercial CMS · Contracts" }] }),
});

const TABS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "open", label: "Open", match: (s) => !["approved", "rejected", "closed", "active"].includes(s) },
  { key: "review", label: "In review", match: (s) => s === "in_review" || s === "submitted" },
  { key: "approval", label: "Approval", match: (s) => s === "pending_approval" || s === "pending_committee" },
  { key: "returned", label: "Returned", match: (s) => s === "returned" },
  { key: "done", label: "Approved / rejected", match: (s) => ["approved", "rejected", "closed", "active"].includes(s) },
  { key: "all", label: "All", match: () => true },
];

function CcmsContracts() {
  const listFn = useServerFn(listCcmsContracts);
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ["ccms-contracts"], queryFn: () => listFn(), staleTime: 15_000 });
  const [tab, setTab] = useState("open");
  const [side, setSide] = useState<"all" | "vendor" | "client">("all");
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const t = TABS.find((x) => x.key === tab)!;
    const needle = q.trim().toLowerCase();
    return rows.filter((c: any) =>
      t.match(c.status) && (side === "all" || c.side === side) &&
      (!needle || [c.reference_number, c.title, c.counterparty_name, c.project, c.entity].some((v) => String(v ?? "").toLowerCase().includes(needle))));
  }, [rows, tab, side, q]);

  return (
    <AppShell>
      <CcmsHeader subtitle="Contract requests"
        action={<Button asChild className="gap-1.5"><Link to="/ccms/new"><Plus className="size-4" /> New request</Link></Button>} />
      <div className="p-6 space-y-4 bg-white min-h-full">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn("rounded-md border px-3 py-1.5 text-sm", tab === t.key ? "border-gray-900 font-semibold text-gray-900" : "border-gray-200 text-gray-600 hover:border-gray-400")}>
              {t.label} <span className="text-gray-500">{rows.filter((c: any) => t.match(c.status)).length}</span>
            </button>
          ))}
          <select value={side} onChange={(e) => setSide(e.target.value as any)} className="ml-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm">
            <option value="all">Vendor and client</option>
            <option value="vendor">Vendor contracts (tender-out)</option>
            <option value="client">Client contracts (tender-in)</option>
          </select>
          <div className="ml-auto flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5">
            <Search className="size-4 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference, title, counterparty, project" className="w-72 text-sm focus:outline-none" />
          </div>
        </div>

        {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
        <div className={CARD}>
          {isLoading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            : shown.length === 0 ? <p className="p-6 text-sm text-gray-500">No requests here.</p>
            : (
              <table className="w-full">
                <thead><tr className="border-b border-gray-200">
                  <th className={TH}>Reference</th><th className={TH}>Request</th><th className={TH}>Entity</th>
                  <th className={TH}>Status</th><th className={TH}>Waiting on</th><th className={TH}>Flags</th><th className={TH + " text-right"}>Value</th>
                </tr></thead>
                <tbody>
                  {shown.map((c: any) => {
                    const w = waitingOn(c);
                    return (
                      <tr key={c.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                        <td className={TD}><Link to="/ccms/$contractId" params={{ contractId: c.id }} className="font-medium text-blue-700 hover:underline">{c.reference_number}</Link></td>
                        <td className={TD}><div className="font-medium">{c.title}</div><div className="text-sm text-gray-600">{CONTRACT_TYPES[c.contract_type]?.label} · {c.counterparty_name}</div></td>
                        <td className={TD}>{c.entity}</td>
                        <td className={TD}><StatusBadge status={c.status} /></td>
                        <td className={TD}><span className={w?.overdue ? "text-red-700 font-semibold" : ""}>{w?.label ?? "—"}{w?.overdue ? " (overdue)" : ""}</span></td>
                        <td className={TD}><FlagChips flags={c.flags ?? []} max={2} /></td>
                        <td className={TD + " text-right tabular-nums"}>{fmtMoney(c.value, c.currency)}</td>
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
