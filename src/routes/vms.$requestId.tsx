import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createContext, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { RequiredDocsChecklist } from "@/components/vms-docs-checklist";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  assessVmsRequest, complianceVmsDecision, decideVmsRequest, getVmsRequest, inviteVmsVendor, readVmsDocument,
  deleteVmsDocument, deleteVmsRequest, readCtosReport, recordVmsConflictCheck, recordVmsCtos, screenVmsRequest, verifyVmsDocument, vmsAiAssist,
} from "@/lib/vms.functions";
import { CcmsHeader, CARD, TD, StageBar, NoteText, friendlyError, useCcmsRole, useConfirm, uploadToStorage } from "@/components/ccms-widgets";
import {
  ABMS_QUESTIONS, AFS_ITEMS, DOC_TYPES, PASS_MARK, PREQUAL_AREAS, VENDOR_CATEGORIES, VMS_STATUS, afsRatios, daysTo, docsFor, prequalScore, requestMilestones, sameValue, validationRows, vmsActions, type Afs, type VmsAction,
} from "@/lib/vms";
import { CCMS_ROLES, DEMO_SINGLE_USER, displayName, fmtMoneyPlain } from "@/lib/ccms";
import { ArrowLeft, ChevronRight, Copy, Loader2, Sparkles, Star, Trash2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vms/$requestId")({
  component: VmsRequestPage,
  head: () => ({ meta: [{ title: "Vendor Management · Request" }] }),
});

const INPUT = "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";

function useRun(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    run: async (p: () => Promise<unknown>, ok: string) => {
      setBusy(true);
      try { await p(); toast.success(ok); onDone(); } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
    },
  };
}

