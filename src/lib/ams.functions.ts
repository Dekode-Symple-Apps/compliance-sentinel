import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProduct } from "@/lib/feature-middleware";
import { actorOf, assertTenant, requireRole, selfApproval } from "@/lib/actor";
import { CCMS_ROLES, type CcmsRole } from "@/lib/ccms";
import { REQUIREMENTS, assignmentBlocks, classById, isFixedAsset } from "@/lib/ams";

// ---------------------------------------------------------------------------
// Asset Monitoring (Module 3, AMS-01) — server functions.
// ---------------------------------------------------------------------------

const requireAms = requireProduct("asset_monitoring");
const roleSchema = z.enum(Object.keys(CCMS_ROLES) as [CcmsRole, ...CcmsRole[]]);
const ams = (context: any) => actorOf(context, "asset_monitoring");

async function log(sb: any, row: Record<string, unknown>) {
  try { await sb.from("ams_events").insert(row); } catch (e) { console.error("[ams] event log failed:", e); }
}
async function loadAsset(sb: any, id: string, tenantId: string) {
  const { data } = await sb.from("ams_assets").select("*").eq("id", id).single();
  if (!data) throw new Error("Asset not found");
  assertTenant(data.tenant_id, tenantId);
  return data;
}
async function loadItem(sb: any, id: string, tenantId: string) {
  const { data: item } = await sb.from("ams_items").select("*").eq("id", id).single();
  if (!item) throw new Error("Item not found");
  const asset = await loadAsset(sb, item.asset_id, tenantId);
  return { item, asset };
}

// ── the register ─────────────────────────────────────────────────────────────

export const listAmsAssets = createServerFn({ method: "GET" })
  .middleware([requireAms])
  .handler(async ({ context }) => {
    const { sb, tenantId } = await ams(context);
    const { data: assets, error } = await sb.from("ams_assets").select("*").eq("tenant_id", tenantId).order("asset_code");
    if (error) throw new Error(error.message);
    const ids = (assets ?? []).map((a: any) => a.id);
    const [{ data: items }, { data: assigns }] = await Promise.all([
      ids.length ? sb.from("ams_items").select("*").in("asset_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? sb.from("ams_assignments").select("*, driver:ams_drivers(name)").in("asset_id", ids).eq("status", "active") : Promise.resolve({ data: [] }),
    ]);
    return { assets: assets ?? [], items: items ?? [], assignments: assigns ?? [] };
  });

export const getAmsAsset = createServerFn({ method: "GET" })
  .middleware([requireAms])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId } = await ams(context);
    const asset = await loadAsset(sb, data.id, tenantId);
    const [items, assigns, events, vendor] = await Promise.all([
      sb.from("ams_items").select("*").eq("asset_id", asset.id).order("created_at"),
      sb.from("ams_assignments").select("*, driver:ams_drivers(*)").eq("asset_id", asset.id).order("created_at", { ascending: false }),
      sb.from("ams_events").select("*").eq("asset_id", asset.id).order("created_at"),
      asset.vendor_id ? sb.from("ccms_vendors").select("name,status,compliance_hold").eq("id", asset.vendor_id).single() : Promise.resolve({ data: null }),
    ]);
    return { asset, items: items.data ?? [], assignments: assigns.data ?? [], events: events.data ?? [], vendor: vendor.data };
  });

