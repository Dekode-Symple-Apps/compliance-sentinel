import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { listCcmsContracts } from "@/lib/ccms.functions";
import { CcmsHeader, CARD, TH, TD, fmtMoney } from "@/components/ccms-widgets";
import { CONTRACT_TYPES, LSH_ENTITIES, contractOwner, daysBetween, entityShort, paymentReady } from "@/lib/ccms";
import { Building2, Folder, FolderOpen, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type RepoSearch = { entity?: string; type?: string; owner?: string };
export const Route = createFileRoute("/ccms/repository")({
  // Folders and filters live in the URL, so a folder can be linked to.
  validateSearch: (s: Record<string, unknown>): RepoSearch => ({
    ...(typeof s.entity === "string" ? { entity: s.entity } : {}),
    ...(typeof s.type === "string" ? { type: s.type } : {}),
    ...(typeof s.owner === "string" ? { owner: s.owner } : {}),
  }),
  component: Repository,
  head: () => ({ meta: [{ title: "Commercial CMS · Repository" }] }),
});

/** Every filed contract, grouped by the subsidiary it belongs to and, within
 *  it, by contract type — soonest to expire first. */
function Repository() {
  const listFn = useServerFn(listCcmsContracts);
  const nav = useNavigate({ from: "/ccms/repository" });
  const { entity, type, owner } = Route.useSearch();
  const go = (s: RepoSearch) => nav({ search: (p: RepoSearch) => Object.fromEntries(Object.entries({ ...p, ...s }).filter(([, v]) => v)) as RepoSearch });
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ["ccms-contracts"], queryFn: () => listFn(), staleTime: 15_000 });
  const [q, setQ] = useState("");
  const [side, setSide] = useState<"all" | "vendor" | "client">("all");
  const filed = useMemo(() => rows.filter((c: any) => c.status === "active" || c.status === "closed"), [rows]);
  const count = (pred: (c: any) => boolean) => filed.filter(pred).length;
  const owners = useMemo(() => [...new Set(filed.map((c: any) => contractOwner(c)).filter(Boolean))].sort() as string[], [filed]);
  const typesIn = useMemo(() => {
    const inEntity = filed.filter((c: any) => !entity || c.entity === entity);
    return Object.entries(CONTRACT_TYPES).map(([k, t]) => ({ key: k, label: t.label, n: inEntity.filter((c: any) => c.contract_type === k).length })).filter((t) => t.n > 0);
  }, [filed, entity]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return filed
      .filter((c: any) => !entity || c.entity === entity)
      .filter((c: any) => !type || c.contract_type === type)
      .filter((c: any) => !owner || contractOwner(c) === owner)
      .filter((c: any) => side === "all" || c.side === side)
      .filter((c: any) => !needle || [c.reference_number, c.title, c.counterparty_name, c.project, c.entity, contractOwner(c)].some((v) => String(v ?? "").toLowerCase().includes(needle)))
      .sort((a: any, b: any) => String(a.expiry_date ?? "9999").localeCompare(String(b.expiry_date ?? "9999")));
  }, [filed, q, side, entity, type, owner]);
  const expiring = shown.filter((c: any) => c.expiry_date && daysBetween(new Date(), c.expiry_date) <= 30).length;
  const crumb = [entity ? entityShort(entity) : "Lim Seong Hai Group", type ? CONTRACT_TYPES[type]?.label : null].filter(Boolean).join(" › ");

  const FolderRow = ({ active, onClick, icon, label, n, indent }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; n: number; indent?: boolean }) => (
    <button onClick={onClick} title={label} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", indent && "pl-7", active ? "bg-gray-100 font-semibold text-gray-900" : "text-gray-700 hover:bg-gray-50")}>
      {icon}<span className="flex-1 truncate">{label}</span><span className="text-xs tabular-nums text-gray-500">{n}</span>
    </button>
  );

  return (
    <AppShell>
      <CcmsHeader subtitle="Contract repository — filed contracts by subsidiary and type, alerted 30 days before expiry" />
      <div className="grid min-h-full grid-cols-1 gap-5 bg-white p-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-0.5">
          <FolderRow active={!entity && !type} onClick={() => go({ entity: undefined, type: undefined })} icon={<Building2 className="size-4 text-gray-500" />} label="Lim Seong Hai Group" n={filed.length} />
          {LSH_ENTITIES.map((e) => {
            const open = entity === e;
            return (
              <div key={e}>
                <FolderRow active={open && !type} onClick={() => go({ entity: e, type: undefined })} indent
                  icon={open ? <FolderOpen className="size-4 text-amber-600" /> : <Folder className="size-4 text-amber-500" />} label={entityShort(e)} n={count((c) => c.entity === e)} />
                {open && typesIn.map((t) => (
                  <button key={t.key} onClick={() => go({ type: t.key })}
                    className={cn("flex w-full items-center gap-2 rounded-md py-1 pl-12 pr-2 text-left text-sm", type === t.key ? "bg-gray-100 font-semibold text-gray-900" : "text-gray-600 hover:bg-gray-50")}>
                    <span className="flex-1 truncate">{t.label}</span><span className="text-xs tabular-nums text-gray-500">{t.n}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {!entity && typesIn.length > 0 && (
            <div className="pt-3">
              <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">By type</div>
              {typesIn.map((t) => (
                <button key={t.key} onClick={() => go({ type: type === t.key ? undefined : t.key })}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm", type === t.key ? "bg-gray-100 font-semibold text-gray-900" : "text-gray-600 hover:bg-gray-50")}>
                  <Folder className="size-3.5 text-gray-400" /><span className="flex-1 truncate">{t.label}</span><span className="text-xs tabular-nums text-gray-500">{t.n}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm text-gray-700"><span className="font-semibold text-gray-900">{crumb}</span> · {shown.length} contract{shown.length === 1 ? "" : "s"}{expiring ? <span className="font-semibold text-red-700"> · {expiring} expiring within 30 days</span> : null}</div>
            <select value={owner ?? ""} onChange={(e) => go({ owner: e.target.value || undefined })} className="ml-auto rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm">
              <option value="">All owners</option>{owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <select value={side} onChange={(e) => setSide(e.target.value as any)} className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm">
              <option value="all">Vendor and client</option><option value="vendor">Vendor contracts</option><option value="client">Client contracts</option>
            </select>
            <div className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5">
              <Search className="size-4 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="w-52 text-sm focus:outline-none" />
            </div>
          </div>
          {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
          <div className={CARD}>
            {isLoading ? <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="size-4 animate-spin" /> Loading…</div>
              : shown.length === 0 ? <p className="p-6 text-sm text-gray-500">{filed.length ? "No contracts in this folder." : "Nothing in the repository yet. A contract arrives here once it is signed and its key terms are confirmed."}</p>
              : (
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200">
                    <th className={TH}>Contract</th><th className={TH}>Entity</th><th className={TH}>Counterparty</th><th className={TH}>Owner</th>
                    <th className={TH + " text-right"}>Value</th><th className={TH}>Period</th><th className={TH}>Expiry</th><th className={TH}>Payment-ready</th>
                  </tr></thead>
                  <tbody>
                    {shown.map((c: any) => {
                      const d = c.expiry_date ? daysBetween(new Date(), c.expiry_date) : null;
                      return (
                        <tr key={c.id} className="border-b border-gray-100 last:border-0">
                          <td className={TD}><Link to="/ccms/$contractId" params={{ contractId: c.id }} className="font-medium text-blue-700 hover:underline">{c.reference_number}</Link><div className="text-sm text-gray-900">{c.title}</div><div className="text-sm text-gray-600">{CONTRACT_TYPES[c.contract_type]?.label} · {c.side === "client" ? "client" : "vendor"}</div></td>
                          <td className={TD}><button onClick={() => go({ entity: c.entity, type: undefined })} title={c.entity} className="text-left text-gray-900 hover:underline">{entityShort(c.entity)}</button></td>
                          <td className={TD}>{c.counterparty_name}</td>
                          <td className={TD + " text-gray-700"}>{contractOwner(c) || "—"}</td>
                          <td className={TD + " text-right tabular-nums"}>{fmtMoney(c.repository?.value ?? c.value, c.repository?.currency ?? c.currency)}</td>
                          <td className={TD + " text-gray-700"}>{c.repository?.start_date ?? c.start_date ?? "—"} to {c.expiry_date ?? "—"}</td>
                          <td className={TD}>{d == null ? "—" : <span className={cn(d <= 7 ? "font-semibold text-red-700" : d <= 30 ? "font-semibold text-amber-700" : "text-gray-700")}>{d < 0 ? `expired ${-d}d ago` : `${d} days`}</span>}</td>
                          <td className={TD}>{(c.securities ?? []).length === 0 ? "—" : paymentReady(c.securities) ? <span className="text-emerald-700">Yes</span> : <span className="text-amber-700">Incomplete</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
