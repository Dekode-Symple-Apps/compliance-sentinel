// ----------------------------------------------------------------------------
// The action for the current stage, as buttons under the milestone — and a
// pop-up per action holding only that action's fields. Each button names who
// acts; in the single-user demo, clicking it switches "Acting as" to them, so
// nobody has to hunt for the right persona. The server still checks the role.
// ----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Upload, Wand2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TemplateFieldsForm } from "@/components/ccms-template-form";
import { AiDraftButton, NoteText, SeverityIcon, fmtMoney, uploadToStorage, useCcmsRole } from "@/components/ccms-widgets";
import { friendlyError } from "@/components/ccms-widgets";
import {
  attachCcmsDocument, closeCcmsContract, decideCcmsApproval, decideCcmsChange, decideCcmsRenewal, extractCcmsKeyTerms, generateCcmsDraft,
  raiseCcmsChange, recordCcmsAcceptedAsIs, recordCcmsConfirmation, recordCcmsSentToCounterparty, recordCcmsSigned, recordCcmsStamping,
  resubmitCcmsContract, reviewCcmsDocument, saveCcmsRepository, saveCcmsSecurities, draftCcmsReturnNote } from "@/lib/ccms.functions";
import {
  BLOCKING_FLAGS, CCMS_ROLES, DEMO_SINGLE_USER, particularsFromRecords, LINK_ACTIONS, SECURITY_TYPES, fillNda, flowOf, nextActions, nextApproval, paymentReady,
  type Flag, type KeyTerms, type NextAction, type Security, type Stage,
} from "@/lib/ccms";
import { recall, recallForm, remember } from "@/lib/ccms-prefill";
import { cn } from "@/lib/utils";

const INPUT = "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL = "block text-sm text-gray-700";
const today = () => new Date().toISOString().slice(0, 10);

// ── remembered inputs ────────────────────────────────────────────────────────

/** A text input that offers its last-used values: a dropdown while typing, and
 *  a one-click chip under it while empty. */
export function RememberedInput({ field, value, onChange, placeholder, type = "text" }: {
  field: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  const [opts, setOpts] = useState<string[]>([]);
  useEffect(() => { setOpts(recall(field)); }, [field]);
  const last = opts.find((o) => o !== value);
  return (
    <div className="min-w-0">
      <input list={`fill-${field}`} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={INPUT} />
      <datalist id={`fill-${field}`}>{opts.map((o) => <option key={o} value={o} />)}</datalist>
      {!value && last && <Chip value={last} onPick={onChange} />}
    </div>
  );
}
export function RememberedTextarea({ field, value, onChange, placeholder }: { field: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [opts, setOpts] = useState<string[]>([]);
  useEffect(() => { setOpts(recall(field)); }, [field]);
  return (
    <div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={INPUT + " min-h-16"}
        rows={Math.min(12, Math.max(3, value.split("\n").reduce((n, l) => n + Math.ceil((l.length || 1) / 80), 0)))} />
      {!value && opts[0] && <Chip value={opts[0]} onPick={onChange} />}
    </div>
  );
}
function Chip({ value, onPick }: { value: string; onPick: (v: string) => void }) {
  return (
    <button type="button" onClick={() => onPick(value)} title="Use the last value"
      className="mt-1 block max-w-full truncate rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-left text-xs text-gray-600 hover:border-gray-500 hover:text-gray-900">
      ↺ {value}
    </button>
  );
}
export function FillButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline shrink-0">
      <Wand2 className="size-4" /> Fill last used
    </button>
  );
}

