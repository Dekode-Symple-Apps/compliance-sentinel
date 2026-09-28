import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { PdfViewer } from "@/components/pdf-viewer";
import { CostChip, SeverityIcon, friendlyError, NoteText } from "@/components/ccms-widgets";
import {
  BrandHeader, BrandStatusBadge, DecisionDialog, ImageBoxViewer, RevisionDialog, RiskBadge, useBrandRole,
} from "@/components/brand-widgets";
import { getBrandSubmission, runBrandReview } from "@/lib/brand.functions";
import {
  BRAND_ROLES, CHANNELS, MATERIAL_TYPES, brandActions, brandMilestones, type BrandFinding, type BrandReview,
} from "@/lib/brand";
import { BRAND_RULES, CATEGORIES, GUIDELINE, ruleById } from "@/lib/brand-guideline";
import { displayName } from "@/lib/ccms";
import { ArrowLeft, Check, Circle, Loader2, Minus, HelpCircle, X, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/brand/$reportId")({
  component: BrandSubmission,
  head: () => ({ meta: [{ title: "Branding Compliance · Submission" }] }),
});

const SEV_ORDER: Record<string, number> = { red_flag: 0, caution: 1, info: 2 };
type Tab = "findings" | "rules" | "details";

function BrandSubmission() {
  const { reportId } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(getBrandSubmission);
  const runFn = useServerFn(runBrandReview);
  const [role, setRole] = useBrandRole();
  const { data: s, isLoading, error } = useQuery({
    queryKey: ["brand", "submission", reportId],
    queryFn: () => getFn({ data: { id: reportId } }),
    // Another tab may be running the review: check back until it lands.
    refetchInterval: (q) => ((q.state.data as any)?.status === "reviewing" ? 4000 : false),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["brand"] }); };
  const [running, setRunning] = useState(false);
  const started = useRef<string | null>(null);
  const [tab, setTab] = useState<Tab>("findings");
  const [active, setActive] = useState<string | null>(null);
  const [focusPage, setFocusPage] = useState<number | null>(null);
  const [viewV, setViewV] = useState<number | null>(null);
  const [dialog, setDialog] = useState<"clear" | "return" | "revise" | null>(null);

  const versions: any[] = (s as any)?.versions ?? [];
  const latest = versions.at(-1);
  // Start the AI review for a version that has not been reviewed yet.
  async function review() {
    setRunning(true);
    try { const r: any = await runFn({ data: { id: reportId } }); toast.success(`Reviewed — risk ${r.riskScore}, ${r.findings} finding${r.findings === 1 ? "" : "s"}`); }
    catch (e: any) { toast.error(friendlyError(e)); }
    finally { setRunning(false); refresh(); }
  }
  useEffect(() => {
    if (!latest || latest.review_status !== "pending") return;
    const key = `${reportId}:${latest.v}`;
    if (started.current === key) return;
    started.current = key;
    review();
  }, [latest?.v, latest?.review_status]);
  useEffect(() => { setViewV(null); setActive(null); setFocusPage(null); }, [latest?.v]);

  const shown = versions.find((x) => x.v === viewV) ?? latest;
  const rv: BrandReview | null = shown?.review ?? null;
  const findings = useMemo(() => [...(rv?.findings ?? [])].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.page - b.page), [rv]);
  const pageMarks = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of findings) { const cur = m.get(f.page); if (!cur || SEV_ORDER[f.severity] < SEV_ORDER[cur]) m.set(f.page, f.severity); }
    return m;
  }, [findings]);

  if (isLoading) return <AppShell><div className="p-10 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div></AppShell>;
  if (error || !s) return <AppShell><div className="p-10 text-sm text-red-700">{(error as Error)?.message ?? "Not found"}</div></AppShell>;
  const sub: any = s;
  // The server's status decides: it is polled while a review runs, so the page
  // settles even if this browser's own request was paused (a hidden tab).
  const reviewing = sub.status === "reviewing";
  const stages = brandMilestones(sub);
  const actions = brandActions(sub);
  const redFlags = (latest?.review?.findings ?? []).filter((f: BrandFinding) => f.severity === "red_flag").length;
  const select = (f: BrandFinding) => { setActive(f.id); if (!f.box) setFocusPage(f.page); };
  const act = (a: ReturnType<typeof brandActions>[number]) => {
    if (role !== a.role) setRole(a.role);
    if (a.id === "rerun") review(); else setDialog(a.id);
  };

  return (
    <AppShell>
      <BrandHeader title={`${sub.ref} · ${sub.title}`} subtitle={`${sub.agency} · ${MATERIAL_TYPES[sub.material_type] ?? sub.material_type} · ${CHANNELS[sub.channel] ?? sub.channel}`}
        action={<div className="flex items-center gap-2"><BrandStatusBadge status={reviewing ? "reviewing" : sub.status} /><CostChip log={sub.cost_log ?? []} /></div>} />
      <div className="bg-white">
        <div className="px-6 pt-3"><Link to="/reports" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline"><ArrowLeft className="size-4" /> Submissions</Link></div>

        {/* milestones and the action for the current step */}
        <section className="mx-6 my-3 rounded-lg border border-gray-200 p-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            {stages.map((st, i) => (
              <div key={st.key} className="flex items-center gap-2">
                <span className={cn("size-6 rounded-full border-2 grid place-items-center", st.state === "done" ? "border-emerald-500 bg-emerald-500 text-white" : st.state === "current" ? "border-sky-600 bg-sky-50" : "border-gray-200")}>
                  {st.state === "done" ? <Check className="size-3.5" /> : <Circle className={cn("size-2", st.state === "current" ? "fill-sky-600 text-sky-600" : "text-gray-300")} />}
                </span>
                <span className={cn("text-sm", st.state === "current" ? "font-semibold text-sky-900" : st.state === "done" ? "text-gray-900" : "text-gray-500")}>{st.label}</span>
                {i < stages.length - 1 && <span className={cn("mx-1 h-0.5 w-6", st.state === "done" ? "bg-emerald-500" : "bg-gray-200")} />}
              </div>
            ))}
            <div className="ml-auto flex items-center gap-2">
              {reviewing && <span className="flex items-center gap-2 text-sm text-sky-800"><Loader2 className="size-4 animate-spin" /> AI review in progress…</span>}
              {!reviewing && actions.map((a) => (
                <Button key={a.id} size="sm" variant={a.primary ? "default" : "outline"} onClick={() => act(a)}>{a.label}</Button>
              ))}
            </div>
          </div>
          {sub.status === "cleared" && sub.decision && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm text-emerald-900">
              <ShieldCheck className="size-4" /> Cleared for public use · <b>{sub.decision.clearance_ref}</b> · {format(new Date(sub.decision.at), "d MMM yyyy")} · {displayName(sub.decision.by)}{sub.decision.note ? ` — ${sub.decision.note}` : ""}
            </div>
          )}
          {sub.status === "returned" && sub.decision && (
            <div className="mt-3 rounded-md border border-orange-200 bg-orange-50/50 px-3 py-2 text-sm text-orange-900">Returned by {displayName(sub.decision.by)}<NoteText text={sub.decision.note} className="mt-1" /></div>
          )}
          {latest?.review_status === "failed" && <div className="mt-3 rounded-md border border-red-200 bg-red-50/50 px-3 py-2 text-sm text-red-800">AI review failed: {latest.error}</div>}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_460px] border-t border-gray-200 h-[calc(100vh-15rem)]">
          <div className="min-w-0 border-r border-gray-200 bg-gray-50">
            {!shown?.view_url
              ? <div className="grid h-full place-items-center text-sm text-gray-500">{reviewing ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Preparing the document…</span> : "No preview yet."}</div>
              : shown.view_kind === "image"
                ? <ImageBoxViewer url={shown.view_url} findings={findings} activeId={active} onSelect={(id) => setActive(id)} />
                : <PdfViewer fileUrl={shown.view_url} focusPage={focusPage} activeId={active} onSelect={(id) => setActive(id)}
                    boxes={findings.filter((f) => f.box).map((f) => ({ id: f.id, page: f.page, box: f.box!, kind: f.severity === "red_flag" ? "critical" : f.severity === "caution" ? "medium" : "info", label: f.rule_id }))} />}
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="border-b border-gray-200 px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-3">
                <RiskBadge verdict={rv?.verdict} score={rv?.riskScore} showLabel />
                {versions.length > 1 && (
                  <select value={shown?.v} onChange={(e) => setViewV(Number(e.target.value))} className="ml-auto rounded-md border border-gray-200 bg-white px-2 py-1 text-sm">
                    {versions.map((x) => <option key={x.v} value={x.v}>v{x.v}{x.review ? ` · risk ${x.review.riskScore}` : ""}{x.v === latest?.v ? " · latest" : ""}</option>)}
                  </select>
                )}
              </div>
              {rv?.summary && <p className="text-sm text-gray-700">{rv.summary}</p>}
              {rv && rv.pages > 1 && (
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <span className="mr-1 text-xs text-gray-500">Pages</span>
                  {Array.from({ length: rv.pages }, (_, i) => i + 1).map((p) => {
                    const m = pageMarks.get(p);
                    return (
                      <button key={p} onClick={() => { setActive(null); setFocusPage(p); }}
                        className={cn("size-7 rounded border text-xs font-semibold", m === "red_flag" ? "border-red-300 bg-red-50 text-red-800" : m === "caution" ? "border-amber-300 bg-amber-50 text-amber-800" : m ? "border-sky-200 bg-sky-50 text-sky-800" : "border-gray-200 text-gray-500")}>{p}</button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex border-b border-gray-200">
              {([["findings", `Findings ${findings.length}`], ["rules", `Rules ${rv ? rv.rules.filter((r) => r.outcome === "fail").length + " failed" : ""}`], ["details", "Details"]] as [Tab, string][]).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={cn("flex-1 px-3 py-2.5 text-sm", tab === k ? "border-b-2 border-gray-900 font-semibold text-gray-900" : "text-gray-600")}>{l}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {tab === "findings" && (!rv ? <p className="text-sm text-gray-500">{reviewing ? "Reviewing…" : "Not reviewed yet."}</p> : findings.length === 0
                ? <p className="flex items-center gap-2 text-sm text-emerald-800"><Check className="size-4" /> No breaches found against {GUIDELINE.code}.</p>
                : findings.map((f) => (
                  <button key={f.id} onClick={() => select(f)} className={cn("block w-full rounded-lg border bg-white p-3 text-left hover:border-gray-400", active === f.id ? "border-gray-900 ring-1 ring-gray-900" : "border-gray-200")}>
                    <div className="flex items-center gap-2">
                      <SeverityIcon severity={f.severity} />
                      <span className="text-sm font-semibold text-gray-900">{f.ref}</span>
                      <span className="ml-auto rounded border border-gray-200 px-1.5 text-xs text-gray-600">Page {f.page}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-900">{f.issue}</p>
                    {f.whyItMatters && <p className="text-sm text-gray-500">Why: {f.whyItMatters}</p>}
                    {f.fix && <p className="text-sm text-gray-700">Fix: {f.fix}</p>}
                    {f.excerpt && <p className="mt-1 border-l-2 border-gray-300 pl-2 text-sm text-gray-600 line-clamp-2">"{f.excerpt}"</p>}
                  </button>
                )))}

              {tab === "rules" && (rv ? CATEGORIES.map((cat) => (
                <div key={cat}>
                  <div className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{cat}</div>
                  {BRAND_RULES.filter((r) => r.category === cat).map((r) => {
                    const res = rv.rules.find((x) => x.rule_id === r.id);
                    const o = res?.outcome ?? "unclear";
                    return (
                      <div key={r.id} className="flex gap-2 border-b border-gray-100 py-1.5 text-sm last:border-0">
                        <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full", o === "pass" ? "bg-emerald-100 text-emerald-700" : o === "fail" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500")} title={o.replace("_", " ")}>
                          {o === "pass" ? <Check className="size-3" /> : o === "fail" ? <X className="size-3" /> : o === "not_applicable" ? <Minus className="size-3" /> : <HelpCircle className="size-3" />}
                        </span>
                        <div className="min-w-0"><span className="font-medium text-gray-900">{r.id}</span> <span className="text-gray-700">{r.rule}</span>{res?.note && <div className="text-gray-500">{res.note}</div>}</div>
                      </div>
                    );
                  })}
                </div>
              )) : <p className="text-sm text-gray-500">Not reviewed yet.</p>)}

              {tab === "details" && (
                <div className="space-y-4 text-sm">
                  {rv?.detected && (
                    <div>
                      <div className="mb-1 font-semibold text-gray-900">Detected</div>
                      {rv.detected.colours?.length ? <div className="flex flex-wrap items-center gap-1.5">{rv.detected.colours.map((c, i) => <span key={i} className="inline-flex items-center gap-1 rounded border border-gray-200 px-1.5 py-0.5 text-xs"><span className="size-3 rounded-sm border border-gray-300" style={{ background: /^#?[0-9a-f]{6}$/i.test(c) ? (c.startsWith("#") ? c : `#${c}`) : "transparent" }} />{c}</span>)}</div> : null}
                      {rv.detected.fonts?.length ? <p className="mt-1 text-gray-700">Fonts: {rv.detected.fonts.join(", ")}</p> : null}
                      {rv.detected.languages?.length ? <p className="text-gray-700">Languages: {rv.detected.languages.join(", ")}</p> : null}
                      {rv.detected.logos?.length ? <p className="text-gray-700">Logos: {rv.detected.logos.join(", ")}</p> : null}
                    </div>
                  )}
                  <div>
                    <div className="mb-1 font-semibold text-gray-900">Versions</div>
                    {versions.map((x) => (
                      <div key={x.v} className="flex items-center gap-2 border-b border-gray-100 py-1.5 last:border-0">
                        <span className="w-8 font-medium">v{x.v}</span>
                        <a href={x.file_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-blue-700 hover:underline">{x.file_name}</a>
                        {x.review ? <RiskBadge verdict={x.review.verdict} score={x.review.riskScore} /> : <span className="text-gray-500">{x.review_status}</span>}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="mb-1 font-semibold text-gray-900">Audit trail</div>
                    {[...(sub.events ?? [])].reverse().map((e: any, i: number) => (
                      <div key={i} className="border-b border-gray-100 py-1.5 last:border-0">
                        <div className="text-xs text-gray-500">{format(new Date(e.at), "d MMM yyyy, HH:mm")} · {e.role === "ai" ? "AI Reviewer" : `${displayName(e.by)} · ${BRAND_ROLES[e.role as keyof typeof BRAND_ROLES] ?? ""}`}</div>
                        <NoteText text={e.detail} className="text-gray-900" />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">Checked against {GUIDELINE.code} {GUIDELINE.title}, {GUIDELINE.version}.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {(dialog === "clear" || dialog === "return") && <DecisionDialog id={reportId} outcome={dialog} redFlags={redFlags} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === "revise" && <RevisionDialog id={reportId} onClose={() => setDialog(null)} onDone={refresh} />}
    </AppShell>
  );
}
