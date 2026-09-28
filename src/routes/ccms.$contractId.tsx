import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CommentBody, ConfirmationRecord, ExecutionRecord, LifecycleRecord, Milestones } from "@/components/ccms-execution";
import { ActionDialog } from "@/components/ccms-actions";
import { deleteCcmsContract, getCcmsContract, setCcmsOwner } from "@/lib/ccms.functions";
import { CATEGORY_TINT, ObligationRows } from "@/components/ccms-obligations";
import { toast } from "sonner";
import {
  CcmsHeader, StatusBadge, OutcomeText, SlaText, Section, CostChip, SeverityIcon, CARD, TH, TD, fmtMoney, useCcmsRole, useConfirm, NoteText } from "@/components/ccms-widgets";
import {
  AI_ROLE, CCMS_ROLES, CONTRACT_TYPES, DEMO_PEOPLE, FLAG_META, BLOCKING_FLAGS, DEMO_SINGLE_USER, OBLIGATION_CATEGORIES, SECURITY_TYPES, STRAIGHT_THROUGH, contractOwner, departmentChecklist, departmentRequired, straightThrough, wasStraightThrough, daysBetween, entityShort, flowOf, nextApproval, normalizeObligations, obligationBucket, paymentReady, stageTitle, roleLabel, templateById, displayName,
  type Flag, type NextAction, type Obligation, type ObligationCategory, type Security, type Stage,
} from "@/lib/ccms";
import { Loader2, FileText, ArrowLeft, ChevronRight, MoreHorizontal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ccms/$contractId")({
  // ?view= opens a section of the tree, e.g. ?view=ob-finance.
  validateSearch: (s: Record<string, unknown>): { view?: string } => (typeof s.view === "string" ? { view: s.view } : {}),
  component: ContractDetail,
  head: () => ({ meta: [{ title: "Commercial CMS · Contract" }] }),
});

const DOC_ROLE: Record<string, string> = { counterparty: "Counterparty Revision", draft: "Draft", tender: "Tender", executed: "Signed Copy", supporting: "Supporting" };
const SEV_ORDER: Record<string, number> = { red_flag: 0, caution: 1, info: 2 };

