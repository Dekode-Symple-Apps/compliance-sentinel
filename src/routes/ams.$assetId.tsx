import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  assignAmsAsset, escalateAmsItem, getAmsAsset, listAmsDrivers, recordAmsHandover, setAmsItemApplicable, uploadAmsEvidence, verifyAmsEvidence,
} from "@/lib/ams.functions";
import { CcmsHeader, CARD, TH, TD, useCcmsRole, uploadToStorage } from "@/components/ccms-widgets";
import {
  ASSET_STATE_LABEL, ITEM_STATUS_LABEL, REQUIREMENTS, assetCompliance, assignmentBlocks, classById, daysTo, itemStatus,
} from "@/lib/ams";
import { CCMS_ROLES, displayName, fmtMoneyPlain } from "@/lib/ccms";
import { ArrowLeft, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ams/$assetId")({
  component: AssetPage,
  head: () => ({ meta: [{ title: "Asset Monitoring · Asset" }] }),
});

const INPUT = "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900";
const stTone = (s: string) => s === "expired" ? "text-red-700 font-semibold" : s === "expiring" ? "text-amber-700 font-semibold" : s === "compliant" ? "text-emerald-700" : s === "na" ? "text-gray-400" : "text-blue-800";
const CHECKLIST = ["Body and paint", "Tyres", "Lights", "Brakes", "Fluids", "Safety devices", "Documents in vehicle"];

