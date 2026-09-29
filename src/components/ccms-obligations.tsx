import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BadgeCheck, Check, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { updateCcmsObligation, validateCcmsObligations } from "@/lib/ccms.functions";
import { friendlyError, fmtMoney, useCcmsRole } from "@/components/ccms-widgets";
import {
  DEMO_PEOPLE, DEMO_SINGLE_USER, OBLIGATION_CATEGORIES, VALIDATE_ROLES, daysBetween, defaultPic, displayName, entityShort, obligationBucket,
  type Obligation, type ObligationCategory,
} from "@/lib/ccms";
import { cn } from "@/lib/utils";

// Obligations: what someone must do under a filed contract — Finance, Business
// or Legal — each with a person in charge (PIC) and a due date.

const INPUT = "w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";
export const CATEGORY_TINT: Record<ObligationCategory, string> = {
  finance: "border-emerald-200 bg-emerald-50 text-emerald-800",
  business: "border-sky-200 bg-sky-50 text-sky-800",
  legal: "border-violet-200 bg-violet-50 text-violet-800",
};
export function CategoryChip({ c }: { c: ObligationCategory }) {
  return <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", CATEGORY_TINT[c])}>{OBLIGATION_CATEGORIES[c]}</span>;
}

/** Due date as "in 12 days" / "3 days overdue", coloured by urgency. */
export function DueText({ o }: { o: Obligation }) {
  if (o.status === "done") return <span className="text-emerald-700">Done{o.done_at ? ` ${o.done_at.slice(0, 10)}` : ""}</span>;
  if (!o.due_date) return <span className="text-gray-500">{o.trigger || "No date"}</span>;
  const d = daysBetween(new Date(), o.due_date);
  return (
    <span title={o.trigger || undefined} className={cn(d < 0 ? "font-semibold text-red-700" : d <= 30 ? "font-semibold text-amber-700" : "text-gray-700")}>
      {o.due_date}<span className="block text-xs font-normal">{d < 0 ? `${-d} days overdue` : d === 0 ? "today" : `in ${d} days`}</span>
    </span>
  );
}