/** Which sections are open: the one for the current step, plus any the reviewer opens. */
const SectionCtx = createContext<{ isOpen: (k: string) => boolean; toggle: (k: string) => void }>({ isOpen: () => true, toggle: () => {} });
function Section({ k, title, sub, children, right }: { k: string; title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  const { isOpen, toggle } = useContext(SectionCtx);
  const open = isOpen(k);
  return (
    <section id={`sec-${k}`} className={CARD + " scroll-mt-4"}>
      <div className={cn("flex items-start gap-3 px-4 py-3", open && "border-b border-gray-200")}>
        <button type="button" onClick={() => toggle(k)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <ChevronRight className={cn("mt-0.5 size-4 shrink-0 text-gray-400 transition-transform", open && "rotate-90")} />
          <div className="min-w-0"><h2 className="text-sm font-semibold text-gray-900">{title}</h2>{sub && open && <p className="text-sm text-gray-600">{sub}</p>}</div>
        </button>
        {right && open && <div className="ml-auto">{right}</div>}
      </div>
      {open && <div className="space-y-2 px-4 py-3 text-sm">{children}</div>}
    </section>
  );
}
const Hint = ({ role }: { role: string }) => <p className="text-gray-500">Switch "Acting as" to {role}.</p>;

function VmsRequestPage() {
  const { requestId } = Route.useParams();
  const getFn = useServerFn(getVmsRequest);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["vms-request", requestId], queryFn: () => getFn({ data: { id: requestId } }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["vms-request", requestId] }); qc.invalidateQueries({ queryKey: ["vms-requests"] }); };
  const [, setRole] = useCcmsRole();
  const [focus, setFocus] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, boolean>>({});
  useEffect(() => { setManual({}); }, [focus]);
  if (isLoading) return <AppShell><div className="p-10 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div></AppShell>;
  if (error || !data) return <AppShell><div className="p-10 text-sm text-red-700">{(error as Error)?.message ?? "Not found"}</div></AppShell>;
  const { request: r, token, vendor, documents, events } = data as any;
  const sub = r.kind === "subcontractor";
  const ms = requestMilestones({ ...r, invite_token: token }, documents);
  const closed = ["approved", "conditional", "rejected"].includes(r.status);
  // The current step's section is open; the rest are one click away.
  const acts = vmsActions({ ...r, invite_token: token }, documents);
  const focusKey = focus ?? acts[0]?.section ?? null;
  const reviewing = ["screening", "ctos", "documents", "assessment", "compliance", "decision"].includes(focusKey ?? "");
  const isOpen = (k: string) => manual[k] ?? (!focusKey || k === focusKey || (k === "validation" && reviewing));
  const toggle = (k: string) => setManual((m) => ({ ...m, [k]: !isOpen(k) }));
  const portalUrl = token && typeof window !== "undefined" ? `${window.location.origin}/vendor-portal/${token}` : null;
  const act = (a: VmsAction) => {
    if (a.id === "portal") { if (portalUrl) window.open(portalUrl, "_blank"); return; }
    if (DEMO_SINGLE_USER && a.role !== "vendor") setRole(a.role as any);
    setFocus(a.section);
    setTimeout(() => document.getElementById(`sec-${a.section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  return (
    <AppShell>
      <CcmsHeader title={`${r.reference_number} · ${r.company_name}`} subtitle={`${sub ? "Subcontractor pre-qualification" : "Vendor onboarding"} · ${VENDOR_CATEGORIES[r.category] ?? r.category} · ${r.entity ?? ""}`} />
      <div className="p-6 bg-white min-h-full space-y-5">
        <div className="flex items-center">
          <Link to="/vms/requests" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline"><ArrowLeft className="size-4" /> Requests</Link>
          {!["approved", "conditional"].includes(r.status) && <DeleteRequest r={r} />}
        </div>
        <StageBar stages={ms.stages} next={ms.next} actions={acts.length ? acts.map((a, i) => (
          <Button key={a.id} size="sm" variant={i === 0 ? "default" : "outline"} onClick={() => act(a)}>{a.label}</Button>
        )) : undefined} />
        <SectionCtx.Provider value={{ isOpen, toggle }}>
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5">
          <div className="space-y-5 min-w-0">
            {r.status === "returned" && <p className="rounded-md border border-orange-300 px-3 py-2 text-sm text-orange-800">Returned to the vendor: {r.return_reason}</p>}
            {r.status === "rejected" && <p className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-800">Rejected: {r.decision?.reason ?? r.compliance?.rationale}</p>}
            <InviteSection r={r} token={token} onDone={refresh} />
            {r.submitted_by_vendor_at && <SubmissionSection r={r} documents={documents} onDone={refresh} />}
            {r.submitted_by_vendor_at && <ScreeningSection r={r} onDone={refresh} />}
            {r.screening && !r.screening.blacklisted && (sub ? <ConflictSection r={r} onDone={refresh} /> : <CtosSection r={r} onDone={refresh} />)}
            {r.submitted_by_vendor_at && <DocumentsSection r={r} documents={documents} onDone={refresh} />}
            {r.screening && !r.screening.blacklisted && <AssessmentSection r={r} onDone={refresh} />}
            {(r.status === "compliance" || r.compliance) && <ComplianceSection r={r} onDone={refresh} />}
            {(r.status === "manager" || r.decision) && !(r.status === "rejected" && r.compliance?.decision === "reject") && <DecisionSection r={r} onDone={refresh} />}
          </div>
          <aside className="space-y-5">
            <section className={CARD}>
              <table className="w-full"><tbody>
                {[["Status", <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", VMS_STATUS[r.status]?.tone)}>{VMS_STATUS[r.status]?.label}</span>],
                  ["Raised by", `${displayName(r.requestor_name)} · ${format(new Date(r.created_at), "d MMM yyyy")}`],
                  ...(sub ? [["Trade", r.trade], ["Project", r.project], ["Expected value", r.expected_value != null ? fmtMoneyPlain(r.expected_value) : "—"]] : [["Goods / services", r.goods_services ?? "—"], ["Annual spend", r.annual_spend != null ? fmtMoneyPlain(r.annual_spend) : "—"]]),
                  ["Justification", r.justification ?? "—"], ["Contact", r.contact_name ?? "—"],
                  ...(vendor ? [["Vendor record", `${vendor.vendor_code ?? "—"} · ${vendor.status}${vendor.dd_valid_until ? ` · DD to ${vendor.dd_valid_until}` : ""}`]] : []),
                ].map(([k, v]: any) => <tr key={k} className="border-b border-gray-100 last:border-0"><td className="px-4 py-2 text-sm text-gray-600 w-32 align-top">{k}</td><td className="px-4 py-2 text-sm text-gray-900">{v}</td></tr>)}
              </tbody></table>
            </section>
            <section className={CARD}>
              <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">Audit trail</div>
              <ul className="divide-y divide-gray-100">
                {events.map((e: any) => (
                  <li key={e.id} className="px-4 py-2 text-sm"><div className="text-gray-500 text-xs">{format(new Date(e.created_at), "d MMM, HH:mm")} · {displayName(e.actor_name)}{e.acting_role ? ` · ${CCMS_ROLES[e.acting_role as keyof typeof CCMS_ROLES] ?? ""}` : ""}</div><div className="text-gray-900">{e.detail}</div></li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
        </SectionCtx.Provider>
        {closed && <p className="text-sm text-gray-500">This request is {r.status}.</p>}
      </div>
    </AppShell>
  );
}

function InviteSection({ r, token, onDone }: { r: any; token: string | null; onDone: () => void }) {
  const [role] = useCcmsRole();
  const inviteFn = useServerFn(inviteVmsVendor);
  const { busy, run } = useRun(onDone);
  const [reason, setReason] = useState("");
  const url = token && typeof window !== "undefined" ? `${window.location.origin}/vendor-portal/${token}` : null;
  const can = ["purchasing_executive", "contract_executive", "contract_manager"].includes(role);
  if (["approved", "conditional", "rejected"].includes(r.status)) return null;
  return (
    <Section k="portal" title="Vendor portal" sub="The vendor completes the register form, uploads documents and signs the integrity forms. The link is valid 14 days.">
      {url ? (
        <>
          <div className="flex items-center gap-2">
            <input readOnly value={url} className={INPUT + " flex-1 font-mono text-xs"} />
            <Button size="sm" variant="outline" className="gap-1" onClick={() => { navigator.clipboard.writeText(url); toast.success("Link copied — send it to the vendor"); }}><Copy className="size-4" /> Copy</Button>
            <Button size="sm" variant="outline" asChild><a href={url} target="_blank" rel="noreferrer">Open as vendor</a></Button>
          </div>
          <p className="text-gray-600">Valid to {r.invite_expires?.slice(0, 10)}{r.submitted_by_vendor_at ? ` · submitted ${r.submitted_by_vendor_at.slice(0, 10)}` : " · awaiting the vendor"}.</p>
          {can && (
            <div className="flex gap-2"><input className={INPUT + " flex-1"} placeholder="Reason to re-invite" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => inviteFn({ data: { request_id: r.id, reason, acting_role: role } }), "New link issued")}>Re-invite</Button></div>
          )}
        </>
      ) : can ? (
        <Button size="sm" disabled={busy} onClick={() => run(() => inviteFn({ data: { request_id: r.id, acting_role: role } }), "Invitation link ready — copy it to the vendor")}>Invite the vendor</Button>
      ) : <Hint role="Purchasing Executive" />}
    </Section>
  );
}

const CHECK: Record<string, { icon: string; text: string; tone: string }> = {
  match: { icon: "✓", text: "Confirmed", tone: "text-emerald-700" },
  differs: { icon: "⚠", text: "Differs", tone: "text-amber-700 font-semibold" },
  unconfirmed: { icon: "—", text: "Not in documents", tone: "text-gray-500" },
};
const money = (n?: number | null) => (n == null ? "—" : Math.round(n).toLocaleString());

/** What the vendor submitted, checked against what was filled in and what the
 *  documents say — in tables, so the reviewer can confirm it is accurate. */
function SubmissionSection({ r, documents, onDone }: { r: any; documents: any[]; onDone: () => void }) {
  const [role] = useCcmsRole();
  const readFn = useServerFn(readVmsDocument);
  const reg = r.register ?? {}, ab = r.abms ?? {};
  const docs = documents.filter((d) => d.status !== "superseded");
  const rows = validationRows(r, docs);
  const confirmed = rows.filter((x) => x.check === "match").length, differs = rows.filter((x) => x.check === "differs").length;
  const unread = docs.filter((d) => !d.extracted);
  const afsDoc = docs.find((d) => d.doc_type === "afs" && d.extracted?.afs);
  const afs = afsDoc?.extracted?.afs as Afs | undefined;
  const k = afs ? afsRatios(afs, r.annual_spend) : null;
  const TH2 = "px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500";
  const TD2 = "px-2 py-1.5 align-top";
  const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
  return (
    <Section k="validation" title="Vendor Details for Validation" sub={`What was filled in, checked against the documents. Signed by ${ab.signatory ?? "—"} (${ab.designation ?? "—"}) on ${ab.signed_date ?? "—"}.`}
      right={unread.length > 0 && ["purchasing_executive", "contract_executive", "contract_manager"].includes(role) ? <AiLink label={`Read ${unread.length} Document${unread.length === 1 ? "" : "s"}`} run={async () => {
        for (let i = 0; i < unread.length; i += 3) await Promise.all(unread.slice(i, i + 3).map((d) => readFn({ data: { document_id: d.id } }).catch(() => null)));
        onDone();
      }} /> : undefined}>
      <div className={cn("rounded-md px-3 py-2 text-sm", differs ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900")}>
        {differs ? `⚠ ${differs} field${differs === 1 ? "" : "s"} differ from the documents — check before screening.` : `✓ ${confirmed} of ${rows.length} fields confirmed by the documents${confirmed < rows.length ? "; the rest are not stated in any document" : ""}.`}
      </div>

      <div className="font-semibold text-gray-900 pt-1">Company details</div>
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr><th className={TH2}>Field</th><th className={TH2}>Requester entered</th><th className={TH2}>Vendor entered</th><th className={TH2}>Found in document</th><th className={TH2}>Source</th><th className={TH2}>Check</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.key} className={cn("border-t border-gray-100", x.check === "differs" && "bg-amber-50/60")}>
                <td className={TD2 + " font-medium text-gray-700"}>{x.label}</td>
                <td className={TD2 + " text-gray-900"}>{x.requester ?? <span className="text-gray-400">—</span>}</td>
                <td className={TD2 + " text-gray-900"}>{x.vendor ?? <span className="text-gray-400">—</span>}</td>
                <td className={TD2 + " text-gray-900"}>{x.doc ?? <span className="text-gray-400">—</span>}</td>
                <td className={TD2}>{x.source ? <a href={x.source.url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{x.source.label}</a> : <span className="text-gray-400">—</span>}</td>
                <td className={cn(TD2, "whitespace-nowrap", CHECK[x.check].tone)}>{CHECK[x.check].icon} {CHECK[x.check].text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="font-semibold text-gray-900 pt-2">Documents</div>
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr><th className={TH2}>Document</th><th className={TH2}>Number</th><th className={TH2}>Issuer</th><th className={TH2}>Issued to</th><th className={TH2}>Expiry</th><th className={TH2}>Status</th><th className={TH2} /></tr></thead>
          <tbody>
            {docs.map((d) => {
              const x = d.extracted ?? {};
              const expiry = d.expiry_date || x.expiry;
              const expired = expiry && daysTo(expiry) < 0;
              const nameOk = !x.holder || sameValue("name", x.holder, reg.company_name || r.company_name);
              return (
                <tr key={d.id} className={cn("border-t border-gray-100", (expired || !nameOk) && "bg-amber-50/60")}>
                  <td className={TD2 + " text-gray-900"}>{DOC_TYPES.find((t) => t.id === d.doc_type)?.label ?? d.doc_type}</td>
                  <td className={TD2}>{d.number || x.number || "—"}</td>
                  <td className={TD2}>{d.issuer || x.issuer || "—"}</td>
                  <td className={cn(TD2, !nameOk && "font-semibold text-amber-800")}>{x.holder || "—"}{!nameOk && " ⚠"}</td>
                  <td className={cn(TD2, expired && "font-semibold text-red-700")}>{expiry ? `${expiry}${expired ? " (expired)" : ""}` : "—"}</td>
                  <td className={cn(TD2, d.status === "verified" ? "text-emerald-700" : d.status === "rejected" ? "text-red-700" : "text-amber-700")}>{d.status}</td>
                  <td className={TD2}><a href={d.file_url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">View</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {afs && k && (
        <>
          <div className="flex items-baseline gap-2 pt-2"><span className="font-semibold text-gray-900">Financial standing</span>
            <span className="text-sm text-gray-600">Audited FY {afs.fy_end ?? "—"} · {afs.auditor || "auditor —"} · {afs.opinion ?? "—"} opinion</span>
            <a href={afsDoc.file_url} target="_blank" rel="noreferrer" className="ml-auto text-sm text-blue-700 hover:underline">View AFS</a></div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="overflow-x-auto rounded-md border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr><th className={TH2}>{afs.currency ?? "MYR"}</th><th className={TH2 + " text-right"}>FY {String(afs.fy_end ?? "").slice(0, 4) || "current"}</th><th className={TH2 + " text-right"}>FY {String(afs.prior_fy_end ?? "").slice(0, 4) || "prior"}</th><th className={TH2 + " text-right"}>Change</th></tr></thead>
                <tbody>
                  {AFS_ITEMS.map(([key, label]) => {
                    const c = afs.current?.[key], p = afs.prior?.[key];
                    const ch = c != null && p != null && p !== 0 ? (c - p) / Math.abs(p) : null;
                    return (
                      <tr key={key} className="border-t border-gray-100">
                        <td className={TD2 + " text-gray-700"}>{label}</td>
                        <td className={TD2 + " text-right tabular-nums text-gray-900"}>{money(c)}</td>
                        <td className={TD2 + " text-right tabular-nums text-gray-600"}>{money(p)}</td>
                        <td className={cn(TD2, "text-right tabular-nums", ch == null ? "text-gray-400" : ch >= 0 ? "text-emerald-700" : "text-red-700")}>{ch == null ? "—" : `${ch >= 0 ? "+" : ""}${(ch * 100).toFixed(1)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="space-y-2">
              {([["Revenue growth", pct(k.growth), (k.growth ?? 0) >= 0], ["Net margin", pct(k.netMargin), (k.netMargin ?? 0) > 0], ["Current ratio", k.currentRatio?.toFixed(2) ?? "—", (k.currentRatio ?? 0) >= 1],
                ["Debt to equity", k.debtToEquity?.toFixed(2) ?? "—", (k.debtToEquity ?? 0) <= 1.5], ["Our spend vs their revenue", pct(k.dependence), (k.dependence ?? 0) <= 0.1]] as [string, string, boolean][]).map(([l, v, ok]) => (
                <div key={l} className={cn("flex items-center justify-between rounded-md border px-3 py-1.5 text-sm", ok ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/60")}>
                  <span className="text-gray-700">{l}</span><span className={cn("font-semibold tabular-nums", ok ? "text-emerald-800" : "text-amber-800")}>{v}</span>
                </div>
              ))}
              {k.flags.length ? <ul className="list-disc pl-5 text-sm text-amber-800">{k.flags.map((f) => <li key={f}>{f}</li>)}</ul> : <p className="text-sm text-emerald-700">✓ No financial flags.</p>}
            </div>
          </div>
        </>
      )}

      <div className="font-semibold text-gray-900 pt-2">Integrity</div>
      <div className="overflow-x-auto rounded-md border border-gray-200">
        <table className="w-full text-sm"><tbody>
          {ABMS_QUESTIONS.map((q) => (
            <tr key={q.id} className="border-t border-gray-100 first:border-0">
              <td className={TD2 + " text-gray-700"}>{q.text}</td>
              <td className={cn(TD2, "w-20 font-semibold", ab.answers?.[q.id] === "yes" ? "text-red-700" : "text-emerald-700")}>{ab.answers?.[q.id] === "yes" ? "Yes" : ab.answers?.[q.id] === "no" ? "No" : "—"}</td>
            </tr>
          ))}
          {([["Declaration of interest (ABMS-001)", ab.declaration_interest === "declared" ? `Declared — ${ab.interest_details ?? ""}` : "None to declare", ab.declaration_interest !== "declared"],
            ["Integrity pledge (ABMS-005)", ab.pledge ? "Signed" : "—", !!ab.pledge], ["CTOS consent", ab.ctos_consent === "signed" ? "Given" : ab.ctos_consent ?? "—", ab.ctos_consent === "signed"],
            ["PDPA consent", ab.pdpa ? "Given" : "—", !!ab.pdpa], ["Signed by", `${ab.signatory ?? "—"}, ${ab.designation ?? "—"} · ${ab.signed_date ?? "—"}`, true]] as [string, string, boolean][]).map(([l, v, ok]) => (
            <tr key={l} className="border-t border-gray-100"><td className={TD2 + " text-gray-700"}>{l}</td><td className={cn(TD2, "font-semibold", ok ? "text-emerald-700" : "text-red-700")}>{v}</td></tr>
          ))}
          {ab.details && <tr className="border-t border-gray-100"><td className={TD2 + " text-gray-700"}>Details given</td><td className={TD2}>{ab.details}</td></tr>}
        </tbody></table>
      </div>
      {(reg.project_references ?? []).filter((x: string) => x?.trim()).length > 0 && <p className="text-sm"><span className="text-gray-500">Project references:</span> {reg.project_references.filter((x: string) => x?.trim()).join("; ")}</p>}
    </Section>
  );
}

function ScreeningSection({ r, onDone }: { r: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const screenFn = useServerFn(screenVmsRequest);
  const { busy, run } = useRun(onDone);
  const s = r.screening;
  return (
    <Section k="screening" title="Screening" sub="Duplicates (SSM, TIN, bank account, directors), related parties, blacklist and red flags. A blacklist hit rejects automatically."
      right={["purchasing_executive", "contract_executive", "contract_manager"].includes(role) && !["approved", "conditional", "rejected"].includes(r.status) &&
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => screenFn({ data: { request_id: r.id, acting_role: role } }), "Screened")}>{s ? "Re-run" : "Run screening"}</Button>}>
      {s ? (
        <>
          <p>Risk: <span className={cn("font-semibold", s.rating === "high" ? "text-red-700" : s.rating === "medium" ? "text-amber-700" : "text-emerald-700")}>{s.rating}</span>{s.relatedParty && <span className="text-red-700"> · related party</span>}</p>
          {s.reasons.length > 0 && <ul className="list-disc pl-5 text-gray-800">{s.reasons.map((x: string) => <li key={x}>{x}</li>)}</ul>}
        </>
      ) : <p className="text-gray-500">Not run yet.</p>}
    </Section>
  );
}

function CtosSection({ r, onDone }: { r: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const ctosFn = useServerFn(recordVmsCtos);
  const { busy, run } = useRun(onDone);
  const [f, setF] = useState({ score: "", litigation: false, winding_up: false, director_flags: false, note: "" });
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const readCtos = useServerFn(readCtosReport);
  async function pick(fl: File | null) {
    setFile(fl);
    if (!fl) return;
    setReading(true);
    try {
      const o: any = await readCtos({ data: { file_name: fl.name, mime_type: fl.type || "application/octet-stream", base64: await toB64(fl) } });
      if (o) { setF({ score: o.score == null ? "" : String(o.score), litigation: o.litigation, winding_up: o.winding_up, director_flags: o.director_flags, note: o.note }); toast.success("Read the report — check the score and flags"); }
    } catch (e) { toast.error(friendlyError(e)); } finally { setReading(false); }
  }
  if (r.ctos) return (
    <Section k="ctos" title="CTOS report"><p>Score {r.ctos.score ?? "—"} · {[r.ctos.litigation && "litigation", r.ctos.winding_up && "winding-up", r.ctos.director_flags && "director flags"].filter(Boolean).join(", ") || "no adverse records"} · {displayName(r.ctos.by)}{r.ctos.note ? ` — ${r.ctos.note}` : ""}</p></Section>
  );
  return (
    <Section k="ctos" title="CTOS report" sub={`Finance — whether or not consent was given (vendor: ${r.abms?.ctos_consent ?? "—"}). Pre-qualification cannot be approved without it.`}>
      {role !== "finance" ? <Hint role="Finance" /> : (
        <div className="flex flex-wrap items-center gap-2">
          <input className={INPUT + " w-24"} placeholder="Score" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} />
          {(["litigation", "winding_up", "director_flags"] as const).map((k) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {k.replace("_", " ")}</label>)}
          <label className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 cursor-pointer">{reading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {reading ? "Reading…" : file ? file.name : "Upload Report"}<input type="file" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} /></label>
          <input className={INPUT + " flex-1 min-w-40"} placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <Button size="sm" disabled={busy || !file} onClick={() => run(async () => {
            const url = await uploadToStorage(`vms/${r.id}`, file!);
            await ctosFn({ data: { request_id: r.id, score: f.score === "" ? null : Number(f.score), litigation: f.litigation, winding_up: f.winding_up, director_flags: f.director_flags, note: f.note || null, file_name: file!.name, file_url: url, acting_role: role } });
          }, "CTOS recorded")}>Save</Button>
        </div>
      )}
    </Section>
  );
}

function ConflictSection({ r, onDone }: { r: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const fn = useServerFn(recordVmsConflictCheck);
  const { busy, run } = useRun(onDone);
  const [note, setNote] = useState("");
  const c = r.conflict_check;
  return (
    <Section k="ctos" title="CTOS conflict check" sub="Directors and shareholders screened against the related-party list and the employee conflict register. Must clear before selection.">
      {c?.accounts_decision ? <p>Accounts: <span className={c.accounts_decision === "cleared" ? "text-emerald-700 font-semibold" : "text-red-700 font-semibold"}>{c.accounts_decision === "cleared" ? "cleared" : "red flag"}</span> · {displayName(c.by)}{c.note ? ` — ${c.note}` : ""}</p>
        : role !== "accounts" ? <Hint role="Accounts" /> : (
          <div className="flex gap-2"><div className="flex-1"><input className={INPUT + " w-full"} placeholder="Note (required for a red flag)" value={note} onChange={(e) => setNote(e.target.value)} />
            {!note && <button type="button" onClick={() => setNote("No matches against the related-party list or the employee conflict register.")} className="mt-1 rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-xs text-gray-600 hover:border-gray-500">↺ No matches against the related-party list or the employee conflict register.</button>}</div>
            <Button size="sm" disabled={busy} onClick={() => run(() => fn({ data: { request_id: r.id, decision: "cleared", note, acting_role: role } }), "Cleared")}>Clear</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => fn({ data: { request_id: r.id, decision: "red_flag", note, acting_role: role } }), "Red flag recorded")}>Red flag</Button></div>
        )}
    </Section>
  );
}

/** A blue "✦ label" link that runs an AI assist; the result lands in the form for the person to check. */
function AiLink({ label, run }: { label: string; run: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} className="inline-flex shrink-0 items-center gap-1 text-sm text-blue-700 hover:underline disabled:opacity-60"
      onClick={async () => { setBusy(true); try { await run(); } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); } }}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {busy ? "Working…" : label}
    </button>
  );
}
const toB64 = (file: File) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] ?? ""); fr.onerror = rej; fr.readAsDataURL(file); });

