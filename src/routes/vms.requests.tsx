import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { compareVmsVendors, listVmsRequests } from "@/lib/vms.functions";
import { CcmsHeader, CARD, TH, TD, PRIORITY_TINT, NoteText, friendlyError, useCcmsRole } from "@/components/ccms-widgets";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VENDOR_CATEGORIES, VMS_STATUS, requestMilestones, vmsPriority } from "@/lib/vms";
import { CCMS_ROLES } from "@/lib/ccms";
import { Plus, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vms/requests")({
  component: VmsRequests,
  head: () => ({ meta: [{ title: "Vendor Management · Requests" }] }),
});

function VmsRequests() {
  const listFn = useServerFn(listVmsRequests);
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ["vms-requests"], queryFn: () => listFn() });
  const compareFn = useServerFn(compareVmsVendors);
  const [role] = useCcmsRole();
  const [picked, setPicked] = useState<string[]>([]);
  const [cmp, setCmp] = useState<{ text: string; busy: boolean; saved?: boolean } | null>(null);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 5 ? p : [...p, id]));
  async function compare(save?: string) {
    setCmp((c) => ({ text: c?.text ?? "", busy: true }));
    try { const o: any = await compareFn({ data: { request_ids: picked, save: save ?? null, acting_role: role } }); setCmp({ text: o.text, busy: false, saved: o.saved }); if (o.saved) toast.success("Saved to each request's history"); }
    catch (e: any) { toast.error(friendlyError(e)); setCmp((c) => (c?.text ? { ...c, busy: false } : null)); }
  }
  return (
    <AppShell>
      <CcmsHeader title="Vendor Management" subtitle="Onboarding and pre-qualification requests"
        action={<Button asChild className="gap-1.5"><Link to="/vms/new"><Plus className="size-4" /> New request</Link></Button>} />
      <div className="p-6 bg-white min-h-full">
        {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
        {picked.length > 0 && (
          <div className="mb-3 flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            <span className="text-gray-700">{picked.length} selected{picked.length < 2 ? " — tick one more to compare" : ""}</span>
            {picked.length >= 2 && <Button size="sm" className="gap-1.5" onClick={() => compare()}><Sparkles className="size-4" /> Compare with AI</Button>}
            <button type="button" className="ml-auto text-gray-500 hover:underline" onClick={() => setPicked([])}>Clear</button>
          </div>
        )}
        <div className={CARD}>
          {isLoading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            : rows.length === 0 ? <p className="p-6 text-sm text-gray-500">No requests yet.</p> : (
              <table className="w-full">
                <thead><tr className="border-b border-gray-200"><th className={TH + " w-8"} title="Tick 2–5 to compare" /><th className={TH}>Reference</th><th className={TH}>Vendor</th><th className={TH}>Type</th><th className={TH}>Category</th><th className={TH}>Risk</th><th className={TH}>Status</th><th className={TH}>Needs</th></tr></thead>
                <tbody>
                  {[...rows].sort((a: any, b: any) => vmsPriority(a) - vmsPriority(b)).map((r: any) => {
                    // The list has no documents; "next" here is by stage only.
                    const next = requestMilestones(r, r.submitted_by_vendor_at ? [{ status: "uploaded" }] : []).next;
                    return (
                    <tr key={r.id} className={cn("border-b border-gray-100 last:border-0", vmsPriority(r) === 1 && PRIORITY_TINT[3])}>
                      <td className={TD}><input type="checkbox" aria-label={`Compare ${r.company_name}`} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} /></td>
                      <td className={TD}><Link to="/vms/$requestId" params={{ requestId: r.id }} className="font-medium text-blue-700 hover:underline">{r.reference_number}</Link></td>
                      <td className={TD}>{r.company_name}</td>
                      <td className={TD}>{r.kind === "subcontractor" ? "Subcontractor" : "Onboarding"}</td>
                      <td className={TD}>{VENDOR_CATEGORIES[r.category] ?? r.category}</td>
                      <td className={TD}>{r.screening?.rating ? <span className={cn(r.screening.rating === "high" ? "text-red-700 font-semibold" : r.screening.rating === "medium" ? "text-amber-700" : "text-gray-700")}>{r.screening.rating}</span> : "—"}</td>
                      <td className={TD}><span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", VMS_STATUS[r.status]?.tone)}>{VMS_STATUS[r.status]?.label ?? r.status}</span></td>
                      <td className={TD}>{next ? <><div className="text-gray-900">{next.text}</div><div className="text-xs text-gray-500">{next.role === "vendor" ? "Vendor" : (CCMS_ROLES as Record<string, string>)[next.role] ?? next.role}</div></> : <span className="text-gray-500">—</span>}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
      </div>
      <Dialog open={!!cmp} onOpenChange={(o) => !o && setCmp(null)}>
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader><DialogTitle>Shortlist comparison (draft)</DialogTitle>
            <DialogDescription>A first draft for your internal justification. The team decides; edit it before saving.</DialogDescription></DialogHeader>
          {cmp?.busy && !cmp.text ? <p className="flex items-center gap-2 text-sm text-gray-600"><Loader2 className="size-4 animate-spin" /> Comparing…</p> : cmp && (
            <div className="space-y-3">
              {cmp.saved ? <NoteText text={cmp.text} className="max-h-96 overflow-y-auto text-sm text-gray-800" />
                : <textarea className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" rows={14} value={cmp.text} onChange={(e) => setCmp({ ...cmp, text: e.target.value })} />}
              {!cmp.saved && <Button size="sm" disabled={cmp.busy || !cmp.text.trim()} onClick={() => compare(cmp.text)}>{cmp.busy ? <Loader2 className="size-4 animate-spin" /> : "Save to Each Request's History"}</Button>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
