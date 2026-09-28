import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  attachCcmsDocument, createCcmsContract, generateCcmsDraft, listCcmsVendors, reviewCcmsDocument,
} from "@/lib/ccms.functions";
import { CcmsHeader, CARD, useCcmsRole, fmtMoney } from "@/components/ccms-widgets";
import { friendlyError } from "@/components/ccms-widgets";
import { TemplateFieldsForm } from "@/components/ccms-template-form";
import { FillButton } from "@/components/ccms-actions";
import { IntakeChat } from "@/components/ccms-intake-chat";
import { recallForm, rememberForm } from "@/lib/ccms-prefill";
import {
  CONTRACT_TYPES, LSH_ENTITIES, FX_TO_MYR, TEMPLATES, fillNda, particularsFromRecords, templateById, toMyr,
} from "@/lib/ccms";
import { Loader2, Upload, ArrowRight, Bot, ClipboardList } from "lucide-react";

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
  const generateFn = useServerFn(generateCcmsDraft);
  const { data: vendors = [] } = useQuery({ queryKey: ["ccms-vendors"], queryFn: () => vendorsFn() });

  const [side, setSide] = useState<"vendor" | "client">("vendor");
  const [f, setF] = useState<any>({
    contract_type: "letter_of_award", entity: LSH_ENTITIES[1], vendor_id: "", counterparty_name: "",
    title: "", project: "", job_number: "", award_reference: "", value: "", currency: "MYR",
    start_date: "", end_date: "", scope_summary: "", personal_data_cross_border: false, requestor_department: "",
  });
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));
  const [file, setFile] = useState<File | null>(null);
  // Generate the draft from the approved template, or upload the counterparty's own paper.
  const [draftMode, setDraftMode] = useState<"generate" | "upload">("generate");
  // The templates available for this contract type; the requester picks one.
  const [tplId, setTplId] = useState<string | null>(null);
  const [tf, setTf] = useState<Record<string, string>>({
    date: new Date().toISOString().slice(0, 10), direction: "Mutual", term: "Two (2) years",
    disputes: "Courts of Malaysia", stamp_duty: "Counterparty", non_solicit: "No", cp_form: "company", cp_country: "Malaysia",
  });
  const setT = (k: string, v: string) => setTf((p) => ({ ...p, [k]: v }));
  const [phase, setPhase] = useState<string | null>(null);
  const [intake, setIntake] = useState<"form" | "chat">("form");

  const t = CONTRACT_TYPES[f.contract_type];
  const vendor = vendors.find((v: any) => v.id === f.vendor_id) ?? null;
  // The particulars come from the records: the entity master for the Company,
  // the vendor record for the counterparty. What the record lacks is kept as typed.
  const fromRecords = (entity: string, v: any | null, prev: Record<string, string>) => {
    const r = particularsFromRecords(entity, v);
    return { ...prev, ...Object.fromEntries(Object.entries(r).filter(([, x]) => x)) };
  };
  useEffect(() => { if (vendor) setTf((p) => fromRecords(f.entity, vendor, p)); }, [vendor?.id]);
  useEffect(() => { setTf((p) => fromRecords(f.entity, null, p)); }, [f.entity]);
  // "Fill last used": the particulars go in after the entity and vendor effects
  // above have run, so they are not reset by them.
  const pendingTf = useRef<Record<string, string> | null>(null);
  const [fillTick, setFillTick] = useState(0);
  useEffect(() => {
    if (!pendingTf.current) return;
    const p = pendingTf.current; pendingTf.current = null;
    setTf((x) => ({ ...x, ...p }));
  }, [fillTick, f.entity, f.vendor_id]);
  function fillLast() {
    const snap = recallForm(`request:${f.contract_type}`);
    if (!snap) { toast.message("Nothing saved for this contract type yet — it is remembered after the first request."); return; }
    const { vendor_name, ...rest } = snap.f ?? {};
    const vid = vendors.find((v: any) => v.name === vendor_name)?.id;
    setF((p: any) => ({ ...p, ...rest, contract_type: p.contract_type, vendor_id: vid ?? p.vendor_id }));
    pendingTf.current = snap.tf ?? null;
    const avail = TEMPLATES.filter((x) => x.contractTypes.includes(f.contract_type));
    if (snap.tf && avail.length) { setDraftMode("generate"); setTplId(avail[0].id); }
    setFillTick((n) => n + 1);
  }
  const valueNum = f.value === "" ? null : Number(f.value);
  const valueMyr = toMyr(valueNum, f.currency);
  async function submit() {
    return submitWith({ f, tf, side, tpl, draftMode: mode, file, vendor });
  }
  /** Submit with explicit values — the AI Chat submits a proposal it has just
   *  applied, before the form state has re-rendered. */
  async function submitWith(x: { f: any; tf: Record<string, string>; side: "vendor" | "client"; tpl: any; draftMode: string; file: File | null; vendor: any }) {
    const { f, tf, side, tpl, draftMode, file, vendor } = x;
    const valueNum = f.value === "" || f.value == null ? null : Number(f.value);
    setPhase("Creating the request…");
    let contract: any;
    try {
      contract = await createFn({ data: {
        ...f, acting_role: role,
        vendor_id: side === "vendor" ? f.vendor_id || null : null,
        counterparty_name: side === "client" ? f.counterparty_name : null,
        value: valueNum, start_date: f.start_date || null, end_date: f.end_date || null,
      } });
    } catch (e: any) { toast.error(friendlyError(e)); setPhase(null); return; }
    qc.invalidateQueries({ queryKey: ["ccms-contracts"] });
    const { contract_type: _t, vendor_id: _v, ...remembered } = f;
    rememberForm(`request:${f.contract_type}`, { f: { ...remembered, vendor_name: vendor?.name ?? null }, tf });
    // The request exists from here: a failed upload is reported, never retried
    // by sending the user back to the form (that would duplicate the request).
    if (tpl && draftMode === "generate") {
      try {
        setPhase("Generating draft…");
        const r: any = await generateFn({ data: { contract_id: contract.id, acting_role: role,
          fields: { ...tf, purpose: tf.purpose || f.scope_summary } } });
        if (r.missing?.length) toast.message(`Draft generated with ${r.missing.length} particular(s) still blank.`);
      } catch (e: any) { toast.error(`Request ${contract.reference_number} created, but generating the draft failed: ${friendlyError(e)}`); }
    } else if (file) {
      try {
        setPhase(`Uploading ${file.name}…`);
        const path = `ccms/${contract.id}/${Date.now()}-${file.name}`;
        const up = await supabase.storage.from("policies").upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
        if (up.error) throw new Error(up.error.message);
        const url = supabase.storage.from("policies").getPublicUrl(path).data.publicUrl;
        const doc = await attachFn({ data: { contract_id: contract.id, file_name: file.name, file_url: url, mime_type: file.type || null, size_bytes: file.size, doc_role: "draft", acting_role: role } });
        setPhase("AI review in progress…");
        await reviewFn({ data: { document_id: doc.id, acting_role: role } });
      } catch (e: any) { toast.error(`Request ${contract.reference_number} created, but the draft step failed: ${friendlyError(e)}`); }
    }
    nav({ to: "/ccms/$contractId", params: { contractId: contract.id } });
  }

  /** The AI Chat's proposal, applied to the form — then reviewed, or submitted. */
  function applyDraft(d: any, submitNow: boolean) {
    const nextSide: "vendor" | "client" = d.side === "client" ? "client" : "vendor";
    const v = nextSide === "vendor" ? vendors.find((x: any) => x.name.toLowerCase() === String(d.vendor_name ?? "").toLowerCase()) ?? null : null;
    const nextF = { ...f, contract_type: d.contract_type, entity: d.entity, vendor_id: v?.id ?? "", counterparty_name: nextSide === "client" ? d.counterparty_name ?? "" : "",
      title: d.title ?? "", project: d.project ?? "", award_reference: d.award_reference ?? "", value: d.value ?? "", currency: d.currency || "MYR",
      start_date: d.start_date ?? "", end_date: d.end_date ?? "", scope_summary: d.scope_summary ?? "", requestor_department: d.requestor_department ?? "",
      personal_data_cross_border: !!d.personal_data_cross_border };
    const avail = TEMPLATES.filter((x) => x.contractTypes.includes(d.contract_type));
    const nextTpl = avail[0] ?? null;
    const p = d.particulars ?? {};
    const nextTf = fromRecords(d.entity, v, { ...tf, date: d.start_date || tf.date, purpose: p.purpose || d.scope_summary || "",
      ...(p.direction ? { direction: p.direction } : {}), ...(p.term ? { term: p.term } : {}) });
    setSide(nextSide); setF(nextF); setTf(nextTf);
    if (nextTpl) { setDraftMode("generate"); setTplId(nextTpl.id); }
    if (submitNow) {
      if (nextSide === "vendor" && !v) { toast.error(`${d.vendor_name ?? "The vendor"} is not on the vendor list.`); setIntake("form"); return; }
      submitWith({ f: nextF, tf: nextTf, side: nextSide, tpl: nextTpl, draftMode: nextTpl ? "generate" : "upload", file: null, vendor: v });
    } else setIntake("form");
  }

  const types = Object.entries(CONTRACT_TYPES).filter(([, v]) => v.side === side);
  const available = TEMPLATES.filter((x) => x.contractTypes.includes(f.contract_type));
  const mode = available.length ? draftMode : "upload";
  const tpl = mode === "generate" ? templateById(tplId) : undefined;

  return (
    <AppShell>
      <CcmsHeader subtitle="New contract request" />
      <div className="p-6 bg-white min-h-full">
        <div className="max-w-4xl space-y-3">
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5 w-fit">
            {([["form", "Form", ClipboardList], ["chat", "AI Chat", Bot]] as const).map(([k, l, Icon]) => (
              <button key={k} onClick={() => setIntake(k)} className={"flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm " + (intake === k ? "bg-gray-900 text-white" : "text-gray-600 hover:text-gray-900")}>
                <Icon className="size-4" /> {l}
              </button>
            ))}
          </div>
          {phase && intake === "chat" && <p className="flex items-center gap-2 text-sm text-gray-700"><Loader2 className="size-4 animate-spin" /> {phase}</p>}
          {intake === "chat" ? <IntakeChat onApply={applyDraft} /> : (
          <div className={CARD + " p-5 space-y-5"}>
            <div className="flex flex-wrap items-center gap-2">
              {(["vendor", "client"] as const).map((s) => (
                <button key={s} onClick={() => { setSide(s); set("contract_type", s === "vendor" ? "letter_of_award" : "client_loa"); }}
                  className={"rounded-md border px-3 py-1.5 text-sm " + (side === s ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>
                  {s === "vendor" ? "Vendor Contract" : "Client Contract"}
                </button>
              ))}
              <div className="ml-auto"><FillButton onClick={fillLast} /></div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL}>Contract type</label>
                <select className={INPUT} value={f.contract_type} onChange={(e) => { set("contract_type", e.target.value); setTplId(null); }}>
                  {types.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
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
              <label className={LABEL}>Draft</label>
              <div className="flex gap-2">
                {available.length > 0 && (
                  <button onClick={() => setDraftMode("generate")} className={"rounded-md border px-3 py-1.5 text-sm " + (mode === "generate" ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>Select Template</button>
                )}
                <button onClick={() => setDraftMode("upload")} className={"rounded-md border px-3 py-1.5 text-sm " + (mode === "upload" ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>Upload Draft</button>
              </div>
            </div>
            {mode === "generate" ? (
              <div className="rounded-md border border-gray-200 p-4 space-y-4">
                <div className="space-y-2">
                  {available.map((x) => (
                    <label key={x.id} className={"flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 " + (tplId === x.id ? "border-gray-900" : "border-gray-200 hover:border-gray-400")}>
                      <input type="radio" name="template" checked={tplId === x.id} onChange={() => setTplId(x.id)} />
                      <span className="text-sm font-medium text-gray-900">{x.code} · {x.title}</span>
                      <span className="ml-auto text-xs text-gray-500">v{x.version} · effective {x.effectiveDate}</span>
                    </label>
                  ))}
                </div>
                {tpl && (
                  <>
                    <TemplateFieldsForm values={tf} onChange={setT} fallbackPurpose={f.scope_summary} />
                    {(() => {
                      const miss = fillNda(f.entity, { ...tf, purpose: tf.purpose || f.scope_summary }).missing;
                      return miss.length
                        ? <p className="text-sm text-amber-700">Missing particulars: {miss.join("; ")}.</p>
                        : <p className="text-sm text-emerald-700">All particulars complete.</p>;
                    })()}
                  </>
                )}
              </div>
            ) : (
              <label className="flex items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-700 cursor-pointer hover:border-gray-500">
                <Upload className="size-4" /> {file ? file.name : "Select file (.docx or .pdf) · optional"}
                <input type="file" accept=".docx,.pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            )}
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={submit} disabled={!!phase} className="gap-1.5">
                {phase ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} {phase ?? "Submit Request"}
              </Button>
              <Link to="/ccms/contracts" className="text-sm text-gray-600 hover:underline">Cancel</Link>
            </div>
          </div>
          )}

        </div>
      </div>
    </AppShell>
  );
}
