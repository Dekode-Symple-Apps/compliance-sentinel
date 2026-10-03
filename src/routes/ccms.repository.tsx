import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { listCcmsContracts } from "@/lib/ccms.functions";
import { CcmsHeader, CARD, TH, TD, fmtMoney } from "@/components/ccms-widgets";
import { CONTRACT_TYPES, GENERAL, LSH_ENTITIES, SECURITY_TYPES, contractOwner, daysBetween, entityShort, inFolder, paymentReady, projectFolders, projectOf, typeLabel} from "@/lib/ccms";
import { Building2, Folder, FolderOpen, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileSignedButton } from "@/components/ccms-file-signed";

type RepoSearch = { entity?: string; project?: string; type?: string; owner?: string };
export const Route = createFileRoute("/ccms/repository")({
  // Folders and filters live in the URL, so a folder can be linked to.
  validateSearch: (s: Record<string, unknown>): RepoSearch => ({
    ...(typeof s.entity === "string" ? { entity: s.entity } : {}),
    ...(typeof s.project === "string" ? { project: s.project } : {}),
    ...(typeof s.type === "string" ? { type: s.type } : {}),
    ...(typeof s.owner === "string" ? { owner: s.owner } : {}),
  }),
  component: Repository,
  head: () => ({ meta: [{ title: "Commercial CMS · Repository" }] }),
});

/** Every filed contract, by company, then project (with a General folder for
 *  what is not tied to a project). Type is a filter. Soonest to expire first. */
