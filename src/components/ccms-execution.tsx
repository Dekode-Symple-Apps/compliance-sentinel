import { Check, Circle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ActionBar } from "@/components/ccms-actions";
import {
  COMPARISON_AREAS, DECISION_LABEL, SECURITY_TYPES, contractAlerts, contractMilestones, daysBetween, displayName, flowOf, normalizeObligations, paymentReady, retainUntil,
  type Decision, type Security,
} from "@/lib/ccms";
import { CARD, fmtMoney, SeverityIcon } from "@/components/ccms-widgets";

// ── the milestone tracker ────────────────────────────────────────────────────

/** Every stage in one line, and under it the buttons for the current one —
 *  the one thing to do now. */
export function Milestones({ c, documents, events, onDone }: { c: any; documents: any[]; events: any[]; onDone: () => void }) {
  const comparison = documents.find((d) => d.comparison)?.comparison;
  const { stages, next } = contractMilestones(c, documents, events, comparison);
  const alerts = contractAlerts(c);
  const cur = stages.find((s) => s.state === "current");
  return (
    <section className={CARD + " p-4 space-y-3"}>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="rounded-full border border-gray-200 px-2 py-0.5">{flowOf(c) === "lite" ? "Lite Workflow" : "Full Workflow"}</span>
      </div>
      <ol className="flex flex-wrap items-start gap-y-3">
        {stages.map((s, i) => (
          <li key={s.key} className="flex items-start">
            <div className="flex flex-col items-center w-[104px] text-center">
              <span className={cn("size-7 rounded-full border-2 grid place-items-center",
                s.state === "done" ? "border-emerald-500 bg-emerald-500 text-white"
                : s.state === "current" ? "border-sky-600 bg-sky-50 text-sky-700"
                : "border-gray-200 text-gray-300")}>
                {s.state === "done" ? <Check className="size-4" /> : <Circle className={cn("size-2.5", s.state === "current" && "fill-sky-600")} />}
              </span>
              <span className={cn("mt-1.5 text-xs leading-tight", s.state === "current" ? "font-semibold text-sky-800" : s.state === "done" ? "text-gray-900" : "text-gray-500")}>{s.label}</span>
              {s.detail && <span className="mt-0.5 text-[11px] leading-tight text-gray-500">{s.detail}</span>}
            </div>
            {i < stages.length - 1 && <span className={cn("mt-3.5 h-0.5 w-4 -mx-1", s.state === "done" ? "bg-emerald-500" : "bg-gray-200")} />}
          </li>
        ))}
      </ol>
      {cur && (
        <div className="rounded-md border border-sky-100 bg-sky-50/40 px-3 py-2.5 space-y-2">
          {next && <div className="text-sm font-medium text-sky-900">{next.text}</div>}
          <ActionBar c={c} documents={documents} events={events} onDone={onDone} />
        </div>
      )}
      {c.status === "rejected" && <p className="text-sm text-gray-600">Rejected. The request is closed.</p>}
      {alerts.map((a, i) => (
        <div key={i} className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", a.severity === "high" ? "border-red-200 bg-red-50/40 text-red-800" : "border-amber-200 bg-amber-50/40 text-amber-800")}>
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
      {sev && sev !== "info" && <SeverityIcon severity={sev} className="mr-1.5 -mt-0.5 align-middle" />}
      <ul className="inline">
        {lines.map((l, i) => (
          <li key={i} className={cn(i > 0 && "block mt-0.5", l.startsWith("Why:") ? "text-gray-500" : "text-gray-900", clamp && "line-clamp-2", i === 0 && "inline")}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

// ── read-only records (the actions themselves are the milestone buttons) ─────

const Line = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-3 px-4 py-1.5 text-sm"><span className="w-36 shrink-0 text-gray-600">{k}</span><span className="text-gray-900 min-w-0">{v}</span></div>
);

/** Signed, stamped, bonds and insurance, repository — what was recorded. */
export function ExecutionRecord({ c }: { c: any }) {
  const lite = flowOf(c) === "lite";
  const st = c.stamping ?? {};
  const secs: Security[] = (c.securities ?? []).filter((x: Security) => x.required);
  const r = c.repository;
  return (
    <div className="py-2">
      <Line k="Signed" v={c.signed_date ? `${c.signed_date} · ${(c.signatories ?? []).map((s: any) => `${s.name}${s.designation ? `, ${s.designation}` : ""} (${s.party})`).join("; ")}` : "—"} />
      <Line k="Stamped" v={st.stamped_date ? `${st.stamped_date} · certificate ${st.certificate_no}${st.duty != null ? ` · RM${st.duty}` : ""}` : lite ? "not recorded (optional)" : c.signed_date ? `not yet — day ${daysBetween(c.signed_date, new Date())} of 30` : "—"} />
      {!lite && <Line k="Bonds & insurance" v={secs.length ? <>{paymentReady(secs) ? "payment-ready" : "incomplete"} · {secs.map((x) => `${SECURITY_TYPES.find((t) => t.id === x.type)?.label}${x.reference ? ` ${x.reference}` : ""}${x.valid_until ? ` to ${x.valid_until}` : ""}`).join("; ")}</> : "none required"} />}
      <Line k="Repository" v={r ? `${fmtMoney(r.value, r.currency)} · ${r.start_date ?? "—"} to ${r.end_date} · ${r.notice_period || "no notice period stated"} · confirmed by ${displayName(r.confirmed_by)}` : "—"} />
      {r?.obligations?.length > 0 && <Line k="Key obligations" v={<ul className="list-disc pl-4">{normalizeObligations(r.obligations).map((o) => <li key={o.id}>{o.text}<span className="text-gray-500"> · {o.pic}{o.due_date ? ` · due ${o.due_date}` : ""}</span></li>)}</ul>} />}
      {c.signed_date && !c.closure && <Line k="Records kept until" v={`${retainUntil(c)} (7 years from signing)`} />}
      {c.closure && <Line k={lite ? "Ended" : "Closed"} v={`${c.closure.closed_at?.slice(0, 10)} · ${displayName(c.closure.by)} · kept to ${c.closure.retain_until}${c.closure.legal_hold ? " · legal hold" : ""}${c.closure.override_reason ? ` · ${c.closure.override_reason}` : ""}`} />}
    </div>
  );
}

/** Change requests and the renewal decision. */
export function LifecycleRecord({ c }: { c: any }) {
  const changes: any[] = c.changes ?? [];
  return (
    <div className="py-2">
      {changes.length === 0 && !c.renewal && <p className="px-4 py-1.5 text-sm text-gray-500">No changes or renewals yet.</p>}
      {changes.map((x) => (
        <Line key={x.id} k={x.id} v={<>{x.kind} · {x.value_impact >= 0 ? "+" : ""}{fmtMoney(x.value_impact)} → {fmtMoney(x.new_total)} · <b>{x.signed ? "appendix signed" : x.approval === "rejected" ? "rejected" : x.legal === "pending" ? "Legal vetting" : x.approval === "pending" ? `awaiting ${x.band}` : "approved — sign appendix"}</b><div className="text-gray-700">{x.description}</div></>} />
      ))}
      {c.renewal && <Line k="Renewal" v={`${c.renewal.decision} · ${displayName(c.renewal.by)}${c.renewal.new_end ? ` · to ${c.renewal.new_end}` : ""}${c.renewal.note ? ` — ${c.renewal.note}` : ""}`} />}
    </div>
  );
}

/** Client contracts: the differences with our tender settled in writing. */
export function ConfirmationRecord({ c, documents }: { c: any; documents: any[] }) {
  const items: any[] = documents.find((d) => d.comparison)?.comparison?.items ?? [];
  const shown = items.filter((i) => i.decision === "confirm_with_client" || i.decision === "confirmed");
  const conf = c.confirmation ?? {};
  return (
    <div className="py-2">
      {shown.map((i) => (
        <Line key={i.id} k={DECISION_LABEL[i.decision as Decision]} v={<><b>{COMPARISON_AREAS.find((a) => a.id === i.area)?.label}:</b> award says "{i.award || "—"}" · we tendered "{i.tender || "—"}"</>} />
      ))}
      <Line k="Letter" v={conf.sent_date ? `sent ${conf.sent_date}${conf.sent_to ? ` to ${conf.sent_to}` : ""}${conf.reply_date ? ` · client replied ${conf.reply_date}${conf.reply_note ? ` — ${conf.reply_note}` : ""}` : ` · awaiting reply (${daysBetween(conf.sent_date, new Date())} days)`}` : "not sent"} />
    </div>
  );
}