/** Runs a server call with a busy flag and a toast; resolves [ok, result]. */
function useRun() {
  const [busy, setBusy] = useState(false);
  async function run<T>(fn: () => Promise<T>, ok?: string): Promise<[boolean, T | null]> {
    setBusy(true);
    try { const r = await fn(); if (ok) toast.success(ok); return [true, r]; }
    catch (e: any) { toast.error(friendlyError(e)); return [false, null]; }
    finally { setBusy(false); }
  }
  return { busy, run };
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 pt-2">{children}</div>;
}
function Go({ busy, disabled, onClick, children, variant }: { busy?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; variant?: "outline" }) {
  return <Button variant={variant} disabled={busy || disabled} onClick={onClick}>{busy ? <Loader2 className="size-4 animate-spin" /> : children}</Button>;
}
function DropZone({ file, onFile, label = "Select file (.docx or .pdf)" }: { file: File | null; onFile: (f: File | null) => void; label?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-700 hover:border-gray-500">
      {file ? <FileText className="size-4" /> : <Upload className="size-4" />} {file ? file.name : label}
      <input type="file" accept=".docx,.pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}

// ── the buttons under the milestone ──────────────────────────────────────────

export function ActionBar({ c, documents, events, onDone }: { c: any; documents: any[]; events: any[]; onDone: () => void }) {
  const [role, setRole] = useCcmsRole();
  const nav = useNavigate();
  const comparison = documents.find((d) => d.comparison)?.comparison;
  const actions = nextActions(c, documents, events, comparison);
  const [open, setOpen] = useState<NextAction | null>(null);
  if (!actions.length) return null;

  function go(a: NextAction) {
    if (role !== a.role) { if (!DEMO_SINGLE_USER) return; setRole(a.role); }
    if (a.id === "review" || a.id === "open_review") {
      if (a.docId) nav({ to: "/ccms/review/$documentId", params: { documentId: a.docId }, hash: a.stage ? `decide-${a.stage}` : undefined });
      return;
    }
    if (a.id === "download") { const d = documents.find((x) => x.id === a.docId); if (d) window.open(d.file_url, "_blank", "noreferrer"); return; }
    setOpen(a);
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a, i) => {
          const blocked = role !== a.role && !DEMO_SINGLE_USER;
          return (
            <Button key={i} size="sm" variant={a.primary ? "default" : "outline"} disabled={blocked} onClick={() => go(a)}
              title={blocked ? `Waiting on ${CCMS_ROLES[a.role]}` : LINK_ACTIONS.includes(a.id) ? "Opens the review screen" : undefined} className="gap-1.5">
              {a.label}
              {!DEMO_SINGLE_USER && <span className={cn("text-xs font-normal", a.primary ? "opacity-70" : "text-gray-500")}>· {CCMS_ROLES[a.role]}</span>}
            </Button>
          );
        })}
      </div>
      <ActionDialog action={open} c={c} documents={documents} onClose={() => setOpen(null)} onDone={onDone} />
    </>
  );
}

const WIDE = new Set(["generate", "securities", "repository", "sign", "close"]);

/** The pop-up for one action. Also opened from the Documents "More" menu. */
export function ActionDialog({ action, c, documents, onClose, onDone }: { action: NextAction | null; c: any; documents: any[]; onClose: () => void; onDone: () => void }) {
  if (!action) return null;
  const p = { a: action, c, documents, close: onClose, refresh: onDone, done: () => { onClose(); onDone(); } };
  const body = (() => {
    switch (action.id) {
      case "generate": return <GenerateForm {...p} />;
      case "upload_draft": case "upload_theirs": case "upload_revised": case "attach_tender": case "upload_award": return <UploadForm {...p} />;
      case "mark_sent": return <MarkSentForm {...p} />;
      case "accepted_as_is": return <AcceptedForm {...p} />;
      case "resubmit": return <ResubmitForm {...p} />;
      case "decide": return <DecideForm {...p} />;
      case "sign": return <SignForm {...p} />;
      case "stamp": return <StampForm {...p} />;
      case "securities": return <SecuritiesForm {...p} />;
      case "repository": return <RepositoryForm {...p} />;
      case "renew": return <RenewForm {...p} />;
      case "change": return <ChangeForm {...p} />;
      case "change_step": return <ChangeStepForm {...p} />;
      case "close": return <CloseForm {...p} />;
      case "confirm_sent": case "confirm_reply": return <ConfirmForm {...p} />;
      default: return null;
    }
  })();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("bg-white max-h-[90vh] overflow-y-auto", WIDE.has(action.id) ? "max-w-3xl" : "max-w-xl")}>
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          <DialogDescription>{c.reference_number} · {c.title}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

type FormProps = { a: NextAction; c: any; documents: any[]; close: () => void; refresh: () => void; done: () => void };

// ── draft ────────────────────────────────────────────────────────────────────

