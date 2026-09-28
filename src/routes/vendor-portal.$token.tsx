import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getVendorPortal, readVendorPortalDocuments, saveVendorPortal, uploadVendorPortalAuto, uploadVendorPortalDocument } from "@/lib/vms.functions";
import { PORTAL_FORMS } from "@/lib/vms";
import { Check, Clock, Files, Loader2, Sparkles, Star, TriangleAlert, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

// The vendor's own page: no account, reached from the invitation link. Every
// call carries the token; the server checks it and its 14-day expiry.
export const Route = createFileRoute("/vendor-portal/$token")({
  component: VendorPortal,
  head: () => ({ meta: [{ title: "Vendor registration" }] }),
});

const LABEL = "block text-sm font-medium text-gray-800 mb-1";
const INPUT = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";
const CARD = "rounded-lg border border-gray-200 bg-white";

function VendorPortal() {
  const { token } = Route.useParams();
  const getFn = useServerFn(getVendorPortal);
  const saveFn = useServerFn(saveVendorPortal);
  const uploadFn = useServerFn(uploadVendorPortalDocument);
  const autoFn = useServerFn(uploadVendorPortalAuto);
  const readFn = useServerFn(readVendorPortalDocuments);
  const [bulk, setBulk] = useState<{ name: string; state: "working" | "done" | "unknown" | "error"; label?: string; note?: string }[]>([]);
  const [drag, setDrag] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["vendor-portal", token], queryFn: () => getFn({ data: { token } }), retry: false });
  const [reg, setReg] = useState<any>({ directors: [{ name: "" }], project_references: ["", ""] });
  const [ab, setAb] = useState<any>({ answers: {} });
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const k: any = (data as any).known ?? {};
    setReg({ company_name: data.company, registration_no: k.registration_no || "", contact_name: k.contact_name || "", contact_email: k.contact_email || "",
      directors: [{ name: "" }], project_references: ["", ""], ...(data.register ?? {}) });
    setAb({ answers: {}, signed_date: new Date().toISOString().slice(0, 10), ...(data.abms ?? {}) });
  }, [data?.reference]);

  if (isLoading) return <Shell><p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</p></Shell>;
  if (error || !data) return <Shell><p className="text-sm text-red-700">{(error as Error)?.message ?? "This link is not valid."}</p></Shell>;
  const d: any = data;
  const r = (k: string, v: any) => setReg((p: any) => ({ ...p, [k]: v }));
  const a = (k: string, v: any) => setAb((p: any) => ({ ...p, [k]: v }));
  const have = new Set(d.documents.map((x: any) => x.doc_type));
  const uploads = d.required.filter((x: any) => !PORTAL_FORMS.has(x.id));

  async function upload(docType: string, file: File) {
    if (file.size > 3_000_000) { toast.error("Files up to 3 MB, please (scan at a lower resolution if needed)."); return; }
    setBusy(docType);
    try {
      const b64 = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] ?? ""); fr.onerror = rej; fr.readAsDataURL(file); });
      await uploadFn({ data: { token, doc_type: docType, file_name: file.name, mime_type: file.type || "application/octet-stream", base64: b64 } });
      toast.success("Uploaded"); refetch();
    } catch (e: any) { toast.error(e?.message ?? "Upload failed"); } finally { setBusy(null); }
  }
  const toB64 = (file: File) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] ?? ""); fr.onerror = rej; fr.readAsDataURL(file); });
  /** Several files at once: each is filed under the document it is. */
  async function uploadMany(all: File[]) {
    const files = all.filter((f) => f.size > 0 && /\.\w+$/.test(f.name)); // a dropped folder arrives as an empty entry
    if (!files.length) return;
    setBulk(files.map((f) => ({ name: f.name, state: "working" })));
    const put = (i: number, x: any) => setBulk((b) => b.map((y, j) => (j === i ? { ...y, ...x } : y)));
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 3_000_000) { put(i, { state: "error", note: "Over 3 MB" }); continue; }
      try {
        const res: any = await autoFn({ data: { token, file_name: file.name, mime_type: file.type || "application/octet-stream", base64: await toB64(file) } });
        if (res.doc_type) put(i, { state: "done", label: uploads.find((x: any) => x.id === res.doc_type)?.label ?? res.doc_type });
        else put(i, { state: "unknown", note: "Not one of the listed documents — upload it on its row below" });
      } catch (e: any) { put(i, { state: "error", note: e?.message ?? "Upload failed" }); }
    }
    refetch();
    await fillFromDocs(true);
  }
  /** Fill the register form from the uploaded documents — only empty fields. */
  async function fillFromDocs(quiet = false) {
    setBusy("read");
    try {
      const { fields, read } = await readFn({ data: { token } });
      if (!read.length) { if (!quiet) toast.message("Upload your SSM certificate, company profile or bank letter first."); return; }
      setReg((p: any) => {
        const next = { ...p };
        for (const [key, v] of Object.entries(fields)) {
          if (key === "contact_designation") continue;
          if (key === "directors") { if (!(p.directors ?? []).some((x: any) => x.name?.trim())) next.directors = v; continue; }
          if (!String(p[key] ?? "").trim()) next[key] = v;
        }
        return next;
      });
      setAb((p: any) => ({ ...p, signatory: p.signatory || fields.contact_name || reg.contact_name || "", designation: p.designation || fields.contact_designation || "" }));
      toast.success(`Filled from ${read.join(", ")} — please check each field.`);
    } catch (e: any) { if (!quiet) toast.error(e?.message ?? "Could not read the documents"); } finally { setBusy(null); }
  }
  async function save(submit: boolean) {
    setBusy(submit ? "submit" : "save");
    try { await saveFn({ data: { token, register: reg, abms: ab, submit } }); toast.success(submit ? "Submitted — thank you" : "Saved"); refetch(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(null); }
  }

  if (!d.open) return (
    <Shell ref_={d.reference} company={d.company}>
      <div className={CARD + " p-6 text-sm"}><Check className="size-6 text-emerald-600" /><p className="mt-2 font-semibold text-gray-900">Submission received.</p><p className="text-gray-600">We will contact you if anything else is needed.</p></div>
    </Shell>
  );

  return (
    <Shell ref_={d.reference} company={d.company}>
      {d.returnReason && <p className="rounded-md border border-orange-300 px-3 py-2 text-sm text-orange-800">Please correct: {d.returnReason}</p>}
      <p className="text-sm text-gray-600">Category: {d.categoryLabel}{d.entity ? ` · for ${d.entity}` : ""} · link valid to {String(d.expires ?? "").slice(0, 10)}</p>

      <section className={CARD + " p-5 space-y-3"}>
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-base font-semibold text-gray-900">1. Supplier register form</h2>
          <button type="button" disabled={!!busy} onClick={() => fillFromDocs()} className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline disabled:opacity-60"
            title="Reads your SSM certificate, company profile and bank letter (upload them in section 2)">
            {busy === "read" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} {busy === "read" ? "Reading…" : "Fill from Documents"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[["company_name", "Company name"], ["registration_no", "SSM registration no."], ["tin", "Tax identification no. (TIN)"], ["address", "Registered address"], ["contact_name", "Contact person"], ["contact_email", "Contact email"], ["contact_phone", "Contact phone"], ["bank_name", "Bank"], ["bank_account", "Bank account no."], ...(d.category === "subcontractor" ? [["cidb_grade", "CIDB grade and number"]] : [])].map(([k, l]) => (
            <div key={k}><label className={LABEL}>{l}</label><input className={INPUT} value={reg[k] ?? ""} onChange={(e) => r(k, e.target.value)} /></div>
          ))}
        </div>
        <div>
          <label className={LABEL}>Directors</label>
          {(reg.directors ?? []).map((x: any, i: number) => (
            <input key={i} className={INPUT + " mb-1"} placeholder={`Director ${i + 1} full name`} value={x.name} onChange={(e) => r("directors", reg.directors.map((y: any, j: number) => j === i ? { ...y, name: e.target.value } : y))} />
          ))}
          <button className="text-sm text-blue-700 hover:underline" onClick={() => r("directors", [...(reg.directors ?? []), { name: "" }])}>+ add director</button>
        </div>
        {d.category === "subcontractor" && (
          <div>
            <label className={LABEL}>Project references (at least two)</label>
            {(reg.project_references ?? ["", ""]).map((x: string, i: number) => (
              <input key={i} className={INPUT + " mb-1"} placeholder="Project, client, value, year" value={x} onChange={(e) => r("project_references", (reg.project_references ?? ["", ""]).map((y: string, j: number) => j === i ? e.target.value : y))} />
            ))}
          </div>
        )}
      </section>

      <section className={CARD + " p-5 space-y-2"}>
        <div className="flex items-baseline gap-3">
          <h2 className="text-base font-semibold text-gray-900">2. Documents</h2>
          <span className="text-sm text-gray-500">{uploads.filter((x: any) => x.level === "M" && have.has(x.id)).length} of {uploads.filter((x: any) => x.level === "M").length} mandatory uploaded</span>
          <span className="ml-auto flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Star className="size-3 fill-amber-400 text-amber-400" /> Mandatory</span>
            <span className="flex items-center gap-1"><Clock className="size-3 text-gray-400" /> Expiry tracked</span>
          </span>
        </div>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); uploadMany(Array.from(e.dataTransfer.files)); }}
          className={cn("flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-4 py-3 text-sm", drag ? "border-gray-900 bg-gray-50" : "border-gray-300 hover:border-gray-500")}>
          <Files className="size-5 text-gray-500" />
          <span className="flex-1"><span className="font-medium text-gray-900">Upload All at Once</span> <span className="text-gray-500">— drop your files here or choose several; each is filed under the right document.</span></span>
          <span className="rounded-md border border-gray-300 px-3 py-1.5 text-gray-900">Choose Files</span>
          <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.docx" className="hidden" onChange={(e) => { uploadMany(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        </label>
        {bulk.length > 0 && (
          <ul className="space-y-1 rounded-md bg-gray-50 px-3 py-2 text-sm">
            {bulk.map((b, i) => (
              <li key={i} className="flex items-center gap-2">
                {b.state === "working" ? <Loader2 className="size-4 animate-spin text-gray-500" /> : b.state === "done" ? <Check className="size-4 text-emerald-600" /> : <TriangleAlert className="size-4 text-amber-600" />}
                <span className="truncate text-gray-700">{b.name}</span>
                <span className="ml-auto shrink-0 text-gray-500">{b.state === "working" ? "Reading…" : b.state === "done" ? `→ ${b.label}` : b.note}</span>
              </li>
            ))}
          </ul>
        )}
        {[...uploads].sort((p: any, q: any) => Number(q.level === "M") - Number(p.level === "M")).map((x: any) => (
          <div key={x.id} className="flex flex-wrap items-center gap-3 border-b border-gray-100 py-1.5 last:border-0">
            <span className={cn("grid size-4 shrink-0 place-items-center rounded border", have.has(x.id) ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300")}>
              {have.has(x.id) && <Check className="size-3" strokeWidth={3} />}
            </span>
            <span className={cn("text-sm flex-1", x.level === "M" ? "text-gray-900" : "text-gray-600")}>{x.label}</span>
            {x.expires && <span title="Expiry tracked"><Clock className="size-3.5 text-gray-400" aria-label="Expiry tracked" /></span>}
            {x.level === "M"
              ? <span title="Mandatory"><Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="Mandatory" /></span>
              : <span className="w-20 text-right text-[11px] text-gray-400">{x.level === "C" ? "If relevant" : "Suggested"}</span>}
            <label className={cn("inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm cursor-pointer hover:border-gray-500", busy === x.id && "opacity-60 pointer-events-none")}>
              {busy === x.id ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {have.has(x.id) ? "Replace" : "Upload"}
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(x.id, f); e.target.value = ""; }} />
            </label>
          </div>
        ))}
      </section>

      <section className={CARD + " p-5 space-y-3"}>
        <h2 className="text-base font-semibold text-gray-900">3. Integrity forms</h2>
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm text-gray-600">ABMS-004 questionnaire. Answer every question.</p>
          <button type="button" className="text-sm text-blue-700 hover:underline" onClick={() => a("answers", Object.fromEntries(d.questions.map((q: any) => [q.id, "no"])))}>No to All</button>
        </div>
        {d.questions.map((q: any) => (
          <div key={q.id} className="flex items-start gap-3 text-sm">
            <span className="flex-1 text-gray-900">{q.text}</span>
            {(["no", "yes"] as const).map((v) => <label key={v} className="flex items-center gap-1"><input type="radio" name={q.id} checked={ab.answers?.[q.id] === v} onChange={() => a("answers", { ...(ab.answers ?? {}), [q.id]: v })} /> {v === "yes" ? "Yes" : "No"}</label>)}
          </div>
        ))}
        {Object.values(ab.answers ?? {}).includes("yes") && <textarea className={INPUT + " min-h-16"} placeholder="Please give details for each Yes" value={ab.details ?? ""} onChange={(e) => a("details", e.target.value)} />}
        <div className="text-sm space-y-1.5 pt-1">
          <div className="font-medium text-gray-900">ABMS-001 Declaration of interest</div>
          <label className="flex items-center gap-2"><input type="radio" checked={ab.declaration_interest === "none"} onChange={() => a("declaration_interest", "none")} /> We have no interest to declare with any director or employee of the group.</label>
          <label className="flex items-center gap-2"><input type="radio" checked={ab.declaration_interest === "declared"} onChange={() => a("declaration_interest", "declared")} /> We declare an interest:</label>
          {ab.declaration_interest === "declared" && <input className={INPUT} placeholder="Person and relationship" value={ab.interest_details ?? ""} onChange={(e) => a("interest_details", e.target.value)} />}
          <label className="flex items-center gap-2 pt-1"><input type="checkbox" checked={!!ab.pledge} onChange={(e) => a("pledge", e.target.checked)} /> ABMS-005: we give the Third Party Integrity Pledge and acknowledge the Anti-Bribery, Whistleblowing and Code of Conduct policies.</label>
          <div className="flex items-center gap-3 pt-1"><span>CTOS credit check consent:</span>
            <label className="flex items-center gap-1"><input type="radio" checked={ab.ctos_consent === "signed"} onChange={() => a("ctos_consent", "signed")} /> I consent</label>
            <label className="flex items-center gap-1"><input type="radio" checked={ab.ctos_consent === "declined"} onChange={() => a("ctos_consent", "declined")} /> I decline</label></div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!ab.pdpa} onChange={(e) => a("pdpa", e.target.checked)} /> We consent to our personal data being processed under the PDPA 2010 for this registration.</label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className={LABEL}>Signatory name</label><input className={INPUT} value={ab.signatory ?? ""} onChange={(e) => a("signatory", e.target.value)} /></div>
          <div><label className={LABEL}>Designation</label><input className={INPUT} value={ab.designation ?? ""} onChange={(e) => a("designation", e.target.value)} /></div>
          <div><label className={LABEL}>Date</label><input type="date" className={INPUT} value={ab.signed_date ?? ""} onChange={(e) => a("signed_date", e.target.value)} /></div>
        </div>
      </section>

      <div className="flex gap-2">
        <Button variant="outline" disabled={!!busy} onClick={() => save(false)}>{busy === "save" ? <Loader2 className="size-4 animate-spin" /> : "Save draft"}</Button>
        <Button disabled={!!busy} onClick={() => save(true)}>{busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : "Submit registration"}</Button>
      </div>
    </Shell>
  );
}

function Shell({ children, ref_, company }: { children: React.ReactNode; ref_?: string; company?: string }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-base font-semibold text-gray-900">Vendor registration{company ? ` — ${company}` : ""}</div>
          {ref_ && <div className="text-sm text-gray-600">Reference {ref_}</div>}
        </div>
      </header>
      <main className="max-w-4xl mx-auto p-6 space-y-5">{children}</main>
    </div>
  );
}
