import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Circle, Loader2, AlertTriangle, Upload, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  attachCcmsDocument, closeCcmsContract, decideCcmsChange, decideCcmsRenewal, extractCcmsKeyTerms, raiseCcmsChange,
  recordCcmsConfirmation, recordCcmsSigned, recordCcmsStamping, saveCcmsRepository, saveCcmsSecurities,
} from "@/lib/ccms.functions";
import {
  CCMS_ROLES, COMPARISON_AREAS, DECISION_LABEL, SECURITY_TYPES, contractAlerts, contractMilestones, daysBetween,
  displayName, paymentReady, type CcmsRole, type Decision, type KeyTerms, type Security,
} from "@/lib/ccms";
import { CARD, fmtMoney, useCcmsRole } from "@/components/ccms-widgets";

const INPUT = "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";
const today = () => new Date().toISOString().slice(0, 10);

async function run(p: Promise<unknown>, ok: string, done: () => void, setBusy: (b: boolean) => void) {
  setBusy(true);
  try { await p; toast.success(ok); done(); } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
}

// ── the milestone tracker ────────────────────────────────────────────────────

/** Every stage of the contract in one line, where it is, and the next step. */
export function Milestones({ c, documents, events }: { c: any; documents: any[]; events: any[] }) {
  const [role] = useCcmsRole();
  const comparison = documents.find((d) => d.comparison)?.comparison;
  const { stages, next } = contractMilestones(c, documents, events, comparison);
  const alerts = contractAlerts(c);
  return (
    <section className={CARD + " p-4 space-y-3"}>
      <ol className="flex flex-wrap items-start gap-y-3">
        {stages.map((s, i) => (
          <li key={s.key} className="flex items-start">
            <div className="flex flex-col items-center w-[104px] text-center">
              <span className={cn("size-7 rounded-full border-2 grid place-items-center",
                s.state === "done" ? "border-emerald-600 bg-emerald-600 text-white"
                : s.state === "current" ? "border-blue-700 text-blue-700"
                : "border-gray-300 text-gray-300")}>
                {s.state === "done" ? <Check className="size-4" /> : <Circle className={cn("size-2.5", s.state === "current" && "fill-blue-700")} />}
              </span>
              <span className={cn("mt-1.5 text-xs leading-tight", s.state === "current" ? "font-semibold text-blue-800" : s.state === "done" ? "text-gray-900" : "text-gray-500")}>{s.label}</span>
              {s.detail && <span className="mt-0.5 text-[11px] leading-tight text-gray-500">{s.detail}</span>}
            </div>
            {i < stages.length - 1 && <span className={cn("mt-3.5 h-0.5 w-4 -mx-1", s.state === "done" ? "bg-emerald-600" : "bg-gray-200")} />}
          </li>
        ))}
      </ol>
      {next && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-200 px-3 py-2 text-sm">
          <span className="font-semibold text-blue-800">Next:</span>
          <span className="text-gray-900">{next.text}</span>
          {next.role && <span className={cn("ml-auto rounded-full border px-2 py-0.5 text-xs", role === next.role ? "border-blue-300 text-blue-800" : "border-gray-300 text-gray-600")}>
            {CCMS_ROLES[next.role as CcmsRole]}{role === next.role ? " · you" : ""}
          </span>}
        </div>
      )}
      {alerts.map((a, i) => (
        <div key={i} className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", a.severity === "high" ? "border-red-300 text-red-800" : "border-amber-300 text-amber-800")}>
          <AlertTriangle className="size-4 shrink-0" /> {a.text}
        </div>
      ))}
    </section>
  );
}

// ── short comments ───────────────────────────────────────────────────────────

/** A comment as short bullets: the point, then (muted) why it matters. Older
 *  long-form bodies are shown the same way, trimmed of their headings. */