/** Editable obligations for the filing pop-up: text, category, PIC, due date, amount. */
export function ObligationsEditor({ value, onChange, owner }: { value: Obligation[]; onChange: (v: Obligation[]) => void; owner: string }) {
  const set = (i: number, patch: Partial<Obligation>) => onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div className="space-y-2">
      <datalist id="obl-people">{DEMO_PEOPLE.map((p) => <option key={p.name} value={p.name} />)}</datalist>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500"><th className="pb-1 font-medium">Obligation</th><th className="w-28 pb-1 font-medium">Category</th><th className="w-32 pb-1 font-medium">PIC</th><th className="w-36 pb-1 font-medium">Due</th><th className="w-28 pb-1 font-medium">Amount</th><th className="w-6" /></tr></thead>
        <tbody>
          {value.map((o, i) => (
            <tr key={o.id} className="align-top">
              <td className="py-1 pr-2"><input className={INPUT} value={o.text} onChange={(e) => set(i, { text: e.target.value })} />{o.trigger && <div className="mt-0.5 text-xs text-gray-500">{o.trigger}</div>}</td>
              <td className="py-1 pr-2">
                <select className={INPUT} value={o.category} onChange={(e) => { const c = e.target.value as ObligationCategory; set(i, { category: c, pic: defaultPic(c, owner) }); }}>
                  {Object.entries(OBLIGATION_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </td>
              <td className="py-1 pr-2"><input className={INPUT} list="obl-people" value={o.pic} onChange={(e) => set(i, { pic: e.target.value })} /></td>
              <td className="py-1 pr-2"><input type="date" className={INPUT} value={o.due_date ?? ""} onChange={(e) => set(i, { due_date: e.target.value || null })} /></td>
              <td className="py-1 pr-2"><input className={INPUT} inputMode="decimal" value={o.amount ?? ""} placeholder={o.category === "finance" ? "RM" : ""} onChange={(e) => set(i, { amount: e.target.value === "" ? null : Number(e.target.value.replace(/,/g, "")) || null })} />{o.percent != null && <div className="mt-0.5 text-xs text-gray-500">{o.percent}%</div>}</td>
              <td className="py-1"><button type="button" title="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="size-4" /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => onChange([...value, { id: `o${Date.now()}`, text: "", category: "business", pic: defaultPic("business", owner), due_date: null, status: "open" }])}
        className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><Plus className="size-4" /> Add Obligation</button>
    </div>
  );
}

/** Validate in review: the department confirms the AI read its obligations
 *  right. "Acting as" follows the department in the demo. Returns the call. */
export function useValidateObligations(onChanged: () => void) {
  const fn = useServerFn(validateCcmsObligations);
  const [role, setRole] = useCcmsRole();
  const [busy, setBusy] = useState<string | null>(null);
  async function validate(key: string, c: any, list: Obligation[], validated: boolean, documentId?: string) {
    if (!list.length) return;
    const allowed = VALIDATE_ROLES[list[0].category];
    let acting = role;
    if (!allowed.includes(role) && DEMO_SINGLE_USER) { acting = allowed[0]; setRole(acting); }
    setBusy(key);
    try {
      await fn({ data: { contract_id: c.id, document_id: documentId, ids: list.map((o) => o.id), validated, acting_role: acting } });
      toast.success(validated ? (list.length === 1 ? "Validated" : `${list.length} obligations validated`) : "Validation undone");
      onChanged();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  }
  return { validate, busy };
}

/** Validate every obligation in the list still to validate. */
export function ValidateAllButton({ c, list, documentId, onChanged, label }: { c: any; list: Obligation[]; documentId?: string; onChanged: () => void; label?: string }) {
  const v = useValidateObligations(onChanged);
  const left = list.filter((o) => !o.validated_by);
  if (!left.length) return list.length ? <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700"><BadgeCheck className="size-4" /> All validated</span> : null;
  return (
    <button type="button" disabled={v.busy === "all"} onClick={() => v.validate("all", c, left, true, documentId)}
      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 px-2.5 py-1 text-sm font-medium text-emerald-800 hover:bg-emerald-50">
      {v.busy === "all" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Validate All{label ? ` · ${label}` : ""} ({left.length})
    </button>
  );
}

/** Who validated an obligation, as a small green mark. */
export function ValidatedMark({ o }: { o: Obligation }) {
  if (!o.validated_by) return null;
  return <span className="inline-flex items-center gap-0.5 font-medium text-emerald-700" title={o.validated_at ? `Validated ${o.validated_at.slice(0, 10)}` : undefined}><BadgeCheck className="size-3.5" /> Validated · {displayName(o.validated_by)}</span>;
}

/** Obligations as a list with Mark Done — on the contract page and across contracts.
 *  `validate` (in review): each row is confirmed by its department instead. */
export function ObligationRows({ rows, showContract, onChanged, readOnly, validate, documentId, compact }: {
  rows: { o: Obligation; c: any }[]; showContract?: boolean; onChanged: () => void; readOnly?: boolean; validate?: boolean; documentId?: string; compact?: boolean;
}) {
  const fn = useServerFn(updateCcmsObligation);
  const [busy, setBusy] = useState<string | null>(null);
  const v = useValidateObligations(onChanged);
  async function toggle(o: Obligation, c: any) {
    setBusy(o.id + c.id);
    try { await fn({ data: { contract_id: c.id, id: o.id, status: o.status === "done" ? "open" : "done" } }); toast.success(o.status === "done" ? "Reopened" : "Marked done"); onChanged(); }
    catch (e) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  }
  if (!rows.length) return <p className="px-4 py-3 text-sm text-gray-500">Nothing here.</p>;
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map(({ o, c }) => (
        <li key={c.id + o.id} className={cn("flex items-start gap-3 px-4 py-2.5 text-sm", o.status === "done" && "opacity-60", obligationBucket(o) === "overdue" && "bg-red-50/40")}>
          <div className="min-w-0 flex-1">
            <div className={cn("text-gray-900", o.status === "done" && "line-through")}>{o.text}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <CategoryChip c={o.category} />
              <span>PIC {o.pic}</span>
              {o.amount != null && <span className="font-medium text-gray-700">{fmtMoney(o.amount, c.repository?.currency ?? c.currency)}{o.percent != null ? ` (${o.percent}%)` : ""}</span>}
              {showContract && <Link to="/ccms/$contractId" params={{ contractId: c.id }} className="text-blue-700 hover:underline">{c.reference_number}</Link>}
              {showContract && <span title={c.entity}>{entityShort(c.entity)} · {c.counterparty_name}</span>}
              <ValidatedMark o={o} />
            </div>
          </div>
          <div className={cn("shrink-0 text-right", compact ? "w-24" : "w-32")}><DueText o={o} /></div>
          {validate && (o.validated_by
            ? <button type="button" title="Undo the validation" disabled={v.busy === o.id} onClick={() => v.validate(o.id, c, [o], false, documentId)}
                className="inline-flex w-24 shrink-0 items-center justify-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:border-gray-400">
                {v.busy === o.id ? <Loader2 className="size-4 animate-spin" /> : <><RotateCcw className="size-3.5" /> Undo</>}
              </button>
            : <button type="button" disabled={v.busy === o.id} onClick={() => v.validate(o.id, c, [o], true, documentId)}
                className="inline-flex w-24 shrink-0 items-center justify-center gap-1 rounded-md border border-emerald-300 px-2 py-1 text-sm font-medium text-emerald-800 hover:bg-emerald-50">
                {v.busy === o.id ? <Loader2 className="size-4 animate-spin" /> : <><Check className="size-4" /> Validate</>}
              </button>)}
          {!readOnly && !validate && <button type="button" disabled={busy === o.id + c.id} onClick={() => toggle(o, c)}
            className={cn("inline-flex w-28 shrink-0 items-center justify-center gap-1 rounded-md border px-2 py-1 text-sm", o.status === "done" ? "border-gray-200 text-gray-600 hover:border-gray-400" : "border-gray-300 text-gray-900 hover:border-gray-900")}>
            {busy === o.id + c.id ? <Loader2 className="size-4 animate-spin" /> : o.status === "done" ? <><RotateCcw className="size-3.5" /> Reopen</> : <><Check className="size-4" /> Mark Done</>}
          </button>}
        </li>
      ))}
    </ul>
  );
}
