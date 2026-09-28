import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { format } from "date-fns";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CommentBody, ConfirmationRecord, ExecutionRecord, LifecycleRecord, Milestones } from "@/components/ccms-execution";
import { ActionDialog } from "@/components/ccms-actions";
import { getCcmsContract } from "@/lib/ccms.functions";
import {
  CcmsHeader, StatusBadge, OutcomeText, SlaText, Section, CostChip, SeverityIcon, CARD, TH, TD, fmtMoney, useCcmsRole,
} from "@/components/ccms-widgets";
import {
  AI_ROLE, CCMS_ROLES, CONTRACT_TYPES, FLAG_META, BLOCKING_FLAGS, DEMO_SINGLE_USER, flowOf, nextApproval, stageTitle, roleLabel, templateById, displayName,
  type Flag, type NextAction, type Stage,
} from "@/lib/ccms";
import { Loader2, FileText, ArrowLeft, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ccms/$contractId")({
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

  return (
    <AppShell>
      <CcmsHeader title={`${c.reference_number} · ${c.title}`} subtitle={`${t?.label ?? c.contract_type} · ${c.entity} · ${c.counterparty_name ?? "—"}`}
        action={<div className="flex items-center gap-2"><StatusBadge status={c.status} contract={c} /><CostChip log={c.cost_log ?? []} /></div>} />
      <div className="p-6 bg-white min-h-full">
        <div className="mx-auto max-w-6xl space-y-4">
          <Link to="/ccms/contracts" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline"><ArrowLeft className="size-4" /> Contracts</Link>

          <Milestones c={{ ...c, vendor }} documents={documents} events={events} onDone={refresh} />

          <Section title="Documents" summary={`${documents.length} version${documents.length === 1 ? "" : "s"}`} defaultOpen
            right={<MoreMenu c={c} documents={documents} onDone={refresh} />}>
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
          </Section>

          <Section title="Comments" summary={openNow ? `${openNow} open on the current version` : `${onCurrent.length} on the current version`}
            defaultOpen={reviewing && openNow > 0}>
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
          </Section>

          {flags.length > 0 && (
            <Section title="Flags" summary={<span className="inline-flex items-center gap-1.5">{flags.map((f) => <SeverityIcon key={f.key} severity={FLAG_META[f.key]?.severity} className="size-3.5" />)} {flags.map((f) => FLAG_META[f.key]?.label).join(", ")}</span>}
              defaultOpen={blocking.length > 0}>
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
            </Section>
          )}

          <Section title="Review and approval route" summary={route.map((s) => `${stageTitle(s.label)}: ${(flowOf(c) === "lite" && s.key === "legal" ? ({ cleared: "approved", cleared_with_comments: "approved with comments", not_cleared: "returned" } as Record<string, string>)[s.status] : null) ?? s.status.replace(/_/g, " ")}`).join(" · ")}>
            <table className="w-full">
              <thead><tr className="border-b border-gray-200"><th className={TH}>Stage</th><th className={TH}>Why</th><th className={TH}>Outcome</th><th className={TH}>Service level</th></tr></thead>
              <tbody>
                {route.map((s) => {
                  const now = (c.status === "in_review" && s.kind === "review" && s.status === "pending") || (nextApproval(route)?.key === s.key && c.status.startsWith("pending"));
                  return (
                    <tr key={s.key} className={cn("border-b border-gray-100 last:border-0", now && "bg-sky-50/40")}>
                      <td className={TD}><div className="font-medium">{stageTitle(s.label)}</div><div className="text-sm text-gray-600">{CCMS_ROLES[s.role]} · {s.kind}</div></td>
                      <td className={TD + " text-gray-700"}>{s.reason}</td>
                      <td className={TD}><OutcomeText status={s.status} lite={flowOf(c) === "lite" && s.key === "legal"} />{s.decided_by && <div className="text-sm text-gray-600">{displayName(s.decided_by)} · {s.decided_at ? format(new Date(s.decided_at), "d MMM") : ""}</div>}{s.note && <div className="text-sm text-gray-700 mt-0.5">{s.note}</div>}</td>
                      <td className={TD}>{now ? <SlaText since={c.stage_started_at} days={s.sla_days} /> : <span className="text-sm text-gray-500">{s.sla_days} working days</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          <Section title="Details" summary={`${fmtMoney(c.value, c.currency)} · ${c.start_date ?? "—"} to ${c.end_date ?? "—"} · ${c.counterparty_name ?? "—"}`}>
            <table className="w-full"><tbody>
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
          </Section>

          {c.side === "client" && (c.confirmation || documents.some((d: any) => d.comparison)) && (
            <Section title="Confirmation letter" summary={c.confirmation?.reply_date ? "client replied" : c.confirmation?.sent_date ? "awaiting reply" : "not sent"}>
              <ConfirmationRecord c={c} documents={documents} />
            </Section>
          )}

          {after && (
            <Section title="Signing and repository" summary={c.expiry_date ? `expires ${c.expiry_date}` : c.signed_date ? `signed ${c.signed_date}` : "not signed yet"}>
              <ExecutionRecord c={c} />
            </Section>
          )}

          {["signed", "stamped", "active", "closed"].includes(c.status) && ((c.changes ?? []).length > 0 || c.renewal) && (
            <Section title="Changes and renewals" summary={`${(c.changes ?? []).length} change${(c.changes ?? []).length === 1 ? "" : "s"}${c.renewal ? ` · ${c.renewal.decision}` : ""}`}>
              <LifecycleRecord c={c} />
            </Section>
          )}

          <Section title="Audit trail" summary={`${events.length} entries · last ${events.length ? format(new Date(events[events.length - 1].created_at), "d MMM, HH:mm") : "—"}`}>
            <table className="w-full"><tbody>
              {[...events].reverse().map((e: any) => (
                <tr key={e.id} className="border-b border-gray-100 last:border-0">
                  <td className={TD + " w-40 text-gray-600 whitespace-nowrap"}>{format(new Date(e.created_at), "d MMM yyyy, HH:mm")}</td>
                  <td className={TD + " w-48"}>{displayName(e.actor_name)}<div className="text-sm text-gray-600">{CCMS_ROLES[e.acting_role as keyof typeof CCMS_ROLES] ?? ""}</div></td>
                  <td className={TD}>{e.detail}</td>
                </tr>
              ))}
            </tbody></table>
          </Section>
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