function DocumentsSection({ r, documents, onDone }: { r: any; documents: any[]; onDone: () => void }) {
  const [role] = useCcmsRole();
  const readFn = useServerFn(readVmsDocument);
  const verifyFn = useServerFn(verifyVmsDocument);
  const deleteFn = useServerFn(deleteVmsDocument);
  const [confirm, confirmDialog] = useConfirm();
  const { busy, run } = useRun(onDone);
  const [edit, setEdit] = useState<Record<string, any>>({});
  const can = ["purchasing_executive", "contract_executive", "contract_manager"].includes(role);
  const required = docsFor(r.category);
  const val = (d: any, k: string) => edit[d.id]?.[k] ?? d[k] ?? d.extracted?.[k === "issued_date" ? "issued" : k === "expiry_date" ? "expiry" : k] ?? "";
  const set = (d: any, k: string, v: string) => setEdit((e) => ({ ...e, [d.id]: { ...(e[d.id] ?? {}), [k]: v } }));
  const docs = documents.filter((d) => d.doc_type !== "ctos");
  return (
    <Section k="documents" title="Documents" sub="The AI reads each certificate; the person verifying confirms every field. A name that does not match the company blocks verification."
      right={can && docs.some((d) => d.status === "uploaded" && !d.extracted) && <AiLink label="Read All with AI" run={async () => {
        const todo = docs.filter((d) => d.status === "uploaded" && !d.extracted);
        for (let i = 0; i < todo.length; i += 3) await Promise.all(todo.slice(i, i + 3).map((d) => readFn({ data: { document_id: d.id } }).catch(() => null)));
        toast.success(`Read ${todo.length} document${todo.length === 1 ? "" : "s"} — check each field, then Verify`); onDone();
      }} />}>
      {confirmDialog}
      <div className="rounded-md border border-gray-200 p-3"><RequiredDocsChecklist category={r.category} documents={documents}
        done={[...(r.submitted_by_vendor_at ? ["register_form", "abms_001", "abms_004", "abms_005", "abc_ack"] : []), ...(r.ctos ? ["ctos"] : []), ...(r.assessment ? ["prequal_form"] : [])]} /></div>
      {docs.length === 0 && <p className="text-gray-500">No documents uploaded.</p>}
      {docs.map((d) => {
        const t = DOC_TYPES.find((x) => x.id === d.doc_type);
        const lvl = required.find((x) => x.id === d.doc_type)?.level;
        return (
          <div key={d.id} className="rounded-md border border-gray-200 p-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-gray-900">{t?.label ?? d.doc_type}</span>
              {lvl === "M" && <span title="Mandatory"><Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="Mandatory" /></span>}
              <a href={d.file_url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline truncate max-w-64">{d.file_name}</a>
              <span className={cn("ml-auto text-xs font-semibold", d.status === "verified" ? "text-emerald-700" : d.status === "rejected" ? "text-red-700" : "text-amber-700")}>{d.status}{d.verified_by ? ` · ${displayName(d.verified_by)}` : ""}</span>
              {can && ["uploaded", "rejected"].includes(d.status) && (
                <button type="button" title="Delete this document" disabled={busy}
                  onClick={async () => { if (await confirm({ title: "Delete this document?", body: `${d.file_name} is removed from the request.` })) run(() => deleteFn({ data: { document_id: d.id, acting_role: role } }), "Deleted"); }}
                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button>
              )}
            </div>
            {d.status === "uploaded" && can ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => run(() => readFn({ data: { document_id: d.id } }), "Read — check each field")}><Sparkles className="size-4" /> Read with AI</Button>
                <input className={INPUT + " w-36"} placeholder="Number" value={val(d, "number")} onChange={(e) => set(d, "number", e.target.value)} />
                <input className={INPUT + " w-40"} placeholder="Issuer" value={val(d, "issuer")} onChange={(e) => set(d, "issuer", e.target.value)} />
                <input className={INPUT + " w-44"} placeholder="Issued to" value={val(d, "holder")} onChange={(e) => set(d, "holder", e.target.value)} />
                {t?.expires && <input type="date" className={INPUT} value={val(d, "expiry_date")} onChange={(e) => set(d, "expiry_date", e.target.value)} title="Expiry" />}
                <Button size="sm" disabled={busy} onClick={() => run(() => verifyFn({ data: { document_id: d.id, action: "verify", number: val(d, "number") || null, issuer: val(d, "issuer") || null, holder: val(d, "holder") || null, issued_date: val(d, "issued_date") || null, expiry_date: val(d, "expiry_date") || null, acting_role: role } }), "Verified")}>Verify</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => verifyFn({ data: { document_id: d.id, action: "reject", note: "Not acceptable", acting_role: role } }), "Rejected")}>Reject</Button>
              </div>
            ) : d.status === "verified" ? <p className="text-gray-600">{[d.number, d.issuer, d.expiry_date && `valid to ${d.expiry_date}`].filter(Boolean).join(" · ")}</p> : d.status === "uploaded" && <Hint role="Purchasing Executive" />}
          </div>
        );
      })}
    </Section>
  );
}

