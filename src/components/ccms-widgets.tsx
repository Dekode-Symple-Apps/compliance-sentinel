import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Briefcase, ChevronRight, Info, Loader2, OctagonAlert, Sparkles, TriangleAlert, UserCog } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CCMS_ROLES, ROLE_GROUPS, FLAG_META, STATUS_META, OUTCOME_LABEL, workingDaysSince, statusLabel,
  type CcmsRole, type Flag, type Stage,
} from "@/lib/ccms";
export { waitingOn } from "@/lib/ccms";

// ---------------------------------------------------------------------------
// "Acting as" — the demo persona. Unlike Legal CMS's switcher, the server
// checks it per action (only Legal records a Legal outcome, only an approver
// approves), so the sandbox shows the real segregation of duties with one
// login. It is still not authentication.
// ---------------------------------------------------------------------------
const ROLE_KEY = "ccms-acting-role";
const ROLES = Object.keys(CCMS_ROLES) as CcmsRole[];
let listeners: Array<() => void> = [];

function readRole(): CcmsRole {
  if (typeof window === "undefined") return "requestor";
  const v = window.localStorage.getItem(ROLE_KEY);
  return (ROLES as string[]).includes(v ?? "") ? (v as CcmsRole) : "requestor";
}

export function useCcmsRole(): [CcmsRole, (r: CcmsRole) => void] {
  const [role, setRole] = useState<CcmsRole>("requestor");
  useEffect(() => {
    setRole(readRole());
    const l = () => setRole(readRole());
    listeners.push(l);
    return () => { listeners = listeners.filter((x) => x !== l); };
  }, []);
  return [role, (r) => { window.localStorage.setItem(ROLE_KEY, r); listeners.forEach((l) => l()); }];
}

