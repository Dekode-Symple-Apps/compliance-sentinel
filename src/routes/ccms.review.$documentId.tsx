import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { DocViewer, type DocHighlight } from "@/components/doc-viewer";
import { PdfViewer } from "@/components/pdf-viewer";
import {
  addCcmsComment, getCcmsDocument, recordCcmsReview, reviewCcmsDocument, setCcmsCommentStatus,
} from "@/lib/ccms.functions";
import { CcmsHeader, StatusBadge, OutcomeText, CARD, useCcmsRole } from "@/components/ccms-widgets";
import { CCMS_ROLES, CONTRACT_TYPES, templateById, type CcmsRole, type Stage } from "@/lib/ccms";
import { ArrowLeft, Loader2, MessageSquarePlus, RefreshCw, Check, RotateCcw, Lock, Quote } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ccms/review/$documentId")({
  component: ReviewScreen,
  head: () => ({ meta: [{ title: "Commercial CMS · Review" }] }),
});

type Tab = "findings" | "template" | "loa" | "comments";
type Anchor = { anchor_type: "general" | "finding" | "clause" | "quote"; anchor_ref?: string; quote?: string };

const sevTone = (s: string) =>
  s === "red_flag" || s === "high" ? "text-red-800 border-red-300"
  : s === "caution" || s === "medium" ? "text-amber-800 border-amber-300" : "text-gray-700 border-gray-300";

