import { NDA_FIELDS } from "@/lib/ccms";

const LABEL = "block text-sm font-medium text-gray-800 mb-1";
const INPUT = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";

/** The particulars a template asks for, grouped as they appear in the draft. */
export function TemplateFieldsForm({ values, onChange, fallbackPurpose = "" }: {
  values: Record<string, string>; onChange: (k: string, v: string) => void; fallbackPurpose?: string;
}) {
  const tf = values; const setT = onChange;
  return (
    <>
      {(["Agreement", "The Company", "Counterparty"] as const).map((g) => (
        <div key={g}>
          <div className="text-sm font-semibold text-gray-900 mb-2">{g}</div>
          <div className="grid grid-cols-2 gap-3">
            {NDA_FIELDS.filter((x) => x.group === g).map((x) => (
              <div key={x.key} className={x.kind === "textarea" ? "col-span-2" : ""}>
                <label className={LABEL}>{x.label}{x.required && <span className="text-red-700"> *</span>}</label>
                {x.kind === "select" ? (
                  <select className={INPUT} value={tf[x.key] ?? ""} onChange={(e) => setT(x.key, e.target.value)}>
                    {x.options!.map((o) => <option key={o}>{o}</option>)}
                  </select>
                ) : x.kind === "textarea" ? (
                  <textarea className={INPUT + " min-h-16"} value={tf[x.key] ?? (x.key === "purpose" ? fallbackPurpose : "")} onChange={(e) => setT(x.key, e.target.value)} />
                ) : (
                  <input className={INPUT} type={x.kind === "date" ? "date" : "text"} value={tf[x.key] ?? ""} onChange={(e) => setT(x.key, e.target.value)} />
                )}
                {x.hint && <p className="mt-0.5 text-xs text-gray-500">{x.hint}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