function ContractDetail() {
  const { contractId } = Route.useParams();
  const getFn = useServerFn(getCcmsContract);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["ccms-contract", contractId], queryFn: () => getFn({ data: { id: contractId } }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["ccms-contract", contractId] }); qc.invalidateQueries({ queryKey: ["ccms-contracts"] }); };
  const [showOlder, setShowOlder] = useState(false);
  const { view } = Route.useSearch();
  const navTo = useNavigate({ from: "/ccms/$contractId" });
  const setView = (v: string) => navTo({ search: { view: v }, replace: true });
  const [role] = useCcmsRole();

  if (isLoading) return <AppShell><div className="p-10 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div></AppShell>;
  if (error || !data) return <AppShell><div className="p-10 text-sm text-red-700">{(error as Error)?.message ?? "Not found"}</div></AppShell>;

  const { contract: c, vendor, documents, comments, events } = data as any;
  const t = CONTRACT_TYPES[c.contract_type];
  const flags: Flag[] = c.flags ?? [];
  const route: Stage[] = c.approval_route ?? [];
  const blocking = flags.filter((f) => BLOCKING_FLAGS.includes(f.key));
  // The document under review: the newest of our drafts and their versions.
  const current = documents.find((d: any) => d.doc_role === "draft" || d.doc_role === "counterparty");
  const threads = (comments as any[]).filter((x) => !x.parent_id).sort((a, b) =>
    (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || (SEV_ORDER[a.severity ?? "info"] ?? 2) - (SEV_ORDER[b.severity ?? "info"] ?? 2));
  const onCurrent = threads.filter((x) => !x.document_id || x.document_id === current?.id);
  const older = threads.filter((x) => x.document_id && x.document_id !== current?.id);
  const openNow = onCurrent.filter((x) => x.status === "open").length;
  const reviewing = ["in_review", "returned", "pending_approval", "pending_committee"].includes(c.status);
  const after = ["approved", "signed", "stamped", "active", "closed"].includes(c.status);

  // Obligations by department, for the tree and the department views.
  const owner = contractOwner(c);
  // Filed: the confirmed obligations. In review: those read from the draft.
  const draftDoc = documents.find((d: any) => (d.doc_role === "draft" || d.doc_role === "counterparty") && d.terms);
  const fromDraft = !c.repository && !!draftDoc?.terms;
  const obl = c.repository ? normalizeObligations(c.repository.obligations, owner) : fromDraft ? normalizeObligations(draftDoc.terms.obligations, owner) : [];
  const openOf = (cat?: ObligationCategory) => obl.filter((o) => o.status === "open" && (!cat || o.category === cat)).length;
  const client = c.side === "client" && (c.confirmation || documents.some((d: any) => d.comparison));
  const lifecycle = ["signed", "stamped", "active", "closed"].includes(c.status) && ((c.changes ?? []).length > 0 || c.renewal);
  type Node = { key: string; label: string; badge?: React.ReactNode; show?: boolean; children?: Node[] };
  const tree: Node[] = [
    { key: "documents", label: "Documents", badge: documents.length },
    { key: "comments", label: "Comments", badge: openNow ? <span className="text-amber-700">{openNow} open</span> : onCurrent.length || undefined },
    { key: "review", label: "Review & Approval", badge: blocking.length ? <SeverityIcon severity="red_flag" className="size-3.5" /> : flags.length ? <SeverityIcon severity="caution" className="size-3.5" /> : undefined },
    { key: "details", label: "Details" },
    { key: "obligations", label: "Obligations", badge: obl.length ? openOf() || undefined : undefined, children: (Object.keys(OBLIGATION_CATEGORIES) as ObligationCategory[]).map((k) => ({
      key: `ob-${k}`, label: OBLIGATION_CATEGORIES[k],
      badge: openOf(k) || (!departmentRequired(c, k).required ? <span className="text-gray-400">Not required</span> : undefined),
    })) },
    { key: "confirmation", label: "Confirmation Letter", show: !!client },
    { key: "signing", label: "Signing & Repository", show: after },
    { key: "lifecycle", label: "Changes & Renewals", show: !!lifecycle },
    { key: "audit", label: "Audit Trail", badge: events.length },
  ].filter((n) => n.show !== false);
  // Opens on what the person acting needs: their department's view once filed, the documents before.
  const byRole: Record<string, string> = { finance: "ob-finance", accounts: "ob-finance", legal: "ob-legal", contract_executive: "ob-legal", requestor: "ob-business", contract_manager: "ob-business", head_of_department: "ob-business", operations_manager: "ob-business" };
  const initial = view ?? (c.repository && byRole[role] ? byRole[role] : "documents");
  const cur = tree.some((n) => n.key === initial || n.children?.some((x) => x.key === initial)) ? initial : "documents";
  const go = (k: string) => setView(k);

  return (
    <AppShell>
      <CcmsHeader title={`${c.reference_number} · ${c.title}`} subtitle={`${t?.label ?? c.contract_type} · ${c.entity} · ${c.counterparty_name ?? "—"}`}
        action={<div className="flex items-center gap-2"><StatusBadge status={c.status} contract={c} /><CostChip log={c.cost_log ?? []} />{!["active", "closed"].includes(c.status) && <DeleteContract c={c} />}</div>} />
      <div className="p-6 bg-white min-h-full">
        <div className="mx-auto max-w-7xl space-y-4">
          <Link to="/ccms/contracts" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline"><ArrowLeft className="size-4" /> Contracts</Link>

          <Milestones c={{ ...c, vendor }} documents={documents} events={events} onDone={refresh} />

          {wasStraightThrough(route) && (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-600 text-xs text-white">✓</span>
              <div><div className="font-semibold text-emerald-900">Cleared and approved straight-through</div>
                <div className="text-emerald-800">{(route[0]?.note ?? "").replace(/^Straight-through:\s*/, "")} No one needed to review or approve it; it goes straight to signing.</div></div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
            <nav className="h-fit rounded-lg border border-gray-200 p-2 lg:sticky lg:top-4" aria-label="Contract sections">
              {tree.map((n) => (
                <div key={n.key}>
                  <TreeItem label={n.label} badge={n.badge} active={cur === n.key} open={!!n.children && (cur === n.key || cur.startsWith("ob-"))} hasChildren={!!n.children} onClick={() => go(n.key)} />
                  {n.children && (cur === n.key || cur.startsWith("ob-")) && n.children.map((x) => (
                    <TreeItem key={x.key} label={x.label} badge={x.badge} active={cur === x.key} indent onClick={() => go(x.key)}
                      dot={x.key === "ob-finance" ? "bg-emerald-500" : x.key === "ob-business" ? "bg-sky-500" : "bg-violet-500"} />
                  ))}
                </div>
              ))}
            </nav>

            <div className="min-w-0 space-y-4">
              {cur === "documents" && (
                <Panel title="Documents" sub={`${documents.length} version${documents.length === 1 ? "" : "s"}`} right={<MoreMenu c={c} documents={documents} onDone={refresh} />}>

            {documents.length === 0 ? <p className="p-4 text-sm text-gray-500">No documents.</p> : (
              <table className="w-full">
                <thead><tr className="border-b border-gray-200"><th className={TH}>Document</th><th className={TH}>Uploaded</th><th className={TH}>AI review</th><th className={TH}></th></tr></thead>
                <tbody>
                  {documents.map((d: any) => {
                    const sent = events.filter((e: any) => e.event_type === "sent" && e.meta?.document_id === d.id).at(-1);
                    return (
                      <tr key={d.id} className={cn("border-b border-gray-100 last:border-0", d.id === current?.id && reviewing && "bg-sky-50/30")}>
                        <td className={TD}>
                          <div className="font-medium flex items-center gap-1.5"><FileText className="size-4 text-gray-500" />{d.file_name}</div>
                          <div className="text-sm text-gray-600">{DOC_ROLE[d.doc_role] ?? d.doc_role} v{d.version}{d.generated ? " · Template" : ""}{sent ? ` · sent ${format(new Date(sent.created_at), "d MMM")}` : ""}{d.id === current?.id && reviewing ? " · under review" : ""}</div>
                        </td>
                        <td className={TD + " text-gray-700"}>{displayName(d.uploaded_by_name)}<div className="text-sm text-gray-600">{format(new Date(d.created_at), "d MMM yyyy, HH:mm")}</div></td>
                        <td className={TD}>
                          {d.ai_review_status === "done"
                            ? <span className="inline-flex items-center gap-1.5"><SeverityIcon severity={d.verdict === "compliant" ? "info" : d.verdict} /> Risk {d.riskScore ?? "—"}{d.findings ? <span className="text-gray-500"> · {d.findings.length} finding{d.findings.length === 1 ? "" : "s"}</span> : null}</span>
                            : <span className="text-gray-500">{d.doc_role === "executed" || d.doc_role === "tender" ? "—" : d.ai_review_status}</span>}
                        </td>
                        <td className={TD + " text-right"}>
                          <div className="flex justify-end gap-2">
                            <Button asChild size="sm" variant="outline"><a href={d.file_url} target="_blank" rel="noreferrer" download>Download</a></Button>
                            {d.doc_role !== "executed" && <Button asChild size="sm" variant="outline"><Link to="/ccms/review/$documentId" params={{ documentId: d.id }}>Open review</Link></Button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
                </Panel>
              )}

              {cur === "comments" && (
                <Panel title="Comments" sub={openNow ? `${openNow} open on the current version` : `${onCurrent.length} on the current version`}>

            {threads.length === 0 ? <p className="p-4 text-sm text-gray-500">No comments yet.</p> : (
              <>
                <ThreadTable rows={onCurrent} comments={comments} />
                {older.length > 0 && (
                  <div className="border-t border-gray-100">
                    <button onClick={() => setShowOlder((v) => !v)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">{showOlder ? "Hide" : "Show"} earlier versions ({older.length})</button>
                    {showOlder && <div className="opacity-75"><ThreadTable rows={older} comments={comments} /></div>}
                  </div>
                )}
              </>
            )}
                </Panel>
              )}

              {cur === "review" && (
                <>
                  {flags.length > 0 && (
                    <Panel title="Flags" sub={flags.map((f) => FLAG_META[f.key]?.label).join(", ")}>

              <ul className="divide-y divide-gray-100">
                {flags.map((f) => (
                  <li key={f.key} className="flex gap-2 px-4 py-3">
                    <SeverityIcon severity={FLAG_META[f.key]?.severity} className="mt-0.5" />
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{FLAG_META[f.key]?.label}{BLOCKING_FLAGS.includes(f.key) && " · blocks approval"}</div>
                      <div className="text-sm text-gray-700">{f.detail}</div>
                      <div className="text-sm text-gray-500 mt-0.5">→ {FLAG_META[f.key]?.effect}</div>
                    </div>
                  </li>
                ))}
              </ul>
                    </Panel>
                  )}
                  {STRAIGHT_THROUGH.types.includes(c.contract_type) && !wasStraightThrough(route) && current?.ai_review_status === "done" && (() => {
                    const st = straightThrough(c, vendor, flags, { verdict: current.verdict, riskScore: current.riskScore, findings: current.findings });
                    return st.blockers.length ? (
                      <div className="rounded-md border border-gray-200 px-4 py-2.5 text-sm text-gray-700"><span className="font-semibold text-gray-900">Not straight-through</span> — {st.blockers.join("; ")}. Routine contracts that pass every check are cleared and approved without waiting.</div>
                    ) : null;
                  })()}
                  <Panel title="Review and approval route" sub={route.length ? `${route.length} stage${route.length === 1 ? "" : "s"}` : undefined}>

            <table className="w-full">
              <thead><tr className="border-b border-gray-200"><th className={TH}>Stage</th><th className={TH}>Why</th><th className={TH}>Outcome</th><th className={TH}>Service level</th></tr></thead>
              <tbody>
                {route.map((s) => {
                  const now = (c.status === "in_review" && s.kind === "review" && s.status === "pending") || (nextApproval(route)?.key === s.key && c.status.startsWith("pending"));
                  return (
                    <tr key={s.key} className={cn("border-b border-gray-100 last:border-0", now && "bg-sky-50/40")}>
                      <td className={TD}><div className="font-medium">{stageTitle(s.label)}</div><div className="text-sm text-gray-600">{CCMS_ROLES[s.role]} · {s.kind}</div></td>
                      <td className={TD + " text-gray-700"}>{s.reason}</td>
                      <td className={TD}><OutcomeText status={s.status} lite={flowOf(c) === "lite" && s.key === "legal"} />{s.decided_by && <div className="text-sm text-gray-600">{displayName(s.decided_by)} · {s.decided_at ? format(new Date(s.decided_at), "d MMM") : ""}</div>}<NoteText text={s.note} className="mt-0.5 text-gray-700" /></td>
                      <td className={TD}>{now ? <SlaText since={c.stage_started_at} days={s.sla_days} /> : <span className="text-sm text-gray-500">{s.sla_days} working days</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
                  </Panel>
                </>
              )}

              {cur === "details" && (
                <Panel title="Details" sub={`${fmtMoney(c.value, c.currency)} · ${c.start_date ?? "—"} to ${c.end_date ?? "—"} · ${c.counterparty_name ?? "—"}`}>

            <table className="w-full"><tbody>
              <Row k="Entity" v={c.entity} />
              <Row k="Contract owner" v={<OwnerEditor c={c} onDone={refresh} />} />
              <Row k="Side" v={c.side === "client" ? "Client contract — the Company is awarded the work (CMS-02)" : "Vendor contract — the Company awards the work (CMS-01)"} />
              <Row k="Value" v={<>{fmtMoney(c.value, c.currency)}{c.currency !== "MYR" && c.value_myr != null ? <span className="text-gray-600"> · ≈ {fmtMoney(c.value_myr)}</span> : null}</>} />
              <Row k="Period" v={`${c.start_date ?? "—"} to ${c.end_date ?? "—"}`} />
              <Row k="Project / job" v={[c.project, c.job_number].filter(Boolean).join(" · ") || "—"} />
              <Row k="Award reference" v={c.award_reference || "—"} />
              <Row k="Scope" v={<span className="whitespace-pre-wrap">{c.scope_summary}</span>} />
              <Row k="Requested by" v={`${displayName(c.requestor_name)}${c.requestor_department ? ` · ${c.requestor_department}` : ""} · ${format(new Date(c.created_at), "d MMM yyyy")}`} />
              {vendor ? <>
                <Row k="Vendor" v={vendor.name} />
                <Row k="SSM no." v={vendor.registration_no || "—"} />
                <Row k="Vendor status" v={<span className={vendor.status === "approved" ? "text-emerald-700" : "text-red-700"}>{vendor.status.replace("_", " ")}{vendor.compliance_hold ? " · on compliance hold" : ""}</span>} />
                <Row k="Due diligence" v={vendor.dd_valid_until ? <span className={new Date(vendor.dd_valid_until) < new Date() ? "text-red-700 font-semibold" : ""}>valid until {vendor.dd_valid_until}</span> : "—"} />
                <Row k="Risk rating" v={vendor.risk_rating} />
                <Row k="Related party" v={vendor.related_party ? <span className="text-red-700">Yes{vendor.related_party_note ? ` — ${vendor.related_party_note}` : ""}</span> : "No"} />
              </> : <Row k="Counterparty" v={`${c.counterparty_name ?? "—"}${c.side === "client" ? " (client)" : ""}`} />}
            </tbody></table>
                </Panel>
              )}

              {cur === "obligations" && <ObligationsOverview c={c} obl={obl} fromDraft={fromDraft} go={go} />}
              {cur.startsWith("ob-") && <DepartmentView cat={cur.slice(3) as ObligationCategory} c={{ ...c, __draftTerms: draftDoc?.terms }} vendor={vendor} obl={obl} fromDraft={fromDraft} onChanged={refresh} />}

              {cur === "confirmation" && client && <Panel title="Confirmation Letter"><ConfirmationRecord c={c} documents={documents} /></Panel>}
              {cur === "signing" && after && <Panel title="Signing & Repository" sub={c.expiry_date ? `expires ${c.expiry_date}` : c.signed_date ? `signed ${c.signed_date}` : undefined}><ExecutionRecord c={c} /></Panel>}
              {cur === "lifecycle" && lifecycle && <Panel title="Changes & Renewals"><LifecycleRecord c={c} /></Panel>}

              {cur === "audit" && (
                <Panel title="Audit Trail" sub={`${events.length} entries`}>

            <table className="w-full"><tbody>
              {[...events].reverse().map((e: any) => (
                <tr key={e.id} className="border-b border-gray-100 last:border-0">
                  <td className={TD + " w-40 text-gray-600 whitespace-nowrap"}>{format(new Date(e.created_at), "d MMM yyyy, HH:mm")}</td>
                  <td className={TD + " w-48"}>{displayName(e.actor_name)}<div className="text-sm text-gray-600">{CCMS_ROLES[e.acting_role as keyof typeof CCMS_ROLES] ?? ""}</div></td>
                  <td className={TD}><NoteText text={e.detail} /></td>
                </tr>
              ))}
            </tbody></table>
                </Panel>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <tr className="border-b border-gray-100 last:border-0"><td className="px-4 py-2 text-sm text-gray-600 w-40 align-top">{k}</td><td className="px-4 py-2 text-sm text-gray-900">{v}</td></tr>;
}

function ThreadTable({ rows, comments }: { rows: any[]; comments: any[] }) {
  if (!rows.length) return <p className="px-4 py-3 text-sm text-gray-500">None on this version.</p>;
  return (
    <table className="w-full">
      <tbody>
        {rows.map((x) => {
          const n = comments.filter((r: any) => r.parent_id === x.id).length;
          return (
            <tr key={x.id} className={cn("border-b border-gray-100 last:border-0", x.status === "resolved" && "opacity-60")}>
              <td className={TD + " w-36"}>{roleLabel(x.acting_role)}<div className="text-sm text-gray-600">{x.acting_role === AI_ROLE ? "" : displayName(x.author_name)}</div></td>
              <td className={TD + " text-gray-700 w-48"}>{(x.anchor_ref || (x.quote ? `"${x.quote.slice(0, 50)}…"` : "General")).replace(/^Finding:\s*/, "")}</td>
              <td className={TD}><CommentBody body={x.body} severity={x.severity} clamp />{n > 0 && <div className="text-xs text-gray-500 mt-0.5">{n} repl{n === 1 ? "y" : "ies"}</div>}</td>
              <td className={TD + " w-28"}><span className={x.status === "open" ? "text-amber-700 font-semibold text-sm" : "text-emerald-700 text-sm"}>{x.status === "open" ? "Open" : "Resolved"}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Less common document actions, out of the way of the one next step. */
function MoreMenu({ c, documents, onDone }: { c: any; documents: any[]; onDone: () => void }) {
  const [role, setRole] = useCcmsRole();
  const [open, setOpen] = useState<NextAction | null>(null);
  const editable = ["submitted", "in_review", "returned", "pending_committee", "pending_approval"].includes(c.status);
  const items: NextAction[] = [
    ...(c.side === "client" ? [{ id: "attach_tender" as const, label: "Attach Tender", role: "contract_executive" as const }] : []),
    ...(editable ? [
      { id: (c.side === "client" ? "upload_award" : "upload_theirs") as NextAction["id"], label: c.side === "client" ? "Upload Client Award" : "Upload Counterparty Revision", role: "requestor" as const },
      ...(c.side === "vendor" ? [{ id: "upload_revised" as const, label: "Upload Draft Revision", role: "requestor" as const }] : []),
      ...(templateById(c.template_id) ? [{ id: "generate" as const, label: "Regenerate Draft", role: "requestor" as const }] : []),
    ] : []),
  ];
  if (!items.length) return null;
  const pick = (a: NextAction) => { if (role !== a.role && DEMO_SINGLE_USER) setRole(a.role); setOpen(a); };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" className="gap-1 text-gray-600"><MoreHorizontal className="size-4" /> More</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-white">
          {items.map((a) => <DropdownMenuItem key={a.id} onSelect={() => pick(a)}>{a.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
      <ActionDialog action={open} c={c} documents={documents} onClose={() => setOpen(null)} onDone={onDone} />
    </>
  );
}

/** The contract owner, changeable in place. */
function OwnerEditor({ c, onDone }: { c: any; onDone: () => void }) {
  const fn = useServerFn(setCcmsOwner);
  const [role] = useCcmsRole();
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (edit === null) return <span>{contractOwner(c) || "—"} <button onClick={() => setEdit(contractOwner(c))} className="ml-2 text-sm text-blue-700 hover:underline">Change Owner</button></span>;
  return (
    <span className="inline-flex items-center gap-2">
      <input list="owner-people" autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm" />
      <datalist id="owner-people">{DEMO_PEOPLE.map((p) => <option key={p.name} value={p.name} />)}</datalist>
      <Button size="sm" disabled={busy || edit.trim().length < 2} onClick={async () => {
        setBusy(true);
        try { await fn({ data: { contract_id: c.id, owner: edit.trim(), acting_role: role } }); toast.success("Owner changed"); setEdit(null); onDone(); }
        catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
      }}>Save</Button>
      <button onClick={() => setEdit(null)} className="text-sm text-gray-500 hover:underline">Cancel</button>
    </span>
  );
}

/** Deletes a contract request (not a filed contract) after the reference is typed back. */
function DeleteContract({ c }: { c: any }) {
  const fn = useServerFn(deleteCcmsContract);
  const [role, setRole] = useCcmsRole();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
    {confirmDialog}
    <Button size="sm" variant="ghost" title="Delete this request" disabled={busy} className="gap-1 text-gray-500 hover:text-red-700" onClick={async () => {
      if (!(await confirm({ title: `Delete ${c.reference_number}?`, body: "The request, its documents, comments and history are removed. This cannot be undone.", typeToConfirm: c.reference_number, confirmLabel: "Delete Request" }))) return;
      setBusy(true);
      try {
        const acting = ["requestor", "contract_executive", "legal", "contract_manager"].includes(role) ? role : "contract_executive";
        if (DEMO_SINGLE_USER && acting !== role) setRole(acting as any);
        await fn({ data: { contract_id: c.id, acting_role: acting as any } });
        toast.success(`${c.reference_number} deleted`);
        qc.invalidateQueries({ queryKey: ["ccms-contracts"] });
        nav({ to: "/ccms/contracts" });
      } catch (e: any) { toast.error(e?.message ?? "Could not delete"); setBusy(false); }
    }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete</Button>
    </>
  );
}

function TreeItem({ label, badge, active, onClick, indent, hasChildren, open, dot }: {
  label: string; badge?: React.ReactNode; active: boolean; onClick: () => void; indent?: boolean; hasChildren?: boolean; open?: boolean; dot?: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm", indent && "pl-8", active ? "bg-gray-100 font-semibold text-gray-900" : "text-gray-700 hover:bg-gray-50")}>
      {hasChildren && <ChevronRight className={cn("size-3.5 shrink-0 text-gray-400 transition-transform", open && "rotate-90")} />}
      {dot && <span className={cn("size-2 shrink-0 rounded-full", dot)} />}
      <span className="flex-1 truncate">{label}</span>
      {badge != null && <span className="shrink-0 text-xs tabular-nums text-gray-500">{badge}</span>}
    </button>
  );
}

function Panel({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={CARD}>
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {sub && <span className="truncate text-sm text-gray-500">{sub}</span>}
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </section>
  );
}

/** A labelled figure for the department views. */
function Fact({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className={cn("rounded-md border px-3 py-2", tone === "good" ? "border-emerald-200 bg-emerald-50/40" : tone === "warn" ? "border-amber-200 bg-amber-50/50" : tone === "bad" ? "border-red-200 bg-red-50/50" : "border-gray-200")}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-gray-900">{value}</div>
      {note && <div className="mt-0.5 text-xs text-gray-600">{note}</div>}
    </div>
  );
}

const NOT_FILED = <p className="px-4 py-6 text-sm text-gray-500">Obligations come in when the contract is filed: File to Repository reads the signed copy and lists each one, with a person in charge and a due date.</p>;

/** All obligations, with a card per department that opens its view. */
function ObligationsOverview({ c, obl, fromDraft, go }: { c: any; obl: Obligation[]; fromDraft: boolean; go: (k: string) => void }) {
  if (!obl.length) return <Panel title="Obligations">{NOT_FILED}</Panel>;
  return (
    <Panel title="Obligations" sub={fromDraft ? "From the draft under review · confirmed when filed" : `${obl.filter((o) => o.status === "open").length} open · ${obl.filter((o) => o.status === "done").length} done`}>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
        {(Object.keys(OBLIGATION_CATEGORIES) as ObligationCategory[]).map((k) => {
          const mine = obl.filter((o) => o.category === k);
          const open = mine.filter((o) => o.status === "open");
          const soon = open.filter((o) => ["overdue", "soon"].includes(obligationBucket(o))).length;
          const next = open.filter((o) => o.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0];
          if (!mine.length && !departmentRequired(c, k).required) return (
            <button key={k} onClick={() => go(`ob-${k}`)} className="rounded-lg border border-gray-200 p-3 text-left text-gray-500 hover:shadow-sm">
              <div className="font-semibold">{OBLIGATION_CATEGORIES[k]}</div><div className="mt-1 text-sm">Not required for this contract</div>
            </button>
          );
          return (
            <button key={k} onClick={() => go(`ob-${k}`)} className={cn("rounded-lg border p-3 text-left hover:shadow-sm", CATEGORY_TINT[k])}>
              <div className="flex items-center justify-between"><span className="font-semibold">{OBLIGATION_CATEGORIES[k]}</span><span className="text-xs">PIC {[...new Set(mine.map((o) => o.pic))].join(", ") || "—"}</span></div>
              <div className="mt-1 text-2xl font-semibold">{open.length}<span className="ml-1 text-sm font-normal">open</span></div>
              <div className="text-xs">{soon ? `${soon} due within 30 days` : next ? `Next: ${next.due_date}` : "Nothing dated"}</div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

/** One department's view of the contract: its checklist, the facts it works
 *  with (only those with a value), its obligations and the records behind them. */
function DepartmentView({ cat, c, vendor, obl, fromDraft, onChanged }: { cat: ObligationCategory; c: any; vendor: any; obl: Obligation[]; fromDraft: boolean; onChanged: () => void }) {
  const mine = obl.filter((o) => o.category === cat).sort((a, b) => String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")));
  const req = departmentRequired(c, cat);
  const checklist = departmentChecklist(c, cat, obl);
  const cur = c.repository?.currency ?? c.currency;
  const value = c.repository?.value ?? c.value;
  const days = c.expiry_date ? daysBetween(new Date(), c.expiry_date) : null;
  const terms = c.__draftTerms as any;
  const has = (v: any) => v !== null && v !== undefined && v !== "" && v !== "—";
  type F = { label: string; value: any; note?: any; tone?: "good" | "warn" | "bad" };
  let facts: F[] = [];
  let extra: React.ReactNode = null;
  if (cat === "finance") {
    const pays = mine.filter((o) => o.amount != null);
    const scheduled = pays.reduce((n, o) => n + (o.amount ?? 0), 0);
    const paid = pays.filter((o) => o.status === "done").reduce((n, o) => n + (o.amount ?? 0), 0);
    const next = pays.filter((o) => o.status === "open" && o.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0];
    const secs: Security[] = c.securities ?? [];
    facts = [
      { label: "Contract value", value: value != null ? fmtMoney(value, cur) : null, note: c.currency !== "MYR" && c.value_myr != null ? `≈ ${fmtMoney(c.value_myr)}` : undefined },
      { label: "Payment schedule", value: pays.length ? fmtMoney(scheduled, cur) : null, note: `${pays.length} instalment${pays.length === 1 ? "" : "s"}${value ? ` · ${Math.round((scheduled / value) * 100)}% of value` : ""}` },
      ...(!fromDraft && pays.length ? [{ label: "Paid", value: fmtMoney(paid, cur), note: `Outstanding ${fmtMoney(scheduled - paid, cur)}`, tone: paid >= scheduled ? ("good" as const) : undefined }] : []),
      { label: "Next payment", value: next ? fmtMoney(next.amount, cur) : null, note: next ? `${next.due_date} · ${next.text}` : undefined, tone: next && !fromDraft && obligationBucket(next) === "overdue" ? "bad" : undefined },
      { label: "Stamp duty", value: c.stamping?.duty != null ? fmtMoney(c.stamping.duty) : null, note: c.stamping?.certificate_no ?? undefined },
    ];
    if (secs.some((x) => x.reference || x.required)) extra = (
      <Panel title="Bonds and insurance" sub={paymentReady(secs) ? "Payment-ready" : "Incomplete"}>
        <table className="w-full"><thead><tr className="border-b border-gray-200"><th className={TH}>Instrument</th><th className={TH}>Required</th><th className={TH + " text-right"}>Amount</th><th className={TH}>Reference</th><th className={TH}>Valid until</th></tr></thead>
          <tbody>{secs.filter((x) => x.required || x.reference).map((x) => (
            <tr key={x.type} className="border-b border-gray-100 last:border-0">
              <td className={TD}>{SECURITY_TYPES.find((t) => t.id === x.type)?.label ?? x.type}</td><td className={TD}>{x.required ? "Yes" : "—"}</td>
              <td className={TD + " text-right tabular-nums"}>{x.amount != null ? fmtMoney(x.amount) : "—"}</td><td className={TD}>{x.reference || "—"}</td><td className={TD}>{x.valid_until || "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
    );
  } else if (cat === "business") {
    facts = [
      { label: "Contract owner", value: contractOwner(c) || null, note: c.requestor_department ?? undefined },
      { label: "Period", value: (c.repository?.start_date ?? c.start_date) || c.expiry_date || c.end_date ? `${c.repository?.start_date ?? c.start_date ?? "—"} to ${c.expiry_date ?? c.end_date ?? "—"}` : null },
      { label: "Expires in", value: days == null ? null : days < 0 ? `expired ${-days} days ago` : `${days} days`, tone: days != null && days <= 30 ? "warn" : undefined },
      { label: "Renewal", value: c.repository?.renewal || null, note: c.renewal ? `Decided: ${c.renewal.decision}` : undefined },
      { label: "Counterparty", value: c.counterparty_name, note: vendor ? `${vendor.status}${vendor.dd_valid_until ? ` · due diligence to ${vendor.dd_valid_until}` : ""}` : undefined, tone: vendor && vendor.status !== "approved" ? "warn" : undefined },
      { label: "Project / job", value: [c.project, c.job_number].filter(Boolean).join(" · ") || null },
      { label: "Changes", value: (c.changes ?? []).length || null },
    ];
    if ((c.changes ?? []).length) extra = <Panel title="Changes and renewals"><LifecycleRecord c={c} /></Panel>;
  } else {
    const flags = (c.flags ?? []) as Flag[];
    facts = [
      { label: "Parties", value: c.repository?.parties || null },
      { label: "Contracting entity", value: entityShort(c.entity), note: c.entity },
      { label: "Governing law", value: c.repository?.governing_law || terms?.governing_law || null },
      { label: "Notice period", value: c.repository?.notice_period || terms?.notice_period || null },
      { label: "Flags", value: flags.length ? flags.map((f) => FLAG_META[f.key]?.label).join(", ") : null, tone: flags.some((f) => BLOCKING_FLAGS.includes(f.key)) ? "bad" : flags.length ? "warn" : undefined },
    ];
    const sigs = (c.signatories ?? []) as any[];
    if (sigs.length) extra = (
      <Panel title="Signatories">
        <table className="w-full"><tbody>{sigs.map((x, i) => (
          <tr key={i} className="border-b border-gray-100 last:border-0"><td className={TD}>{x.name}</td><td className={TD + " text-gray-600"}>{x.designation ?? "—"}</td><td className={TD + " text-gray-600"}>{x.party}</td></tr>
        ))}</tbody></table>
      </Panel>
    );
  }
  facts = facts.filter((f) => has(f.value));
  const pics = [...new Set(mine.map((o) => o.pic))].join(", ");

  return (
    <>
      <Panel title={OBLIGATION_CATEGORIES[cat]} sub={req.required ? req.why : "Not required"}>
        {!req.required && <p className="border-b border-gray-100 bg-gray-50/60 px-4 py-2.5 text-sm text-gray-600">{req.why}{mine.length ? ` Its ${OBLIGATION_CATEGORIES[cat].toLowerCase()} obligations are still listed below.` : ""}</p>}
        {checklist.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {checklist.map((it) => (
              <li key={it.label} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border text-xs", it.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300 text-gray-300")}>{it.done ? "✓" : ""}</span>
                <span className={cn("flex-1", it.done ? "text-gray-900" : "text-gray-600")}>{it.label}</span>
                <span className="text-xs text-gray-500">{it.note ?? (it.done ? "Done" : "Pending")}</span>
              </li>
            ))}
          </ul>
        )}
        {facts.length > 0 && (
          <div className="grid grid-cols-2 gap-3 border-t border-gray-100 p-4 md:grid-cols-4">
            {facts.map((f) => <Fact key={f.label} label={f.label} value={f.value} note={f.note} tone={f.tone} />)}
          </div>
        )}
        {cat === "business" && c.scope_summary && <div className="border-t border-gray-100 px-4 py-3 text-sm"><span className="text-gray-500">Scope · </span><span className="whitespace-pre-wrap text-gray-900">{c.scope_summary}</span></div>}
      </Panel>
      {mine.length > 0 && (
        <Panel title={`${OBLIGATION_CATEGORIES[cat]} obligations`} sub={fromDraft ? `From the draft under review · confirmed when filed · PIC ${pics}` : `${mine.filter((o) => o.status === "open").length} open · PIC ${pics}`}>
          <ObligationRows rows={mine.map((o) => ({ o, c }))} onChanged={onChanged} readOnly={fromDraft} />
        </Panel>
      )}
      {extra}
    </>
  );
}
