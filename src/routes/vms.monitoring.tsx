import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  assessVmsCoi, escalateVmsCoi, getVmsMonitor, recordVmsCoi, runVmsScan, startVmsCoiCampaign, uploadVmsRenewal, verifyVmsDocument,
} from "@/lib/vms.functions";
import { CcmsHeader, CARD, TH, TD, PRIORITY_TINT, friendlyError, useCcmsRole, uploadToStorage } from "@/components/ccms-widgets";
import { RememberedInput } from "@/components/ccms-actions";
import { remember } from "@/lib/ccms-prefill";
import { DOC_TYPES, coiDates, credentialAlerts, daysTo } from "@/lib/vms";
import { CCMS_ROLES, DEMO_SINGLE_USER, displayName, type CcmsRole } from "@/lib/ccms";
import { FileText, Loader2, Search, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vms/monitoring")({
  component: Monitoring,
  head: () => ({ meta: [{ title: "Vendor Management · Monitoring" }] }),
});

const INPUT = "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL = "block text-sm text-gray-700";

type Kind = "doc" | "verify" | "dd" | "condition" | "coi";
const KIND_LABEL: Record<Kind, string> = { doc: "Credential", verify: "Renewal to Verify", dd: "Due Diligence", condition: "Condition", coi: "COI Declaration" };
interface Row {
  key: string; kind: Kind; vendor_id: string; vendor: string; item: string;
  /** Days to the due date (negative = overdue); null when not date-driven. */
  days: number | null; status: string; rank: 1 | 2 | 3 | 5;
  action?: { label: string; role: CcmsRole }; record: any;
}

