import { Check, CircleDashed, Clock, Star, X } from "lucide-react";
import { docsFor } from "@/lib/vms";
import { cn } from "@/lib/utils";

// The documents a vendor category needs, as a checklist: mandatory first and
// starred, expiry-tracked marked with a clock. With `documents`, each item is
// ticked as it is received and verified.

const TAG: Record<string, string> = { C: "If relevant", S: "Suggested" };

export function RequiredDocsChecklist({ category, documents, done = [] }: { category: string; documents?: any[]; done?: string[] }) {
  const list = docsFor(category);
  const mandatory = list.filter((d) => d.level === "M");
  const optional = list.filter((d) => d.level !== "M");
  const stateOf = (id: string) => {
    if (done.includes(id)) return "verified"; // completed on the portal's own forms, or recorded by Finance / the assessor
    const ds = (documents ?? []).filter((x) => x.doc_type === id);
    if (ds.some((x) => x.status === "verified")) return "verified";
    if (ds.some((x) => x.status === "uploaded")) return "uploaded";
    if (ds.some((x) => x.status === "rejected")) return "rejected";
    return "missing";
  };
  const verifiedCount = documents ? mandatory.filter((d) => stateOf(d.id) === "verified").length : null;

  const Row = ({ d }: { d: (typeof list)[number] }) => {
    const s = documents ? stateOf(d.id) : "missing";
    return (
      <li className="flex items-start gap-2 py-1">
        <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded border",
          s === "verified" ? "border-emerald-600 bg-emerald-600 text-white" : s === "uploaded" ? "border-amber-500 text-amber-600" : s === "rejected" ? "border-red-500 text-red-600" : "border-gray-300")}
          title={documents ? { verified: "Verified", uploaded: "Received, to verify", rejected: "Rejected", missing: "Not received" }[s] : undefined}>
          {s === "verified" ? <Check className="size-3" strokeWidth={3} /> : s === "uploaded" ? <CircleDashed className="size-3" /> : s === "rejected" ? <X className="size-3" strokeWidth={3} /> : null}
        </span>
        <span className={cn("flex-1 text-sm leading-5", d.level === "M" ? "text-gray-900" : "text-gray-600")}>{d.label}</span>
        <span className="flex shrink-0 items-center gap-1 pt-0.5">
          {d.expires && <span title="Expiry tracked"><Clock className="size-3.5 text-gray-400" aria-label="Expiry tracked" /></span>}
          {d.level === "M"
            ? <span title="Mandatory"><Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="Mandatory" /></span>
            : <span className="text-[11px] text-gray-400">{TAG[d.level] ?? ""}</span>}
        </span>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-gray-500">
          <span>Mandatory</span>
          <span className="normal-case tracking-normal font-normal">{verifiedCount != null ? `${verifiedCount} of ${mandatory.length} done` : mandatory.length}</span>
        </div>
        <ul className="mt-1 divide-y divide-gray-100">{mandatory.map((d) => <Row key={d.id} d={d} />)}</ul>
      </div>
      {optional.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Optional</div>
          <ul className="mt-1 divide-y divide-gray-100">{optional.map((d) => <Row key={d.id} d={d} />)}</ul>
        </div>
      )}
      <div className="flex gap-3 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><Star className="size-3 fill-amber-400 text-amber-400" /> Mandatory</span>
        <span className="flex items-center gap-1"><Clock className="size-3 text-gray-400" /> Expiry tracked</span>
      </div>
    </div>
  );
}
