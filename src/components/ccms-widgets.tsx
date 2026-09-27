import { useEffect, useState } from "react";
import { Briefcase, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CCMS_ROLES, ROLE_GROUPS, FLAG_META, STATUS_META, OUTCOME_LABEL, workingDaysSince, nextApproval,
  type CcmsRole, type Flag, type Stage,
} from "@/lib/ccms";

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

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, tone: "border-gray-300 text-gray-700" };
  return <span className={cn("inline-flex items-center rounded-full border bg-white px-2 py-0.5 text-xs font-semibold whitespace-nowrap", m.tone)}>{m.label}</span>;
}

export function FlagChips({ flags, max }: { flags: Flag[]; max?: number }) {
  if (!flags?.length) return <span className="text-sm text-gray-400">—</span>;
  const shown = max ? flags.slice(0, max) : flags;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((f) => (
        <span key={f.key} title={f.detail}
          className={cn("rounded border bg-white px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
            FLAG_META[f.key]?.severity === "high" ? "border-red-300 text-red-800" : "border-amber-300 text-amber-800")}>
          {FLAG_META[f.key]?.label ?? f.key}
        </span>
      ))}
      {max && flags.length > max && <span className="text-xs text-gray-500">+{flags.length - max}</span>}
    </div>
  );
}

export function OutcomeText({ status }: { status: Stage["status"] }) {
  const tone = status === "cleared" || status === "approved" ? "text-emerald-700"
    : status === "cleared_with_comments" ? "text-amber-700"
    : status === "pending" ? "text-gray-500" : "text-red-700";
  return <span className={cn("text-sm font-semibold", tone)}>{OUTCOME_LABEL[status] ?? status}</span>;
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

/** The stage a request is waiting on, and whether it is past its service level. */
export function waitingOn(c: any): { label: string; overdue: boolean } | null {
  const route: Stage[] = c.approval_route ?? [];
  if (c.status === "submitted") return { label: "Draft upload", overdue: workingDaysSince(c.created_at) > 2 };
  if (c.status === "in_review") {
    const open = route.filter((s) => s.kind === "review" && s.status === "pending");
    const sla = Math.max(0, ...open.map((s) => s.sla_days));
    return { label: open.map((s) => s.label).join(" · ") || "Review", overdue: workingDaysSince(c.stage_started_at) > sla };
  }
  if (c.status === "pending_committee" || c.status === "pending_approval") {
    const s = nextApproval(route);
    return s ? { label: s.label, overdue: workingDaysSince(c.stage_started_at) > s.sla_days } : null;
  }
  if (c.status === "returned") return { label: "Requestor (revise and resubmit)", overdue: false };
  return null;
}


/** A row of stages — done, current, to do, skipped — and the one next step. */
export function StageBar({ stages, next }: { stages: { key: string; label: string; state: string; detail?: string }[]; next: { text: string; role: string } | null }) {
  const [role] = useCcmsRole();
  return (
    <section className={CARD + " p-4 space-y-3"}>
      <ol className="flex flex-wrap items-start gap-y-3">
        {stages.map((s, i) => (
          <li key={s.key} className="flex items-start">
            <div className="flex flex-col items-center w-[108px] text-center">
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
          <span className={cn("ml-auto rounded-full border px-2 py-0.5 text-xs", role === next.role ? "border-blue-300 text-blue-800" : "border-gray-300 text-gray-600")}>
            {next.role === "vendor" ? "Vendor" : (CCMS_ROLES as Record<string, string>)[next.role] ?? next.role}{role === next.role ? " · you" : ""}
          </span>
        </div>
      )}
    </section>
  );
}

/** Upload a file to storage from the browser; returns its public URL. */
export async function uploadToStorage(prefix: string, file: File): Promise<string> {
  const { supabase } = await import("@/integrations/supabase/client");
  const path = `${prefix}/${Date.now()}-${file.name.replace(/[^\w.\- ]+/g, "_")}`;
  const up = await supabase.storage.from("policies").upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (up.error) throw new Error(up.error.message);
  return supabase.storage.from("policies").getPublicUrl(path).data.publicUrl;
}