export function CommentBody({ body, severity, clamp }: { body: string; severity?: string | null; clamp?: boolean }) {
  const lines = String(body ?? "")
    .replace(/^(Red flag|Caution)\s*—\s*/i, "")
    .split(/\n+/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replace(/^Why it matters:\s*/i, "Why: "));
  const sev = severity ?? (/^Red flag/i.test(body) ? "red_flag" : /^Caution/i.test(body) ? "caution" : null);
  return (
    <div className="text-sm">
      {sev && sev !== "info" && <span className={cn("mr-1.5 rounded border px-1 py-px text-[11px] font-semibold align-middle", sev === "red_flag" ? "border-red-300 text-red-800" : "border-amber-300 text-amber-800")}>{sev === "red_flag" ? "Red flag" : "Caution"}</span>}
      <ul className="inline">
        {lines.map((l, i) => (
          <li key={i} className={cn(i > 0 && "block mt-0.5", l.startsWith("Why:") ? "text-gray-500" : "text-gray-900", clamp && "line-clamp-2", i === 0 && "inline")}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

// ── client contracts: confirming differences with the client ─────────────────

export function ConfirmationPanel({ c, documents, onDone }: { c: any; documents: any[]; onDone: () => void }) {
  const [role] = useCcmsRole();
  const confFn = useServerFn(recordCcmsConfirmation);
  const [busy, setBusy] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const items: any[] = documents.find((d) => d.comparison)?.comparison?.items ?? [];
  const toConfirm = items.filter((i) => i.decision === "confirm_with_client");
  const confirmed = items.filter((i) => i.decision === "confirmed");
  const conf = c.confirmation ?? {};
  if (!toConfirm.length && !confirmed.length && !conf.sent_date) return null;
  const can = role === "contract_manager" || role === "contract_executive";
  return (
    <section className={CARD}>
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">Confirmation letter to the client</h2>
        <p className="text-sm text-gray-600">Differences with our tender are settled in writing before signing.</p>
      </div>
      <ul className="px-4 py-3 space-y-1.5">
        {[...toConfirm, ...confirmed].map((i) => (
          <li key={i.id} className="text-sm">
            <span className={cn("mr-2 font-semibold", i.decision === "confirmed" ? "text-emerald-700" : "text-amber-700")}>{DECISION_LABEL[i.decision as Decision]}</span>
            <span className="text-gray-900">{COMPARISON_AREAS.find((a) => a.id === i.area)?.label}:</span>{" "}
            <span className="text-gray-700">award says "{i.award || "—"}" · we tendered "{i.tender || "—"}"</span>
          </li>
        ))}
      </ul>
      <div className="px-4 pb-4 text-sm space-y-2">
        {conf.sent_date && <p className="text-gray-700">Sent {conf.sent_date}{conf.sent_to ? ` to ${conf.sent_to}` : ""}. {conf.reply_date ? <span className="text-emerald-700">Client replied {conf.reply_date}{conf.reply_note ? ` — ${conf.reply_note}` : ""}.</span> : <span className="text-amber-700">Awaiting reply ({daysBetween(conf.sent_date, new Date())} days).</span>}</p>}
        {can && !conf.sent_date && toConfirm.length > 0 && (
          <div className="flex gap-2">
            <input className={INPUT + " w-72"} value={to} onChange={(e) => setTo(e.target.value)} placeholder="Sent to (name, designation)" />
            <Button size="sm" disabled={busy} onClick={() => run(confFn({ data: { contract_id: c.id, action: "sent", date: today(), sent_to: to, acting_role: role } }), "Letter recorded as sent", onDone, setBusy)}>Mark letter sent</Button>
          </div>
        )}
        {can && conf.sent_date && !conf.reply_date && (
          <div className="flex gap-2">
            <input className={INPUT + " w-96"} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Client's reply, in short" />
            <Button size="sm" disabled={busy} onClick={() => run(confFn({ data: { contract_id: c.id, action: "reply", date: today(), note, acting_role: role } }), "Client's reply recorded", onDone, setBusy)}>Record client reply</Button>
          </div>
        )}
        {!can && (toConfirm.length > 0 && !conf.reply_date) && <p className="text-gray-500">Switch "Acting as" to Contract Manager to record the letter.</p>}
      </div>
    </section>
  );
}

// ── after approval: signed, stamped, bonds & insurance, repository ───────────

export function ExecutionPanel({ c, documents, onDone }: { c: any; documents: any[]; onDone: () => void }) {
  if (!["approved", "signed", "stamped", "active", "closed"].includes(c.status)) return null;
  return (
    <section className={CARD}>
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">After approval</h2>
        <p className="text-sm text-gray-600">Sign → stamp within 30 days → bonds and insurance → save to the repository.</p>
      </div>
      <div className="divide-y divide-gray-100">
        <SignedStep c={c} documents={documents} onDone={onDone} />
        {c.signed_date && <StampStep c={c} onDone={onDone} />}
        {c.signed_date && <SecuritiesStep c={c} onDone={onDone} />}
        {c.stamping?.stamped_date && <RepositoryStep c={c} onDone={onDone} />}
      </div>
    </section>
  );
}

function StepHead({ n, title, done, children }: { n: number; title: string; done: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-5 rounded-full grid place-items-center text-[11px] font-semibold", done ? "bg-emerald-600 text-white" : "border border-gray-400 text-gray-600")}>{done ? <Check className="size-3" /> : n}</span>
      <span className="text-sm font-semibold text-gray-900">{title}</span>
      {children}
    </div>
  );
}

function SignedStep({ c, documents, onDone }: { c: any; documents: any[]; onDone: () => void }) {
  const [role] = useCcmsRole();
  const attachFn = useServerFn(attachCcmsDocument);
  const signFn = useServerFn(recordCcmsSigned);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(today());
  const [ours, setOurs] = useState({ name: "", designation: "" });
  const [theirs, setTheirs] = useState({ name: "", designation: "" });
  const signed = documents.find((d) => d.doc_role === "executed");
  async function upload(file: File) {
    setBusy(true);
    try {
      const path = `ccms/${c.id}/${Date.now()}-signed-${file.name}`;
      const up = await supabase.storage.from("policies").upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (up.error) throw new Error(up.error.message);
      const url = supabase.storage.from("policies").getPublicUrl(path).data.publicUrl;
      await attachFn({ data: { contract_id: c.id, file_name: file.name, file_url: url, mime_type: file.type || null, size_bytes: file.size, doc_role: "executed", acting_role: role } });
      toast.success("Signed copy uploaded"); onDone();
    } catch (e: any) { toast.error(e?.message ?? "Upload failed"); } finally { setBusy(false); }
  }
  return (
    <div className="px-4 py-3 space-y-2">
      <StepHead n={1} title="Signed" done={!!c.signed_date}>
        {c.signed_date && <span className="text-sm text-gray-600">{c.signed_date} · {(c.signatories ?? []).map((s: any) => `${s.name} (${s.party})`).join(", ")}</span>}
      </StepHead>
      {!c.signed_date && (
        <div className="pl-7 space-y-2 text-sm">
          {signed ? <p className="text-gray-700">Signed copy: {signed.file_name}</p> : (
            <label className={cn("inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 cursor-pointer hover:border-gray-500", busy && "opacity-60 pointer-events-none")}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload signed copy
              <input type="file" accept=".pdf,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-600 w-24">Signed on</span><input type="date" className={INPUT} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-600 w-24">For us</span>
            <input className={INPUT} placeholder="Authorised signatory" value={ours.name} onChange={(e) => setOurs({ ...ours, name: e.target.value })} />
            <input className={INPUT} placeholder="Designation" value={ours.designation} onChange={(e) => setOurs({ ...ours, designation: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-gray-600 w-24">{c.side === "client" ? "For the client" : "For the vendor"}</span>
            <input className={INPUT} placeholder="Signatory" value={theirs.name} onChange={(e) => setTheirs({ ...theirs, name: e.target.value })} />
            <input className={INPUT} placeholder="Designation" value={theirs.designation} onChange={(e) => setTheirs({ ...theirs, designation: e.target.value })} />
          </div>
          <Button size="sm" disabled={busy || !signed || !ours.name.trim()} onClick={() => run(signFn({ data: {
            contract_id: c.id, signed_date: date, acting_role: role,
            signatories: [{ name: ours.name, designation: ours.designation, party: c.entity }, ...(theirs.name.trim() ? [{ name: theirs.name, designation: theirs.designation, party: c.counterparty_name ?? "Counterparty" }] : [])],
          } }), "Signing recorded — stamp within 30 days", onDone, setBusy)}>Record signing</Button>
        </div>
      )}
    </div>
  );
}

function StampStep({ c, onDone }: { c: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const stampFn = useServerFn(recordCcmsStamping);
  const [busy, setBusy] = useState(false);
  const st = c.stamping ?? {};
  const [f, setF] = useState({ sent_date: st.sent_date ?? "", stamped_date: st.stamped_date ?? "", duty: st.duty ?? "", certificate_no: st.certificate_no ?? "" });
  const day = daysBetween(c.signed_date, new Date());
  return (
    <div className="px-4 py-3 space-y-2">
      <StepHead n={2} title="Stamped" done={!!st.stamped_date}>
        <span className={cn("text-sm", st.stamped_date ? "text-gray-600" : day >= 25 ? "text-red-700 font-semibold" : day >= 14 ? "text-amber-700" : "text-gray-600")}>
          {st.stamped_date ? `${st.stamped_date} · certificate ${st.certificate_no}` : `day ${day} of 30`}
        </span>
      </StepHead>
      {!st.stamped_date && (
        <div className="pl-7 flex flex-wrap items-center gap-2 text-sm">
          <label className="text-gray-600">Sent <input type="date" className={INPUT} value={f.sent_date} onChange={(e) => setF({ ...f, sent_date: e.target.value })} /></label>
          <label className="text-gray-600">Stamped <input type="date" className={INPUT} value={f.stamped_date} onChange={(e) => setF({ ...f, stamped_date: e.target.value })} /></label>
          <input className={INPUT + " w-28"} placeholder="Duty (RM)" value={f.duty} onChange={(e) => setF({ ...f, duty: e.target.value })} />
          <input className={INPUT + " w-40"} placeholder="Certificate no." value={f.certificate_no} onChange={(e) => setF({ ...f, certificate_no: e.target.value })} />
          <Button size="sm" disabled={busy} onClick={() => run(stampFn({ data: {
            contract_id: c.id, acting_role: role, sent_date: f.sent_date || null, stamped_date: f.stamped_date || null,
            duty: f.duty === "" ? null : Number(f.duty), certificate_no: f.certificate_no || null,
          } }), "Stamping recorded", onDone, setBusy)}>Save</Button>
        </div>
      )}
    </div>
  );
}

function SecuritiesStep({ c, onDone }: { c: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const saveFn = useServerFn(saveCcmsSecurities);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Security[]>(c.securities ?? []);
  const ready = rows.length > 0 && paymentReady(rows);
  const set = (i: number, patch: Partial<Security>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="px-4 py-3 space-y-2">
      <StepHead n={3} title="Bonds & insurance" done={ready}>
        <span className={cn("text-sm", ready ? "text-emerald-700" : "text-gray-600")}>{ready ? "payment-ready" : "payment not ready until every required item is on file"}</span>
      </StepHead>
      <table className="ml-7 text-sm">
        <thead><tr className="text-left text-xs text-gray-500"><th className="pr-3 py-1 font-semibold">Item</th><th className="pr-3 font-semibold">Required</th><th className="pr-3 font-semibold">Amount (RM)</th><th className="pr-3 font-semibold">Reference</th><th className="font-semibold">Valid until</th></tr></thead>
        <tbody>
          {rows.map((x, i) => (
            <tr key={x.type}>
              <td className="pr-3 py-1 text-gray-900">{SECURITY_TYPES.find((t) => t.id === x.type)?.label}</td>
              <td className="pr-3"><input type="checkbox" checked={x.required} onChange={(e) => set(i, { required: e.target.checked })} /></td>
              <td className="pr-3"><input className={INPUT + " w-28"} value={x.amount ?? ""} onChange={(e) => set(i, { amount: e.target.value === "" ? null : Number(e.target.value) })} /></td>
              <td className="pr-3"><input className={INPUT + " w-40"} value={x.reference ?? ""} onChange={(e) => set(i, { reference: e.target.value })} placeholder={x.type === "cidb_levy" ? "Receipt no." : "Policy / bond no."} /></td>
              <td>{x.type !== "cidb_levy" && <input type="date" className={INPUT} value={x.valid_until ?? ""} onChange={(e) => set(i, { valid_until: e.target.value || null })} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="pl-7"><Button size="sm" variant="outline" disabled={busy} onClick={() => run(saveFn({ data: { contract_id: c.id, securities: rows, acting_role: role } }), "Saved", onDone, setBusy)}>Save bonds & insurance</Button></div>
    </div>
  );
}

function RepositoryStep({ c, onDone }: { c: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const extractFn = useServerFn(extractCcmsKeyTerms);
  const saveFn = useServerFn(saveCcmsRepository);
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState<KeyTerms | null>(c.repository ?? null);
  const saved = c.status === "active" || c.status === "closed";
  const set = (k: keyof KeyTerms, v: any) => setTerms((t) => (t ? { ...t, [k]: v } : t));
  return (
    <div className="px-4 py-3 space-y-2">
      <StepHead n={4} title="In repository" done={saved}>
        {saved && <span className="text-sm text-gray-600">expires {c.expiry_date} · alert 30 days before{c.repository?.confirmed_by ? ` · confirmed by ${displayName(c.repository.confirmed_by)}` : ""}</span>}
      </StepHead>
      {!terms && !saved && (
        <div className="pl-7">
          <Button size="sm" disabled={busy} className="gap-1.5" onClick={async () => {
            setBusy(true);
            try { const r: any = await extractFn({ data: { contract_id: c.id, acting_role: role } }); setTerms(r.terms); toast.success("Key terms read — check them, then save"); }
            catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
          }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Read key terms from the signed copy</Button>
        </div>
      )}
      {terms && (
        <div className="pl-7 grid grid-cols-2 gap-2 text-sm max-w-3xl">
          <label className="col-span-2 text-gray-600">Parties <input className={INPUT + " w-full"} value={terms.parties} onChange={(e) => set("parties", e.target.value)} disabled={saved} /></label>
          <label className="text-gray-600">Value <input className={INPUT + " w-full"} value={terms.value ?? ""} onChange={(e) => set("value", e.target.value === "" ? null : Number(e.target.value))} disabled={saved} /></label>
          <label className="text-gray-600">Governing law <input className={INPUT + " w-full"} value={terms.governing_law ?? ""} onChange={(e) => set("governing_law", e.target.value)} disabled={saved} /></label>
          <label className="text-gray-600">Start <input type="date" className={INPUT + " w-full"} value={terms.start_date ?? ""} onChange={(e) => set("start_date", e.target.value || null)} disabled={saved} /></label>
          <label className="text-gray-600">Expiry <span className="text-red-700">*</span> <input type="date" className={INPUT + " w-full"} value={terms.end_date ?? ""} onChange={(e) => set("end_date", e.target.value || null)} disabled={saved} /></label>
          <label className="text-gray-600">Notice period <input className={INPUT + " w-full"} value={terms.notice_period ?? ""} onChange={(e) => set("notice_period", e.target.value)} disabled={saved} /></label>
          <label className="text-gray-600">Renewal <input className={INPUT + " w-full"} value={terms.renewal ?? ""} onChange={(e) => set("renewal", e.target.value)} disabled={saved} /></label>
          <label className="col-span-2 text-gray-600">Key obligations (one per line)
            <textarea className={INPUT + " w-full min-h-20"} value={terms.obligations.join("\n")} onChange={(e) => set("obligations", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} disabled={saved} />
          </label>
          {!saved && <div className="col-span-2"><Button size="sm" disabled={busy} onClick={() => run(saveFn({ data: { contract_id: c.id, terms: terms as any, acting_role: role } }), "Saved to the repository", onDone, setBusy)}>Confirm and save to repository</Button></div>}
        </div>
      )}
      {saved && c.repository && (
        <p className="pl-7 text-sm text-gray-700">{fmtMoney(c.repository.value, c.repository.currency)} · {c.repository.start_date ?? "—"} to {c.repository.end_date} · {c.repository.notice_period || "no notice period stated"}</p>
      )}
    </div>
  );
}

// ── CMS-03: changes, renewal, closure ────────────────────────────────────────

export function LifecyclePanel({ c, onDone }: { c: any; onDone: () => void }) {
  if (!["signed", "stamped", "active", "closed"].includes(c.status)) return null;
  return (
    <section className={CARD}>
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">Changes, renewal and closure</h2>
      </div>
      <div className="divide-y divide-gray-100">
        <ChangesStep c={c} onDone={onDone} />
        {c.status === "active" && <RenewalStep c={c} onDone={onDone} />}
        {(c.status === "active" || c.status === "closed") && <ClosureStep c={c} onDone={onDone} />}
      </div>
    </section>
  );
}

function ChangesStep({ c, onDone }: { c: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const raiseFn = useServerFn(raiseCcmsChange);
  const decideFn = useServerFn(decideCcmsChange);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ kind: "scope", description: "", value_impact: "", deviates: false });
  const changes: any[] = c.changes ?? [];
  const act = (id: string, stage: "legal" | "approval" | "signed", outcome: "cleared" | "approved" | "rejected" | "signed") =>
    run(decideFn({ data: { contract_id: c.id, change_id: id, stage, outcome, acting_role: role, note: outcome === "rejected" ? "Rejected" : null } }), "Recorded", onDone, setBusy);
  return (
    <div className="px-4 py-3 space-y-2 text-sm">
      <div className="font-semibold text-gray-900">Change requests</div>
      {changes.length === 0 && <p className="text-gray-500">None.</p>}
      {changes.map((x) => (
        <div key={x.id} className="rounded-md border border-gray-200 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{x.id}</span><span className="text-gray-600">{x.kind}</span>
            <span className="text-gray-900">{x.value_impact >= 0 ? "+" : ""}{fmtMoney(x.value_impact)} → {fmtMoney(x.new_total)}</span>
            <span className="text-gray-500">· {x.band}</span>
            <span className={cn("ml-auto text-xs font-semibold", x.signed ? "text-emerald-700" : x.approval === "rejected" ? "text-red-700" : "text-amber-700")}>
              {x.signed ? "Appendix signed" : x.approval === "rejected" ? "Rejected" : x.legal === "pending" ? "Legal vetting" : x.approval === "pending" ? `Awaiting ${x.band}` : "Approved — sign appendix"}
            </span>
          </div>
          <p className="mt-1 text-gray-800">{x.description}</p>
          {!x.signed && x.approval !== "rejected" && (
            <div className="mt-1.5 flex gap-2">
              {x.legal === "pending" && role === "legal" && <><Button size="sm" disabled={busy} onClick={() => act(x.id, "legal", "cleared")}>Legal: clear</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => act(x.id, "legal", "rejected")}>Reject</Button></>}
              {x.legal !== "pending" && x.approval === "pending" && role === "approver" && <><Button size="sm" disabled={busy} onClick={() => act(x.id, "approval", "approved")}>Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => act(x.id, "approval", "rejected")}>Reject</Button></>}
              {x.approval === "approved" && role === "contract_executive" && <Button size="sm" disabled={busy} onClick={() => act(x.id, "signed", "signed")}>Record signed appendix</Button>}
            </div>
          )}
        </div>
      ))}
      {role === "contract_executive" && c.status !== "closed" && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <select className={INPUT} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="scope">Scope</option><option value="rate">Rate</option><option value="quantity">Quantity</option><option value="time">Time</option>
          </select>
          <input className={INPUT + " flex-1 min-w-60"} placeholder="What changes, and why" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <input className={INPUT + " w-32"} placeholder="Value ± RM" value={f.value_impact} onChange={(e) => setF({ ...f, value_impact: e.target.value })} />
          <label className="flex items-center gap-1 text-gray-700"><input type="checkbox" checked={f.deviates} onChange={(e) => setF({ ...f, deviates: e.target.checked })} /> departs from the template</label>
          <Button size="sm" disabled={busy || f.description.trim().length < 5} onClick={() => run(raiseFn({ data: { contract_id: c.id, kind: f.kind as any, description: f.description, value_impact: Number(f.value_impact || 0), deviates_template: f.deviates, acting_role: role } }), "Change raised", () => { setF({ kind: "scope", description: "", value_impact: "", deviates: false }); onDone(); }, setBusy)}>Raise change</Button>
        </div>
      )}
    </div>
  );
}

function RenewalStep({ c, onDone }: { c: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const renewFn = useServerFn(decideCcmsRenewal);
  const [busy, setBusy] = useState(false);
  const [newEnd, setNewEnd] = useState("");
  const [note, setNote] = useState("");
  const can = role === "approver" || role === "contract_manager";
  const d = c.expiry_date ? daysBetween(new Date(), c.expiry_date) : null;
  return (
    <div className="px-4 py-3 space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-900">Renewal</span>
        {d != null && <span className={cn(d <= 30 ? "text-red-700 font-semibold" : "text-gray-600")}>{d < 0 ? `expired ${-d} days ago` : `${d} days to expiry`}</span>}
        {c.renewal && <span className="ml-auto text-gray-600">{c.renewal.decision} · {displayName(c.renewal.by)}{c.renewal.new_end ? ` · to ${c.renewal.new_end}` : ""}</span>}
      </div>
      {can ? (
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className={INPUT} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} title="New expiry, if renewing" />
          <input className={INPUT + " flex-1 min-w-60"} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={busy} onClick={() => run(renewFn({ data: { contract_id: c.id, decision: "renew", new_end: newEnd || null, note, acting_role: role } }), "Renewed", onDone, setBusy)}>Renew</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(renewFn({ data: { contract_id: c.id, decision: "renegotiate", note, acting_role: role } }), "Recorded", onDone, setBusy)}>Renegotiate</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(renewFn({ data: { contract_id: c.id, decision: "terminate", note, acting_role: role } }), "Recorded", onDone, setBusy)}>Let it end</Button>
        </div>
      ) : <p className="text-gray-500">Switch "Acting as" to Approver or Contract Manager to decide. Renewal re-checks the vendor first.</p>}
    </div>
  );
}

function ClosureStep({ c, onDone }: { c: any; onDone: () => void }) {
  const [role] = useCcmsRole();
  const closeFn = useServerFn(closeCcmsContract);
  const [busy, setBusy] = useState(false);
  const [k, setK] = useState({ payments: false, retention_cpc: "", retention_cmgd: "", bonds_returned: false, defects_closed: false, obligations_met: false });
  const [override, setOverride] = useState("");
  const [hold, setHold] = useState(false);
  if (c.status === "closed") {
    return <div className="px-4 py-3 text-sm"><span className="font-semibold text-gray-900">Closed</span> <span className="text-gray-600">{c.closure?.closed_at?.slice(0, 10)} · {displayName(c.closure?.by)} · kept to {c.closure?.retain_until}{c.closure?.legal_hold ? " · legal hold" : ""}{c.closure?.override_reason ? ` · override: ${c.closure.override_reason}` : ""}</span></div>;
  }
  const box = (key: "payments" | "bonds_returned" | "defects_closed" | "obligations_met", label: string) => (
    <label className="flex items-center gap-1.5"><input type="checkbox" checked={k[key]} onChange={(e) => setK({ ...k, [key]: e.target.checked })} /> {label}</label>
  );
  return (
    <div className="px-4 py-3 space-y-2 text-sm">
      <div className="font-semibold text-gray-900">Close out</div>
      {role !== "contract_manager" ? <p className="text-gray-500">Switch "Acting as" to Contract Manager to close.</p> : (
        <>
          <div className="flex flex-wrap gap-4">{box("payments", "Final payments made")}{box("bonds_returned", "Bonds returned")}{box("defects_closed", "Defects closed")}{box("obligations_met", "Obligations met")}</div>
          <div className="flex flex-wrap gap-2">
            <input className={INPUT + " w-72"} placeholder="Retention 1st half — CPC reference" value={k.retention_cpc} onChange={(e) => setK({ ...k, retention_cpc: e.target.value })} />
            <input className={INPUT + " w-80"} placeholder="Retention 2nd half — CMGD + final account ref." value={k.retention_cmgd} onChange={(e) => setK({ ...k, retention_cmgd: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className={INPUT + " flex-1 min-w-60"} placeholder="Override reason (only if something is still open)" value={override} onChange={(e) => setOverride(e.target.value)} />
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} /> Legal hold</label>
            <Button size="sm" disabled={busy} onClick={() => run(closeFn({ data: { contract_id: c.id, checklist: k, override_reason: override || null, legal_hold: hold, acting_role: role } }), "Contract closed", onDone, setBusy)}>Close contract</Button>
          </div>
        </>
      )}
    </div>
  );
}
