import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Loader2, Palette, Upload, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SeverityIcon, friendlyError, uploadToStorage, AiDraftButton } from "@/components/ccms-widgets";
import { FillButton, RememberedInput, RememberedTextarea } from "@/components/ccms-actions";
import { recallForm, remember, rememberForm } from "@/lib/ccms-prefill";
import { createBrandSubmission, decideBrandSubmission, reviseBrandSubmission, draftBrandReturnNote } from "@/lib/brand.functions";
import {
  AGENCIES, BRAND_ROLES, CHANNELS, MATERIAL_TYPES, STATUS_META, VERDICT_LABEL, VERDICT_SHORT, boxToPixels,
  type BrandFinding, type BrandRole, type BrandStatus, type Verdict,
} from "@/lib/brand";
import type { BrandRule } from "@/lib/brand-guideline";
import { cn } from "@/lib/utils";

const INPUT = "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";
const LABEL = "block text-sm text-gray-700";
export const ACCEPT = ".pdf,.pptx,.ppt,.docx,.doc,.png,.jpg,.jpeg";

// ── persona (demo) ───────────────────────────────────────────────────────────
const ROLE_KEY = "brand-acting-role";
let roleListeners: Array<() => void> = [];
function readRole(): BrandRole {
  try { const v = window.localStorage.getItem(ROLE_KEY); return v === "ukas" ? "ukas" : "agency"; } catch { return "agency"; }
}
export function useBrandRole(): [BrandRole, (r: BrandRole) => void] {
  const [role, setRole] = useState<BrandRole>("agency");
  useEffect(() => {
    setRole(readRole());
    const l = () => setRole(readRole());
    roleListeners.push(l);
    return () => { roleListeners = roleListeners.filter((x) => x !== l); };
  }, []);
  return [role, (r) => { try { window.localStorage.setItem(ROLE_KEY, r); } catch { /* per-viewer only */ } roleListeners.forEach((l) => l()); }];
}
export function BrandActingAs() {
  const [role, setRole] = useBrandRole();
  return (
    <label className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm" title="For the demo: switch between the agency and the brand officer">
      <UserCog className="size-4 text-gray-500" />
      <span className="whitespace-nowrap text-gray-600">Demo view</span>
      <select value={role} onChange={(e) => setRole(e.target.value as BrandRole)} className="font-semibold bg-transparent focus:outline-none cursor-pointer">
        {(Object.keys(BRAND_ROLES) as BrandRole[]).map((r) => <option key={r} value={r}>{BRAND_ROLES[r]}</option>)}
      </select>
    </label>
  );
}

export function BrandHeader({ title, subtitle, action }: { title?: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="sticky top-14 z-10 flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-6 py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="size-8 rounded-lg border border-gray-200 grid place-items-center shrink-0"><Palette className="size-4 text-gray-700" /></div>
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-gray-900 truncate">{title ?? "Branding Compliance"}</h1>
          <p className="text-sm text-gray-600 truncate">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        <BrandActingAs />
        {action}
      </div>
    </div>
  );
}

export function BrandStatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status as BrandStatus] ?? { label: status, tone: "border-gray-200 bg-gray-50 text-gray-700" };
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", m.tone)}>{m.label}</span>;
}

export const VERDICT_TONE: Record<Verdict, string> = {
  red_flag: "border-red-200 bg-red-50 text-red-800", caution: "border-amber-200 bg-amber-50 text-amber-800", compliant: "border-emerald-200 bg-emerald-50 text-emerald-800",
};
/** The result in plain words — "Must fix", "Small fixes", "Ready" — with how
 *  many things to fix. No score: a number means nothing to the agency. */
export function ResultBadge({ verdict, count, long }: { verdict?: Verdict | null; count?: number; long?: boolean }) {
  if (!verdict) return <span className="text-sm text-gray-400">Not checked yet</span>;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-semibold", long ? "text-sm" : "text-xs", VERDICT_TONE[verdict])}>
      {long ? VERDICT_LABEL[verdict] : VERDICT_SHORT[verdict]}{verdict !== "compliant" && count ? <span className="font-normal">· {count}</span> : null}
    </span>
  );
}