function GenerateForm({ a, c, documents, done }: FormProps) {
  const genFn = useServerFn(generateCcmsDraft);
  const { busy, run } = useRun();
  const previous = documents.find((d: any) => d.generated)?.fields ?? null;
  // The particulars come from the records (entity master, vendor record); what
  // they lack is kept as typed. Blanks in a saved snapshot never clear a value.
  const withRecords = (p: Record<string, string>) =>
    ({ ...p, ...Object.fromEntries(Object.entries(particularsFromRecords(c.entity, c.vendor ?? null)).filter(([, x]) => x)) });
  const [tf, setTf] = useState<Record<string, string>>(() => previous ?? withRecords({
    date: today(), direction: "Mutual", term: "Two (2) years", disputes: "Courts of Malaysia",
    stamp_duty: "Counterparty", non_solicit: "No", cp_form: "company", cp_country: "Malaysia", cp_name: c.counterparty_name ?? "",
    purpose: c.scope_summary ?? "",
  }));
  const miss = fillNda(c.entity, tf).missing;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex-1" />
        <FillButton onClick={() => { const s = recallForm(`request:${c.contract_type}`); if (s?.tf) setTf((p) => withRecords({ ...p, ...Object.fromEntries(Object.entries(s.tf as Record<string, string>).filter(([, x]) => x)) })); }} />
      </div>
      <TemplateFieldsForm values={tf} onChange={(k, v) => setTf((p) => ({ ...p, [k]: v }))} fallbackPurpose={c.scope_summary ?? ""} />
      {miss.length > 0 && <p className="text-sm text-amber-700">Missing particulars: {miss.join("; ")}.</p>}
      <Footer>
        <Go busy={busy} onClick={async () => { const [ok] = await run(() => genFn({ data: { contract_id: c.id, fields: tf, acting_role: a.role } }), "Draft generated"); if (ok) done(); }}>{previous ? "Generate Revision" : "Generate Draft"}</Go>
      </Footer>
    </div>
  );
}

function UploadForm({ a, c, close, refresh, done }: FormProps) {
  const attachFn = useServerFn(attachCcmsDocument);
  const reviewFn = useServerFn(reviewCcmsDocument);
  const docRole = a.id === "attach_tender" ? "tender" : a.id === "upload_theirs" || a.id === "upload_award" ? "counterparty" : "draft";
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  async function go() {
    if (!file) return;
    try {
      setPhase("Uploading…");
      const url = await uploadToStorage(`ccms/${c.id}`, file);
      const doc: any = await attachFn({ data: { contract_id: c.id, file_name: file.name, file_url: url, mime_type: file.type || null, size_bytes: file.size, doc_role: docRole, acting_role: a.role } });
      if (docRole === "tender") { toast.success("Tender attached"); done(); return; }
      refresh();
      setPhase("AI review in progress…");
      const r: any = await reviewFn({ data: { document_id: doc.id, acting_role: a.role } });
      setResult({ ...r, docId: doc.id });
      refresh();
    } catch (e: any) { toast.error(friendlyError(e)); refresh(); }
    finally { setPhase(null); }
  }
  if (result) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-gray-200 p-3 text-sm">
          <SeverityIcon severity={result.verdict === "compliant" ? "info" : result.verdict} />
          <span>Risk <b>{result.riskScore}</b> · {result.findings} finding{result.findings === 1 ? "" : "s"} · {result.threads} comment thread{result.threads === 1 ? "" : "s"} opened</span>
        </div>
        <Footer>
          <Button asChild><Link to="/ccms/review/$documentId" params={{ documentId: result.docId }}>Open review</Link></Button>
          <Button variant="outline" onClick={close}>Done</Button>
        </Footer>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <DropZone file={file} onFile={setFile} />
      <Footer>
        <Go busy={!!phase} disabled={!file} onClick={go}>{docRole === "tender" ? "Attach" : "Upload & Review"}</Go>
        {phase && <span className="text-sm text-gray-600 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> {phase}</span>}
      </Footer>
    </div>
  );
}