function AssetPage() {
  const { assetId } = Route.useParams();
  const [role] = useCcmsRole();
  const getFn = useServerFn(getAmsAsset);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["ams-asset", assetId], queryFn: () => getFn({ data: { id: assetId } }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["ams-asset", assetId] }); qc.invalidateQueries({ queryKey: ["ams-assets"] }); };
  const [busy, setBusy] = useState(false);
  const run = async (p: () => Promise<unknown>, ok: string) => { setBusy(true); try { await p(); toast.success(ok); refresh(); } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); } };

  const uploadFn = useServerFn(uploadAmsEvidence);
  const verifyFn = useServerFn(verifyAmsEvidence);
  const applyFn = useServerFn(setAmsItemApplicable);
  const escFn = useServerFn(escalateAmsItem);
  const [ev, setEv] = useState<Record<string, any>>({});
  const [esc, setEsc] = useState<Record<string, any>>({});

  if (isLoading) return <AppShell><div className="p-10 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Loading…</div></AppShell>;
  if (error || !data) return <AppShell><div className="p-10 text-sm text-red-700">{(error as Error)?.message ?? "Not found"}</div></AppShell>;
  const { asset: a, items, assignments, events, vendor } = data as any;
  const cls = classById(a.asset_class);
  const comp = assetCompliance(items);
  const active = assignments.find((x: any) => x.status === "active");

  return (
    <AppShell>
      <CcmsHeader title={`${a.asset_code} · ${a.name}`} subtitle={`${cls?.label} · ${a.entity ?? ""} · ${a.location ?? ""}`} />
      <div className="p-6 bg-white min-h-full space-y-5">
        <Link to="/ams/assets" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline"><ArrowLeft className="size-4" /> Register</Link>
        <section className={cn(CARD, "p-4 flex flex-wrap items-center gap-3")}>
          <span className={cn("rounded-full border px-2.5 py-0.5 text-sm font-semibold", comp.state === "hold" ? "border-red-300 text-red-800" : comp.state === "overdue" ? "border-orange-300 text-orange-800" : comp.state === "due_soon" ? "border-amber-300 text-amber-800" : "border-emerald-300 text-emerald-800")}>{ASSET_STATE_LABEL[comp.state]}</span>
          <span className="text-sm text-gray-800">{comp.state === "hold" ? "Cannot be deployed or newly assigned: " + comp.reasons.join("; ") : comp.reasons.join("; ") || "All applicable items verified and in date."}</span>
          <span className="ml-auto text-sm text-gray-600">{active ? `Assigned to ${active.driver?.name}` : "Not assigned"}</span>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5">
          <div className="space-y-5 min-w-0">
            <section className={CARD}>
              <div className="px-4 py-3 border-b border-gray-200"><h2 className="text-sm font-semibold text-gray-900">Compliance checklist</h2><p className="text-sm text-gray-600">Set by the asset class. Evidence is uploaded by one person and verified by another; only then does an item count, and its expiry starts the alert clock.</p></div>
              <table className="w-full">
                <thead><tr className="border-b border-gray-200"><th className={TH}>Item</th><th className={TH}>Status</th><th className={TH}>Evidence</th><th className={TH}></th></tr></thead>
                <tbody>
                  {items.map((i: any) => {
                    const st = itemStatus(i);
                    const e = ev[i.id] ?? {};
                    const req = REQUIREMENTS[i.requirement];
                    const setE = (k: string, v: any) => setEv({ ...ev, [i.id]: { ...e, [k]: v } });
                    const overdueDays = i.expiry_date ? -daysTo(i.expiry_date) : 0;
                    return (
                      <tr key={i.id} className="border-b border-gray-100 last:border-0 align-top">
                        <td className={TD}><div className="font-medium">{i.label}</div><div className="text-xs text-gray-500">{i.mandatory ? "mandatory" : "conditional"}{i.blocking ? " · blocks deployment" : ""} · {i.owner_dept}{i.lead_days ? ` · alert ${i.lead_days} days` : ""}</div></td>
                        <td className={TD}><span className={stTone(st)}>{ITEM_STATUS_LABEL[st]}</span>{i.expiry_date && <div className="text-xs text-gray-600">to {i.expiry_date}</div>}</td>
                        <td className={TD + " text-sm"}>
                          {i.verified_at && <div>{i.reference}{i.issuer ? ` · ${i.issuer}` : ""}{i.amount != null ? ` · ${fmtMoneyPlain(i.amount)}` : ""} · verified by {displayName(i.verified_by)}{i.file_url && <> · <a href={i.file_url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">file</a></>}</div>}
                          {i.pending && <div className="text-blue-800">Awaiting verification: {i.pending.reference}{i.pending.expiry_date ? `, to ${i.pending.expiry_date}` : ""} (uploaded by {displayName(i.pending.uploaded_by)}) · <a href={i.pending.file_url} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">file</a></div>}
                          {i.escalation && <div className="text-gray-700">Escalated: {i.escalation.reason} — recovery by {i.escalation.recovery_date}</div>}
                          {(i.history ?? []).length > 0 && <div className="text-xs text-gray-500">{i.history.length} earlier record(s) kept</div>}
                        </td>
                        <td className={TD + " w-[360px]"}>
                          {!i.applicable ? (
                            ["operations_manager", "safety_health"].includes(role) && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => applyFn({ data: { item_id: i.id, applicable: true, acting_role: role } }), "Now applies")}>Applies to this asset</Button>
                          ) : i.pending ? (
                            ["head_of_department", "safety_health", "finance", "operations_manager"].includes(role) && (
                              <div className="flex gap-2">
                                <Button size="sm" disabled={busy} onClick={() => run(() => verifyFn({ data: { item_id: i.id, approve: true, acting_role: role } }), "Verified")}>Verify</Button>
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => verifyFn({ data: { item_id: i.id, approve: false, note: "Not acceptable", acting_role: role } }), "Rejected")}>Reject</Button>
                              </div>
                            )
                          ) : ["operations_manager", "finance", "safety_health"].includes(role) && (st !== "compliant" || true) ? (
                            <div className="flex flex-wrap gap-1.5">
                              <input className={INPUT + " w-28"} placeholder="Reference" value={e.reference ?? ""} onChange={(x) => setE("reference", x.target.value)} />
                              <input className={INPUT + " w-28"} placeholder="Issuer" value={e.issuer ?? ""} onChange={(x) => setE("issuer", x.target.value)} />
                              {!req?.noExpiry && <input type="date" className={INPUT} value={e.expiry_date ?? ""} onChange={(x) => setE("expiry_date", x.target.value)} title="Expiry" />}
                              <label className={cn("inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 cursor-pointer", busy && "opacity-60 pointer-events-none")}>
                                <Upload className="size-4" /> {i.verified_at ? "Renew" : "Upload"}
                                <input type="file" className="hidden" onChange={(x) => { const f = x.target.files?.[0]; if (f) run(async () => { const url = await uploadToStorage(`ams/${a.id}`, f); await uploadFn({ data: { item_id: i.id, file_name: f.name, file_url: url, reference: e.reference ?? "", issuer: e.issuer || null, expiry_date: e.expiry_date || null, acting_role: role } }); setEv({ ...ev, [i.id]: {} }); }, "Uploaded — a second person verifies it"); x.target.value = ""; }} />
                              </label>
                            </div>
                          ) : null}
                          {st === "expired" && overdueDays > 3 && !i.escalation && role === "head_of_department" && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              <input className={INPUT + " w-40"} placeholder="Reason" value={esc[i.id]?.reason ?? ""} onChange={(x) => setEsc({ ...esc, [i.id]: { ...esc[i.id], reason: x.target.value } })} />
                              <input type="date" className={INPUT} value={esc[i.id]?.date ?? ""} onChange={(x) => setEsc({ ...esc, [i.id]: { ...esc[i.id], date: x.target.value } })} />
                              <Button size="sm" disabled={busy} onClick={() => run(() => escFn({ data: { item_id: i.id, reason: esc[i.id]?.reason ?? "", recovery_date: esc[i.id]?.date ?? "", acting_role: role } }), "Escalation recorded")}>Record</Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!["operations_manager", "finance", "safety_health", "head_of_department"].includes(role) && <p className="px-4 py-2 text-sm text-gray-500">Switch "Acting as" to Operations Manager, Finance or Safety and Health to upload; to Head of Department to verify or escalate.</p>}
            </section>

            <AssignmentSection a={a} items={items} assignments={assignments} role={role} onDone={refresh} />
          </div>

          <aside className="space-y-5">
            <section className={CARD}>
              <table className="w-full"><tbody>
                {[["Class", cls?.label], ["Make / model", [a.make, a.model, a.year].filter(Boolean).join(" ") || "—"], ["Registration", a.registration_no ?? "—"], ["Serial", a.serial_no ?? "—"], ["DOSH reg.", a.dosh_reg_no ?? "—"],
                  ["Ownership", a.ownership === "rented" ? `Rented from ${vendor?.name ?? "—"}, ${a.on_hire} to ${a.off_hire}` : `Owned · ${fmtMoneyPlain(a.cost)} · ${a.useful_life_years} years`],
                  ["Source", a.source_ref], ["Fixed asset", a.fixed_asset ? "Yes — AutoCount FA" : "No"], ["Registered by", displayName(a.created_by)]]
                  .map(([k, v]: any) => <tr key={k} className="border-b border-gray-100 last:border-0"><td className="px-4 py-2 text-sm text-gray-600 w-28 align-top">{k}</td><td className="px-4 py-2 text-sm text-gray-900">{v}</td></tr>)}
              </tbody></table>
            </section>
            <section className={CARD}>
              <div className="px-4 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">Audit trail</div>
              <ul className="divide-y divide-gray-100">{events.map((e: any) => <li key={e.id} className="px-4 py-2 text-sm"><div className="text-xs text-gray-500">{format(new Date(e.created_at), "d MMM, HH:mm")} · {displayName(e.actor_name)}{e.acting_role ? ` · ${CCMS_ROLES[e.acting_role as keyof typeof CCMS_ROLES] ?? ""}` : ""}</div><div className="text-gray-900">{e.detail}</div></li>)}</ul>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function AssignmentSection({ a, items, assignments, role, onDone }: { a: any; items: any[]; assignments: any[]; role: string; onDone: () => void }) {
  const driversFn = useServerFn(listAmsDrivers);
  const assignFn = useServerFn(assignAmsAsset);
  const handoverFn = useServerFn(recordAmsHandover);
  const { data: drivers = [] } = useQuery({ queryKey: ["ams-drivers"], queryFn: () => driversFn() });
  const [f, setF] = useState({ driver_id: "", start_date: new Date().toISOString().slice(0, 10), end_date: "" });
  const [h, setH] = useState<{ reading: string; checklist: Record<string, boolean>; photos: string[]; accessories: string }>({ reading: "", checklist: {}, photos: [], accessories: "" });
  const [busy, setBusy] = useState(false);
  const run = async (p: () => Promise<unknown>, ok: string) => { setBusy(true); try { await p(); toast.success(ok); onDone(); } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); } };
  const active = assignments.find((x) => x.status === "active");
  const drv = drivers.find((d: any) => d.id === f.driver_id);
  const preview = drv ? assignmentBlocks(a, items, drv, f.start_date) : [];
  const handoverDone = !!active?.handover;
  const recordKind: "handover" | "return" = handoverDone ? "return" : "handover";

  return (
    <section className={CARD}>
      <div className="px-4 py-3 border-b border-gray-200"><h2 className="text-sm font-semibold text-gray-900">Assignment</h2><p className="text-sm text-gray-600">The driver's licence class, licence expiry and competency are checked against the asset class; a compliance hold also blocks. No override — only a valid credential clears it.</p></div>
      <div className="px-4 py-3 space-y-3 text-sm">
        {active ? (
          <div className="space-y-2">
            <p>Assigned to <b>{active.driver?.name}</b> from {active.start_date}{active.end_date ? ` to ${active.end_date}` : ""}. {handoverDone ? `Handover acknowledged ${active.handover.date}, reading ${active.handover.reading}.` : <span className="text-amber-700">Handover not yet acknowledged (due within 2 working days).</span>}</p>
            <div className="rounded-md border border-gray-200 p-2.5 space-y-2">
              <div className="font-medium">{recordKind === "handover" ? "Acknowledge handover" : "Record return"} — reading, condition, photographs</div>
              <div className="flex flex-wrap gap-3">{CHECKLIST.map((c) => <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={h.checklist[c] ?? false} onChange={(e) => setH({ ...h, checklist: { ...h.checklist, [c]: e.target.checked } })} /> {c} OK</label>)}</div>
              <div className="flex flex-wrap items-center gap-2">
                <input className={INPUT + " w-40"} placeholder="Odometer / hour-meter" value={h.reading} onChange={(e) => setH({ ...h, reading: e.target.value })} />
                <input className={INPUT + " flex-1 min-w-40"} placeholder="Accessories and tools" value={h.accessories} onChange={(e) => setH({ ...h, accessories: e.target.value })} />
                <label className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 cursor-pointer"><Upload className="size-4" /> Photos ({h.photos.length})
                  <input type="file" accept="image/*" multiple className="hidden" onChange={async (e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; try { const urls = await Promise.all(fs.map((x) => uploadToStorage(`ams/${a.id}/photos`, x))); setH((p) => ({ ...p, photos: [...p.photos, ...urls] })); } catch (err: any) { toast.error(err?.message ?? "Upload failed"); } }} /></label>
                <Button size="sm" disabled={busy || !h.photos.length || h.reading === ""} onClick={() => run(() => handoverFn({ data: { assignment_id: active.id, kind: recordKind, date: new Date().toISOString().slice(0, 10), reading: Number(h.reading), checklist: CHECKLIST.map((c) => ({ item: c, ok: !!h.checklist[c] })), photos: h.photos, accessories: h.accessories || null, acting_role: role as any } }).then(() => setH({ reading: "", checklist: {}, photos: [], accessories: "" })), recordKind === "handover" ? "Handover acknowledged" : "Returned")}>{recordKind === "handover" ? "Acknowledge" : "Return"}</Button>
              </div>
            </div>
          </div>
        ) : role !== "operations_manager" ? <p className="text-gray-500">Switch "Acting as" to Operations Manager to assign.</p> : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <select className={INPUT} value={f.driver_id} onChange={(e) => setF({ ...f, driver_id: e.target.value })}><option value="">Driver / operator…</option>{drivers.map((d: any) => <option key={d.id} value={d.id}>{d.name}{d.licence_classes?.length ? ` (${d.licence_classes.join(", ")})` : ""}</option>)}</select>
              <input type="date" className={INPUT} value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} />
              <input type="date" className={INPUT} value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} title="End (optional)" />
              <Button size="sm" disabled={busy || !f.driver_id} onClick={() => run(() => assignFn({ data: { asset_id: a.id, driver_id: f.driver_id, start_date: f.start_date, end_date: f.end_date || null, acting_role: role as any } }), "Assigned")}>Assign</Button>
              <Link to="/ams/drivers" className="text-blue-700 hover:underline">Driver register →</Link>
            </div>
            {drv && (preview.length ? <ul className="text-red-700 list-disc pl-5">{preview.map((p) => <li key={p}>{p}</li>)}</ul> : <p className="text-emerald-700">Licence, competency and asset checks pass.</p>)}
          </div>
        )}
        {assignments.filter((x) => x.status !== "active").length > 0 && (
          <table className="w-full"><thead><tr><th className={TH}>Driver</th><th className={TH}>Dates</th><th className={TH}>Outcome</th></tr></thead><tbody>
            {assignments.filter((x) => x.status !== "active").map((x) => (
              <tr key={x.id} className="border-t border-gray-100"><td className={TD}>{x.driver?.name}</td><td className={TD}>{x.start_date}{x.end_date ? ` – ${x.end_date}` : ""}</td><td className={TD}>{x.status === "blocked" ? <span className="text-red-700">Blocked — {x.blocked_reason}</span> : `Returned${x.return_record ? `, reading ${x.return_record.reading}` : ""}`}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </section>
  );
}
