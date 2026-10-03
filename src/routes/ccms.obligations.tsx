import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { listCcmsContracts } from "@/lib/ccms.functions";
import { CcmsHeader, CARD, TH, TD } from "@/components/ccms-widgets";
import { CATEGORY_TINT, ObligationRows } from "@/components/ccms-obligations";
import { AuditFindings } from "@/components/ccms-audit-findings";
import {
  CONTRACT_TYPES, DEMO_PEOPLE, LSH_ENTITIES, OBLIGATION_CATEGORIES, OBLIGATION_KINDS, contractOwner, daysBetween, entityShort, flowOf, kindOf, normalizeObligations, obligationBucket,
  type Obligation, type ObligationBucket, type ObligationCategory, type ObligationKind, typeLabel} from "@/lib/ccms";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ObTab = "obligations" | "owned" | "stamping" | "findings";
type ObSearch = { person?: string; cat?: ObligationCategory; kind?: ObligationKind; entity?: string; tab?: ObTab };
export const Route = createFileRoute("/ccms/obligations")({
  validateSearch: (s: Record<string, unknown>): ObSearch => ({
    ...(typeof s.person === "string" ? { person: s.person } : {}),
    ...(["finance", "business", "legal"].includes(s.cat as string) ? { cat: s.cat as ObligationCategory } : {}),
    ...(typeof s.kind === "string" && s.kind in OBLIGATION_KINDS ? { kind: s.kind as ObligationKind } : {}),
    ...(typeof s.entity === "string" ? { entity: s.entity } : {}),
    ...(["owned", "stamping", "findings"].includes(s.tab as string) ? { tab: s.tab as ObTab } : {}),
  }),
  component: Obligations,
  head: () => ({ meta: [{ title: "Commercial CMS · Obligations" }] }),
});

const GROUPS: { key: ObligationBucket; label: string; tone: string }[] = [
  { key: "overdue", label: "Overdue", tone: "text-red-700" },
  { key: "soon", label: "Due in the next 30 days", tone: "text-amber-700" },
  { key: "later", label: "Later", tone: "text-gray-900" },
  { key: "nodate", label: "No date — on a trigger", tone: "text-gray-900" },
  { key: "done", label: "Done", tone: "text-emerald-700" },
];

/** Every obligation across filed contracts, by person and category — so Finance
 *  sees the payments, Legal the notices, and the owner the business duties. */