function MarkSentForm({ a, c, documents, done }: FormProps) {
  const sendFn = useServerFn(recordCcmsSentToCounterparty);
  const { busy, run } = useRun();
  const [to, setTo] = useState("");
  const doc = documents.find((d: any) => d.id === a.docId) ?? documents.find((d: any) => d.doc_role === "draft");
  return (
    <div className="space-y-3">
      {doc && <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline">Download v{doc.version}</a>}
      <label className={LABEL}>Sent to<RememberedInput field="sent_to" value={to} onChange={setTo} placeholder="Name, email" /></label>
      <Footer>
        <Go busy={busy} disabled={to.trim().length < 3} onClick={async () => {
          const [ok] = await run(() => sendFn({ data: { contract_id: c.id, document_id: doc.id, recipient: to.trim(), acting_role: a.role } }), "Recorded as sent");
          if (ok) { remember({ sent_to: to }); done(); }
        }}>Mark as Sent</Go>
      </Footer>
    </div>
  );
}

function AcceptedForm({ a, c, done }: FormProps) {
  const fn = useServerFn(recordCcmsAcceptedAsIs);
  const { busy, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <label className={LABEL}>Confirmation reference<RememberedInput field="accepted_note" value={note} onChange={setNote} placeholder="e.g. Confirmed by email" /></label>
      <Footer>
        <Go busy={busy} onClick={async () => { const [ok] = await run(() => fn({ data: { contract_id: c.id, note: note || null, acting_role: a.role } }), "Recorded"); if (ok) { remember({ accepted_note: note }); done(); } }}>Record</Go>
      </Footer>
    </div>
  );
}

function ResubmitForm({ a, c, done }: FormProps) {
  const fn = useServerFn(resubmitCcmsContract);
  const { busy, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3">
      <label className={LABEL}>Revision note<RememberedTextarea field="resubmit_note" value={note} onChange={setNote} /></label>
      <Footer>
        <Go busy={busy} disabled={note.trim().length < 3} onClick={async () => { const [ok] = await run(() => fn({ data: { contract_id: c.id, note, acting_role: a.role } }), "Resubmitted"); if (ok) { remember({ resubmit_note: note }); done(); } }}>Resubmit</Go>
      </Footer>
    </div>
  );
}

// ── approval ─────────────────────────────────────────────────────────────────

function DecideForm({ a, c, done }: FormProps) {
  const fn = useServerFn(decideCcmsApproval);
  const draftFn = useServerFn(draftCcmsReturnNote);
  const { busy, run } = useRun();
  const [note, setNote] = useState("");
  const route: Stage[] = c.approval_route ?? [];
  const stage = nextApproval(route);
  const blocking = ((c.flags ?? []) as Flag[]).filter((f) => BLOCKING_FLAGS.includes(f.key));
  const decide = async (decision: "approved" | "returned" | "rejected", ok: string) => {
    const [good] = await run(() => fn({ data: { contract_id: c.id, decision, note, acting_role: a.role } }), ok);
    if (good) { remember(decision === "approved" ? { approve_note: note } : { return_note: note }); done(); }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700">{stage?.reason}.</p>
      <ul className="space-y-1 text-sm">
        {route.filter((s) => s.kind === "review").map((s) => <li key={s.key} className="text-gray-700">{s.label}: <b>{s.status.replace(/_/g, " ")}</b><NoteText text={s.note} className="mt-0.5" /></li>)}
      </ul>
      {blocking.length > 0 && <p className="flex gap-1.5 text-sm text-red-700"><SeverityIcon severity="red_flag" className="mt-0.5" /> Cannot be approved until cleared: {blocking.map((f) => f.detail).join(" ")}</p>}
      <label className={LABEL}><span className="flex items-center gap-2"><span className="flex-1">Note · required to return or reject</span><AiDraftButton run={() => draftFn({ data: { contract_id: c.id } })} onText={setNote} /></span><RememberedTextarea field="approve_note" value={note} onChange={setNote} /></label>
      <Footer>
        <Go busy={busy} disabled={blocking.length > 0} onClick={() => decide("approved", "Approved")}>Approve</Go>
        <Button variant="outline" disabled={busy} onClick={() => decide("returned", "Returned for amendment")}>Return</Button>
        <Button variant="outline" className="text-red-700" disabled={busy} onClick={() => decide("rejected", "Rejected")}>Reject</Button>
      </Footer>
      {DEMO_SINGLE_USER && <p className="text-xs text-gray-500">Demo mode: self-approval is allowed and recorded in the audit trail.</p>}
    </div>
  );
}

// ── after approval ───────────────────────────────────────────────────────────

function SignForm({ a, c, documents, done }: FormProps) {
  const attachFn = useServerFn(attachCcmsDocument);
  const signFn = useServerFn(recordCcmsSigned);
  const stampFn = useServerFn(recordCcmsStamping);
  const lite = flowOf(c) === "lite";
  const existing = documents.find((d: any) => d.doc_role === "executed");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ date: today(), ours: "", ours_d: "", theirs: "", theirs_d: "", stamped: "", cert: "", duty: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const fill = () => setF((p) => ({ ...p,
    ours: recall("our_signatory")[0] ?? "", ours_d: recall("our_designation")[0] ?? "",
    theirs: recall("their_signatory")[0] ?? "", theirs_d: recall("their_designation")[0] ?? "",
    ...(lite ? { stamped: p.stamped || today(), cert: recall("stamp_certificate")[0] ?? "", duty: recall("stamp_duty")[0] ?? "" } : {}) }));
  async function go() {
    setBusy(true);
    try {
      if (file) {
        const url = await uploadToStorage(`ccms/${c.id}`, file);
        await attachFn({ data: { contract_id: c.id, file_name: file.name, file_url: url, mime_type: file.type || null, size_bytes: file.size, doc_role: "executed", acting_role: a.role } });
      }
      await signFn({ data: { contract_id: c.id, signed_date: f.date, acting_role: a.role,
        signatories: [{ name: f.ours, designation: f.ours_d, party: c.entity }, ...(f.theirs.trim() ? [{ name: f.theirs, designation: f.theirs_d, party: c.counterparty_name ?? "Counterparty" }] : [])] } });
      if (lite && f.cert.trim()) {
        await stampFn({ data: { contract_id: c.id, acting_role: a.role, sent_date: null, stamped_date: f.stamped || f.date, duty: f.duty === "" ? null : Number(f.duty), certificate_no: f.cert } });
      }
      remember({ our_signatory: f.ours, our_designation: f.ours_d, their_signatory: f.theirs, their_designation: f.theirs_d, stamp_certificate: f.cert, stamp_duty: f.duty });
      toast.success(lite ? "Signing recorded" : "Signing recorded — stamp within 30 days");
      done();
    } catch (e: any) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><FillButton onClick={fill} /></div>
      {existing ? <p className="text-sm text-gray-700">Signed copy: {existing.file_name}</p> : <DropZone file={file} onFile={setFile} label="Signed copy (.pdf or .docx)" />}
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>Signed on<input type="date" className={INPUT} value={f.date} onChange={(e) => set("date")(e.target.value)} /></label>
        <span />
        <label className={LABEL}>Company signatory<RememberedInput field="our_signatory" value={f.ours} onChange={set("ours")} /></label>
        <label className={LABEL}>Designation<RememberedInput field="our_designation" value={f.ours_d} onChange={set("ours_d")} /></label>
        <label className={LABEL}>{c.side === "client" ? "Client" : "Counterparty"} signatory<RememberedInput field="their_signatory" value={f.theirs} onChange={set("theirs")} /></label>
        <label className={LABEL}>Designation<RememberedInput field="their_designation" value={f.theirs_d} onChange={set("theirs_d")} /></label>
      </div>
      {lite && (
        <div className="rounded-md border border-gray-200 p-3">
          <div className="text-sm font-semibold text-gray-900">Stamping <span className="font-normal text-gray-500">· optional</span></div>
          <div className="mt-2 grid grid-cols-3 gap-3">
            <label className={LABEL}>Stamped on<input type="date" className={INPUT} value={f.stamped} onChange={(e) => set("stamped")(e.target.value)} /></label>
            <label className={LABEL}>Certificate no.<RememberedInput field="stamp_certificate" value={f.cert} onChange={set("cert")} /></label>
            <label className={LABEL}>Duty (RM)<RememberedInput field="stamp_duty" value={f.duty} onChange={set("duty")} /></label>
          </div>
        </div>
      )}
      <Footer><Go busy={busy} disabled={(!existing && !file) || !f.ours.trim()} onClick={go}>Record Signing</Go></Footer>
    </div>
  );
}

function StampForm({ a, c, done }: FormProps) {
  const fn = useServerFn(recordCcmsStamping);
  const { busy, run } = useRun();
  const st = c.stamping ?? {};
  const [f, setF] = useState({ sent: st.sent_date ?? "", stamped: st.stamped_date ?? today(), duty: st.duty != null ? String(st.duty) : "", cert: st.certificate_no ?? "" });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3">
      <div className="flex items-start"><p className="flex-1 text-sm text-gray-600">Due within 30 days of signing ({c.signed_date}).</p><FillButton onClick={() => setF((p) => ({ ...p, cert: recall("stamp_certificate")[0] ?? "", duty: recall("stamp_duty")[0] ?? "" }))} /></div>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>Sent for stamping<input type="date" className={INPUT} value={f.sent} onChange={(e) => set("sent")(e.target.value)} /></label>
        <label className={LABEL}>Stamped on<input type="date" className={INPUT} value={f.stamped} onChange={(e) => set("stamped")(e.target.value)} /></label>
        <label className={LABEL}>Certificate no.<RememberedInput field="stamp_certificate" value={f.cert} onChange={set("cert")} /></label>
        <label className={LABEL}>Duty (RM)<RememberedInput field="stamp_duty" value={f.duty} onChange={set("duty")} /></label>
      </div>
      <Footer>
        <Go busy={busy} onClick={async () => {
          const [ok] = await run(() => fn({ data: { contract_id: c.id, acting_role: a.role, sent_date: f.sent || null, stamped_date: f.stamped || null, duty: f.duty === "" ? null : Number(f.duty), certificate_no: f.cert || null } }), "Stamping recorded");
          if (ok) { remember({ stamp_certificate: f.cert, stamp_duty: f.duty }); done(); }
        }}>Save Stamping</Go>
      </Footer>
    </div>
  );
}

