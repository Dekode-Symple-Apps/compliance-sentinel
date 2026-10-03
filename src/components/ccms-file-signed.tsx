import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { classifyCcmsSigned, fileCcmsSigned } from "@/lib/ccms.functions";
import { friendlyError, uploadToStorage, useCcmsRole } from "@/components/ccms-widgets";
import { CONTRACT_TYPES, DEMO_SINGLE_USER, LSH_ENTITIES, entityShort, projectOf } from "@/lib/ccms";
import { FileUp, Loader2, Sparkles } from "lucide-react";

// File a signed document (29 Sep review): the AI reads it and proposes the
// company, project and type; the person confirms the folder; it is filed as an
// active contract with its obligations. Stands in for email intake for now.

const INPUT = "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL = "block text-sm text-gray-700";

export function FileSignedButton({ contracts }: { contracts: any[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="gap-1.5" onClick={() => setOpen(true)}><FileUp className="size-4" /> File a Signed Document</Button>
      {open && <FileSignedDialog contracts={contracts} onClose={() => setOpen(false)} />}
    </>
  );
}

function FileSignedDialog({ contracts, onClose }: { contracts: any[]; onClose: () => void }) {
  const classifyFn = useServerFn(classifyCcmsSigned);
  const fileFn = useServerFn(fileCcmsSigned);
  const [role, setRole] = useCcmsRole();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [file, setFile] = useState<{ name: string; url: string; mime: string } | null>(null);
  const [p, setP] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const set = (k: string, v: any) => setP((x: any) => ({ ...x, [k]: v }));
  const projects = [...new Set(contracts.filter((c) => c.entity === p?.entity).map(projectOf).filter(Boolean))].sort() as string[];

  async function read(f: File) {
    setBusy("Reading the document…");
    try {
      const url = await uploadToStorage("ccms/filed", f);
      const meta = { name: f.name, url, mime: f.type || (f.name.endsWith(".pdf") ? "application/pdf" : "") };
      setFile(meta);
      const o: any = await classifyFn({ data: { file_name: meta.name, file_url: meta.url, mime_type: meta.mime || null } });
      setP(o);
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  }
  async function go() {
    if (!file || !p) return;
    setBusy("Filing…");
    try {
      const acting = ["contract_executive", "legal", "contract_manager", "requestor"].includes(role) ? role : "contract_executive";
      if (acting !== role && DEMO_SINGLE_USER) setRole(acting as any);
      const r: any = await fileFn({ data: {
        file_name: file.name, file_url: file.url, mime_type: file.mime || null, contract_type: p.contract_type, entity: p.entity, project: p.project || null,
        counterparty_name: p.counterparty_name, title: p.title, signed_date: p.signed_date || null, value: p.value ?? null, currency: p.currency || "MYR",
        start_date: p.start_date || null, end_date: p.end_date || null, notice_period: p.notice_period, renewal: p.renewal, governing_law: p.governing_law,
        parties: p.parties, obligations: p.obligations, acting_role: acting as any,
      } });
      toast.success(`Filed as ${r.reference_number} in ${entityShort(p.entity)} › ${p.project || "General"}`);
      qc.invalidateQueries({ queryKey: ["ccms-contracts"] });
      onClose();
      nav({ to: "/ccms/$contractId", params: { contractId: r.id } });
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl bg-white max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>File a signed document</DialogTitle>
          <DialogDescription>A signed contract, tenancy, loan agreement or insurance policy. The AI reads it and proposes where it goes; you confirm.</DialogDescription></DialogHeader>
        {!p ? (
          <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-gray-300 px-4 py-6 text-sm hover:border-gray-500">
            {busy ? <Loader2 className="size-5 animate-spin text-gray-500" /> : <FileUp className="size-5 text-gray-500" />}
            <span className="flex-1">{busy ?? "Choose the signed document (PDF or Word)"}</span>
            <input type="file" accept=".pdf,.docx,.doc" className="hidden" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
          </label>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md bg-violet-50/60 px-3 py-2 text-sm text-violet-900"><Sparkles className="mt-0.5 size-4 shrink-0" /><span>Proposed folder: <b>{p.entity ? entityShort(p.entity) : "—"} › {p.project || "General"}</b>{p.why ? ` — ${p.why}` : ""}. Check it and the details, then file.</span></div>
            <div className="grid grid-cols-2 gap-3">
              <label className={LABEL}>Company<select className={INPUT} value={p.entity} onChange={(e) => set("entity", e.target.value)}><option value="">Choose…</option>{LSH_ENTITIES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
              <label className={LABEL}>Project<input className={INPUT} list="file-projects" value={p.project} onChange={(e) => set("project", e.target.value)} placeholder="Blank = General" />
                <datalist id="file-projects">{projects.map((x) => <option key={x} value={x} />)}</datalist></label>
              <label className={LABEL}>Type<select className={INPUT} value={p.contract_type} onChange={(e) => set("contract_type", e.target.value)}>{Object.entries(CONTRACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
              <label className={LABEL}>Counterparty<input className={INPUT} value={p.counterparty_name} onChange={(e) => set("counterparty_name", e.target.value)} /></label>
              <label className={LABEL + " col-span-2"}>Title<input className={INPUT} value={p.title} onChange={(e) => set("title", e.target.value)} /></label>
              <label className={LABEL}>Signed<input type="date" className={INPUT} value={p.signed_date || ""} onChange={(e) => set("signed_date", e.target.value)} /></label>
              <label className={LABEL}>Value ({p.currency || "MYR"})<input className={INPUT} value={p.value ?? ""} onChange={(e) => set("value", e.target.value === "" ? null : Number(e.target.value.replace(/,/g, "")) || null)} /></label>
              <label className={LABEL}>Start<input type="date" className={INPUT} value={p.start_date || ""} onChange={(e) => set("start_date", e.target.value)} /></label>
              <label className={LABEL}>Expiry / end <span className="text-red-700">*</span><input type="date" className={INPUT} value={p.end_date || ""} onChange={(e) => set("end_date", e.target.value)} /></label>
            </div>
            {p.obligations?.length > 0 && <p className="text-sm text-gray-600">{p.obligations.length} obligation{p.obligations.length === 1 ? "" : "s"} read from it, plus a renewal decision 30 days before expiry. Edit them after filing.</p>}
            <div className="flex gap-2">
              <Button disabled={!!busy || !p.entity || !p.end_date || !p.counterparty_name} onClick={go}>{busy ? <><Loader2 className="size-4 animate-spin" /> {busy}</> : `File to ${p.entity ? entityShort(p.entity) : "…"} › ${p.project || "General"}`}</Button>
              <Button variant="outline" disabled={!!busy} onClick={() => { setP(null); setFile(null); }}>Choose Another File</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