/** Where a rule comes from: an official state rule (with its circular) or good practice. */
export function RuleSource({ rule }: { rule: BrandRule }) {
  const s = rule.source;
  if (s.kind === "official") return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs text-gray-600" title={s.note}>
      <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 font-medium text-indigo-800">Official rule</span>
      {s.url ? <a href={s.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-700 hover:underline">{s.ref}</a> : s.ref}
    </span>
  );
  return <span className="inline-flex items-center text-xs text-gray-500" title={s.note ?? "Good practice until UKAS publishes a full guideline."}><span className="rounded border border-gray-200 px-1.5">Good practice</span></span>;
}

function DropZone({ file, onFile }: { file: File | null; onFile: (f: File | null) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-700 hover:border-gray-500">
      {file ? <FileText className="size-4" /> : <Upload className="size-4" />} {file ? file.name : "Choose a file: PDF, PowerPoint, Word or an image"}
      <input type="file" accept={ACCEPT} className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  );
}

// ── new submission ───────────────────────────────────────────────────────────
export function NewSubmissionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const createFn = useServerFn(createBrandSubmission);
  const [, setRole] = useBrandRole();
  const blank = { agency: AGENCIES[2], title: "", material_type: "poster", channel: "digital" };
  const [f, setF] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { if (open) { setRole("agency"); setFile(null); } }, [open]);
  async function submit() {
    if (!file) return;
    try {
      setBusy("Uploading…");
      const url = await uploadToStorage("brand/uploads", file);
      setBusy("Sending…");
      const r: any = await createFn({ data: { ...f, file_name: file.name, file_url: url, mime: file.type || null } });
      rememberForm("brand:submission", f);
      qc.invalidateQueries({ queryKey: ["brand"] });
      onClose();
      nav({ to: "/brand/$reportId", params: { reportId: r.id } });
    } catch (e: any) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl bg-white">
        <DialogHeader><DialogTitle>Check a Design</DialogTitle><DialogDescription>Upload it and we check it against the Sarawak brand guide. It takes about a minute.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="flex justify-end"><FillButton onClick={() => { const s = recallForm("brand:submission"); if (s) setF({ ...blank, ...s }); else toast.message("Nothing saved yet. Your details are remembered after your first upload."); }} /></div>
          <label className={LABEL}>Agency
            <select className={INPUT} value={f.agency} onChange={(e) => setF({ ...f, agency: e.target.value })}>{AGENCIES.map((a) => <option key={a}>{a}</option>)}</select>
          </label>
          <label className={LABEL}>Name of the design<RememberedInput field="brand_title" value={f.title} onChange={(v) => setF({ ...f, title: v })} placeholder="e.g. Hari Terbuka JKR 2026 poster" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>What is it?
              <select className={INPUT} value={f.material_type} onChange={(e) => setF({ ...f, material_type: e.target.value })}>{Object.entries(MATERIAL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className={LABEL}>Where will it be used?
              <select className={INPUT} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
          </div>
          <DropZone file={file} onFile={setFile} />
          <div className="flex items-center gap-2 pt-1">
            <Button disabled={!!busy || !file || f.title.trim().length < 3} onClick={submit}>{busy ? <><Loader2 className="size-4 animate-spin" /> {busy}</> : "Check It"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── the officer's decision and the agency's revision ────────────────────────
export function DecisionDialog({ id, outcome, redFlags, onClose, onDone }: { id: string; outcome: "clear" | "return"; redFlags: number; onClose: () => void; onDone: () => void }) {
  const fn = useServerFn(decideBrandSubmission);
  const draftFn = useServerFn(draftBrandReturnNote);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const needNote = outcome === "return" || redFlags > 0;
  async function go() {
    setBusy(true);
    try {
      const r: any = await fn({ data: { id, outcome, note: note || null } });
      remember(outcome === "return" ? { brand_return_note: note } : { brand_clear_note: note });
      toast.success(outcome === "clear" ? `Approved. Approval no. ${r.clearance_ref}` : "Sent back to the agency");
      onClose(); onDone();
    } catch (e: any) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader><DialogTitle>{outcome === "clear" ? "Approve for Use" : "Send Back to the Agency"}</DialogTitle>
          <DialogDescription>{outcome === "clear" ? "The agency gets an approval number to quote." : "The agency fixes it and uploads a new version. We check it again."}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          {outcome === "clear" && redFlags > 0 && <p className="flex gap-1.5 text-sm text-red-800"><SeverityIcon severity="red_flag" className="mt-0.5" /> {redFlags} must-fix item{redFlags === 1 ? " is" : "s are"} still open. Say why you are approving it anyway.</p>}
          <label className={LABEL}>
            <span className="flex items-center gap-2"><span className="flex-1">{outcome === "clear" ? (redFlags ? "Why you are approving it anyway" : "Note (optional)") : "What to change"}</span>
              {outcome === "return" && <AiDraftButton label="Write It for Me" empty="Nothing to fix was found. Write the note yourself." run={() => draftFn({ data: { id } })} onText={setNote} />}</span>
            <RememberedTextarea field={outcome === "return" ? "brand_return_note" : "brand_clear_note"} value={note} onChange={setNote} />
          </label>
          <Button disabled={busy || (needNote && !note.trim())} onClick={go}>{busy ? <Loader2 className="size-4 animate-spin" /> : outcome === "clear" ? "Approve" : "Send Back"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RevisionDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const fn = useServerFn(reviseBrandSubmission);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadToStorage("brand/uploads", file);
      await fn({ data: { id, file_name: file.name, file_url: url, mime: file.type || null, note: note || null } });
      remember({ brand_revision_note: note });
      onClose(); onDone();
    } catch (e: any) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-white">
        <DialogHeader><DialogTitle>Upload a New Version</DialogTitle><DialogDescription>We check it again. Earlier versions are kept.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <DropZone file={file} onFile={setFile} />
          <label className={LABEL}>What did you change? (optional)<RememberedInput field="brand_revision_note" value={note} onChange={setNote} /></label>
          <Button disabled={busy || !file} onClick={go}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Upload and Check"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── image view with boxes (PNG / JPG submissions) ────────────────────────────
export function ImageBoxViewer({ url, findings, activeId, onSelect, numberOf }: { url: string; findings: BrandFinding[]; activeId: string | null; onSelect: (id: string) => void; numberOf: (f: BrandFinding) => number }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <div className="h-full overflow-auto bg-gray-100 p-6">
      <div className="relative mx-auto w-fit shadow">
        <img src={url} alt="Submission" className="block max-w-full" onLoad={(e) => setSize({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight })} />
        {size && findings.filter((f) => f.box).map((f) => {
          const p = boxToPixels(f.box!, size.w, size.h);
          const rgb = f.severity === "red_flag" ? "220,38,38" : f.severity === "caution" ? "217,119,6" : "2,132,199";
          const on = activeId === f.id;
          return (
            <button key={f.id} onClick={() => onSelect(f.id)} className="absolute rounded-[3px]"
              style={{ left: p.left, top: p.top, width: p.width, height: p.height, border: `${on ? 3 : 2}px solid rgba(${rgb},0.85)`, background: `rgba(${rgb},${on ? 0.16 : 0.06})`, boxShadow: on ? `0 0 0 4px rgba(${rgb},0.25)` : "none" }}>
              <span className="absolute -top-[18px] -left-[2px] whitespace-nowrap rounded-[3px] px-1.5 text-[11px] font-semibold leading-4 text-white" style={{ background: `rgba(${rgb},0.95)` }}>{numberOf(f)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