function SecuritiesForm({ a, c, done }: FormProps) {
  const fn = useServerFn(saveCcmsSecurities);
  const { busy, run } = useRun();
  const [rows, setRows] = useState<Security[]>(c.securities ?? []);
  const set = (i: number, patch: Partial<Security>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const ready = rows.length > 0 && paymentReady(rows);
  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-2 font-semibold">Item</th><th className="pr-2 font-semibold">Required</th><th className="pr-2 font-semibold">Amount (RM)</th><th className="pr-2 font-semibold">Reference</th><th className="font-semibold">Valid until</th></tr></thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={x.type}>
              <td className="py-1 pr-2 text-gray-900">{SECURITY_TYPES.find((t) => t.id === x.type)?.label}</td>
              <td className="pr-2"><input type="checkbox" checked={x.required} onChange={(e) => set(i, { required: e.target.checked })} /></td>
              <td className="pr-2"><input className={INPUT} value={x.amount ?? ""} onChange={(e) => set(i, { amount: e.target.value === "" ? null : Number(e.target.value) })} /></td>
              <td className="pr-2"><input className={INPUT} value={x.reference ?? ""} onChange={(e) => set(i, { reference: e.target.value })} placeholder={x.type === "cidb_levy" ? "Receipt no." : "Policy / bond no."} /></td>
              <td>{x.type !== "cidb_levy" && <input type="date" className={INPUT} value={x.valid_until ?? ""} onChange={(e) => set(i, { valid_until: e.target.value || null })} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={cn("text-sm", ready ? "text-emerald-700" : "text-gray-600")}>{ready ? "Payment-ready." : "Payment is not ready until every required item has a reference and validity."}</p>
      <Footer><Go busy={busy} onClick={async () => { const [ok] = await run(() => fn({ data: { contract_id: c.id, securities: rows, acting_role: a.role } }), "Saved"); if (ok) done(); }}>Save</Go></Footer>
    </div>
  );
}

function RepositoryForm({ a, c, done }: FormProps) {
  const extractFn = useServerFn(extractCcmsKeyTerms);
  const saveFn = useServerFn(saveCcmsRepository);
  const { busy, run } = useRun();
  const [terms, setTerms] = useState<KeyTerms | null>(c.repository ?? null);
  const [reading, setReading] = useState(false);
  const set = (k: keyof KeyTerms, v: any) => setTerms((t) => (t ? { ...t, [k]: v } : t));
  useEffect(() => {
    if (terms) return;
    let live = true;
    setReading(true);
    extractFn({ data: { contract_id: c.id, acting_role: a.role } })
      .then((r: any) => { if (live) setTerms(r.terms); })
      .catch((e: any) => toast.error(friendlyError(e)))
      .finally(() => live && setReading(false));
    return () => { live = false; };
  }, []);
  if (reading || !terms) return <p className="flex items-center gap-2 py-6 text-sm text-gray-600"><Loader2 className="size-4 animate-spin" /> Extracting key terms…</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Extracted by AI from the signed copy. Expiry date sets the 30-day alert.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL + " col-span-2"}>Parties<input className={INPUT} value={terms.parties} onChange={(e) => set("parties", e.target.value)} /></label>
        <label className={LABEL}>Value<input className={INPUT} value={terms.value ?? ""} onChange={(e) => set("value", e.target.value === "" ? null : Number(e.target.value))} /></label>
        <label className={LABEL}>Governing law<input className={INPUT} value={terms.governing_law ?? ""} onChange={(e) => set("governing_law", e.target.value)} /></label>
        <label className={LABEL}>Start<input type="date" className={INPUT} value={terms.start_date ?? ""} onChange={(e) => set("start_date", e.target.value || null)} /></label>
        <label className={LABEL}>Expiry <span className="text-red-700">*</span><input type="date" className={INPUT} value={terms.end_date ?? ""} onChange={(e) => set("end_date", e.target.value || null)} /></label>
        <label className={LABEL}>Notice period<input className={INPUT} value={terms.notice_period ?? ""} onChange={(e) => set("notice_period", e.target.value)} /></label>
        <label className={LABEL}>Renewal<input className={INPUT} value={terms.renewal ?? ""} onChange={(e) => set("renewal", e.target.value)} /></label>
        <label className={LABEL + " col-span-2"}>Key obligations · one per line
          <textarea className={INPUT + " min-h-24"} value={terms.obligations.join("\n")} onChange={(e) => set("obligations", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} />
        </label>
      </div>
      <Footer><Go busy={busy} disabled={!terms.end_date} onClick={async () => { const [ok] = await run(() => saveFn({ data: { contract_id: c.id, terms: terms as any, acting_role: a.role } }), "Saved to the repository"); if (ok) done(); }}>File to Repository</Go></Footer>
    </div>
  );
}

