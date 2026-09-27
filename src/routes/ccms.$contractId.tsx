import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { TemplateFieldsForm } from "@/components/ccms-template-form";
import { supabase } from "@/integrations/supabase/client";
import {
  attachCcmsDocument, decideCcmsApproval, generateCcmsDraft, getCcmsContract, recordCcmsSentToCounterparty, resubmitCcmsContract, reviewCcmsDocument,
} from "@/lib/ccms.functions";
import {
  CcmsHeader, StatusBadge, OutcomeText, SlaText, CARD, TH, TD, fmtMoney, useCcmsRole,
} from "@/components/ccms-widgets";
import {
  AI_ROLE, CCMS_ROLES, CONTRACT_TYPES, FLAG_META, BLOCKING_FLAGS, DEMO_SINGLE_USER, nextApproval, roleLabel, templateById, fillNda, ENTITY_DETAILS,
  type Flag, type Stage,
} from "@/lib/ccms";
import { Loader2, Upload, FileText, MessageSquare, AlertTriangle, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ccms/$contractId")({
  component: ContractDetail,
  head: () => ({ meta: [{ title: "Commercial CMS · Contract" }] }),
});

function ContractDetail() {
  const { contractId } = Route.useParams();
  const getFn = useServerFn(getCcmsContract);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["ccms-contract", contractId], queryFn: () => getFn({ data: { id: contractId } }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["ccms-contract", contractId] }); qc.invalidateQueries({ queryKey: ["ccms-contracts"] }); };

  if (isLoading) return <AppShell><div className="p-10 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div></AppShell>;
  if (error || !data) return <AppShell><div className="p-10 text-sm text-red-700">{(error as Error)?.message ?? "Not found"}</div></AppShell>;

  const { contract: c, vendor, documents, comments, reviews, events } = data as any;
  const t = CONTRACT_TYPES[c.contract_type];
  const flags: Flag[] = c.flags ?? [];
  const route: Stage[] = c.approval_route ?? [];
  const threads = comments.filter((x: any) => !x.parent_id);
  const openThreads = threads.filter((x: any) => x.status === "open");
  const latestDraft = documents.find((d: any) => d.doc_role === "draft");

  return (
    <AppShell>
      <CcmsHeader title={`${c.reference_number} · ${c.title}`} subtitle={`${t?.label ?? c.contract_type} · ${c.entity} · ${c.counterparty_name ?? "—"}`} />
      <div className="p-6 bg-white min-h-full space-y-5">
        <Link to="/ccms/contracts" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline"><ArrowLeft className="size-4" /> Contracts</Link>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
          <div className="space-y-5 min-w-0">
            {/* Summary */}
            <section className={CARD}>
              <table className="w-full">
                <tbody>
                  <Row k="Status" v={<StatusBadge status={c.status} />} />
                  <Row k="Side" v={c.side === "client" ? "Client contract — the Company is awarded the work (CMS-02)" : "Vendor contract — the Company awards the work (CMS-01)"} />
                  <Row k="Value" v={<>{fmtMoney(c.value, c.currency)}{c.currency !== "MYR" && c.value_myr != null ? <span className="text-gray-600"> · ≈ {fmtMoney(c.value_myr)}</span> : null}</>} />
                  <Row k="Period" v={`${c.start_date ?? "—"} to ${c.end_date ?? "—"}`} />
                  <Row k="Project / job" v={[c.project, c.job_number].filter(Boolean).join(" · ") || "—"} />
                  <Row k="Award reference" v={c.award_reference || "—"} />
                  <Row k="Scope" v={<span className="whitespace-pre-wrap">{c.scope_summary}</span>} />
                  <Row k="Requested by" v={`${c.requestor_name ?? "—"}${c.requestor_department ? ` · ${c.requestor_department}` : ""} · ${format(new Date(c.created_at), "d MMM yyyy")}`} />
                </tbody>
              </table>
            </section>

            <ActionPanel c={c} route={route} flags={flags} openThreads={openThreads.length} latestDraft={latestDraft} documents={documents} events={events} onDone={refresh} />

            {/* Route */}
            <section className={CARD}>
              <Head title="Review and approval route" sub="Reviews run side by side; approvals follow in order. Set from the flags, contract type and value." />
              <table className="w-full">
                <thead><tr className="border-b border-gray-200"><th className={TH}>Stage</th><th className={TH}>Why</th><th className={TH}>Outcome</th><th className={TH}>Service level</th></tr></thead>
                <tbody>
                  {route.map((s) => {
                    const current = (c.status === "in_review" && s.kind === "review" && s.status === "pending") || nextApproval(route)?.key === s.key && c.status.startsWith("pending");
                    return (
                      <tr key={s.key} className={cn("border-b border-gray-100 last:border-0", current && "bg-blue-50/40")}>
                        <td className={TD}><div className="font-medium">{s.label}</div><div className="text-sm text-gray-600">{CCMS_ROLES[s.role]} · {s.kind}</div></td>
                        <td className={TD + " text-gray-700"}>{s.reason}</td>
                        <td className={TD}><OutcomeText status={s.status} />{s.decided_by && <div className="text-sm text-gray-600">{s.decided_by} · {s.decided_at ? format(new Date(s.decided_at), "d MMM") : ""}</div>}{s.note && <div className="text-sm text-gray-700 mt-0.5">{s.note}</div>}</td>
                        <td className={TD}>{current ? <SlaText since={c.stage_started_at} days={s.sla_days} /> : <span className="text-sm text-gray-500">{s.sla_days} working days</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            {/* Documents */}
            <section className={CARD}>
              <Head title="Documents" sub="Every upload is a new version. The AI flags issues — it never rewrites the draft." right={
                <div className="flex gap-2">
                  {templateById(c.template_id) && !["approved", "rejected", "closed"].includes(c.status) && (
                    <RegenerateButton contract={c} previous={documents.find((d: any) => d.generated)?.fields ?? null} onDone={refresh} />
                  )}
                  {documents.length > 0 && <UploadButton contractId={c.id} onDone={refresh} docRole="counterparty" label="Upload counterparty markup" />}
                  <UploadButton contractId={c.id} onDone={refresh} docRole="draft" label={documents.length ? "Upload revised draft" : "Upload draft"} />
                </div>} />
              {documents.length === 0 ? <p className="p-4 text-sm text-gray-500">No draft yet. Upload the draft contract to start the review.</p> : (
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200"><th className={TH}>Document</th><th className={TH}>Uploaded</th><th className={TH}>AI review</th><th className={TH}></th></tr></thead>
                  <tbody>
                    {documents.map((d: any) => (
                      <tr key={d.id} className="border-b border-gray-100 last:border-0">
                        <td className={TD}><div className="font-medium flex items-center gap-1.5"><FileText className="size-4 text-gray-500" />{d.file_name}</div><div className="text-sm text-gray-600">{d.doc_role === "counterparty" ? "Counterparty markup" : "Our draft"} v{d.version}{d.generated ? " · generated from the approved template" : ""}</div></td>
                        <td className={TD + " text-gray-700"}>{d.uploaded_by_name ?? "—"}<div className="text-sm text-gray-600">{format(new Date(d.created_at), "d MMM yyyy, HH:mm")}</div></td>
                        <td className={TD}>{d.ai_review_status === "done" ? <span>Risk {d.riskScore ?? "—"} · <span className={d.verdict === "red_flag" ? "text-red-700" : d.verdict === "caution" ? "text-amber-700" : "text-emerald-700"}>{String(d.verdict ?? "").replace("_", " ")}</span></span> : <span className="text-gray-600">{d.ai_review_status}</span>}</td>
                        <td className={TD + " text-right"}>
                          <div className="flex justify-end gap-2">
                            <Button asChild size="sm" variant="outline"><a href={d.file_url} target="_blank" rel="noreferrer" download>Download</a></Button>
                            {d.doc_role === "draft" && <SendButton contractId={c.id} doc={d} sent={events.filter((e: any) => e.event_type === "sent" && e.meta?.document_id === d.id)} onDone={refresh} />}
                            <Button asChild size="sm" variant="outline"><Link to="/ccms/review/$documentId" params={{ documentId: d.id }}>Open review</Link></Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Comment threads */}
            <section className={CARD}>
              <Head title={`Comment threads · ${openThreads.length} open`} sub="Raised on the review screen against a finding, a template clause or a passage. Tracked until resolved." />
              {threads.length === 0 ? <p className="p-4 text-sm text-gray-500">No comments yet.</p> : (
                <table className="w-full">
                  <thead><tr className="border-b border-gray-200"><th className={TH}>Raised by</th><th className={TH}>On</th><th className={TH}>Comment</th><th className={TH}>Status</th></tr></thead>
                  <tbody>
                    {threads.map((x: any) => (
                      <tr key={x.id} className="border-b border-gray-100 last:border-0">
                        <td className={TD}>{roleLabel(x.acting_role)}<div className="text-sm text-gray-600">{x.acting_role === AI_ROLE ? "on the draft" : x.author_name}</div></td>
                        <td className={TD + " text-gray-700"}>{x.anchor_ref || (x.quote ? `"${x.quote.slice(0, 60)}…"` : "General")}</td>
                        <td className={TD}>{x.body}<div className="text-sm text-gray-500">{comments.filter((r: any) => r.parent_id === x.id).length} repl{comments.filter((r: any) => r.parent_id === x.id).length === 1 ? "y" : "ies"}</div></td>
                        <td className={TD}><span className={x.status === "open" ? "text-amber-700 font-semibold text-sm" : "text-emerald-700 text-sm"}>{x.status === "open" ? "Open" : `Resolved · ${x.resolved_by_name ?? ""}`}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Audit trail */}
            <section className={CARD}>
              <Head title="Audit trail" />
              <table className="w-full">
                <tbody>
                  {events.map((e: any) => (
                    <tr key={e.id} className="border-b border-gray-100 last:border-0">
                      <td className={TD + " w-40 text-gray-600 whitespace-nowrap"}>{format(new Date(e.created_at), "d MMM yyyy, HH:mm")}</td>
                      <td className={TD + " w-48"}>{e.actor_name}<div className="text-sm text-gray-600">{CCMS_ROLES[e.acting_role as keyof typeof CCMS_ROLES] ?? ""}</div></td>
                      <td className={TD}>{e.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <aside className="space-y-5">
            <section className={CARD}>
              <Head title={`Flags · ${flags.length}`} sub="Raised by the platform and the AI review. The requestor cannot clear them." />
              {flags.length === 0 ? <p className="p-4 text-sm text-gray-500">No flags.</p> : (
                <ul className="divide-y divide-gray-100">
                  {flags.map((f) => (
                    <li key={f.key} className="px-4 py-3">
                      <div className={cn("text-sm font-semibold", FLAG_META[f.key]?.severity === "high" ? "text-red-800" : "text-amber-800")}>
                        {FLAG_META[f.key]?.label}{BLOCKING_FLAGS.includes(f.key) && " · blocks approval"}
                      </div>
                      <div className="text-sm text-gray-700">{f.detail}</div>
                      <div className="text-sm text-gray-500 mt-0.5">→ {FLAG_META[f.key]?.effect}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={CARD}>
              <Head title="Counterparty" />
              {vendor ? (
                <table className="w-full"><tbody>
                  <Row k="Vendor" v={vendor.name} />
                  <Row k="SSM no." v={vendor.registration_no || "—"} />
                  <Row k="Status" v={<span className={vendor.status === "approved" ? "text-emerald-700" : "text-red-700"}>{vendor.status.replace("_", " ")}</span>} />
                  <Row k="Due diligence" v={vendor.dd_valid_until ? <span className={new Date(vendor.dd_valid_until) < new Date() ? "text-red-700 font-semibold" : ""}>valid until {vendor.dd_valid_until}</span> : "—"} />
                  <Row k="Risk rating" v={vendor.risk_rating} />
                  <Row k="Related party" v={vendor.related_party ? <span className="text-red-700">Yes{vendor.related_party_note ? ` — ${vendor.related_party_note}` : ""}</span> : "No"} />
                </tbody></table>
              ) : <p className="p-4 text-sm text-gray-700">{c.counterparty_name ?? "—"}{c.side === "client" ? " (client)" : ""}</p>}
            </section>

            {(c.cost_log ?? []).length > 0 && (
              <section className={CARD + " p-4"}>
                <div className="text-sm text-gray-600">AI cost on this request</div>
                <div className="text-lg font-semibold text-gray-900">US${(c.cost_log as any[]).reduce((a, x) => a + (x.usd ?? 0), 0).toFixed(4)}</div>
                <div className="text-sm text-gray-500">{c.cost_log.length} AI call{c.cost_log.length === 1 ? "" : "s"}</div>
              </section>
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <tr className="border-b border-gray-100 last:border-0"><td className="px-4 py-2 text-sm text-gray-600 w-40 align-top">{k}</td><td className="px-4 py-2 text-sm text-gray-900">{v}</td></tr>;
}

function Head({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-gray-200 flex items-start gap-3">
      <div className="min-w-0"><h2 className="text-sm font-semibold text-gray-900">{title}</h2>{sub && <p className="text-sm text-gray-600">{sub}</p>}</div>
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </div>
  );
}

function UploadButton({ contractId, onDone, label, docRole }: { contractId: string; onDone: () => void; label: string; docRole: "draft" | "counterparty" }) {
  const [role] = useCcmsRole();
  const attachFn = useServerFn(attachCcmsDocument);
  const reviewFn = useServerFn(reviewCcmsDocument);
  const [busy, setBusy] = useState<string | null>(null);
  async function onFile(file: File) {
    try {
      setBusy("Uploading…");
      const path = `ccms/${contractId}/${Date.now()}-${file.name}`;
      const up = await supabase.storage.from("policies").upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (up.error) throw new Error(up.error.message);
      const url = supabase.storage.from("policies").getPublicUrl(path).data.publicUrl;
      const doc = await attachFn({ data: { contract_id: contractId, file_name: file.name, file_url: url, mime_type: file.type || null, size_bytes: file.size, doc_role: docRole, acting_role: role } });
      onDone();
      setBusy("AI reviewing…");
      await reviewFn({ data: { document_id: doc.id, acting_role: role } });
      toast.success("Draft reviewed");
    } catch (e: any) { toast.error(e?.message ?? "Upload failed"); }
    finally { setBusy(null); onDone(); }
  }
  return (
    <label className={cn("inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm cursor-pointer hover:border-gray-500", busy && "pointer-events-none opacity-70")}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {busy ?? label}
      <input type="file" accept=".docx,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

/** What the current persona can do right now, and why not when they can't. */
function ActionPanel({ c, route, flags, openThreads, latestDraft, documents, events, onDone }: { c: any; route: Stage[]; flags: Flag[]; openThreads: number; latestDraft: any; documents: any[]; events: any[]; onDone: () => void }) {
  const [role] = useCcmsRole();
  const decideFn = useServerFn(decideCcmsApproval);
  const resubmitFn = useServerFn(resubmitCcmsContract);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const stage = nextApproval(route);
  const blocking = flags.filter((f) => BLOCKING_FLAGS.includes(f.key));

  async function run(p: Promise<any>, ok: string) {
    setBusy(true);
    try { await p; toast.success(ok); setNote(""); onDone(); } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  }

  let body: React.ReactNode = null;
  if (c.status === "submitted") {
    body = <p className="text-sm text-gray-700">Waiting for the draft. The Contract Executive uploads it under Documents (service level 2 working days); the AI review then sets the route.</p>;
  } else if (c.status === "in_review") {
    const pending = route.filter((s) => s.kind === "review" && s.status === "pending");
    const latest = documents[0];
    const sent = latest && events.some((e: any) => e.event_type === "sent" && e.meta?.document_id === latest.id);
    body = (
      <div className="space-y-2 text-sm text-gray-700">
        {latest?.generated && latest.doc_role === "draft" && (
          <p className="rounded-md border border-emerald-200 p-2.5 text-gray-800">
            {sent
              ? <>Draft v{latest.version} has gone to the counterparty. When their marked-up version comes back, use <b>Upload counterparty markup</b> — the AI compares it with the approved template and opens a comment thread for each change.</>
              : <>Draft v{latest.version} was generated from the approved template and is ready for the counterparty: <b>Download</b> it, send it, then <b>Mark as sent</b>.</>}
          </p>
        )}
        <p>Waiting on: <b>{pending.map((s) => `${s.label} (${CCMS_ROLES[s.role]})`).join(", ") || "—"}</b>. Reviewers record their outcome on the review screen, where they can comment against the draft.</p>
        {latestDraft && <Button asChild size="sm"><Link to="/ccms/review/$documentId" params={{ documentId: latestDraft.id }}>Open the latest draft to review</Link></Button>}
        {openThreads > 0 && <p className="text-amber-800">{openThreads} comment thread(s) open, including the AI Reviewer's. "Cleared" needs them resolved; otherwise record "Cleared with comments".</p>}
      </div>
    );
  } else if ((c.status === "pending_approval" || c.status === "pending_committee") && stage) {
    const mine = role === stage.role;
    body = (
      <div className="space-y-3">
        <p className="text-sm text-gray-700">Awaiting <b>{stage.label}</b> ({CCMS_ROLES[stage.role]}). {stage.reason}.</p>
        {blocking.length > 0 && <p className="text-sm text-red-700 flex gap-1.5"><AlertTriangle className="size-4 shrink-0 mt-0.5" /> Cannot be approved until cleared: {blocking.map((f) => f.detail).join(" ")}</p>}
        {mine ? (
          <>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Decision note (required to return or reject)" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm min-h-16" />
            <div className="flex gap-2">
              <Button disabled={busy || blocking.length > 0} onClick={() => run(decideFn({ data: { contract_id: c.id, decision: "approved", note, acting_role: role } }), "Approved")}>Approve</Button>
              <Button variant="outline" disabled={busy} onClick={() => run(decideFn({ data: { contract_id: c.id, decision: "returned", note, acting_role: role } }), "Returned for amendment")}>Return for amendment</Button>
              <Button variant="outline" className="text-red-700" disabled={busy} onClick={() => run(decideFn({ data: { contract_id: c.id, decision: "rejected", note, acting_role: role } }), "Rejected")}>Reject</Button>
            </div>
            {DEMO_SINGLE_USER && <p className="text-xs text-gray-500">Demo mode: self-approval is allowed so one person can walk the flow, and it is recorded in the audit trail.</p>}
          </>
        ) : <p className="text-sm text-gray-600">Switch "Acting as" to {CCMS_ROLES[stage.role]} to decide.</p>}
      </div>
    );
  } else if (c.status === "returned") {
    const canResubmit = role === "requestor" || role === "contract_executive";
    body = (
      <div className="space-y-3">
        <p className="text-sm text-gray-700">Returned for amendment. Upload the revised draft, then resubmit — every review is taken again on the new version.</p>
        {canResubmit ? (
          <>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed in this version" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm min-h-16" />
            <Button disabled={busy} onClick={() => run(resubmitFn({ data: { contract_id: c.id, note, acting_role: role } }), "Resubmitted")}>Resubmit</Button>
          </>
        ) : <p className="text-sm text-gray-600">Switch "Acting as" to Requestor or Contract Executive to resubmit.</p>}
      </div>
    );
  } else if (c.status === "approved") {
    body = <p className="text-sm text-gray-700">Approved. Signing, stamping, bonds and obligations are the next phase of this workflow.</p>;
  } else if (c.status === "rejected") {
    body = <p className="text-sm text-gray-700">Rejected. The request is closed.</p>;
  }
  if (!body) return null;
  return (
    <section className={CARD + " p-4"}>
      <h2 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5"><MessageSquare className="size-4 text-gray-500" /> Next step</h2>
      {body}
    </section>
  );
}

/** Record that a draft went to the counterparty. Sending itself happens outside
 *  the platform for now (download, then email); this keeps the trail. */
function SendButton({ contractId, doc, sent, onDone }: { contractId: string; doc: any; sent: any[]; onDone: () => void }) {
  const [role] = useCcmsRole();
  const sendFn = useServerFn(recordCcmsSentToCounterparty);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  if (sent.length && !open) return <span className="self-center text-sm text-emerald-700" title={sent.map((e) => e.detail).join("\n")}>Sent {format(new Date(sent[sent.length - 1].created_at), "d MMM")}</span>;
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Mark as sent</Button>;
  return (
    <span className="flex items-center gap-1">
      <input autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="Sent to (name, email)" className="w-52 rounded-md border border-gray-300 px-2 py-1 text-sm" />
      <Button size="sm" disabled={busy || to.trim().length < 3} onClick={async () => {
        setBusy(true);
        try { await sendFn({ data: { contract_id: contractId, document_id: doc.id, recipient: to.trim(), acting_role: role } }); toast.success("Recorded as sent"); setOpen(false); onDone(); }
        catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
      }}>Save</Button>
    </span>
  );
}

/** A new version from the approved template — to complete particulars left
 *  blank, or correct one — starting from the answers the last one used. */
function RegenerateButton({ contract, previous, onDone }: { contract: any; previous: Record<string, string> | null; onDone: () => void }) {
  const [role] = useCcmsRole();
  const genFn = useServerFn(generateCcmsDraft);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = ENTITY_DETAILS[contract.entity];
  const [tf, setTf] = useState<Record<string, string>>(() => previous ?? {
    date: new Date().toISOString().slice(0, 10), direction: "Mutual", term: "Two (2) years", disputes: "Courts of Malaysia",
    stamp_duty: "Counterparty", non_solicit: "No", cp_form: "company", cp_country: "Malaysia", cp_name: contract.counterparty_name ?? "",
    company_reg: d?.regNo ?? "", company_address: d?.address ?? "", purpose: contract.scope_summary ?? "",
  });
  const miss = fillNda(contract.entity, tf).missing;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{previous ? "Regenerate from template" : "Generate from template"}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl bg-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previous ? "New version from the approved template" : "Generate the draft from the approved template"}</DialogTitle>
            <DialogDescription>The wording stays the approved template's; these particulars go into the parties block and Schedule 1. The draft becomes the next version.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <TemplateFieldsForm values={tf} onChange={(k, v) => setTf((p) => ({ ...p, [k]: v }))} fallbackPurpose={contract.scope_summary ?? ""} />
            {miss.length > 0 && <p className="text-sm text-amber-700">Still blank — {miss.join("; ")} — shown as [●].</p>}
            <div className="flex gap-2">
              <Button disabled={busy} onClick={async () => {
                setBusy(true);
                try { const r: any = await genFn({ data: { contract_id: contract.id, fields: tf, acting_role: role } }); toast.success(`Draft v${r.document.version} generated`); setOpen(false); onDone(); }
                catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
              }}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Generate"}</Button>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