function Obligations() {
  const listFn = useServerFn(listCcmsContracts);
  const qc = useQueryClient();
  const nav = useNavigate({ from: "/ccms/obligations" });
  const { person, cat, kind, entity, tab = "obligations" } = Route.useSearch();
  const go = (s: ObSearch) => nav({ search: (p: ObSearch) => Object.fromEntries(Object.entries({ ...p, ...s }).filter(([, v]) => v)) as ObSearch });
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["ccms-contracts"], queryFn: () => listFn(), staleTime: 15_000 });
  const filed = useMemo(() => rows.filter((c: any) => c.repository && (c.status === "active" || c.status === "closed")), [rows]);
  const all = useMemo(() => filed.flatMap((c: any) => normalizeObligations(c.repository.obligations, contractOwner(c)).map((o: Obligation) => ({ o, c }))), [filed]);
  const people = useMemo(() => {
    const names = new Set<string>([...DEMO_PEOPLE.map((p) => p.name), ...all.map((x) => x.o.pic), ...filed.map((c: any) => contractOwner(c))].filter(Boolean));
    return [...names].map((n) => ({ name: n, team: DEMO_PEOPLE.find((p) => p.name === n)?.team }));
  }, [all, filed]);
  const byPerson = all.filter((x) => (!person || x.o.pic === person) && (!cat || x.o.category === cat));
  const kinds = (Object.keys(OBLIGATION_KINDS) as ObligationKind[]).map((k) => ({ k, n: byPerson.filter((x) => x.o.status === "open" && kindOf(x.o) === k).length })).filter((x) => x.n > 0);
  const mine = byPerson.filter((x) => !kind || kindOf(x.o) === kind);
  // Stamp duty register: every signed full-flow contract, stamped or not, across the companies.
  const signed = rows.filter((c: any) => c.signed_date && flowOf(c) === "full" && (!entity || c.entity === entity))
    .sort((a: any, b: any) => Number(!!a.stamping?.stamped_date) - Number(!!b.stamping?.stamped_date) || String(a.signed_date).localeCompare(String(b.signed_date)));
  const byDue = (a: { o: Obligation }, b: { o: Obligation }) => String(a.o.due_date ?? "9999").localeCompare(String(b.o.due_date ?? "9999"));
  const refresh = () => qc.invalidateQueries({ queryKey: ["ccms-contracts"] });
  const owned = filed.filter((c: any) => !person || contractOwner(c) === person);
  const openCount = (pred: (x: { o: Obligation }) => boolean) => all.filter((x) => x.o.status === "open" && pred(x)).length;

  return (
    <AppShell>
      <CcmsHeader subtitle="Obligations — what each person must do under filed contracts, by category and due date" />
      <div className="min-h-full space-y-4 bg-white p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-600">Showing</span>
          <select value={person ?? ""} onChange={(e) => go({ person: e.target.value || undefined })} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium">
            <option value="">Everyone</option>
            {people.map((p) => <option key={p.name} value={p.name}>{p.name}{p.team ? ` · ${OBLIGATION_CATEGORIES[p.team]}` : ""}</option>)}
          </select>
          <div className="ml-2 flex gap-1.5">
            <button onClick={() => go({ cat: undefined })} className={cn("rounded-full border px-3 py-1 text-sm", !cat ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>All <span className="text-gray-500">{openCount((x) => !person || x.o.pic === person)}</span></button>
            {(Object.keys(OBLIGATION_CATEGORIES) as ObligationCategory[]).map((k) => (
              <button key={k} onClick={() => go({ cat: cat === k ? undefined : k })} className={cn("rounded-full border px-3 py-1 text-sm", cat === k ? CATEGORY_TINT[k] + " font-semibold" : "border-gray-200 text-gray-600")}>
                {OBLIGATION_CATEGORIES[k]} <span className="text-gray-500">{openCount((x) => x.o.category === k && (!person || x.o.pic === person))}</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex rounded-md border border-gray-200 p-0.5 text-sm">
            <button onClick={() => go({ tab: undefined })} className={cn("rounded px-3 py-1", tab === "obligations" ? "bg-gray-900 text-white" : "text-gray-600")}>Obligations</button>
            <button onClick={() => go({ tab: "owned" })} className={cn("rounded px-3 py-1", tab === "owned" ? "bg-gray-900 text-white" : "text-gray-600")}>Contracts Owned</button>
            <button onClick={() => go({ tab: "stamping" })} className={cn("rounded px-3 py-1", tab === "stamping" ? "bg-gray-900 text-white" : "text-gray-600")}>Stamp Duty</button>
            <button onClick={() => go({ tab: "findings" })} className={cn("rounded px-3 py-1", tab === "findings" ? "bg-gray-900 text-white" : "text-gray-600")}>Audit Findings</button>
          </div>
        </div>

        {tab === "obligations" && kinds.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => go({ kind: undefined })} className={cn("rounded-md border px-2.5 py-1 text-sm", !kind ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>All kinds</button>
            {kinds.map(({ k, n }) => <button key={k} onClick={() => go({ kind: kind === k ? undefined : k })} className={cn("rounded-md border px-2.5 py-1 text-sm", kind === k ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>{OBLIGATION_KINDS[k]} <span className="text-gray-500">{n}</span></button>)}
          </div>
        )}
        {isLoading ? <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="size-4 animate-spin" /> Loading…</p>
          : tab === "findings" ? <AuditFindings />
          : tab === "stamping" ? (
            <div className={CARD}>
              <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
                <div className="flex-1"><h2 className="text-sm font-semibold text-gray-900">Stamp duty register</h2><p className="text-sm text-gray-600">Every signed contract: stamped within 30 days of signing, or not yet.</p></div>
                <select value={entity ?? ""} onChange={(e) => go({ entity: e.target.value || undefined })} className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm">
                  <option value="">All companies</option>{LSH_ENTITIES.map((e) => <option key={e} value={e}>{entityShort(e)}</option>)}
                </select>
              </div>
              {signed.length === 0 ? <p className="p-6 text-sm text-gray-500">No signed contracts{entity ? ` for ${entityShort(entity)}` : ""}.</p> : (
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200"><th className={TH}>Contract</th><th className={TH}>Company</th><th className={TH}>Signed</th><th className={TH}>Stamped</th><th className={TH + " text-right"}>Duty (RM)</th><th className={TH}>Certificate</th><th className={TH}>Status</th></tr></thead>
                  <tbody>
                    {signed.map((c: any) => {
                      const st = c.stamping ?? {};
                      const day = daysBetween(c.signed_date, new Date());
                      return (
                        <tr key={c.id} className={cn("border-b border-gray-100 last:border-0", !st.stamped_date && day > 30 && "bg-red-50/40")}>
                          <td className={TD}><Link to="/ccms/$contractId" params={{ contractId: c.id }} className="font-medium text-blue-700 hover:underline">{c.reference_number}</Link><div className="text-sm text-gray-600">{c.counterparty_name}</div></td>
                          <td className={TD} title={c.entity}>{entityShort(c.entity)}</td>
                          <td className={TD}>{c.signed_date}</td>
                          <td className={TD}>{st.stamped_date ?? "—"}</td>
                          <td className={TD + " text-right tabular-nums"}>{st.duty != null ? Number(st.duty).toLocaleString() : "—"}</td>
                          <td className={TD}>{st.certificate_no ?? "—"}</td>
                          <td className={TD}>{st.stamped_date ? <span className="text-emerald-700">Stamped</span> : day > 30 ? <span className="font-semibold text-red-700">Overdue by {day - 30} days</span> : <span className={day >= 14 ? "text-amber-700" : "text-gray-700"}>Day {day} of 30</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ) : tab === "owned" ? (
            <div className={CARD}>
              {owned.length === 0 ? <p className="p-6 text-sm text-gray-500">No filed contracts owned{person ? ` by ${person}` : ""}.</p> : (
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200"><th className={TH}>Contract</th><th className={TH}>Entity</th><th className={TH}>Counterparty</th><th className={TH}>Owner</th><th className={TH}>Open obligations</th><th className={TH}>Expiry</th></tr></thead>
                  <tbody>
                    {owned.map((c: any) => {
                      const obl = normalizeObligations(c.repository.obligations, contractOwner(c)).filter((o) => o.status === "open");
                      const d = c.expiry_date ? daysBetween(new Date(), c.expiry_date) : null;
                      return (
                        <tr key={c.id} className="border-b border-gray-100 last:border-0">
                          <td className={TD}><Link to="/ccms/$contractId" params={{ contractId: c.id }} className="font-medium text-blue-700 hover:underline">{c.reference_number}</Link><div className="text-sm text-gray-600">{typeLabel(c)}</div></td>
                          <td className={TD} title={c.entity}>{entityShort(c.entity)}</td>
                          <td className={TD}>{c.counterparty_name}</td>
                          <td className={TD}>{contractOwner(c)}</td>
                          <td className={TD}>{obl.length}{obl.some((o) => obligationBucket(o) === "overdue") && <span className="ml-1 text-red-700">· overdue</span>}</td>
                          <td className={TD}>{c.expiry_date ?? "—"}{d != null && <span className="block text-xs text-gray-500">{d} days</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ) : mine.length === 0 ? (
            <div className={CARD + " p-6 text-sm text-gray-500"}>No obligations{person ? ` for ${person}` : ""}{cat ? ` in ${OBLIGATION_CATEGORIES[cat]}` : ""}. Obligations come from filed contracts: File to Repository extracts them, with a person in charge and a due date for each.</div>
          ) : (
            GROUPS.map((g) => {
              const items = mine.filter((x) => obligationBucket(x.o) === g.key).sort(byDue);
              if (!items.length) return null;
              return (
                <section key={g.key} className={CARD}>
                  <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-2.5">
                    <h2 className={cn("text-sm font-semibold", g.tone)}>{g.label}</h2><span className="text-sm text-gray-500">{items.length}</span>
                  </div>
                  <ObligationRows rows={items} showContract onChanged={refresh} />
                </section>
              );
            })
          )}
      </div>
    </AppShell>
  );
}