// ── after it is active ───────────────────────────────────────────────────────

function RenewForm({ a, c, done }: FormProps) {
  const fn = useServerFn(decideCcmsRenewal);
  const { busy, run } = useRun();
  const lite = flowOf(c) === "lite";
  const nextEnd = () => { if (!c.expiry_date) return ""; const d = new Date(c.expiry_date); d.setFullYear(d.getFullYear() + (lite ? 2 : 1)); return d.toISOString().slice(0, 10); };
  const [newEnd, setNewEnd] = useState(nextEnd());
  const [note, setNote] = useState("");
  const decide = async (decision: "renew" | "renegotiate" | "terminate", ok: string) => {
    const [good] = await run(() => fn({ data: { contract_id: c.id, decision, new_end: decision === "renew" ? newEnd || null : null, note, acting_role: a.role } }), ok);
    if (good) { remember({ renew_note: note }); done(); }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Expires {c.expiry_date ?? "—"}. Vendor status is re-checked on renewal.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>New expiry<input type="date" className={INPUT} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} /></label>
        <label className={LABEL}>Note<RememberedInput field="renew_note" value={note} onChange={setNote} /></label>
      </div>
      <Footer>
        <Go busy={busy} onClick={() => decide("renew", "Renewed")}>Renew</Go>
        {!lite && <Button variant="outline" disabled={busy} onClick={() => decide("renegotiate", "Recorded")}>Renegotiate</Button>}
        <Button variant="outline" disabled={busy} onClick={() => decide("terminate", "Recorded")}>Terminate</Button>
      </Footer>
    </div>
  );
}