export const createAmsAsset = createServerFn({ method: "POST" })
  .middleware([requireAms])
  .inputValidator(z.object({
    asset_class: z.string(), name: z.string().min(2), entity: z.string().optional().nullable(), department: z.string().optional().nullable(),
    location: z.string().optional().nullable(), make: z.string().optional().nullable(), model: z.string().optional().nullable(), year: z.number().int().optional().nullable(),
    registration_no: z.string().optional().nullable(), serial_no: z.string().optional().nullable(),
    ownership: z.enum(["owned", "rented"]), source_ref: z.string().min(2),
    purchase_date: z.string().optional().nullable(), cost: z.number().optional().nullable(), useful_life_years: z.number().optional().nullable(),
    vendor_id: z.string().uuid().optional().nullable(), on_hire: z.string().optional().nullable(), off_hire: z.string().optional().nullable(),
    dosh_reg_no: z.string().optional().nullable(), acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await ams(context);
    requireRole(data.acting_role, ["operations_manager"], "register an asset");
    const cls = classById(data.asset_class);
    if (!cls) throw new Error("Choose an asset class.");
    if (data.ownership === "owned" && (data.cost == null || data.useful_life_years == null)) throw new Error("Cost and useful life are required for an owned asset.");
    if (data.ownership === "rented") {
      if (!data.vendor_id || !data.on_hire || !data.off_hire) throw new Error("A rented asset needs the rental vendor and the on-hire and off-hire dates.");
      const { data: v } = await sb.from("ccms_vendors").select("tenant_id,status,compliance_hold,name").eq("id", data.vendor_id).single();
      assertTenant(v?.tenant_id, tenantId);
      if (!["approved", "conditional"].includes(v?.status) || v?.compliance_hold) throw new Error(`${v?.name ?? "The vendor"} is not an approved vendor in good standing.`);
    }
    // Registration and serial numbers are unique across every entity.
    for (const [k, label] of [["registration_no", "Registration"], ["serial_no", "Serial"]] as const) {
      const val = (data as any)[k]?.trim();
      if (!val) continue;
      const { data: dup } = await sb.from("ams_assets").select("asset_code").eq("tenant_id", tenantId).ilike(k, val).limit(1);
      if (dup?.length) throw new Error(`${label} number ${val} is already on ${dup[0].asset_code}.`);
    }
    const { acting_role, ...fields } = data;
    const { data: asset, error } = await sb.from("ams_assets").insert({
      ...fields, tenant_id: tenantId, created_by: userName, fixed_asset: isFixedAsset(data),
    }).select().single();
    if (error) throw new Error(error.message);
    // The class template: its checklist, each item owned, dated and blocking or not.
    const rows = Object.entries(cls.items).map(([rid, level]) => {
      const req = REQUIREMENTS[rid];
      return { asset_id: asset.id, requirement: rid, label: req.label, mandatory: level === "M", blocking: req.blocking, lead_days: req.lead, owner_dept: req.owner,
        applicable: level === "M", reference: rid === "dosh_reg" ? data.dosh_reg_no ?? null : null };
    });
    await sb.from("ams_items").insert(rows);
    await log(sb, { asset_id: asset.id, event_type: "created", actor_name: userName, acting_role,
      detail: `${cls.label} registered from ${data.source_ref}. ${rows.filter((r) => r.applicable).length} compliance item(s) opened.${asset.fixed_asset ? " Fixed asset — queued for AutoCount Fixed Assets." : ""}` });
    return asset;
  });

export const setAmsItemApplicable = createServerFn({ method: "POST" })
  .middleware([requireAms])
  .inputValidator(z.object({ item_id: z.string().uuid(), applicable: z.boolean(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await ams(context);
    requireRole(data.acting_role, ["operations_manager", "safety_health"], "change what applies");
    const { item, asset } = await loadItem(sb, data.item_id, tenantId);
    if (item.mandatory && !data.applicable) throw new Error("A mandatory item always applies.");
    await sb.from("ams_items").update({ applicable: data.applicable }).eq("id", item.id);
    await log(sb, { asset_id: asset.id, event_type: "item", actor_name: userName, acting_role: data.acting_role, detail: `${item.label}: ${data.applicable ? "applies" : "not applicable"}.` });
    return { ok: true };
  });

// ── evidence: uploaded by one person, verified by another (steps 3, 13–15) ───

export const uploadAmsEvidence = createServerFn({ method: "POST" })
  .middleware([requireAms])
  .inputValidator(z.object({
    item_id: z.string().uuid(), file_name: z.string(), file_url: z.string().url(),
    reference: z.string().min(1).max(100), issuer: z.string().max(200).optional().nullable(),
    effective_date: z.string().optional().nullable(), expiry_date: z.string().optional().nullable(), amount: z.number().optional().nullable(),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await ams(context);
    requireRole(data.acting_role, ["operations_manager", "finance", "safety_health"], "upload evidence");
    const { item, asset } = await loadItem(sb, data.item_id, tenantId);
    const req = REQUIREMENTS[item.requirement];
    if (!req?.noExpiry && !data.expiry_date) throw new Error("Give the expiry date — a date alone does not close the task, but it drives the next alert.");
    if (item.expiry_date && data.expiry_date && data.expiry_date <= item.expiry_date) throw new Error(`The new expiry must be later than the current one (${item.expiry_date}).`);
    const pending = { reference: data.reference, issuer: data.issuer ?? null, effective_date: data.effective_date ?? null, expiry_date: data.expiry_date ?? null,
      amount: data.amount ?? null, file_name: data.file_name, file_url: data.file_url, uploaded_by: userName, uploaded_at: new Date().toISOString() };
    await sb.from("ams_items").update({ pending }).eq("id", item.id);
    await log(sb, { asset_id: asset.id, event_type: "evidence", actor_name: userName, acting_role: data.acting_role,
      detail: `${item.label}: evidence uploaded (${data.reference}${data.expiry_date ? `, to ${data.expiry_date}` : ""}) — awaiting verification by a second person.` });
    return { ok: true };
  });

export const verifyAmsEvidence = createServerFn({ method: "POST" })
  .middleware([requireAms])
  .inputValidator(z.object({ item_id: z.string().uuid(), approve: z.boolean(), note: z.string().max(500).optional().nullable(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ams(context);
    requireRole(data.acting_role, ["head_of_department", "safety_health", "finance", "operations_manager"], "verify evidence");
    const { item, asset } = await loadItem(sb, data.item_id, tenantId);
    if (!item.pending) throw new Error("Nothing is awaiting verification.");
    // Verified by someone other than the uploader.
    const sameName = item.pending.uploaded_by === userName;
    const self = selfApproval(sameName ? userId : null, userId);
    if (self.blocked) throw new Error("A second person must verify what you uploaded.");
    if (!data.approve) {
      await sb.from("ams_items").update({ pending: null }).eq("id", item.id);
      await log(sb, { asset_id: asset.id, event_type: "evidence", actor_name: userName, acting_role: data.acting_role, detail: `${item.label}: evidence rejected${data.note ? ` — ${data.note}` : ""}.` });
      return { ok: true };
    }
    const history = [...(item.history ?? []), ...(item.verified_at ? [{ reference: item.reference, issuer: item.issuer, effective_date: item.effective_date, expiry_date: item.expiry_date, file_url: item.file_url, verified_by: item.verified_by, verified_at: item.verified_at }] : [])];
    const p = item.pending;
    await sb.from("ams_items").update({
      reference: p.reference, issuer: p.issuer, effective_date: p.effective_date, expiry_date: p.expiry_date, amount: p.amount,
      file_name: p.file_name, file_url: p.file_url, uploaded_by: p.uploaded_by, uploaded_at: p.uploaded_at,
      verified_by: userName, verified_at: new Date().toISOString(), pending: null, escalation: null, history,
    }).eq("id", item.id);
    await log(sb, { asset_id: asset.id, event_type: "verified", actor_name: userName, acting_role: data.acting_role,
      detail: `${item.label}: verified${p.expiry_date ? `, valid to ${p.expiry_date}` : ""}.${history.length ? " Previous record kept." : ""}${self.note}` });
    return { ok: true };
  });

/** Overdue more than 3 days: the Head of Department records why and when it
 *  will be recovered (step 16). */
export const escalateAmsItem = createServerFn({ method: "POST" })
  .middleware([requireAms])
  .inputValidator(z.object({ item_id: z.string().uuid(), reason: z.string().min(3), recovery_date: z.string(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await ams(context);
    requireRole(data.acting_role, ["head_of_department"], "record the escalation");
    const { item, asset } = await loadItem(sb, data.item_id, tenantId);
    await sb.from("ams_items").update({ escalation: { reason: data.reason, recovery_date: data.recovery_date, by: userName, at: new Date().toISOString() } }).eq("id", item.id);
    await log(sb, { asset_id: asset.id, event_type: "escalated", actor_name: userName, acting_role: data.acting_role, detail: `${item.label} overdue — ${data.reason}. Recovery by ${data.recovery_date}.` });
    return { ok: true };
  });

// ── drivers and operators ────────────────────────────────────────────────────

export const listAmsDrivers = createServerFn({ method: "GET" })
  .middleware([requireAms])
  .handler(async ({ context }) => {
    const { sb, tenantId } = await ams(context);
    const { data } = await sb.from("ams_drivers").select("*").eq("tenant_id", tenantId).order("name");
    return data ?? [];
  });

export const saveAmsDriver = createServerFn({ method: "POST" })
  .middleware([requireAms])
  .inputValidator(z.object({
    id: z.string().uuid().optional(), name: z.string().min(2), staff_id: z.string().optional().nullable(), department: z.string().optional().nullable(),
    contact: z.string().optional().nullable(), licence_no: z.string().optional().nullable(), licence_classes: z.array(z.string()).default([]),
    licence_expiry: z.string().optional().nullable(), competencies: z.array(z.object({ type: z.string(), number: z.string().optional(), expiry: z.string().optional().nullable() })).default([]),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await ams(context);
    requireRole(data.acting_role, ["operations_manager"], "maintain the driver register");
    const { acting_role, id, ...row } = data;
    const clean = { ...row, licence_expiry: row.licence_expiry || null, competencies: row.competencies.filter((c) => c.type) };
    if (id) {
      const { data: d } = await sb.from("ams_drivers").select("tenant_id").eq("id", id).single();
      assertTenant(d?.tenant_id, tenantId);
      await sb.from("ams_drivers").update(clean).eq("id", id);
      await log(sb, { driver_id: id, event_type: "driver", actor_name: userName, acting_role, detail: `Driver record updated: ${data.name}.` });
      return { id };
    }
    const { data: d, error } = await sb.from("ams_drivers").insert({ ...clean, tenant_id: tenantId }).select().single();
    if (error) throw new Error(error.message);
    return { id: d.id };
  });

// ── assignment: licence, competency and certificate checks, no override ─────

export const assignAmsAsset = createServerFn({ method: "POST" })
  .middleware([requireAms])
  .inputValidator(z.object({ asset_id: z.string().uuid(), driver_id: z.string().uuid(), start_date: z.string(), end_date: z.string().optional().nullable(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await ams(context);
    requireRole(data.acting_role, ["operations_manager"], "assign an asset");
    const asset = await loadAsset(sb, data.asset_id, tenantId);
    const { data: driver } = await sb.from("ams_drivers").select("*").eq("id", data.driver_id).single();
    assertTenant(driver?.tenant_id, tenantId);
    const { data: items } = await sb.from("ams_items").select("*").eq("asset_id", asset.id);
    const { data: active } = await sb.from("ams_assignments").select("id,start_date,end_date").eq("asset_id", asset.id).eq("status", "active");
    const overlap = (active ?? []).some((a: any) => (!a.end_date || a.end_date >= data.start_date) && (!data.end_date || data.end_date >= a.start_date));
    const blocks = assignmentBlocks(asset, items ?? [], driver, data.start_date);
    if (overlap) blocks.unshift("Overlaps an active assignment of this asset");
    if (blocks.length) {
      // The attempt is logged; the driver is named non-compliant for this asset.
      await sb.from("ams_assignments").insert({ asset_id: asset.id, driver_id: driver.id, start_date: data.start_date, end_date: data.end_date || null, status: "blocked", blocked_reason: blocks.join("; "), created_by: userName });
      await log(sb, { asset_id: asset.id, driver_id: driver.id, event_type: "blocked", actor_name: userName, acting_role: data.acting_role, detail: `Assignment of ${driver.name} blocked — ${blocks.join("; ")}. Operations and Head of Department notified.` });
      throw new Error(`Blocked: ${blocks.join("; ")}.`);
    }
    const { data: row, error } = await sb.from("ams_assignments").insert({ asset_id: asset.id, driver_id: driver.id, start_date: data.start_date, end_date: data.end_date || null, status: "active", created_by: userName }).select().single();
    if (error) throw new Error(error.message);
    await log(sb, { asset_id: asset.id, driver_id: driver.id, event_type: "assigned", actor_name: userName, acting_role: data.acting_role, detail: `Assigned to ${driver.name} from ${data.start_date}. Handover to be acknowledged within 2 working days.` });
    return row;
  });

export const recordAmsHandover = createServerFn({ method: "POST" })
  .middleware([requireAms])
  .inputValidator(z.object({
    assignment_id: z.string().uuid(), kind: z.enum(["handover", "return"]), date: z.string(), reading: z.number().nonnegative(),
    checklist: z.array(z.object({ item: z.string(), ok: z.boolean() })), photos: z.array(z.string().url()).min(1), accessories: z.string().max(500).optional().nullable(),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await ams(context);
    const { data: a } = await sb.from("ams_assignments").select("*").eq("id", data.assignment_id).single();
    if (!a) throw new Error("Assignment not found");
    const asset = await loadAsset(sb, a.asset_id, tenantId);
    if (a.status !== "active") throw new Error("The assignment is not active.");
    const rec = { date: data.date, reading: data.reading, checklist: data.checklist, photos: data.photos, accessories: data.accessories ?? null, by: userName };
    if (data.kind === "return" && a.handover?.reading != null && data.reading < a.handover.reading) throw new Error(`The return reading is below the handover reading (${a.handover.reading}).`);
    await sb.from("ams_assignments").update(data.kind === "handover" ? { handover: rec } : { return_record: rec, status: "returned", end_date: data.date }).eq("id", a.id);
    await log(sb, { asset_id: asset.id, driver_id: a.driver_id, event_type: data.kind, actor_name: userName, acting_role: data.acting_role,
      detail: `${data.kind === "handover" ? "Handover acknowledged" : "Returned"}: reading ${data.reading}, ${data.checklist.filter((c) => !c.ok).length} defect(s), ${data.photos.length} photo(s).` });
    return { ok: true };
  });