function AssessmentSection({ r, onDone }: { r: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const fn = useServerFn(assessVmsRequest);
  const { busy, run } = useRun(onDone);
  const sub = r.kind === "subcontractor";
  const [areas, setAreas] = useState<Record<string, number>>(r.assessment?.areas ?? {});
  const [own, setOwn] = useState<"none" | "declared">("none");
  const [details, setDetails] = useState("");
  const [fit, setFit] = useState("");
  const [why, setWhy] = useState<Record<string, string>>({});
  const assist = useServerFn(vmsAiAssist);
  const total = prequalScore(areas);
  const who = sub ? "contract_manager" : "purchasing_executive";
  if (r.assessment) return (
    <Section k="assessment" title={sub ? "Contract Manager review" : "Pre-qualification assessment"}>
      <p>Score <span className={cn("font-semibold", r.assessment.pass ? "text-emerald-700" : "text-red-700")}>{r.assessment.total}%</span> (pass {PASS_MARK}%) · {displayName(r.assessment.by)} · assessor's own conflict: {r.assessment.own_conflict}{r.assessment.scope_fit ? ` · scope fit: ${r.assessment.scope_fit}` : ""}</p>
    </Section>
  );
  return (
    <Section k="assessment" title={sub ? "Contract Manager review" : "Pre-qualification assessment"} sub={`Nine areas, 0–5 each; pass mark ${PASS_MARK}%. Every document must be verified first.`}>
      {role !== who ? <Hint role={CCMS_ROLES[who as keyof typeof CCMS_ROLES]} /> : (
        <>
          <div className="flex justify-end"><AiLink label="Suggest Scores with AI" run={async () => {
            const o: any = await assist({ data: { request_id: r.id, kind: "prequal" } });
            setAreas((p) => ({ ...p, ...o.areas })); setWhy(o.why ?? {}); if (sub && o.text && !fit) setFit(o.text);
            toast.success("Suggested — adjust any score you disagree with");
          }} /></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {PREQUAL_AREAS.map((a) => (
              <label key={a.id} title={why[a.id]} className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-2 py-1.5">
                <span className="text-gray-800">{a.label}{why[a.id] && <span className="block text-xs text-gray-500">{why[a.id]}</span>}</span>
                <select className={INPUT + " py-0.5"} value={areas[a.id] ?? ""} onChange={(e) => setAreas({ ...areas, [a.id]: Number(e.target.value) })}>
                  <option value="">–</option>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            ))}
          </div>
          <p>Score: <span className={cn("font-semibold", total >= PASS_MARK ? "text-emerald-700" : "text-red-700")}>{total}%</span></p>
          {sub && <input className={INPUT + " w-full"} placeholder="Scope fit and pricing history" value={fit} onChange={(e) => setFit(e.target.value)} />}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-gray-800">Your own conflict of interest with this vendor:</span>
            <label className="flex items-center gap-1"><input type="radio" checked={own === "none"} onChange={() => setOwn("none")} /> None</label>
            <label className="flex items-center gap-1"><input type="radio" checked={own === "declared"} onChange={() => setOwn("declared")} /> I declare one</label>
            {own === "declared" && <input className={INPUT + " flex-1"} placeholder="Details" value={details} onChange={(e) => setDetails(e.target.value)} />}
          </div>
          <Button size="sm" disabled={busy || Object.keys(areas).length < PREQUAL_AREAS.length} onClick={() => run(() => fn({ data: { request_id: r.id, areas, own_conflict: own, own_conflict_details: details || null, scope_fit: fit || null, acting_role: role } }), "Assessment recorded")}>Submit assessment</Button>
        </>
      )}
    </Section>
  );
}

function ComplianceSection({ r, onDone }: { r: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const fn = useServerFn(complianceVmsDecision);
  const assist = useServerFn(vmsAiAssist);
  const { busy, run } = useRun(onDone);
  const [f, setF] = useState({ decision: "approve", conditions: "", due: "", rationale: "" });
  const sub = r.kind === "subcontractor";
  if (r.compliance) return (
    <Section k="compliance" title="Compliance"><p><span className="font-semibold">{r.compliance.decision}</span> · {displayName(r.compliance.by)}{r.compliance.conditions ? ` · conditions: ${r.compliance.conditions} (due ${r.compliance.due})` : ""}</p><NoteText text={r.compliance.rationale} className="text-gray-700" /></Section>
  );
  return (
    <Section k="compliance" title="Compliance" sub={sub ? "Clear, clear with safeguards, or not accepted. Safeguards stay on the vendor record." : "Extended due diligence. Approve, conditional (with conditions and a due date), or reject. Due diligence is valid 24 months, 12 for High risk."}>
      {role !== "compliance" ? <Hint role="Compliance" /> : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            {([["approve", sub ? "Clear" : "Approve"], ["conditional", sub ? "Clear with safeguards" : "Conditional"], ["reject", sub ? "Not accepted" : "Reject"]] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1"><input type="radio" checked={f.decision === k} onChange={() => setF({ ...f, decision: k })} /> {l}</label>
            ))}
          </div>
          {f.decision === "conditional" && <div className="flex gap-2"><input className={INPUT + " flex-1"} placeholder={sub ? "Safeguards" : "Conditions"} value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} /><input type="date" className={INPUT} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></div>}
          <div className="flex justify-end"><AiLink label="Draft with AI" run={async () => {
            const o: any = await assist({ data: { request_id: r.id, kind: "compliance" } });
            setF({ decision: o.decision, conditions: o.decision === "conditional" ? o.conditions : "", due: o.decision === "conditional" ? o.due : "", rationale: o.text });
          }} /></div>
          <textarea className={INPUT + " w-full min-h-16"} rows={Math.min(10, Math.max(3, f.rationale.split("\n").length + 1))} placeholder="Assessment and rationale (required)" value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} />
          <Button size="sm" disabled={busy} onClick={() => run(() => fn({ data: { request_id: r.id, decision: f.decision as any, conditions: f.conditions || null, due: f.due || null, rationale: f.rationale, acting_role: role } }), "Compliance decision recorded")}>Record decision</Button>
        </div>
      )}
    </Section>
  );
}