function Monitoring() {
  const [role, setRole] = useCcmsRole();
  const qc = useQueryClient();
  const monFn = useServerFn(getVmsMonitor);
  const scanFn = useServerFn(runVmsScan);
  const startFn = useServerFn(startVmsCoiCampaign);
  const escFn = useServerFn(escalateVmsCoi);
  const { data, isLoading } = useQuery({ queryKey: ["vms-monitor"], queryFn: () => monFn() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["vms-monitor"] });
  useEffect(() => { scanFn().then(() => refresh()).catch(() => {}); }, []);
  const [kind, setKind] = useState<"all" | Kind>("all");
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const year = new Date().getFullYear();

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const { vendors, documents, coi } = data as any;
    const vById = (id: string) => vendors.find((v: any) => v.id === id);
    const out: Row[] = [];
    for (const a of credentialAlerts(vendors, documents)) {
      const v = vById(a.vendor_id);
      const hold = !!v?.compliance_hold;
      const rank = a.days < 0 || hold ? 1 : a.days <= 30 ? 2 : 3;
      const status = a.days < 0 ? (hold ? "Lapsed · On Hold" : "Lapsed") : "Expiring";
      if (a.kind === "doc") out.push({ key: `doc-${a.doc_id}`, kind: "doc", vendor_id: a.vendor_id, vendor: a.vendor, item: a.item, days: a.days, status, rank, action: { label: "Upload Renewal", role: "purchasing_executive" }, record: { alert: a, vendor: v } });
      else if (a.kind === "dd") out.push({ key: `dd-${a.vendor_id}`, kind: "dd", vendor_id: a.vendor_id, vendor: a.vendor, item: "Due diligence", days: a.days, status, rank, action: { label: "Start Re-Due Diligence", role: "purchasing_executive" }, record: { alert: a, vendor: v } });
      else out.push({ key: `cond-${a.vendor_id}`, kind: "condition", vendor_id: a.vendor_id, vendor: a.vendor, item: v?.conditions?.text ?? "Conditional approval", days: a.days, status, rank, action: { label: "Open Request", role: "purchasing_executive" }, record: { alert: a, vendor: v } });
    }
    for (const d of documents.filter((x: any) => x.status === "uploaded" && !x.request_id)) {
      out.push({ key: `verify-${d.id}`, kind: "verify", vendor_id: d.vendor_id, vendor: vById(d.vendor_id)?.name ?? "—", item: DOC_TYPES.find((x) => x.id === d.doc_type)?.label ?? d.doc_type,
        days: null, status: "Pending Verification", rank: 2, action: { label: "Verify", role: "purchasing_executive" }, record: { doc: d, vendor: vById(d.vendor_id) } });
    }
    for (const c of coi.filter((x: any) => x.year === year)) {
      const days = c.status === "issued" ? daysTo(c.due_date) : null;
      const needsAssess = c.status === "submitted" && c.declared && !c.assessed_at;
      const rank = c.status === "escalated" || (days != null && days < 0) ? 1 : needsAssess || c.status === "issued" ? 2 : 5;
      const status = c.status === "escalated" ? "Escalated" : c.status === "issued" ? "Awaiting Declaration" : needsAssess ? "Interest Declared · To Assess" : c.declared ? "Interest Declared · Assessed" : "No Interest";
      const action = c.status === "issued" || c.status === "escalated" ? { label: "Register Declaration", role: "purchasing_executive" as CcmsRole }
        : needsAssess ? { label: "Assess", role: "compliance" as CcmsRole } : undefined;
      out.push({ key: `coi-${c.id}`, kind: "coi", vendor_id: c.vendor_id, vendor: vById(c.vendor_id)?.name ?? "—", item: `${year} declaration`, days, status, rank, action, record: { coi: c, vendor: vById(c.vendor_id) } });
    }
    return out.sort((a, b) => a.rank - b.rank || (a.days ?? 9999) - (b.days ?? 9999) || a.vendor.localeCompare(b.vendor));
  }, [data, year]);

  if (isLoading || !data) return <AppShell><div className="p-10 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div></AppShell>;
  const { coi } = data as any;
  const issued = coi.some((c: any) => c.year === year);
  const lateCoi = coi.some((c: any) => c.year === year && c.status === "issued" && daysTo(c.due_date) < 0);
  const openRows = rows.filter((r) => showDone || r.rank < 5);
  const shown = openRows.filter((r) => (kind === "all" || r.kind === kind) &&
    (!q.trim() || `${r.vendor} ${r.item}`.toLowerCase().includes(q.trim().toLowerCase())));
  const counts = (k: Kind) => openRows.filter((r) => r.kind === k).length;

  const act = (as: CcmsRole) => { if (DEMO_SINGLE_USER && role !== as) setRole(as); return DEMO_SINGLE_USER || role === as; };
  async function campaign(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); refresh(); } catch (e: any) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  }

  return (
    <AppShell>
      <CcmsHeader title="Vendor Management" subtitle="Monitoring"
        action={<div className="flex gap-2">
          {!issued && <Button size="sm" variant="outline" disabled={busy} onClick={() => act("purchasing_manager") && campaign(() => startFn({ data: { year, acting_role: "purchasing_manager" } }), "Declarations issued")}>Issue {year} COI Campaign</Button>}
          {lateCoi && <Button size="sm" variant="outline" disabled={busy} onClick={() => act("purchasing_manager") && campaign(() => escFn({ data: { year, acting_role: "purchasing_manager" } }), "Escalated")}>Escalate Non-Responders</Button>}
        </div>} />
      <div className="p-6 bg-white min-h-full">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "doc", "verify", "dd", "condition", "coi"] as const).filter((k) => k === "all" || counts(k) > 0).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={cn("rounded-md border px-3 py-1.5 text-sm", kind === k ? "border-gray-900 font-semibold text-gray-900" : "border-gray-200 text-gray-600 hover:border-gray-400")}>
                {k === "all" ? "All" : KIND_LABEL[k]} <span className="text-gray-500">{k === "all" ? openRows.length : counts(k)}</span>
              </button>
            ))}
            <label className="ml-2 flex items-center gap-1.5 text-sm text-gray-600"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show completed</label>
            <div className="ml-auto flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5">
              <Search className="size-4 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor or item" className="w-56 text-sm focus:outline-none" />
            </div>
          </div>

          <div className={CARD}>
            {shown.length === 0 ? <p className="p-6 text-sm text-gray-500">{!issued ? `Nothing outstanding. ${year} COI campaign not issued (due ${coiDates(year).due}).` : "Nothing outstanding."}</p> : (
              <table className="w-full">
                <thead><tr className="border-b border-gray-200">
                  <th className={TH}>Due</th><th className={TH}>Vendor</th><th className={TH}>Type</th><th className={TH}>Item</th><th className={TH}>Status</th><th className={TH}></th>
                </tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.key} onClick={() => setOpen(r)} className={cn("cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50/60", PRIORITY_TINT[r.rank])}>
                      <td className={TD + " w-28 whitespace-nowrap"}>{r.days == null ? "—" : <span className={cn("font-semibold", r.days < 0 ? "text-red-700" : r.days <= 30 ? "text-amber-700" : "text-gray-700")}>{r.days < 0 ? `${-r.days}d overdue` : `${r.days} days`}</span>}</td>
                      <td className={TD + " font-medium"}>{r.vendor}</td>
                      <td className={TD + " text-gray-700"}>{KIND_LABEL[r.kind]}</td>
                      <td className={TD}>{r.item}</td>
                      <td className={TD}><span className={cn(r.rank === 1 ? "text-red-800" : r.rank === 2 ? "text-amber-800" : "text-gray-600")}>{r.status}</span></td>
                      <td className={TD + " text-right"}>{r.action && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>{r.action.label}</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-gray-500">A lapsed mandatory credential or due diligence places the vendor on compliance hold: no new awards, purchase orders or renewals.</p>
        </div>
      </div>
      {open && <RecordDialog row={open} data={data} onClose={() => setOpen(null)} onDone={() => { setOpen(null); refresh(); }} act={act} />}
    </AppShell>
  );
}

