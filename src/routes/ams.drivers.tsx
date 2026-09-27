import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listAmsDrivers, saveAmsDriver } from "@/lib/ams.functions";
import { CcmsHeader, CARD, TH, TD, useCcmsRole } from "@/components/ccms-widgets";
import { ASSET_CLASSES, LICENCE_CLASSES, daysTo } from "@/lib/ams";
import { Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ams/drivers")({
  component: Drivers,
  head: () => ({ meta: [{ title: "Asset Monitoring · Drivers" }] }),
});

const INPUT = "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm";
const COMPETENCIES = [...new Set(ASSET_CLASSES.flatMap((c) => (c.competency ?? []).map((x) => x.type)))];
const BLANK = { name: "", staff_id: "", department: "", contact: "", licence_no: "", licence_classes: [] as string[], licence_expiry: "", competencies: [] as { type: string; number?: string; expiry?: string }[] };

function Drivers() {
  const [role] = useCcmsRole();
  const qc = useQueryClient();
  const listFn = useServerFn(listAmsDrivers);
  const saveFn = useServerFn(saveAmsDriver);
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["ams-drivers"], queryFn: () => listFn() });
  const [edit, setEdit] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const exp = (d?: string | null) => d ? <span className={cn(daysTo(d) < 0 ? "text-red-700 font-semibold" : daysTo(d) <= 30 ? "text-amber-700" : "text-gray-700")}>{d}</span> : "—";
  async function save() {
    setBusy(true);
    try { await saveFn({ data: { ...edit, acting_role: role } }); toast.success("Saved"); setEdit(null); qc.invalidateQueries({ queryKey: ["ams-drivers"] }); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  }
  return (
    <AppShell>
      <CcmsHeader title="Asset Monitoring" subtitle="Driver and operator register" action={<Button className="gap-1.5" onClick={() => setEdit({ ...BLANK })}><Plus className="size-4" /> Add driver</Button>} />
      <div className="p-6 bg-white min-h-full">
        <div className={CARD}>
          {isLoading ? <div className="p-6 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div>
            : rows.length === 0 ? <p className="p-6 text-sm text-gray-500">No drivers yet.</p> : (
              <table className="w-full"><thead><tr className="border-b border-gray-200"><th className={TH}>Name</th><th className={TH}>Department</th><th className={TH}>Licence</th><th className={TH}>Licence expiry</th><th className={TH}>Competencies</th><th className={TH}></th></tr></thead><tbody>
                {rows.map((d: any) => (
                  <tr key={d.id} className="border-b border-gray-100 last:border-0">
                    <td className={TD}><div className="font-medium">{d.name}</div><div className="text-sm text-gray-600">{d.staff_id ?? ""}</div></td>
                    <td className={TD}>{d.department ?? "—"}</td>
                    <td className={TD}>{(d.licence_classes ?? []).join(", ") || "—"}</td>
                    <td className={TD}>{exp(d.licence_expiry)}</td>
                    <td className={TD}>{(d.competencies ?? []).length ? d.competencies.map((c: any) => <div key={c.type} className="text-sm">{c.type} · {exp(c.expiry)}</div>) : "—"}</td>
                    <td className={TD + " text-right"}><Button size="sm" variant="outline" onClick={() => setEdit({ ...BLANK, ...d, licence_expiry: d.licence_expiry ?? "" })}>Edit</Button></td>
                  </tr>
                ))}
              </tbody></table>
            )}
        </div>
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader><DialogTitle>{edit?.id ? "Edit driver" : "Add driver"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[["name", "Name"], ["staff_id", "Staff ID"], ["department", "Department"], ["contact", "Contact"], ["licence_no", "Licence no."]].map(([k, l]) => (
                <label key={k} className="text-gray-700">{l}<input className={INPUT} value={edit[k] ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>
              ))}
              <label className="text-gray-700">Licence expiry<input type="date" className={INPUT} value={edit.licence_expiry ?? ""} onChange={(e) => setEdit({ ...edit, licence_expiry: e.target.value })} /></label>
              <div className="col-span-2"><div className="text-gray-700 mb-1">Licence classes</div><div className="flex flex-wrap gap-3">{LICENCE_CLASSES.map((c) => <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={edit.licence_classes.includes(c)} onChange={(e) => setEdit({ ...edit, licence_classes: e.target.checked ? [...edit.licence_classes, c] : edit.licence_classes.filter((x: string) => x !== c) })} /> {c}</label>)}</div></div>
              <div className="col-span-2 space-y-1.5">
                <div className="text-gray-700">Competency certificates</div>
                {edit.competencies.map((c: any, i: number) => (
                  <div key={i} className="flex gap-2">
                    <select className={INPUT} value={c.type} onChange={(e) => setEdit({ ...edit, competencies: edit.competencies.map((x: any, j: number) => j === i ? { ...x, type: e.target.value } : x) })}>{COMPETENCIES.map((t) => <option key={t}>{t}</option>)}</select>
                    <input className={INPUT} placeholder="Number" value={c.number ?? ""} onChange={(e) => setEdit({ ...edit, competencies: edit.competencies.map((x: any, j: number) => j === i ? { ...x, number: e.target.value } : x) })} />
                    <input type="date" className={INPUT} value={c.expiry ?? ""} onChange={(e) => setEdit({ ...edit, competencies: edit.competencies.map((x: any, j: number) => j === i ? { ...x, expiry: e.target.value } : x) })} />
                  </div>
                ))}
                <button className="text-blue-700 hover:underline" onClick={() => setEdit({ ...edit, competencies: [...edit.competencies, { type: COMPETENCIES[0], number: "", expiry: "" }] })}>+ add certificate</button>
              </div>
              <div className="col-span-2 flex gap-2 pt-1"><Button onClick={save} disabled={busy || edit.name.trim().length < 2}>{busy ? <Loader2 className="size-4 animate-spin" /> : "Save"}</Button><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button></div>
              {role !== "operations_manager" && <p className="col-span-2 text-gray-500">Saving needs "Acting as" Operations Manager.</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