function DecisionSection({ r, onDone }: { r: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const fn = useServerFn(decideVmsRequest);
  const assist = useServerFn(vmsAiAssist);
  const { busy, run } = useRun(onDone);
  const [reason, setReason] = useState("");
  const sub = r.kind === "subcontractor";
  const who = sub ? "head_contracts" : "purchasing_manager";
  if (r.decision) return (
    <Section k="decision" title={sub ? "Head of Contracts & Procurement" : "Purchasing Manager"}><p><span className="font-semibold">{r.decision.outcome}</span> · {displayName(r.decision.by)}</p><NoteText text={r.decision.reason} className="text-gray-700" /></Section>
  );
  return (
    <Section k="decision" title={sub ? "Head of Contracts & Procurement" : "Purchasing Manager"} sub={sub ? "Adds the subcontractor to the Master Sub-Contractor List. Nobody approves their own submission." : "Signs off the register and pre-qualification forms. Conditional only with Compliance's concurrence; nobody approves their own submission."}>
      {role !== who ? <Hint role={CCMS_ROLES[who as keyof typeof CCMS_ROLES]} /> : (
        <div className="space-y-2">
          <div className="flex justify-end"><AiLink label="Draft with AI" run={async () => {
            const o: any = await assist({ data: { request_id: r.id, kind: "decision" } });
            setReason(o.text); if (o.suggested) toast.message(`Suggested: ${o.suggested}`);
          }} /></div>
          <textarea className={INPUT + " w-full"} rows={Math.min(10, Math.max(2, reason.split("\n").length + 1))} placeholder="Reason (required to return or reject; for a return, name the items to correct)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => run(() => fn({ data: { request_id: r.id, outcome: "approve", reason, acting_role: role } }), "Approved")}>{sub ? "Add to the list" : "Approve"}</Button>
            {r.compliance?.decision === "conditional" && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => fn({ data: { request_id: r.id, outcome: "conditional", reason, acting_role: role } }), "Approved with conditions")}>Approve with conditions</Button>}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => fn({ data: { request_id: r.id, outcome: "return", reason, acting_role: role } }), "Returned to the vendor")}>Return to vendor</Button>
            <Button size="sm" variant="outline" className="text-red-700" disabled={busy} onClick={() => run(() => fn({ data: { request_id: r.id, outcome: "reject", reason, acting_role: role } }), "Rejected")}>Reject</Button>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Deletes the request with its documents and history; a vendor record it
 *  created and nothing else uses goes too, so the company can be raised again. */
function DeleteRequest({ r }: { r: any }) {
  const fn = useServerFn(deleteVmsRequest);
  const [role, setRole] = useCcmsRole();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
    {confirmDialog}
    <button type="button" disabled={busy} className="ml-auto inline-flex items-center gap-1 text-sm text-gray-500 hover:text-red-700 disabled:opacity-60" onClick={async () => {
      if (!(await confirm({ title: `Delete ${r.reference_number}?`, body: `${r.company_name}: the request, its documents and history are removed. A vendor record it created and nothing else uses goes too. This cannot be undone.`, typeToConfirm: r.reference_number, confirmLabel: "Delete Request" }))) return;
      setBusy(true);
      try {
        const acting = ["purchasing_executive", "purchasing_manager", "contract_executive", "contract_manager"].includes(role) ? role : "purchasing_executive";
        if (DEMO_SINGLE_USER && acting !== role) setRole(acting as any);
        const res: any = await fn({ data: { request_id: r.id, acting_role: acting as any } });
        toast.success(`${r.reference_number} deleted${res.vendorRemoved ? ` — ${r.company_name} can be raised again` : ""}`);
        qc.invalidateQueries({ queryKey: ["vms-requests"] }); qc.invalidateQueries({ queryKey: ["vms-vendors"] });
        nav({ to: "/vms/requests" });
      } catch (e: any) { toast.error(friendlyError(e)); setBusy(false); }
    }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete Request</button>
    </>
  );
}
