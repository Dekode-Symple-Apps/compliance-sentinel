import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { listAmsAssets } from "@/lib/ams.functions";
import { CcmsHeader, CARD, TH, TD } from "@/components/ccms-widgets";
import { ASSET_CLASSES, ASSET_STATE_LABEL, assetCompliance, classById } from "@/lib/ams";
import { Plus, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ams/assets")({
  component: Register,
  head: () => ({ meta: [{ title: "Asset Monitoring · Register" }] }),
});

const tone = (s: string) => s === "hold" ? "border-red-300 text-red-800" : s === "overdue" ? "border-orange-300 text-orange-800" : s === "due_soon" ? "border-amber-300 text-amber-800" : "border-emerald-300 text-emerald-800";

function Register() {
  const listFn = useServerFn(listAmsAssets);
  const { data, isLoading } = useQuery({ queryKey: ["ams-assets"], queryFn: () => listFn() });
  const [cls, setCls] = useState("all");
  const [q, setQ] = useState("");
  const assets: any[] = data?.assets ?? [];
  const items: any[] = data?.items ?? [];
  const assigns: any[] = data?.assignments ?? [];
  const shown = useMemo(() => assets.filter((a) => (cls === "all" || a.asset_class === cls) && (!q.trim() || [a.asset_code, a.name, a.registration_no, a.serial_no, a.location].some((x) => String(x ?? "").toLowerCase().includes(q.toLowerCase())))), [assets, cls, q]);
  return (
    <AppShell>
      <CcmsHeader title="Asset Monitoring" subtitle="Asset register"
        action={<Button asChild className="gap-1.5"><Link to="/ams/new"><Plus className="size-4" /> Register asset</Link></Button>} />
      <div className="p-6 space-y-4 bg-white min-h-full">
        <div className="flex items-center gap-2">
          <select value={cls} onChange={(e) => setCls(e.target.value)} className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm"><option value="all">All classes</option>{ASSET_CLASSES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          <div className="ml-auto flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5"><Search className="size-4 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code, name, registration, serial, location" className="w-72 text-sm focus:outline-none" /></div>
        </div>
        <div className={CARD}>
          {isLoading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            : shown.length === 0 ? <p className="p-6 text-sm text-gray-500">No assets yet.</p> : (
              <table className="w-full">
                <thead><tr className="border-b border-gray-200"><th className={TH}>Asset</th><th className={TH}>Class</th><th className={TH}>Location</th><th className={TH}>Assigned to</th><th className={TH}>Compliance</th></tr></thead>
                <tbody>
                  {shown.map((a) => {
                    const c = assetCompliance(items.filter((i) => i.asset_id === a.id));
                    const who = assigns.find((x) => x.asset_id === a.id);
                    return (
                      <tr key={a.id} className="border-b border-gray-100 last:border-0">
                        <td className={TD}><Link to="/ams/$assetId" params={{ assetId: a.id }} className="font-medium text-blue-700 hover:underline">{a.asset_code}</Link><div className="text-sm text-gray-900">{a.name}</div><div className="text-sm text-gray-600">{[a.registration_no, a.serial_no].filter(Boolean).join(" · ")}{a.ownership === "rented" ? " · rented" : ""}</div></td>
                        <td className={TD}>{classById(a.asset_class)?.label}</td>
                        <td className={TD}>{a.location ?? "—"}</td>
                        <td className={TD}>{who?.driver?.name ?? "—"}</td>
                        <td className={TD}><span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", tone(c.state))}>{ASSET_STATE_LABEL[c.state]}</span>{c.reasons[0] && <div className="text-xs text-gray-600 mt-0.5">{c.reasons[0]}{c.reasons.length > 1 ? ` +${c.reasons.length - 1}` : ""}</div>}</td>
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
