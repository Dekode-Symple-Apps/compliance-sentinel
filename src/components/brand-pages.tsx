import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { PRIORITY_TINT } from "@/components/ccms-widgets";
import { BrandHeader, BrandStatusBadge, NewSubmissionDialog, RiskBadge } from "@/components/brand-widgets";
import { listBrandSubmissions } from "@/lib/brand.functions";
import {
  AGENCIES, MATERIAL_TYPES, STATUS_META, agencyCompliance, brandPriority, byBrandPriority, latestReview, topViolations, type BrandStatus,
} from "@/lib/brand";
import { GUIDELINE, ruleById } from "@/lib/brand-guideline";
import { Loader2, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const CARD = "rounded-lg border border-gray-200 bg-white";
const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";
const TD = "px-3 py-2.5 text-sm text-gray-900 align-top";

function useSubmissions() {
  const fn = useServerFn(listBrandSubmissions);
  return useQuery({ queryKey: ["brand", "list"], queryFn: () => fn(), staleTime: 10_000 });
}

/** The agency's short name: the acronym in brackets, else the name. */
const shortAgency = (a: string) => a.match(/\(([^)]+)\)\s*$/)?.[1] ?? a;

// ── submissions (Analyses in the Branding Compliance workspace) ──────────────
export function BrandSubmissionsList() {
  const nav = useNavigate();
  const { data: rows = [], isLoading, error } = useSubmissions();
  const [status, setStatus] = useState<"all" | BrandStatus>("all");
  const [agency, setAgency] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const shown = useMemo(() => rows
    .filter((s: any) => (status === "all" || s.status === status) && (agency === "all" || s.agency === agency) &&
      (!q.trim() || `${s.ref} ${s.title} ${s.agency}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort(byBrandPriority), [rows, status, agency, q]);
  const count = (st: BrandStatus) => rows.filter((s: any) => s.status === st).length;

  return (
    <AppShell>
      <BrandHeader subtitle="Submissions" action={<Button className="gap-1.5" onClick={() => setOpen(true)}><Plus className="size-4" /> New Submission</Button>} />
      <div className="p-6 bg-white min-h-full">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "awaiting_decision", "returned", "reviewing", "cleared"] as const).map((k) => (
              <button key={k} onClick={() => setStatus(k)} className={cn("rounded-md border px-3 py-1.5 text-sm", status === k ? "border-gray-900 font-semibold text-gray-900" : "border-gray-200 text-gray-600 hover:border-gray-400")}>
                {k === "all" ? "All" : STATUS_META[k].label} <span className="text-gray-500">{k === "all" ? rows.length : count(k)}</span>
              </button>
            ))}
            <select value={agency} onChange={(e) => setAgency(e.target.value)} className="ml-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm">
              <option value="all">All Agencies</option>
              {AGENCIES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5">
              <Search className="size-4 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference, title, agency" className="w-60 text-sm focus:outline-none" />
            </div>
          </div>
          <div className={CARD}>
            {error ? <p className="p-6 text-sm text-red-700">{(error as Error).message}</p>
              : isLoading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>
              : shown.length === 0 ? <p className="p-6 text-sm text-gray-500">No submissions.</p> : (
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200">
                    <th className={TH}>Ref</th><th className={TH}>Title</th><th className={TH}>Agency</th><th className={TH}>Type</th><th className={TH}>Risk</th><th className={TH}>Status</th><th className={TH}>Submitted</th>
                  </tr></thead>
                  <tbody>
                    {shown.map((s: any) => {
                      const r = latestReview(s);
                      return (
                        <tr key={s.id} onClick={() => nav({ to: "/brand/$reportId", params: { reportId: s.id } })} className={cn("cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50/60", PRIORITY_TINT[brandPriority(s)])}>
                          <td className={TD + " whitespace-nowrap"}><Link to="/brand/$reportId" params={{ reportId: s.id }} onClick={(e) => e.stopPropagation()} className="font-medium text-blue-700 hover:underline">{s.ref}</Link></td>
                          <td className={TD}><div className="font-medium">{s.title}</div><div className="text-sm text-gray-600">v{s.versions?.length ?? 1}{s.decision?.clearance_ref ? ` · ${s.decision.clearance_ref}` : ""}</div></td>
                          <td className={TD}>{shortAgency(s.agency)}</td>
                          <td className={TD}>{MATERIAL_TYPES[s.material_type] ?? s.material_type}</td>
                          <td className={TD}><RiskBadge verdict={r?.verdict} score={r?.riskScore} /></td>
                          <td className={TD}><BrandStatusBadge status={s.status} /></td>
                          <td className={TD + " whitespace-nowrap text-gray-600"}>{format(new Date(s.created_at), "d MMM yyyy")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
          </div>
        </div>
      </div>
      <NewSubmissionDialog open={open} onClose={() => setOpen(false)} />
    </AppShell>
  );
}

// ── dashboard ────────────────────────────────────────────────────────────────
const band = (p: number | null) => p == null ? "border-gray-200 bg-white text-gray-400"
  : p >= 85 ? "border-emerald-200 bg-emerald-50/60 text-emerald-800"
  : p >= 60 ? "border-amber-200 bg-amber-50/60 text-amber-800" : "border-red-200 bg-red-50/60 text-red-800";

export function BrandDashboard() {
  const { data: rows = [], isLoading } = useSubmissions();
  const [open, setOpen] = useState(false);
  const byAgency = agencyCompliance(rows);
  const top = topViolations(rows);
  const reviewed = rows.filter((s: any) => latestReview(s));
  const overall = (() => {
    const all = reviewed.flatMap((s: any) => latestReview(s)!.rules).filter((r: any) => r.outcome === "pass" || r.outcome === "fail");
    return all.length ? Math.round((all.filter((r: any) => r.outcome === "pass").length / all.length) * 100) : null;
  })();
  const tiles = [
    { label: "Submissions", value: rows.length },
    { label: "Compliance", value: overall == null ? "—" : `${overall}%` },
    { label: "Awaiting Decision", value: rows.filter((s: any) => s.status === "awaiting_decision").length, alert: true },
    { label: "Returned", value: rows.filter((s: any) => s.status === "returned").length },
    { label: "Cleared", value: rows.filter((s: any) => s.status === "cleared").length },
  ];
  const agencyTiles = AGENCIES.map((a) => byAgency.find((x) => x.agency === a) ?? { agency: a, compliance: null, submissions: 0, cleared: 0, returned: 0 });

  return (
    <AppShell>
      <BrandHeader subtitle={`Agency materials checked against ${GUIDELINE.code} · ${GUIDELINE.version}`}
        action={<Button className="gap-1.5" onClick={() => setOpen(true)}><Plus className="size-4" /> New Submission</Button>} />
      <div className="p-6 bg-white min-h-full">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {tiles.map((t) => (
              <div key={t.label} className={CARD + " p-4"}>
                <div className="text-sm text-gray-600">{t.label}</div>
                <div className={cn("mt-1 text-2xl font-semibold", t.alert && Number(t.value) > 0 ? "text-amber-700" : "text-gray-900")}>{isLoading ? "…" : t.value}</div>
              </div>
            ))}
          </div>

          <section className={CARD}>
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">Brand Governance · Compliance by Agency</h2>
              <p className="text-sm text-gray-600">Share of guideline rules passed in each agency's latest submissions.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
              {agencyTiles.map((a) => (
                <div key={a.agency} className={cn("rounded-lg border p-3", band(a.compliance))} title={a.agency}>
                  <div className="text-2xl font-semibold">{a.compliance == null ? "—" : `${a.compliance}%`}</div>
                  <div className="mt-1 truncate text-sm font-medium text-gray-900">{shortAgency(a.agency)}</div>
                  <div className="text-xs text-gray-500">{a.submissions} submission{a.submissions === 1 ? "" : "s"}{a.cleared ? ` · ${a.cleared} cleared` : ""}</div>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className={CARD}>
              <div className="px-4 py-3 border-b border-gray-200"><h2 className="text-sm font-semibold text-gray-900">Most-Breached Rules</h2></div>
              {top.length === 0 ? <p className="p-4 text-sm text-gray-500">No reviews yet.</p> : (
                <ul className="divide-y divide-gray-100">
                  {top.map((t) => {
                    const r = ruleById(t.rule_id);
                    return (
                      <li key={t.rule_id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                        <span className="w-14 shrink-0 font-semibold text-gray-900">{t.rule_id}</span>
                        <span className="min-w-0 flex-1 text-gray-700">{r?.rule}</span>
                        <span className="shrink-0 rounded-full border border-red-200 bg-red-50/60 px-2 text-xs font-semibold text-red-800">{t.count}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section className={CARD}>
              <div className="px-4 py-3 border-b border-gray-200 flex items-center"><h2 className="text-sm font-semibold text-gray-900">Needs Attention</h2><Link to="/reports" className="ml-auto text-sm text-blue-700 hover:underline">All submissions →</Link></div>
              {rows.filter((s: any) => brandPriority(s) <= 2).length === 0 ? <p className="p-4 text-sm text-gray-500">Nothing waiting.</p> : (
                <ul className="divide-y divide-gray-100">
                  {[...rows].sort(byBrandPriority).filter((s: any) => brandPriority(s) <= 2).slice(0, 8).map((s: any) => {
                    const r = latestReview(s);
                    return (
                      <li key={s.id} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm", PRIORITY_TINT[brandPriority(s)])}>
                        <Link to="/brand/$reportId" params={{ reportId: s.id }} className="w-28 shrink-0 font-medium text-blue-700 hover:underline">{s.ref}</Link>
                        <span className="min-w-0 flex-1 truncate">{s.title} <span className="text-gray-500">· {shortAgency(s.agency)}</span></span>
                        <RiskBadge verdict={r?.verdict} score={r?.riskScore} />
                        <BrandStatusBadge status={s.status} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
      <NewSubmissionDialog open={open} onClose={() => setOpen(false)} />
    </AppShell>
  );
}
