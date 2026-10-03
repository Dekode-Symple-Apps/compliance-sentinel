import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { actCcmsFinding, listCcmsFindings, saveCcmsFinding } from "@/lib/ccms.functions";
import { CARD, TH, TD, NoteText, friendlyError, uploadToStorage } from "@/components/ccms-widgets";
import { DEMO_PEOPLE, LSH_ENTITIES, daysBetween, displayName, entityShort } from "@/lib/ccms";
import { Download, FileText, Loader2, Plus, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

// Internal audit findings (29 Sep review): each finding has an owner, an action
// plan, evidence and a due date, and is tracked to resolution. Overdue findings
// are flagged and can be escalated to the head of department. Reminders by
// email are not built yet; everything shows in the app.

const INPUT = "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL = "block text-sm text-gray-700";
const STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Open", tone: "border-red-200 bg-red-50 text-red-800" },
  in_progress: { label: "In progress", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  resolved: { label: "Resolved", tone: "border-emerald-200 bg-emerald-50 text-emerald-800" },
};
const dueText = (f: any) => {
  if (f.status === "resolved") return { text: `Resolved ${String(f.resolved_at ?? "").slice(0, 10)}`, tone: "text-emerald-700" };
  if (!f.due_date) return { text: "No due date", tone: "text-gray-500" };
  const d = daysBetween(new Date(), f.due_date);
  return { text: d < 0 ? `${-d} days overdue` : d === 0 ? "Due today" : `Due in ${d} days`, tone: d < 0 ? "font-semibold text-red-700" : d <= 14 ? "font-semibold text-amber-700" : "text-gray-700" };
};

export function AuditFindings() {
  const listFn = useServerFn(listCcmsFindings);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["ccms-findings"], queryFn: () => listFn() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["ccms-findings"] });
  const [edit, setEdit] = useState<any | null>(null);
  const [open, setOpen] = useState<any | null>(null);
  const [show, setShow] = useState<"open" | "resolved" | "all">("open");
  const findings: any[] = data?.findings ?? [];
  const shown = findings.filter((f) => show === "all" || (show === "resolved" ? f.status === "resolved" : f.status !== "resolved"))
    .sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")));
  const overdue = findings.filter((f) => f.status !== "resolved" && f.due_date && daysBetween(new Date(), f.due_date) < 0).length;

  function report() {
    const rows = findings.map((f) => ({
      Ref: f.ref, Finding: f.title, Description: f.description ?? "", Company: f.entity ? entityShort(f.entity) : "", Project: f.project ?? "",
      Owner: f.owner_name ?? "", "Head of department": f.hod_name ?? "", "Action plan": f.action_plan ?? "", "Due date": f.due_date ?? "",
      Status: STATUS[f.status]?.label ?? f.status, Escalated: f.escalated_at ? String(f.escalated_at).slice(0, 10) : "", Resolved: f.resolved_at ? String(f.resolved_at).slice(0, 10) : "",
      Evidence: (f.evidence ?? []).map((e: any) => e.name).join("; "), History: (f.events ?? []).map((e: any) => `${String(e.at).slice(0, 10)} ${displayName(e.by)}: ${e.detail}`).join("\n"),
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Findings");
    XLSX.writeFile(wb, `Internal audit findings ${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  if (isLoading) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="size-4 animate-spin" /> Loading…</p>;
  if (data?.missing) return <div className={CARD + " p-6 text-sm text-gray-600"}>Run the database update (20261003_lsh_feedback.sql) to start tracking audit findings.</div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["open", "resolved", "all"] as const).map((k) => (
          <button key={k} onClick={() => setShow(k)} className={cn("rounded-md border px-3 py-1.5 text-sm", show === k ? "border-gray-900 font-semibold" : "border-gray-200 text-gray-600")}>
            {k === "open" ? "Open" : k === "resolved" ? "Resolved" : "All"} <span className="text-gray-500">{findings.filter((f) => k === "all" || (k === "resolved" ? f.status === "resolved" : f.status !== "resolved")).length}</span>
          </button>
        ))}
        {overdue > 0 && <span className="text-sm font-semibold text-red-700">{overdue} overdue</span>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!findings.length} onClick={report}><Download className="size-4" /> Findings Report</Button>
          <Button size="sm" className="gap-1.5" onClick={() => setEdit({})}><Plus className="size-4" /> Raise Finding</Button>
        </div>
      </div>
      <div className={CARD}>
        {shown.length === 0 ? <p className="p-6 text-sm text-gray-500">{findings.length ? "Nothing here." : "No audit findings yet. Raise one from the last internal audit report."}</p> : (
          <table className="w-full">
            <thead><tr className="border-b border-gray-200"><th className={TH}>Finding</th><th className={TH}>Company · project</th><th className={TH}>Owner</th><th className={TH}>Due</th><th className={TH}>Status</th></tr></thead>
            <tbody>
              {shown.map((f) => {
                const d = dueText(f);
                return (
                  <tr key={f.id} onClick={() => setOpen(f)} className={cn("cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50/60", d.tone.includes("red") && "bg-red-50/40")}>
                    <td className={TD}><div className="font-medium text-gray-900">{f.ref} · {f.title}</div>{f.action_plan && <div className="line-clamp-1 text-sm text-gray-600">Plan: {f.action_plan}</div>}</td>
                    <td className={TD}>{f.entity ? entityShort(f.entity) : "—"}{f.project && <div className="text-sm text-gray-600">{f.project}</div>}</td>
                    <td className={TD}>{f.owner_name ?? "—"}{f.escalated_at && f.status !== "resolved" && <div className="text-xs text-red-700">Escalated to {f.hod_name || "HOD"}</div>}</td>
                    <td className={TD}><span className={d.tone}>{d.text}</span>{f.due_date && f.status !== "resolved" && <div className="text-xs text-gray-500">{f.due_date}</div>}</td>
                    <td className={TD}><span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", STATUS[f.status]?.tone)}>{STATUS[f.status]?.label ?? f.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {edit && <FindingForm f={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); refresh(); }} />}
      {open && <FindingDetail f={findings.find((x) => x.id === open.id) ?? open} onEdit={() => { setEdit(open); setOpen(null); }} onClose={() => setOpen(null)} onDone={refresh} />}
    </div>
  );
}

function FindingForm({ f, onClose, onDone }: { f: any; onClose: () => void; onDone: () => void }) {
  const fn = useServerFn(saveCcmsFinding);
  const [v, setV] = useState<any>({ title: "", description: "", entity: LSH_ENTITIES[0], project: "", owner_name: "", hod_name: "", action_plan: "", due_date: "", ...f });
  const [busy, setBusy] = useState(false);
  const set = (k: string, x: any) => setV((p: any) => ({ ...p, [k]: x }));
  async function go() {
    setBusy(true);
    try { await fn({ data: { id: f.id ?? null, title: v.title, description: v.description || null, entity: v.entity || null, project: v.project || null, owner_name: v.owner_name || null, hod_name: v.hod_name || null, action_plan: v.action_plan || null, due_date: v.due_date || null } }); toast.success(f.id ? "Saved" : "Finding raised"); onDone(); }
    catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl bg-white">
        <DialogHeader><DialogTitle>{f.id ? `Edit ${f.ref}` : "Raise an audit finding"}</DialogTitle><DialogDescription>From the internal audit report: what was found, who fixes it, and by when.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <datalist id="af-people">{DEMO_PEOPLE.map((p) => <option key={p.name} value={p.name} />)}</datalist>
          <label className={LABEL}>Finding<input className={INPUT} value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Contracts signed without stamp duty paid" /></label>
          <label className={LABEL}>Details<textarea className={INPUT} rows={2} value={v.description ?? ""} onChange={(e) => set("description", e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>Company<select className={INPUT} value={v.entity ?? ""} onChange={(e) => set("entity", e.target.value)}>{LSH_ENTITIES.map((x) => <option key={x} value={x}>{entityShort(x)}</option>)}</select></label>
            <label className={LABEL}>Project (optional)<input className={INPUT} value={v.project ?? ""} onChange={(e) => set("project", e.target.value)} /></label>
            <label className={LABEL}>Owner<input className={INPUT} list="af-people" value={v.owner_name ?? ""} onChange={(e) => set("owner_name", e.target.value)} /></label>
            <label className={LABEL}>Head of department<input className={INPUT} list="af-people" value={v.hod_name ?? ""} onChange={(e) => set("hod_name", e.target.value)} /></label>
          </div>
          <label className={LABEL}>Action plan<textarea className={INPUT} rows={2} value={v.action_plan ?? ""} onChange={(e) => set("action_plan", e.target.value)} placeholder="What the owner will do to fix it" /></label>
          <label className={LABEL}>Due date<input type="date" className={INPUT + " w-48"} value={v.due_date ?? ""} onChange={(e) => set("due_date", e.target.value)} /></label>
          <Button disabled={busy || v.title.trim().length < 3} onClick={go}>{busy ? <Loader2 className="size-4 animate-spin" /> : f.id ? "Save" : "Raise Finding"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FindingDetail({ f, onEdit, onClose, onDone }: { f: any; onEdit: () => void; onClose: () => void; onDone: () => void }) {
  const fn = useServerFn(actCcmsFinding);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const d = dueText(f);
  async function act(action: "escalate" | "resolve" | "reopen" | "progress", ok: string) {
    setBusy(action);
    try { await fn({ data: { id: f.id, action, note: note || null } }); setNote(""); toast.success(ok); onDone(); }
    catch (e) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  }
  async function attach(file: File) {
    setBusy("evidence");
    try { const url = await uploadToStorage(`ccms/findings/${f.id}`, file); await fn({ data: { id: f.id, action: "evidence", evidence: { name: file.name, url } } }); toast.success("Evidence added"); onDone(); }
    catch (e) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl bg-white max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{f.ref} · {f.title}</DialogTitle>
          <DialogDescription>{STATUS[f.status]?.label} · <span className={d.tone}>{d.text}</span>{f.entity ? ` · ${entityShort(f.entity)}` : ""}{f.project ? ` · ${f.project}` : ""}</DialogDescription></DialogHeader>
        <div className="space-y-3 text-sm">
          {f.description && <NoteText text={f.description} className="text-gray-800" />}
          <div className="grid grid-cols-2 gap-2 rounded-md border border-gray-200 p-3">
            <div><span className="text-gray-500">Owner</span> {f.owner_name ?? "—"}</div><div><span className="text-gray-500">Head of department</span> {f.hod_name ?? "—"}</div>
            <div className="col-span-2"><span className="text-gray-500">Action plan</span> {f.action_plan ?? <span className="text-amber-700">not set</span>}</div>
            {f.escalated_at && <div className="col-span-2 text-red-700">Escalated {String(f.escalated_at).slice(0, 10)}</div>}
          </div>
          <div>
            <div className="mb-1 font-semibold text-gray-900">Evidence</div>
            {(f.evidence ?? []).length === 0 ? <p className="text-gray-500">None yet.</p> : (f.evidence ?? []).map((e: any, i: number) => (
              <a key={i} href={e.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-blue-700 hover:underline"><FileText className="size-4" />{e.name}<span className="text-xs text-gray-500">· {displayName(e.by)} {String(e.at).slice(0, 10)}</span></a>
            ))}
            {f.status !== "resolved" && (
              <label className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 hover:border-gray-500">
                {busy === "evidence" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Attach Evidence
                <input type="file" className="hidden" onChange={(e) => { const x = e.target.files?.[0]; if (x) attach(x); e.target.value = ""; }} />
              </label>
            )}
          </div>
          <div>
            <div className="mb-1 font-semibold text-gray-900">History</div>
            {[...(f.events ?? [])].reverse().map((e: any, i: number) => <div key={i} className="border-b border-gray-100 py-1 last:border-0"><span className="text-xs text-gray-500">{String(e.at).slice(0, 10)} · {displayName(e.by)}</span> <span className="text-gray-900">{e.detail}</span></div>)}
          </div>
          <textarea className={INPUT} rows={2} placeholder={f.status === "resolved" ? "Why it is being reopened" : "Note: progress, how it was resolved, or why it is escalated"} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {f.status === "resolved" ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act("reopen", "Reopened")}>Reopen</Button> : (
              <>
                <Button size="sm" disabled={!!busy} onClick={() => act("resolve", "Resolved")}>Mark Resolved</Button>
                <Button size="sm" variant="outline" disabled={!!busy || !note.trim()} onClick={() => act("progress", "Progress noted")}>Add Progress Note</Button>
                <Button size="sm" variant="outline" className="text-red-700" disabled={!!busy} onClick={() => act("escalate", "Escalated")}>Escalate to {f.hod_name || "HOD"}</Button>
                <Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