export function ActingAs() {
  const [role, setRole] = useCcmsRole();
  return (
    <label className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm" title="Demo persona — the server checks it for each action">
      <UserCog className="size-4 text-gray-500" />
      <span className="text-gray-600">Acting as</span>
      <select value={role} onChange={(e) => setRole(e.target.value as CcmsRole)} className="font-semibold bg-transparent focus:outline-none cursor-pointer">
        {ROLE_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.roles.map((r) => <option key={r} value={r}>{CCMS_ROLES[r]}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function CcmsHeader({ title, subtitle, action }: { title?: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="sticky top-14 z-10 flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="size-8 rounded-lg border border-gray-200 grid place-items-center shrink-0">
          <Briefcase className="size-4 text-gray-700" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-gray-900 truncate">{title ?? "Commercial CMS"}</h1>
          <p className="text-sm text-gray-600 truncate">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <ActingAs />
        {action}
      </div>
    </div>
  );
}

export function StatusBadge({ status, contract }: { status: string; contract?: any }) {
  const m = STATUS_META[status] ?? { label: status, tone: "border-gray-200 bg-gray-50 text-gray-700" };
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", m.tone)}>{contract ? statusLabel(contract) : m.label}</span>;
}

/** Red flag / caution / note as an icon; the word is in the tooltip and for
 *  screen readers. Accepts the AI's severities and the flag severities. */
export function SeverityIcon({ severity, className }: { severity?: string | null; className?: string }) {
  const s = severity === "high" ? "red_flag" : severity === "medium" ? "caution" : severity;
  const [Icon, tone, word] = s === "red_flag" ? [OctagonAlert, "text-red-600", "Red flag"]
    : s === "caution" ? [TriangleAlert, "text-amber-500", "Caution"] : [Info, "text-gray-400", "Note"];
  return <Icon className={cn("inline size-4 shrink-0", tone, className)} aria-label={word} role="img"><title>{word}</title></Icon>;
}

/** A card that folds away. The header keeps a one-line summary, so a closed
 *  section still says what is in it. */
export function Section({ title, summary, defaultOpen = false, right, children }: {
  title: string; summary?: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);
  return (
    <section className={CARD}>
      <div className={cn("flex items-center gap-3 px-4 py-2.5", open && "border-b border-gray-200")}>
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          <ChevronRight className={cn("size-4 shrink-0 text-gray-400 transition-transform", open && "rotate-90")} />
          <span className="text-sm font-semibold text-gray-900">{title}</span>
          {summary != null && <span className="truncate text-sm text-gray-500">{summary}</span>}
        </button>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      {open && children}
    </section>
  );
}

/** "AI $0.04" — the per-call breakdown (model, input / thinking / output
 *  tokens, cost) in a tooltip. */
export function CostChip({ log }: { log: any[] }) {
  if (!log?.length) return null;
  const total = log.reduce((a, x) => a + (x.usd ?? 0), 0);
  const sum = (k: "input" | "thinking" | "output") => log.reduce((a, x) => a + (x.tokens?.[k] ?? 0), 0);
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex cursor-default items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
            <Sparkles className="size-3.5 text-gray-500" /> AI ${total.toFixed(4)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-sm bg-white text-gray-900 border border-gray-200 shadow-md p-3">
          <div className="text-xs font-semibold">{log.length} AI call{log.length === 1 ? "" : "s"} · US${total.toFixed(4)}</div>
          <ul className="mt-1.5 space-y-1">
            {log.map((x, i) => (
              <li key={i} className="text-xs">
                <div className="flex gap-3"><span>{x.op}</span><span className="ml-auto tabular-nums">${(x.usd ?? 0).toFixed(4)}</span></div>
                <div className="text-gray-500">{x.model}{x.tokens ? ` · in ${x.tokens.input.toLocaleString()} · thinking ${x.tokens.thinking.toLocaleString()} · out ${x.tokens.output.toLocaleString()}` : ""}</div>
              </li>
            ))}
          </ul>
          {log.some((x) => x.tokens) && <div className="mt-1.5 border-t border-gray-100 pt-1.5 text-xs text-gray-500">Total tokens · in {sum("input").toLocaleString()} · thinking {sum("thinking").toLocaleString()} · out {sum("output").toLocaleString()}. Thinking is billed at the output rate.</div>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Row tint by priority rank — a hint of colour and a thin left rule. */
export const PRIORITY_TINT: Record<number, string> = {
  1: "bg-red-50/40 shadow-[inset_3px_0_0_var(--color-red-300)]",
  2: "bg-amber-50/40 shadow-[inset_3px_0_0_var(--color-amber-300)]",
  3: "shadow-[inset_3px_0_0_var(--color-sky-200)]",
  4: "shadow-[inset_3px_0_0_var(--color-emerald-200)]",
  5: "",
};

export function FlagChips({ flags, max }: { flags: Flag[]; max?: number }) {
  if (!flags?.length) return <span className="text-sm text-gray-400">—</span>;
  const shown = max ? flags.slice(0, max) : flags;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((f) => (
        <span key={f.key} title={f.detail}
          className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-gray-800">
          <SeverityIcon severity={FLAG_META[f.key]?.severity} className="size-3.5" />{FLAG_META[f.key]?.label ?? f.key}
        </span>
      ))}
      {max && flags.length > max && <span className="text-xs text-gray-500">+{flags.length - max}</span>}
    </div>
  );
}

/** In Lite, Legal's outcome is the decision, so it reads as one. */
const LITE_OUTCOME: Record<string, string> = { cleared: "Approved", cleared_with_comments: "Approved with comments", not_cleared: "Returned" };
export function OutcomeText({ status, lite }: { status: Stage["status"]; lite?: boolean }) {
  const tone = status === "cleared" || status === "approved" ? "text-emerald-700"
    : status === "cleared_with_comments" ? (lite ? "text-emerald-700" : "text-amber-700")
    : status === "pending" ? "text-gray-500" : "text-red-700";
  return <span className={cn("text-sm font-semibold", tone)}>{(lite && LITE_OUTCOME[status]) || OUTCOME_LABEL[status] || status}</span>;

}

/** Days in the current stage against its service level. */
export function SlaText({ since, days }: { since?: string | null; days: number }) {
  const n = workingDaysSince(since);
  const over = n > days;
  return <span className={cn("text-sm", over ? "text-red-700 font-semibold" : "text-gray-600")}>{n} of {days} working days{over ? " — overdue" : ""}</span>;
}

export const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";
export const TD = "px-3 py-2.5 text-sm text-gray-900 align-top";
export const CARD = "rounded-lg border border-gray-200 bg-white";

export const fmtMoney = (v: number | null | undefined, cur = "MYR") =>
  typeof v === "number" ? `${cur === "MYR" ? "RM" : cur + " "}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—";

/** A row of stages — done, current, to do, skipped — and the one next step. */
export function StageBar({ stages, next, actions, onStageClick }: { stages: { key: string; label: string; state: string; detail?: string }[]; next: { text: string; role: string } | null; actions?: React.ReactNode; onStageClick?: (key: string) => void }) {
  const [role] = useCcmsRole();
  return (
    <section className={CARD + " p-4 space-y-3"}>
      <ol className="flex flex-wrap items-start gap-y-3">
        {stages.map((s, i) => (
          <li key={s.key} className="flex items-start">
            <div className={cn("flex flex-col items-center w-[108px] text-center", onStageClick && s.state !== "todo" && s.state !== "skipped" && "cursor-pointer rounded-md hover:bg-gray-50")}
              role={onStageClick ? "button" : undefined} tabIndex={onStageClick && s.state !== "todo" ? 0 : undefined}
              title={onStageClick && s.state !== "todo" && s.state !== "skipped" ? `Open ${s.label}` : undefined}
              onClick={() => onStageClick && s.state !== "todo" && s.state !== "skipped" && onStageClick(s.key)}
              onKeyDown={(e) => { if (e.key === "Enter" && onStageClick && s.state !== "todo") onStageClick(s.key); }}>
              <span className={cn("size-7 rounded-full border-2 grid place-items-center text-xs",
                s.state === "done" ? "border-emerald-600 bg-emerald-600 text-white" : s.state === "current" ? "border-blue-700 text-blue-700" : "border-gray-300 text-gray-300")}>
                {s.state === "done" ? "✓" : s.state === "skipped" ? "–" : "●"}
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
          {actions && <span className="ml-auto flex flex-wrap gap-2">{actions}</span>}
          <span className={cn(!actions && "ml-auto", "rounded-full border px-2 py-0.5 text-xs", role === next.role ? "border-blue-300 text-blue-800" : "border-gray-300 text-gray-600")}>
            {next.role === "vendor" ? "Vendor" : (CCMS_ROLES as Record<string, string>)[next.role] ?? next.role}{role === next.role ? " · you" : ""}
          </span>
        </div>
      )}
    </section>
  );
}

/** A server error as a sentence. Validation failures arrive as a JSON list of
 *  issues; show them as "Scope summary: at least 10 characters". */
export function friendlyError(e: any): string {
  const msg = String(e?.message ?? e ?? "Failed");
  if (msg.trim().startsWith("[")) {
    try {
      const issues = JSON.parse(msg);
      if (Array.isArray(issues) && issues.length) {
        return issues.map((i: any) => {
          const raw = String(i.path?.at(-1) ?? "value").replace(/_/g, " ");
          const field = raw.charAt(0).toUpperCase() + raw.slice(1);
          if (i.code === "too_small" && i.type === "string") return i.minimum <= 1 ? `${field} is required` : `${field}: at least ${i.minimum} characters`;
          return `${field}: ${i.message}`;
        }).join("; ");
      }
    } catch { /* not JSON — fall through */ }
  }
  return msg;
}

/** Upload a file to storage from the browser; returns its public URL. */
export async function uploadToStorage(prefix: string, file: File): Promise<string> {
  const { supabase } = await import("@/integrations/supabase/client");
  const path = `${prefix}/${Date.now()}-${file.name.replace(/[^\w.\- ]+/g, "_")}`;
  const up = await supabase.storage.from("policies").upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (up.error) throw new Error(up.error.message);
  return supabase.storage.from("policies").getPublicUrl(path).data.publicUrl;
}

/** A note as written: "- " lines show as a bulleted list, other lines as text. */
export function NoteText({ text, className }: { text?: string | null; className?: string }) {
  if (!text?.trim()) return null;
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-•*]\s+/.test(line);
    const last = blocks.at(-1);
    if (last && last.list === bullet) last.lines.push(line.replace(/^[-•*]\s+/, ""));
    else blocks.push({ list: bullet, lines: [line.replace(/^[-•*]\s+/, "")] });
  }
  return (
    <div className={cn("space-y-1 text-sm", className)}>
      {blocks.map((b, i) => b.list
        ? <ul key={i} className="list-disc space-y-0.5 pl-5">{b.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
        : b.lines.map((l, j) => <p key={`${i}-${j}`}>{l}</p>))}
    </div>
  );
}

/** Drafts a note with AI from what the review found; the text lands in the
 *  box for the person to edit before it is sent. */
export function AiDraftButton({ run, onText, label = "Draft with AI", empty = "Nothing in the review to summarise — write the note." }: { run: () => Promise<{ note: string }>; onText: (t: string) => void; label?: string; empty?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy} className="inline-flex shrink-0 items-center gap-1 text-sm text-blue-700 hover:underline disabled:opacity-60"
      onClick={async () => {
        setBusy(true);
        try { const r = await run(); if (r.note) onText(r.note); else toast.message(empty); }
        catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
      }}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {busy ? "Writing…" : label}
    </button>
  );
}

/** An in-page confirmation (the browser's own confirm/prompt boxes do not show
 *  in every browser or embedded view). `typeToConfirm` asks for a word, such as
 *  a reference, to be typed back before the destructive action runs. */
export interface ConfirmOptions { title: string; body?: string; confirmLabel?: string; typeToConfirm?: string }
export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState("");
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const ask = (o: ConfirmOptions) => new Promise<boolean>((res) => { resolver.current = res; setTyped(""); setOpts(o); });
  const done = (v: boolean) => { resolver.current?.(v); resolver.current = null; setOpts(null); };
  const ok = !opts?.typeToConfirm || typed.trim().toUpperCase() === opts.typeToConfirm.toUpperCase();
  const element = (
    <Dialog open={!!opts} onOpenChange={(o) => { if (!o) done(false); }}>
      <DialogContent className="max-w-md bg-white">
        <DialogHeader>
          <DialogTitle>{opts?.title}</DialogTitle>
          {opts?.body && <DialogDescription className="whitespace-pre-line">{opts.body}</DialogDescription>}
        </DialogHeader>
        {opts?.typeToConfirm && (
          <label className="block text-sm text-gray-700">Type <b>{opts.typeToConfirm}</b> to confirm
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && ok) done(true); }}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-600" />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={() => done(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-500">Cancel</button>
          <button type="button" disabled={!ok} onClick={() => done(true)} className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40">{opts?.confirmLabel ?? "Delete"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
  return [ask, element];
}
