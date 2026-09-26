import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  attachCcmsDocument, createCcmsContract, listCcmsVendors, reviewCcmsDocument,
} from "@/lib/ccms.functions";
import { CcmsHeader, FlagChips, CARD, useCcmsRole, fmtMoney } from "@/components/ccms-widgets";
import {
  CONTRACT_TYPES, LSH_ENTITIES, FX_TO_MYR, buildRoute, computeFlags, templateById, toMyr,
} from "@/lib/ccms";
import { Loader2, Upload, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/ccms/new")({
  component: NewRequest,
  head: () => ({ meta: [{ title: "Commercial CMS · New request" }] }),
});

const LABEL = "block text-sm font-medium text-gray-800 mb-1";
const INPUT = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";

function NewRequest() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [role] = useCcmsRole();
  const vendorsFn = useServerFn(listCcmsVendors);
  const createFn = useServerFn(createCcmsContract);
  const attachFn = useServerFn(attachCcmsDocument);
  const reviewFn = useServerFn(reviewCcmsDocument);
  const { data: vendors = [] } = useQuery({ queryKey: ["ccms-vendors"], queryFn: () => vendorsFn() });

  const [side, setSide] = useState<"vendor" | "client">("vendor");
  const [f, setF] = useState<any>({
    contract_type: "letter_of_award", entity: LSH_ENTITIES[1], vendor_id: "", counterparty_name: "",
    title: "", project: "", job_number: "", award_reference: "", value: "", currency: "MYR",
    start_date: "", end_date: "", scope_summary: "", personal_data_cross_border: false, requestor_department: "",
  });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<string | null>(null);

  const t = CONTRACT_TYPES[f.contract_type];
  const vendor = vendors.find((v: any) => v.id === f.vendor_id) ?? null;
  const valueNum = f.value === "" ? null : Number(f.value);
  const valueMyr = toMyr(valueNum, f.currency);
  // What the platform will do with this request, before it is sent.
  const preview = useMemo(() => {
    const flags = computeFlags({ contract_type: f.contract_type, value_myr: valueMyr, personal_data_cross_border: f.personal_data_cross_border,
      review: t?.templateId ? null : { nonStandard: true } }, side === "vendor" ? vendor : null);
    return { flags, route: buildRoute({ contract_type: f.contract_type, value_myr: valueMyr }, flags) };
  }, [f.contract_type, valueMyr, f.personal_data_cross_border, vendor, side, t?.templateId]);

  async function submit() {
    setPhase("Creating the request…");
    let contract: any;
    try {
      contract = await createFn({ data: {
        ...f, acting_role: role,
        vendor_id: side === "vendor" ? f.vendor_id || null : null,
        counterparty_name: side === "client" ? f.counterparty_name : null,
        value: valueNum, start_date: f.start_date || null, end_date: f.end_date || null,
      } });
    } catch (e: any) { toast.error(e?.message ?? "Could not create the request"); setPhase(null); return; }
    qc.invalidateQueries({ queryKey: ["ccms-contracts"] });
    // The request exists from here: a failed upload is reported, never retried
    // by sending the user back to the form (that would duplicate the request).
    if (file) {
      try {
        setPhase(`Uploading ${file.name}…`);
        const path = `ccms/${contract.id}/${Date.now()}-${file.name}`;
        const up = await supabase.storage.from("policies").upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
        if (up.error) throw new Error(up.error.message);
        const url = supabase.storage.from("policies").getPublicUrl(path).data.publicUrl;
        const doc = await attachFn({ data: { contract_id: contract.id, file_name: file.name, file_url: url, mime_type: file.type || null, size_bytes: file.size, doc_role: "draft", acting_role: role } });
        setPhase("AI is reviewing the draft…");
        await reviewFn({ data: { document_id: doc.id, acting_role: role } });
      } catch (e: any) { toast.error(`Request ${contract.reference_number} created, but the draft step failed: ${e?.message ?? e}`); }
    }
    nav({ to: "/ccms/$contractId", params: { contractId: contract.id } });
  }

  const types = Object.entries(CONTRACT_TYPES).filter(([, v]) => v.side === side);
  const tpl = templateById(t?.templateId);

  return (
    <AppShell>
      <CcmsHeader subtitle="New contract request" />
      <div className="p-6 bg-white min-h-full">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 max-w-6xl">
          <div className={CARD + " p-5 space-y-5"}>
            <div className="flex gap-2">
              {(["vendor", "client"] as const).map((s) => (
                <button key={s} onClick={() => { setSide(s); set("contract_type", s === "vendor" ? "letter_of_award" : "client_loa"); }}
                  className={"rounded-md border px-3 py-1.5 text-sm " + (side === s ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>
                  {s === "vendor" ? "Vendor contract (we award)" : "Client contract (we are awarded)"}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Contract type</label>
                <select className={INPUT} value={f.contract_type} onChange={(e) => set("contract_type", e.target.value)}>
                  {types.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                {tpl ? <p className="mt-1 text-sm text-gray-600">Approved template: {tpl.code} {tpl.title}</p>
                  : <p className="mt-1 text-sm text-amber-700">No approved template yet — the draft will be treated as non-standard.</p>}
              </div>
              <div>
                <label className={LABEL}>Contracting entity</label>
                <select className={INPUT} value={f.entity} onChange={(e) => set("entity", e.target.value)}>
                  {LSH_ENTITIES.map((e) => <option key={e}>{e}</option>)}
                </select>
              </div>
            </div>

            {side === "vendor" ? (
              <div>
                <label className={LABEL}>Vendor</label>
                <select className={INPUT} value={f.vendor_id} onChange={(e) => set("vendor_id", e.target.value)}>
                  <option value="">Select an approved vendor…</option>
                  {vendors.map((v: any) => (
                    <option key={v.id} value={v.id} disabled={v.status === "blacklisted"}>
                      {v.name}{v.status !== "approved" ? ` — ${v.status.replace("_", " ")}` : ""}{v.related_party ? " — related party" : ""}
                    </option>
                  ))}
                </select>
                {vendors.length === 0 && <p className="mt-1 text-sm text-gray-600">No vendors yet. <Link to="/ccms/vendors" className="text-blue-700 hover:underline">Add vendors</Link> first.</p>}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div><label className={LABEL}>Client</label><input className={INPUT} value={f.counterparty_name} onChange={(e) => set("counterparty_name", e.target.value)} /></div>
                <div><label className={LABEL}>Job number</label><input className={INPUT} value={f.job_number} onChange={(e) => set("job_number", e.target.value)} placeholder="From the Job Number Log" /></div>
              </div>
            )}

            <div><label className={LABEL}>Title</label><input className={INPUT} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Piling works — Block B, LSH 33" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={LABEL}>Project</label><input className={INPUT} value={f.project} onChange={(e) => set("project", e.target.value)} /></div>
              <div>
                <label className={LABEL}>Award reference {t?.needsAward && <span className="text-red-700">*</span>}</label>
                <input className={INPUT} value={f.award_reference} onChange={(e) => set("award_reference", e.target.value)} placeholder="Approval Form or Board resolution no." />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className={LABEL}>Value {f.contract_type !== "nda" && <span className="text-red-700">*</span>}</label>
                <input className={INPUT} type="number" min={0} value={f.value} onChange={(e) => set("value", e.target.value)} />
                {f.currency !== "MYR" && valueMyr != null && <p className="mt-1 text-sm text-gray-600">≈ {fmtMoney(valueMyr)} for the approval band</p>}
              </div>
              <div>
                <label className={LABEL}>Currency</label>
                <select className={INPUT} value={f.currency} onChange={(e) => set("currency", e.target.value)}>
                  {Object.keys(FX_TO_MYR).map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={LABEL}>Start date</label><input className={INPUT} type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} /></div>
              <div><label className={LABEL}>End date</label><input className={INPUT} type="date" value={f.end_date} onChange={(e) => set("end_date", e.target.value)} /></div>
            </div>
            <div><label className={LABEL}>Scope summary</label><textarea className={INPUT + " min-h-24"} value={f.scope_summary} onChange={(e) => set("scope_summary", e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className={LABEL}>Requesting department</label><input className={INPUT} value={f.requestor_department} onChange={(e) => set("requestor_department", e.target.value)} /></div>
              <label className="flex items-start gap-2 pt-6 text-sm text-gray-800">
                <input type="checkbox" className="mt-0.5" checked={f.personal_data_cross_border} onChange={(e) => set("personal_data_cross_border", e.target.checked)} />
                Personal data will be transferred outside Malaysia under this contract
              </label>
            </div>
            <div>
              <label className={LABEL}>Draft contract (optional now — can be added later)</label>
              <label className="flex items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-700 cursor-pointer hover:border-gray-500">
                <Upload className="size-4" /> {file ? file.name : "Choose a .docx or .pdf"}
                <input type="file" accept=".docx,.pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={submit} disabled={!!phase} className="gap-1.5">
                {phase ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} {phase ?? "Submit request"}
              </Button>
              <Link to="/ccms/contracts" className="text-sm text-gray-600 hover:underline">Cancel</Link>
            </div>
          </div>

          <aside className="space-y-4">
            <div className={CARD + " p-4"}>
              <h2 className="text-sm font-semibold text-gray-900">What happens next</h2>
              <p className="text-sm text-gray-600 mt-0.5">Set by the platform from the request. The requestor cannot clear a flag.</p>
              <div className="mt-3"><FlagChips flags={preview.flags} /></div>
              <ol className="mt-3 space-y-2">
                {preview.route.map((s, i) => (
                  <li key={s.key} className="text-sm">
                    <div className="font-medium text-gray-900">{i + 1}. {s.label} <span className="font-normal text-gray-500">· {s.kind === "review" ? "review" : "approval"} · {s.sla_days} working days</span></div>
                    <div className="text-gray-600">{s.reason}</div>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-gray-500">Approval bands, service levels and exchange rates are placeholders until Lim Seong Hai confirms its approval matrix.</p>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