/** The record behind a row — its documents, history and status — and the
 *  one action it needs. */
function RecordDialog({ row, data, onClose, onDone, act }: { row: Row; data: any; onClose: () => void; onDone: () => void; act: (r: CcmsRole) => boolean }) {
  const v = row.record.vendor;
  const docsOfType = (type?: string) => (data.documents as any[]).filter((d) => d.vendor_id === row.vendor_id && (!type || d.doc_type === type))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  useEffect(() => { if (row.action) act(row.action.role); }, [row.key]);
  const as = row.action?.role ?? "purchasing_executive";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl bg-white max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.vendor} · {row.item}</DialogTitle>
          <DialogDescription>{KIND_LABEL[row.kind]} · {row.status}{row.days != null ? ` · ${row.days < 0 ? `${-row.days} days overdue` : `due in ${row.days} days`}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-gray-200 p-3">
            <Field k="Vendor code" v={v?.vendor_code ?? "—"} />
            <Field k="Status" v={<>{v?.status ?? "—"}{v?.compliance_hold ? <span className="text-red-700"> · On hold</span> : ""}</>} />
            <Field k="Due diligence to" v={v?.dd_valid_until ?? "—"} />
            <Field k="Risk rating" v={v?.risk_rating ?? "—"} />
            {v?.hold_reason && <div className="col-span-2 text-red-700">{v.hold_reason}</div>}
          </div>

          {(row.kind === "doc" || row.kind === "verify") && (
            <div>
              <div className="mb-1 font-semibold text-gray-900">Document history</div>
              <DocHistory docs={docsOfType(row.kind === "doc" ? row.record.alert.doc_type : row.record.doc.doc_type)} />
            </div>
          )}
          {row.kind === "doc" && <RenewalForm row={row} as={as} onDone={onDone} />}
          {row.kind === "verify" && <VerifyForm doc={row.record.doc} as={as} onDone={onDone} />}
          {row.kind === "dd" && (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-gray-700">Due diligence valid to {v?.dd_valid_until}. A new vendor request re-runs screening, documents and approval.</p>
              <Button asChild onClick={() => act("purchasing_executive")}><Link to="/vms/new">Start Re-Due Diligence</Link></Button>
            </div>
          )}
          {row.kind === "condition" && (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-gray-700">{v?.conditions?.text ?? "Conditional approval"} · due {v?.conditions?.due}</p>
              <Button asChild variant="outline"><Link to="/vms/requests">Open Requests</Link></Button>
            </div>
          )}
          {row.kind === "coi" && <CoiForm row={row} as={as} onDone={onDone} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const Field = ({ k, v }: { k: string; v: React.ReactNode }) => <div><span className="text-gray-500">{k}</span> <span className="ml-1 text-gray-900">{v}</span></div>;

function DocHistory({ docs }: { docs: any[] }) {
  if (!docs.length) return <p className="text-gray-500">No documents on file.</p>;
  return (
    <table className="w-full"><tbody>
      {docs.map((d) => (
        <tr key={d.id} className="border-b border-gray-100 last:border-0">
          <td className="py-1.5 pr-2"><a href={d.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline"><FileText className="size-3.5" />{d.file_name}</a></td>
          <td className="py-1.5 pr-2 text-gray-700">{d.expiry_date ? `expires ${d.expiry_date}` : "—"}</td>
          <td className="py-1.5 text-right"><span className={cn("text-xs font-semibold", d.status === "verified" ? "text-emerald-700" : d.status === "superseded" ? "text-gray-500" : d.status === "rejected" ? "text-red-700" : "text-amber-700")}>{d.status}</span></td>
        </tr>
      ))}
    </tbody></table>
  );
}

function useRun(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); onDone(); } catch (e: any) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };
  return { busy, run };
}

/** Upload the renewed document and verify it with its new expiry in one step;
 *  the old one is kept as superseded and the hold lifts once all is current. */
function RenewalForm({ row, as, onDone }: { row: Row; as: CcmsRole; onDone: () => void }) {
  const renewFn = useServerFn(uploadVmsRenewal);
  const verifyFn = useServerFn(verifyVmsDocument);
  const { busy, run } = useRun(onDone);
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState("");
  const [ref, setRef] = useState("");
  return (
    <div className="space-y-3 rounded-md border border-gray-200 p-3">
      <div className="font-semibold text-gray-900">Upload Renewal</div>
      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-3 text-gray-700 hover:border-gray-500">
        {file ? <FileText className="size-4" /> : <Upload className="size-4" />} {file ? file.name : "Select file"}
        <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>New expiry<input type="date" className={INPUT} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
        <label className={LABEL}>Reference no.<input className={INPUT} value={ref} onChange={(e) => setRef(e.target.value)} /></label>
      </div>
      <Button disabled={busy || !file || !expiry} onClick={() => run(async () => {
        const url = await uploadToStorage(`vms/vendor/${row.vendor_id}`, file!);
        const doc: any = await renewFn({ data: { vendor_id: row.vendor_id, doc_type: row.record.alert.doc_type, file_name: file!.name, file_url: url, acting_role: as } });
        await verifyFn({ data: { document_id: doc.id ?? doc.document?.id, action: "verify", expiry_date: expiry, number: ref || null, acting_role: as } });
      }, "Renewal verified")}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Upload & Verify"}</Button>
    </div>
  );
}

function VerifyForm({ doc, as, onDone }: { doc: any; as: CcmsRole; onDone: () => void }) {
  const verifyFn = useServerFn(verifyVmsDocument);
  const { busy, run } = useRun(onDone);
  const [expiry, setExpiry] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="space-y-3 rounded-md border border-gray-200 p-3">
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL}>Expiry<input type="date" className={INPUT} value={expiry} onChange={(e) => setExpiry(e.target.value)} /></label>
        <label className={LABEL}>Note · required to reject<input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => run(() => verifyFn({ data: { document_id: doc.id, action: "verify", expiry_date: expiry || null, acting_role: as } }), "Verified")}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Verify"}</Button>
        <Button variant="outline" disabled={busy || !note.trim()} onClick={() => run(() => verifyFn({ data: { document_id: doc.id, action: "reject", note, acting_role: as } }), "Rejected")}>Reject</Button>
      </div>
    </div>
  );
}

function CoiForm({ row, as, onDone }: { row: Row; as: CcmsRole; onDone: () => void }) {
  const coiFn = useServerFn(recordVmsCoi);
  const assessFn = useServerFn(assessVmsCoi);
  const { busy, run } = useRun(onDone);
  const c = row.record.coi;
  const [f, setF] = useState({ declared: false, details: "", signatory: "", assessment: "", safeguards: "" });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-gray-200 p-3">
        <Field k="Issued" v={c.issued_date ?? coiDates(c.year).issue} />
        <Field k="Due" v={c.due_date} />
        {c.status === "submitted" && <>
          <Field k="Declared" v={c.declared ? <span className="text-red-700">Yes — {c.details}</span> : "No interest"} />
          <Field k="Signed by" v={c.signatory ?? "—"} />
          {c.assessed_at && <div className="col-span-2 text-gray-700">Assessed by {displayName(c.assessed_by)}: {c.assessment}{c.safeguards ? ` · safeguards: ${c.safeguards}` : ""}</div>}
        </>}
      </div>
      {(c.status === "issued" || c.status === "escalated") && (
        <div className="space-y-3 rounded-md border border-gray-200 p-3">
          <label className="flex items-center gap-2 text-gray-700"><input type="checkbox" checked={f.declared} onChange={(e) => setF({ ...f, declared: e.target.checked })} /> Interest declared</label>
          {f.declared && <label className={LABEL}>Person and relationship<input className={INPUT} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></label>}
          <label className={LABEL}>Signed by<RememberedInput field="coi_signatory" value={f.signatory} onChange={(v) => setF({ ...f, signatory: v })} /></label>
          <Button disabled={busy || f.signatory.trim().length < 2} onClick={() => run(async () => {
            await coiFn({ data: { coi_id: c.id, declared: f.declared, details: f.details || null, signatory: f.signatory, acting_role: as } });
            remember({ coi_signatory: f.signatory });
          }, "Declaration registered")}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Register Declaration"}</Button>
        </div>
      )}
      {c.status === "submitted" && c.declared && !c.assessed_at && (
        <div className="space-y-3 rounded-md border border-gray-200 p-3">
          <label className={LABEL}>Assessment<input className={INPUT} value={f.assessment} onChange={(e) => setF({ ...f, assessment: e.target.value })} /></label>
          <label className={LABEL}>Safeguards<input className={INPUT} value={f.safeguards} onChange={(e) => setF({ ...f, safeguards: e.target.value })} /></label>
          <Button disabled={busy || f.assessment.trim().length < 3} onClick={() => run(() => assessFn({ data: { coi_id: c.id, assessment: f.assessment, safeguards: f.safeguards || null, acting_role: as } }), "Assessed")}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Assess"}</Button>
        </div>
      )}
      {!DEMO_SINGLE_USER && row.action && <p className="text-xs text-gray-500">Action by {CCMS_ROLES[row.action.role]}.</p>}
    </div>
  );
}
