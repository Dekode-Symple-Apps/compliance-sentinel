import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { listVmsRequests } from "@/lib/vms.functions";
import { CcmsHeader, CARD, TH, TD, PRIORITY_TINT } from "@/components/ccms-widgets";
import { VENDOR_CATEGORIES, VMS_STATUS, requestMilestones, vmsPriority } from "@/lib/vms";
import { CCMS_ROLES } from "@/lib/ccms";
import { Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vms/requests")({
  component: VmsRequests,
  head: () => ({ meta: [{ title: "Vendor Management · Requests" }] }),
});

function VmsRequests() {
  const listFn = useServerFn(listVmsRequests);
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: ["vms-requests"], queryFn: () => listFn() });
  return (
    <AppShell>
      <CcmsHeader title="Vendor Management" subtitle="Onboarding and pre-qualification requests"
        action={<Button asChild className="gap-1.5"><Link to="/vms/new"><Plus className="size-4" /> New request</Link></Button>} />
      <div className="p-6 bg-white min-h-full">
        {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
        <div className={CARD}>
          {isLoading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            : rows.length === 0 ? <p className="p-6 text-sm text-gray-500">No requests yet.</p> : (
              <table className="w-full">
                <thead><tr className="border-b border-gray-200"><th className={TH}>Reference</th><th className={TH}>Vendor</th><th className={TH}>Type</th><th className={TH}>Category</th><th className={TH}>Risk</th><th className={TH}>Status</th><th className={TH}>Needs</th></tr></thead>
                <tbody>
                  {[...rows].sort((a: any, b: any) => vmsPriority(a) - vmsPriority(b)).map((r: any) => {
                    // The list has no documents; "next" here is by stage only.
                    const next = requestMilestones(r, r.submitted_by_vendor_at ? [{ status: "uploaded" }] : []).next;
                    return (
                    <tr key={r.id} className={cn("border-b border-gray-100 last:border-0", vmsPriority(r) === 1 && PRIORITY_TINT[3])}>
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
    </AppShell>
  );
}
