import { Check } from "lucide-react";
import { displayName, type BusinessChecklist } from "@/lib/ccms";
import { cn } from "@/lib/utils";

// The business team's checklist before Legal (29 Sep review): many vendor
// drafts are thin, so the business says what it expects — deliverables, KPIs,
// payment terms — and the AI review checks the draft against it.

const INPUT = "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";

export const EMPTY_CHECKLIST: BusinessChecklist = { deliverables: "", kpis: "", payment_terms: "", confirmed: false };

export function BusinessChecklistFields({ value, onChange }: { value: BusinessChecklist; onChange: (v: BusinessChecklist) => void }) {
  const set = (k: keyof BusinessChecklist, v: any) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-2">
      <label className="block text-sm text-gray-700">What the vendor must deliver
        <textarea className={INPUT} rows={3} value={value.deliverables} onChange={(e) => set("deliverables", e.target.value)} placeholder={"One per line, e.g.\nSupply and install 186 bored piles\nMonthly progress report"} />
      </label>
      <label className="block text-sm text-gray-700">KPIs or service levels
        <textarea className={INPUT} rows={2} value={value.kpis} onChange={(e) => set("kpis", e.target.value)} placeholder="e.g. Complete within 20 weeks; defects fixed within 14 days" />
      </label>
      <label className="block text-sm text-gray-700">Payment terms
        <textarea className={INPUT} rows={2} value={value.payment_terms} onChange={(e) => set("payment_terms", e.target.value)} placeholder="e.g. 10% advance against a bond; monthly progress claims, paid within 30 days; 5% retention" />
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-800">
        <input type="checkbox" className="mt-0.5" checked={value.confirmed} onChange={(e) => set("confirmed", e.target.checked)} />
        I confirm this is what the business expects from the vendor. Legal reviews the draft against it.
      </label>
    </div>
  );
}

export function BusinessChecklistView({ value }: { value?: BusinessChecklist | null }) {
  if (!value) return <p className="text-sm text-gray-500">Not filled in yet.</p>;
  const row = (label: string, text: string) => (
    <div><div className="text-xs text-gray-500">{label}</div><div className="whitespace-pre-wrap text-sm text-gray-900">{text?.trim() || <span className="text-gray-400">—</span>}</div></div>
  );
  return (
    <div className="space-y-2">
      {row("What the vendor must deliver", value.deliverables)}
      {row("KPIs or service levels", value.kpis)}
      {row("Payment terms", value.payment_terms)}
      <p className={cn("flex items-center gap-1.5 text-sm", value.confirmed ? "text-emerald-700" : "text-amber-700")}>
        {value.confirmed ? <><Check className="size-4" /> Confirmed by {displayName(value.by)}{value.at ? ` · ${String(value.at).slice(0, 10)}` : ""}</> : "Not confirmed — Legal waits for it"}
      </p>
    </div>
  );
}