function ChangeForm({ a, c, done }: FormProps) {
  const fn = useServerFn(raiseCcmsChange);
  const { busy, run } = useRun();
  const [f, setF] = useState({ kind: "scope", description: "", value_impact: "", deviates: false });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>Kind
          <select className={INPUT} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="scope">Scope</option><option value="rate">Rate</option><option value="quantity">Quantity</option><option value="time">Time</option>
          </select>
        </label>
        <label className={LABEL}>Value ± RM<input className={INPUT} value={f.value_impact} onChange={(e) => setF({ ...f, value_impact: e.target.value })} /></label>
        <label className={LABEL + " col-span-2"}>Description<RememberedTextarea field="change_description" value={f.description} onChange={(v) => setF({ ...f, description: v })} /></label>
        <label className="col-span-2 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={f.deviates} onChange={(e) => setF({ ...f, deviates: e.target.checked })} /> Template deviation · Legal vetting required</label>
      </div>
      <Footer>
        <Go busy={busy} disabled={f.description.trim().length < 5} onClick={async () => {
          const [ok] = await run(() => fn({ data: { contract_id: c.id, kind: f.kind as any, description: f.description, value_impact: Number(f.value_impact || 0), deviates_template: f.deviates, acting_role: a.role } }), "Change raised");
          if (ok) { remember({ change_description: f.description }); done(); }
        }}>Submit Change Request</Go>
      </Footer>
    </div>
  );
}