function Repository() {
  const listFn = useServerFn(listCcmsContracts);
  const nav = useNavigate({ from: "/ccms/repository" });
  const { entity, project, type, owner } = Route.useSearch();
  const go = (s: RepoSearch) => nav({ search: (p: RepoSearch) => Object.fromEntries(Object.entries({ ...p, ...s }).filter(([, v]) => v)) as RepoSearch });
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ["ccms-contracts"], queryFn: () => listFn(), staleTime: 15_000 });
  const [q, setQ] = useState("");
  const [side, setSide] = useState<"all" | "vendor" | "client">("all");
  const filed = useMemo(() => rows.filter((c: any) => c.status === "active" || c.status === "closed"), [rows]);
  const count = (pred: (c: any) => boolean) => filed.filter(pred).length;
  const owners = useMemo(() => [...new Set(filed.map((c: any) => contractOwner(c)).filter(Boolean))].sort() as string[], [filed]);
  const typesIn = useMemo(() => {
    const inHere = filed.filter((c: any) => inFolder(c, entity, project));
    return Object.entries(CONTRACT_TYPES).map(([k, t]) => ({ key: k, label: t.label, n: inHere.filter((c: any) => c.contract_type === k).length })).filter((t) => t.n > 0);
  }, [filed, entity, project]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return filed
      .filter((c: any) => inFolder(c, entity, project))
      .filter((c: any) => !type || c.contract_type === type)
      .filter((c: any) => !owner || contractOwner(c) === owner)
      .filter((c: any) => side === "all" || c.side === side)
      .filter((c: any) => !needle || [c.reference_number, c.title, c.counterparty_name, c.project, c.entity, contractOwner(c)].some((v) => String(v ?? "").toLowerCase().includes(needle)))
      .sort((a: any, b: any) => String(a.expiry_date ?? "9999").localeCompare(String(b.expiry_date ?? "9999")));
  }, [filed, q, side, entity, project, type, owner]);
  const expiring = shown.filter((c: any) => c.expiry_date && daysBetween(new Date(), c.expiry_date) <= 30).length;
  const crumb = [entity ? entityShort(entity) : "Lim Seong Hai Group", project ? (project === GENERAL ? "General" : project) : null].filter(Boolean).join(" › ");
  // A project's bonds and insurance, each with its expiry, across its contracts.
  const securities = project && project !== GENERAL ? shown.flatMap((c: any) => (c.securities ?? []).filter((x: any) => x.required || x.reference).map((x: any) => ({ ...x, c }))) : [];

  const FolderRow = ({ active, onClick, icon, label, n, indent }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; n: number; indent?: boolean }) => (
    <button onClick={onClick} title={label} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", indent && "pl-7", active ? "bg-gray-100 font-semibold text-gray-900" : "text-gray-700 hover:bg-gray-50")}>
      {icon}<span className="flex-1 truncate">{label}</span><span className="text-xs tabular-nums text-gray-500">{n}</span>
    </button>
  );

  return (
    <AppShell>
      <CcmsHeader subtitle="Contract repository — filed contracts by company and project, alerted 30 days before expiry" action={<FileSignedButton contracts={rows} />} />
      <div className="grid min-h-full grid-cols-1 gap-5 bg-white p-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-0.5">
          <FolderRow active={!entity} onClick={() => go({ entity: undefined, project: undefined, type: undefined })} icon={<Building2 className="size-4 text-gray-500" />} label="Lim Seong Hai Group" n={filed.length} />
          {LSH_ENTITIES.map((e) => {
            const open = entity === e;
            return (
              <div key={e}>
                <FolderRow active={open && !project} onClick={() => go({ entity: e, project: undefined, type: undefined })} indent
                  icon={open ? <FolderOpen className="size-4 text-amber-600" /> : <Folder className="size-4 text-amber-500" />} label={entityShort(e)} n={count((c) => c.entity === e)} />
                {open && projectFolders(filed, e).map((p) => (
                  <button key={p.key} onClick={() => go({ project: p.key, type: undefined })} title={p.key === GENERAL ? "Not tied to a project: tenancy, company-wide NDAs and the like" : p.label}
                    className={cn("flex w-full items-center gap-2 rounded-md py-1 pl-12 pr-2 text-left text-sm", project === p.key ? "bg-gray-100 font-semibold text-gray-900" : "text-gray-600 hover:bg-gray-50", p.key === GENERAL && "italic")}>
                    <Folder className="size-3.5 shrink-0 text-gray-400" /><span className="flex-1 truncate">{p.label}</span><span className="text-xs tabular-nums text-gray-500">{p.n}</span>
                  </button>
                ))}
              </div>
            );
          })}
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
          {typesIn.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => go({ type: undefined })} className={cn("rounded-full border px-3 py-1 text-sm", !type ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-600 hover:border-gray-400")}>All types</button>
              {typesIn.map((t) => (
                <button key={t.key} onClick={() => go({ type: type === t.key ? undefined : t.key })} className={cn("rounded-full border px-3 py-1 text-sm", type === t.key ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-600 hover:border-gray-400")}>
                  {t.label} <span className={type === t.key ? "text-gray-300" : "text-gray-500"}>{t.n}</span>
                </button>
              ))}
            </div>
          )}
          {securities.length > 0 && (
            <div className={CARD}>
              <div className="border-b border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-900">Bonds &amp; insurance · {project}</div>
              <table className="w-full"><thead><tr className="border-b border-gray-200"><th className={TH}>Instrument</th><th className={TH}>Contract</th><th className={TH + " text-right"}>Amount</th><th className={TH}>Reference</th><th className={TH}>Valid until</th></tr></thead>
                <tbody>{securities.sort((a: any, b: any) => String(a.valid_until ?? "9999").localeCompare(String(b.valid_until ?? "9999"))).map((x: any, i: number) => {
                  const d = x.valid_until ? daysBetween(new Date(), x.valid_until) : null;
                  return (
                    <tr key={i} className="border-b border-gray-100 last:border-0">
                      <td className={TD}>{SECURITY_TYPES.find((t) => t.id === x.type)?.label ?? x.type}{x.state && x.state !== "held" ? <span className="text-gray-500"> · {x.state}</span> : ""}</td>
                      <td className={TD}><Link to="/ccms/$contractId" params={{ contractId: x.c.id }} className="text-blue-700 hover:underline">{x.c.reference_number}</Link></td>
                      <td className={TD + " text-right tabular-nums"}>{x.amount != null ? fmtMoney(x.amount) : "—"}</td>
                      <td className={TD}>{x.reference || <span className="text-amber-700">not yet received</span>}</td>
                      <td className={TD}>{x.valid_until ? <span className={cn(d != null && d < 0 ? "font-semibold text-red-700" : d != null && d <= 30 ? "font-semibold text-amber-700" : "text-gray-700")}>{x.valid_until}{d != null ? ` (${d < 0 ? `${-d}d ago` : `${d}d`})` : ""}</span> : "—"}</td>
                    </tr>
                  );
                })}</tbody></table>
            </div>
          )}
          {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
          <div className={CARD}>
            {isLoading ? <div className="flex items-center gap-2 p-6 text-sm text-gray-500"><Loader2 className="size-4 animate-spin" /> Loading…</div>
              : shown.length === 0 ? <p className="p-6 text-sm text-gray-500">{filed.length ? "No contracts in this folder." : "Nothing in the repository yet. A contract arrives here once it is signed and its key terms are confirmed."}</p>
              : (
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200">
                    <th className={TH}>Contract</th><th className={TH}>Company · project</th><th className={TH}>Counterparty</th><th className={TH}>Owner</th>
                    <th className={TH + " text-right"}>Value</th><th className={TH}>Period</th><th className={TH}>Expiry</th><th className={TH}>Payment-ready</th>
                  </tr></thead>
                  <tbody>
                    {shown.map((c: any) => {
                      const d = c.expiry_date ? daysBetween(new Date(), c.expiry_date) : null;
                      return (
                        <tr key={c.id} className="border-b border-gray-100 last:border-0">
                          <td className={TD}><Link to="/ccms/$contractId" params={{ contractId: c.id }} className="font-medium text-blue-700 hover:underline">{c.reference_number}</Link><div className="text-sm text-gray-900">{c.title}</div><div className="text-sm text-gray-600">{typeLabel(c)} · {c.side === "client" ? "client" : "vendor"}</div></td>
                          <td className={TD}><button onClick={() => go({ entity: c.entity, project: undefined, type: undefined })} title={c.entity} className="text-left text-gray-900 hover:underline">{entityShort(c.entity)}</button>
                            <button onClick={() => go({ entity: c.entity, project: projectOf(c) ?? GENERAL, type: undefined })} className="block text-left text-sm text-gray-600 hover:underline">{projectOf(c) ?? "General"}</button></td>
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