function ReviewScreen() {
  const { documentId } = Route.useParams();
  const qc = useQueryClient();
  const [role] = useCcmsRole();
  const getFn = useServerFn(getCcmsDocument);
  const reviewFn = useServerFn(reviewCcmsDocument);
  const { data, isLoading, error } = useQuery({ queryKey: ["ccms-doc", documentId], queryFn: () => getFn({ data: { id: documentId } }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["ccms-doc", documentId] }); qc.invalidateQueries({ queryKey: ["ccms-contract"] }); };

  const [tab, setTab] = useState<Tab>("findings");
  const [active, setActive] = useState<string | null>(null);
  const [anchors, setAnchors] = useState<Record<string, boolean>>({});
  const [composer, setComposer] = useState<Anchor | null>(null);
  const [running, setRunning] = useState(false);

  const doc: any = data?.doc;
  const contract: any = data?.contract;
  const review = doc?.ai_review;
  const deviation = doc?.deviation;
  const loa = doc?.loa_check;
  const tpl = templateById(contract?.template_id);

  const highlights: DocHighlight[] = useMemo(() => {
    const out: DocHighlight[] = [];
    for (const f of review?.findings ?? []) if (f.excerpt) out.push({ id: `f:${f.id}`, text: f.excerpt, kind: f.severity === "red_flag" ? "critical" : f.severity === "caution" ? "medium" : "info" });
    for (const c of deviation?.clauses ?? []) if (c.excerpt && c.status !== "same") out.push({ id: `c:${c.templateClauseId}`, text: c.excerpt, kind: c.severity === "high" ? "critical" : "medium" });
    for (const i of loa?.items ?? []) if (i.excerpt) out.push({ id: `l:${i.id}`, text: i.excerpt, kind: i.status === "present" ? "info" : "medium" });
    return out;
  }, [review, deviation, loa]);

  if (isLoading) return <AppShell><div className="p-10 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div></AppShell>;
  if (error || !doc) return <AppShell><div className="p-10 text-sm text-red-700">{(error as Error)?.message ?? "Not found"}</div></AppShell>;

  const isPdf = /\.pdf$/i.test(doc.file_name) || (doc.mime_type ?? "").includes("pdf");
  const comments: any[] = data!.comments.filter((x: any) => !x.document_id || x.document_id === doc.id);
  const threads = comments.filter((x) => !x.parent_id);
  const openCount = threads.filter((x) => x.status === "open").length;
  const devRows = (deviation?.clauses ?? []) as any[];
  const devCount = devRows.filter((c) => c.status !== "same").length;
  const loaMissing = (loa?.items ?? []).filter((i: any) => i.status !== "present").length;

  async function rerun() {
    setRunning(true);
    try { await reviewFn({ data: { document_id: doc.id, acting_role: role } }); toast.success("Review complete"); refresh(); }
    catch (e: any) { toast.error(e?.message ?? "Review failed"); }
    finally { setRunning(false); }
  }
  function commentOnSelection() {
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel.length < 3) { toast.message("Select some text in the document first."); return; }
    setComposer({ anchor_type: "quote", quote: sel.slice(0, 2000) });
    setTab("comments");
  }
  const focus = (id: string) => { setActive(id); if (anchors[id] === false) toast.message("That passage could not be located in the document."); };

  return (
    <AppShell>
      <CcmsHeader title={`${contract.reference_number} · ${doc.file_name}`} subtitle={`${CONTRACT_TYPES[contract.contract_type]?.label} · ${doc.doc_role} v${doc.version} · review and flag — comments only, no rewriting`} />
      <div className="bg-white">
        <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-gray-200">
          <Link to="/ccms/$contractId" params={{ contractId: contract.id }} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline"><ArrowLeft className="size-4" /> {contract.reference_number}</Link>
          <StatusBadge status={contract.status} />
          {review && <span className="text-sm text-gray-700">Risk <b>{review.riskScore}</b> · {review.findings?.length ?? 0} findings{tpl ? ` · ${devCount} deviation${devCount === 1 ? "" : "s"}` : " · no template"}{loa ? ` · ${loaMissing} LoA item${loaMissing === 1 ? "" : "s"} missing` : ""}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={commentOnSelection} className="gap-1.5"><Quote className="size-4" /> Comment on selected text</Button>
            <Button variant="outline" size="sm" onClick={rerun} disabled={running} className="gap-1.5">{running ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {review ? "Re-run AI review" : "Run AI review"}</Button>
          </div>
        </div>

        <OutcomeBar contract={contract} role={role} openThreadsByRole={threads.filter((x) => x.status === "open")} onDone={refresh} />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_480px] h-[calc(100vh-13rem)]">
          <div className="min-w-0 overflow-auto border-r border-gray-200">
            {isPdf
              ? <PdfViewer fileUrl={doc.file_url} highlights={highlights} activeId={active} onSelect={focus} onAnchorStatus={setAnchors} />
              : <DocViewer fileUrl={doc.file_url} fallbackText={review?.documentText} highlights={highlights} activeId={active} onSelect={focus} onAnchorStatus={setAnchors} />}
          </div>

          <div className="flex flex-col min-h-0">
            <div className="flex border-b border-gray-200">
              {([["findings", `Findings ${review?.findings?.length ?? 0}`], ["template", tpl ? `Template ${devCount}` : "Template"], ...(loa ? [["loa", `LoA items ${loaMissing}`]] : []), ["comments", `Comments ${openCount}`]] as [Tab, string][]).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={cn("flex-1 px-3 py-2.5 text-sm", tab === k ? "border-b-2 border-gray-900 font-semibold text-gray-900" : "text-gray-600")}>{l}</button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {doc.ai_review_status === "running" && <p className="text-sm text-gray-600 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> AI review in progress…</p>}
              {doc.ai_review_status === "failed" && <p className="text-sm text-red-700">The last AI review failed. Run it again.</p>}

              {tab === "findings" && (review ? (
                <>
                  <p className="text-sm text-gray-800">{review.summary}</p>
                  {(review.findings ?? []).map((f: any) => (
                    <div key={f.id} className={cn(CARD, "p-3 cursor-pointer", active === `f:${f.id}` && "ring-2 ring-gray-900")} onClick={() => focus(`f:${f.id}`)}>
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded border px-1.5 py-0.5 text-xs font-semibold", sevTone(f.severity))}>{String(f.severity).replace("_", " ")}</span>
                        <span className="text-sm font-semibold text-gray-900">{f.ref}</span>
                        {anchors[`f:${f.id}`] === false && <span className="text-xs text-gray-500">not located</span>}
                      </div>
                      <p className="mt-1.5 text-sm text-gray-900">{f.issue}</p>
                      <p className="mt-1 text-sm text-gray-600">{f.whyItMatters}</p>
                      <CommentLink n={threads.filter((x) => x.anchor_ref === `Finding: ${f.ref}`).length} onClick={() => { setComposer({ anchor_type: "finding", anchor_ref: `Finding: ${f.ref}`, quote: f.excerpt }); setTab("comments"); }} />
                    </div>
                  ))}
                </>
              ) : <p className="text-sm text-gray-600">Not reviewed yet. Run the AI review to flag issues in this draft.</p>)}

              {tab === "template" && (!tpl ? (
                <p className="text-sm text-gray-700">There is no approved template for a {CONTRACT_TYPES[contract.contract_type]?.label}, so this draft is non-standard and Legal vetting is mandatory. See the NDA under <Link to="/ccms/templates" className="text-blue-700 hover:underline">Templates</Link> for how a template drives the check.</p>
              ) : !deviation ? <p className="text-sm text-gray-600">Run the AI review to compare this draft with {tpl.code}.</p> : (
                <>
                  <p className="text-sm text-gray-700">Compared clause by clause with <b>{tpl.code} {tpl.title}</b> v{tpl.version}. Any change to a locked clause, or a missing mandatory clause, sends the draft to Legal.</p>
                  {devRows.map((c) => (
                    <div key={c.templateClauseId} className={cn(CARD, "p-3", c.status !== "same" && "cursor-pointer", active === `c:${c.templateClauseId}` && "ring-2 ring-gray-900")} onClick={() => c.status !== "same" && focus(`c:${c.templateClauseId}`)}>
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded border px-1.5 py-0.5 text-xs font-semibold", c.status === "same" ? "text-emerald-700 border-emerald-300" : sevTone(c.severity))}>{c.status === "same" ? "matches" : c.status}</span>
                        <span className="text-sm font-semibold text-gray-900">{c.number}. {c.title}</span>
                        {c.locked && <span className="inline-flex items-center gap-0.5 text-xs text-gray-600"><Lock className="size-3" /> locked</span>}
                        {!c.locked && c.mandatory && <span className="text-xs text-gray-500">mandatory</span>}
                      </div>
                      {c.change && <p className="mt-1.5 text-sm text-gray-800">{c.change}</p>}
                      {c.draftRef && <p className="mt-0.5 text-sm text-gray-500">Draft {c.draftRef}</p>}
                      {c.status !== "same" && <CommentLink n={threads.filter((x) => x.anchor_ref === `Clause ${c.number} ${c.title}`).length} onClick={() => { setComposer({ anchor_type: "clause", anchor_ref: `Clause ${c.number} ${c.title}`, quote: c.excerpt }); setTab("comments"); }} />}
                    </div>
                  ))}
                  {(deviation.added ?? []).length > 0 && <h3 className="pt-2 text-sm font-semibold text-gray-900">Clauses added that the template does not have</h3>}
                  {(deviation.added ?? []).map((a: any, i: number) => (
                    <div key={i} className={CARD + " p-3"}>
                      <div className="text-sm font-semibold text-gray-900">{a.draftRef}</div>
                      <p className="mt-1 text-sm text-gray-800">{a.note}</p>
                      <CommentLink n={0} onClick={() => { setComposer({ anchor_type: "clause", anchor_ref: `Added clause ${a.draftRef}`, quote: a.excerpt }); setTab("comments"); }} />
                    </div>
                  ))}
                </>
              ))}

              {tab === "loa" && loa && (
                <>
                  <p className="text-sm text-gray-700">The 12 items every Letter of Award / Work Order must carry. <span className="text-gray-500">(Assumed list — to be confirmed by Lim Seong Hai.)</span></p>
                  {loa.items.map((i: any) => (
                    <div key={i.id} className={cn(CARD, "p-3 cursor-pointer", active === `l:${i.id}` && "ring-2 ring-gray-900")} onClick={() => i.excerpt && focus(`l:${i.id}`)}>
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded border px-1.5 py-0.5 text-xs font-semibold", i.status === "present" ? "text-emerald-700 border-emerald-300" : i.status === "unclear" ? "text-amber-800 border-amber-300" : "text-red-800 border-red-300")}>{i.status}</span>
                        <span className="text-sm font-semibold text-gray-900">{i.label}</span>
                      </div>
                      {i.note && <p className="mt-1 text-sm text-gray-700">{i.note}</p>}
                    </div>
                  ))}
                </>
              )}

              {tab === "comments" && (
                <Comments contractId={contract.id} documentId={doc.id} threads={threads} all={comments} composer={composer} setComposer={setComposer} onDone={refresh} />
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function CommentLink({ n, onClick }: { n: number; onClick: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} className="mt-2 inline-flex items-center gap-1 text-sm text-blue-700 hover:underline">
      <MessageSquarePlus className="size-4" /> Comment{n ? ` · ${n} thread${n === 1 ? "" : "s"}` : ""}
    </button>
  );
}

function Comments({ contractId, documentId, threads, all, composer, setComposer, onDone }: {
  contractId: string; documentId: string; threads: any[]; all: any[]; composer: Anchor | null; setComposer: (a: Anchor | null) => void; onDone: () => void;
}) {
  const [role] = useCcmsRole();
  const addFn = useServerFn(addCcmsComment);
  const statusFn = useServerFn(setCcmsCommentStatus);
  const [body, setBody] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState<"open" | "all">("open");

  async function post(parent?: string) {
    const text = parent ? reply[parent] : body;
    if (!text?.trim()) return;
    setBusy(true);
    try {
      await addFn({ data: { contract_id: contractId, document_id: documentId, parent_id: parent ?? null, body: text.trim(), acting_role: role,
        ...(parent ? { anchor_type: "general" } : { anchor_type: composer?.anchor_type ?? "general", anchor_ref: composer?.anchor_ref ?? null, quote: composer?.quote ?? null }) } });
      if (parent) setReply((r) => ({ ...r, [parent]: "" })); else { setBody(""); setComposer(null); }
      onDone();
    } catch (e: any) { toast.error(e?.message ?? "Could not post"); } finally { setBusy(false); }
  }
  async function setStatus(id: string, status: "open" | "resolved") {
    try { await statusFn({ data: { comment_id: id, status, acting_role: role } }); onDone(); } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  const shown = threads.filter((t) => show === "all" || t.status === "open");
  return (
    <div className="space-y-3">
      <div className={CARD + " p-3 space-y-2"}>
        <div className="text-sm font-semibold text-gray-900">New comment as {CCMS_ROLES[role]}</div>
        {composer?.anchor_ref && <div className="text-sm text-gray-700">On: {composer.anchor_ref}</div>}
        {composer?.quote && <blockquote className="border-l-2 border-gray-300 pl-2 text-sm text-gray-600 line-clamp-3">{composer.quote}</blockquote>}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What needs to change, or what needs confirming" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm min-h-20" />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !body.trim()} onClick={() => post()}>Post</Button>
          {composer && <Button size="sm" variant="outline" onClick={() => setComposer(null)}>Clear anchor</Button>}
        </div>
      </div>
      <div className="flex gap-2">
        {(["open", "all"] as const).map((s) => <button key={s} onClick={() => setShow(s)} className={cn("rounded-md border px-2.5 py-1 text-sm", show === s ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>{s === "open" ? "Open" : "All"}</button>)}
      </div>
      {shown.length === 0 && <p className="text-sm text-gray-500">No {show === "open" ? "open " : ""}threads.</p>}
      {shown.map((t) => (
        <div key={t.id} className={cn(CARD, "p-3", t.status === "resolved" && "opacity-75")}>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-gray-900">{CCMS_ROLES[t.acting_role as CcmsRole] ?? "—"}</span>
            <span className="text-gray-500">{t.author_name} · {format(new Date(t.created_at), "d MMM, HH:mm")}</span>
            <span className={cn("ml-auto text-sm", t.status === "open" ? "text-amber-700 font-semibold" : "text-emerald-700")}>{t.status === "open" ? "Open" : "Resolved"}</span>
          </div>
          {t.anchor_ref && <div className="mt-1 text-sm text-gray-600">On: {t.anchor_ref}</div>}
          {t.quote && <blockquote className="mt-1 border-l-2 border-gray-300 pl-2 text-sm text-gray-600 line-clamp-2">{t.quote}</blockquote>}
          <p className="mt-1.5 text-sm text-gray-900 whitespace-pre-wrap">{t.body}</p>
          {all.filter((r) => r.parent_id === t.id).map((r) => (
            <div key={r.id} className="mt-2 ml-3 border-l border-gray-200 pl-3">
              <div className="text-sm"><span className="font-semibold text-gray-900">{CCMS_ROLES[r.acting_role as CcmsRole] ?? "—"}</span> <span className="text-gray-500">{r.author_name} · {format(new Date(r.created_at), "d MMM, HH:mm")}</span></div>
              <p className="text-sm text-gray-900 whitespace-pre-wrap">{r.body}</p>
            </div>
          ))}
          {t.status === "resolved" && <div className="mt-1 text-sm text-gray-500">Resolved by {t.resolved_by_name}{t.resolved_at ? ` · ${format(new Date(t.resolved_at), "d MMM")}` : ""}</div>}
          <div className="mt-2 flex gap-2">
            {t.status === "open" && (
              <>
                <input value={reply[t.id] ?? ""} onChange={(e) => setReply((r) => ({ ...r, [t.id]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && post(t.id)} placeholder="Reply" className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm" />
                <Button size="sm" variant="outline" className="gap-1" onClick={() => setStatus(t.id, "resolved")}><Check className="size-4" /> Resolve</Button>
              </>
            )}
            {t.status === "resolved" && <Button size="sm" variant="outline" className="gap-1" onClick={() => setStatus(t.id, "open")}><RotateCcw className="size-4" /> Reopen</Button>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Legal or Finance records its outcome here, beside the draft it reviewed. */
function OutcomeBar({ contract, role, openThreadsByRole, onDone }: { contract: any; role: CcmsRole; openThreadsByRole: any[]; onDone: () => void }) {
  const recordFn = useServerFn(recordCcmsReview);
  const [outcome, setOutcome] = useState<"cleared" | "cleared_with_comments" | "not_cleared">("cleared");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const route: Stage[] = contract.approval_route ?? [];
  const stages = route.filter((s) => s.kind === "review");
  const mine = stages.find((s) => s.role === role);
  const myOpen = openThreadsByRole.filter((t) => t.acting_role === role).length;

  async function submit() {
    if (!mine) return;
    setBusy(true);
    try {
      await recordFn({ data: { contract_id: contract.id, stage: mine.key as "legal" | "finance", outcome, note, acting_role: role } });
      toast.success(`${mine.label}: outcome recorded`); setNote(""); onDone();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2.5 border-b border-gray-200">
      {stages.map((s) => (
        <span key={s.key} className="text-sm text-gray-700">{s.label}: <OutcomeText status={s.status} /></span>
      ))}
      {mine && mine.status === "pending" && contract.status === "in_review" && (
        <div className="ml-auto flex items-center gap-2">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value as any)} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm">
            <option value="cleared">Cleared</option>
            <option value="cleared_with_comments">Cleared with comments</option>
            <option value="not_cleared">Not cleared (return)</option>
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={outcome === "cleared" ? "Note (optional)" : "Reason / comments (required)"} className="w-72 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          <Button size="sm" disabled={busy} onClick={submit}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Record outcome"}</Button>
          {outcome === "cleared" && myOpen > 0 && <span className="text-sm text-amber-700">{myOpen} of your threads open</span>}
        </div>
      )}
      {!mine && contract.status === "in_review" && <span className="ml-auto text-sm text-gray-500">Switch "Acting as" to {stages.filter((s) => s.status === "pending").map((s) => CCMS_ROLES[s.role]).join(" or ") || "a reviewer"} to record an outcome.</span>}
    </div>
  );
}