function ChangeStepForm({ a, c, done }: FormProps) {
  const fn = useServerFn(decideCcmsChange);
  const { busy, run } = useRun();
  const x = (c.changes ?? []).find((y: any) => y.id === a.changeId);
  if (!x) return <p className="text-sm text-gray-600">Change not found.</p>;
  const act = async (stage: "legal" | "approval" | "signed", outcome: "cleared" | "approved" | "rejected" | "signed") => {
    const [ok] = await run(() => fn({ data: { contract_id: c.id, change_id: x.id, stage, outcome, acting_role: a.role, note: outcome === "rejected" ? "Rejected" : null } }), "Recorded");
    if (ok) done();
  };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-gray-900">{x.description}</p>
      <p className="text-gray-600">{x.kind} · {x.value_impact >= 0 ? "+" : ""}{fmtMoney(x.value_impact)} → {fmtMoney(x.new_total)} · {x.band}</p>
      <Footer>
        {a.stage === "legal" && <><Go busy={busy} onClick={() => act("legal", "cleared")}>Clear</Go><Button variant="outline" disabled={busy} onClick={() => act("legal", "rejected")}>Reject</Button></>}
        {a.stage === "approval" && <><Go busy={busy} onClick={() => act("approval", "approved")}>Approve</Go><Button variant="outline" disabled={busy} onClick={() => act("approval", "rejected")}>Reject</Button></>}
        {a.stage === "signed" && <Go busy={busy} onClick={() => act("signed", "signed")}>Record signed appendix</Go>}
      </Footer>
    </div>
  );
}

function CloseForm({ a, c, done }: FormProps) {
  const fn = useServerFn(closeCcmsContract);
  const { busy, run } = useRun();
  const lite = flowOf(c) === "lite";
  const [k, setK] = useState({ payments: false, retention_cpc: "", retention_cmgd: "", bonds_returned: false, defects_closed: false, obligations_met: false });
  const [reason, setReason] = useState("");
  const [hold, setHold] = useState(false);
  const box = (key: "payments" | "bonds_returned" | "defects_closed" | "obligations_met", label: string) => (
    <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={k[key]} onChange={(e) => setK({ ...k, [key]: e.target.checked })} /> {label}</label>
  );
  return (
    <div className="space-y-3">
      {lite ? <p className="text-sm text-gray-600">Retention: 7 years.</p> : (
        <>
          <div className="flex flex-wrap gap-4">{box("payments", "Final payments made")}{box("bonds_returned", "Bonds returned")}{box("defects_closed", "Defects closed")}{box("obligations_met", "Obligations met")}</div>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>Retention 1st half — CPC ref.<input className={INPUT} value={k.retention_cpc} onChange={(e) => setK({ ...k, retention_cpc: e.target.value })} /></label>
            <label className={LABEL}>Retention 2nd half — CMGD ref.<input className={INPUT} value={k.retention_cmgd} onChange={(e) => setK({ ...k, retention_cmgd: e.target.value })} /></label>
          </div>
        </>
      )}
      <label className={LABEL}>{lite ? "Closure reason" : "Override reason (if items are open)"}<RememberedInput field="close_reason" value={reason} onChange={setReason} /></label>
      <label className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} /> Legal hold</label>
      <Footer>
        <Go busy={busy} disabled={lite && !reason.trim()} onClick={async () => {
          const [ok] = await run(() => fn({ data: { contract_id: c.id, checklist: k, override_reason: reason || null, legal_hold: hold, acting_role: a.role } }), lite ? "Ended and filed" : "Contract closed");
          if (ok) { remember({ close_reason: reason }); done(); }
        }}>{lite ? "Close & Archive" : "Close Contract"}</Go>
      </Footer>
    </div>
  );
}

function ConfirmForm({ a, c, done }: FormProps) {
  const fn = useServerFn(recordCcmsConfirmation);
  const { busy, run } = useRun();
  const sent = a.id === "confirm_sent";
  const [v, setV] = useState("");
  return (
    <div className="space-y-3">
      {!sent && <p className="text-sm text-gray-600">Letter sent {c.confirmation?.sent_date ?? ""}.</p>}
      <label className={LABEL}>{sent ? "Sent to" : "Client reply"}<RememberedInput field={sent ? "confirm_to" : "confirm_reply"} value={v} onChange={setV} /></label>
      <Footer>
        <Go busy={busy} onClick={async () => {
          const [ok] = await run(() => fn({ data: sent
            ? { contract_id: c.id, action: "sent", date: today(), sent_to: v, acting_role: a.role }
            : { contract_id: c.id, action: "reply", date: today(), note: v, acting_role: a.role } } as any), sent ? "Letter recorded as sent" : "Client's reply recorded");
          if (ok) { remember(sent ? { confirm_to: v } : { confirm_reply: v }); done(); }
        }}>{sent ? "Record Letter Sent" : "Record Reply"}</Go>
      </Footer>
    </div>
  );
}
