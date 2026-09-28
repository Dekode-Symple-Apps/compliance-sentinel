import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requireProduct } from "@/lib/feature-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateWithFallback } from "@/lib/gemini";
import { documentText, parseJson } from "@/lib/ccms.functions";
import { actorOf, assertTenant, requireRole, selfApproval } from "@/lib/actor";
import { CCMS_ROLES, type CcmsRole } from "@/lib/ccms";
import {
  ABMS_QUESTIONS, DOC_TYPES, PASS_MARK, PORTAL_FORMS, PREQUAL_AREAS, VENDOR_CATEGORIES, addMonths, coiDates, daysTo, ddMonths, docTypeFromName, docsFor,
  needsCompliance, prequalScore, screen,
} from "@/lib/vms";

// ---------------------------------------------------------------------------
// Vendor Management (Module 1) — server functions.
// Internal functions: signed in, Vendor Management on for the organisation,
// by-id rows checked against the caller's tenant. The vendor portal: no
// account — every call proves itself with the invitation token, read and
// written with the service role, scoped to that one request.
// ---------------------------------------------------------------------------

const requireVms = requireProduct("vendor_management");
const roleSchema = z.enum(Object.keys(CCMS_ROLES) as [CcmsRole, ...CcmsRole[]]);
const vms = (context: any) => actorOf(context, "vendor_management");
const today = () => new Date().toISOString().slice(0, 10);
const admin = () => supabaseAdmin as any;

async function log(sb: any, row: Record<string, unknown>) {
  try { await sb.from("vms_events").insert(row); } catch (e) { console.error("[vms] event log failed:", e); }
}
async function loadRequest(sb: any, id: string, tenantId: string) {
  const { data } = await sb.from("vms_requests").select("*").eq("id", id).single();
  if (!data) throw new Error("Request not found");
  assertTenant(data.tenant_id, tenantId);
  return data;
}
const norm = (s: string | null | undefined) => String(s ?? "").toLowerCase().replace(/\b(sdn|bhd|berhad|sendirian|enterprise|plt)\b/g, "").replace(/[^a-z0-9]/g, "");

// ── VMS-01 step 2: raise the request ─────────────────────────────────────────

export const listVmsRequests = createServerFn({ method: "GET" })
  .middleware([requireVms])
  .handler(async ({ context }) => {
    const { sb, tenantId } = await vms(context);
    const { data, error } = await sb.from("vms_requests").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  });

export const getVmsRequest = createServerFn({ method: "GET" })
  .middleware([requireVms])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId } = await vms(context);
    const r = await loadRequest(sb, data.id, tenantId);
    const [vendor, docs, events] = await Promise.all([
      r.vendor_id ? sb.from("ccms_vendors").select("*").eq("id", r.vendor_id).single() : Promise.resolve({ data: null }),
      sb.from("vms_documents").select("*").eq("request_id", r.id).order("created_at"),
      sb.from("vms_events").select("*").eq("request_id", r.id).order("created_at"),
    ]);
    return { request: { ...r, invite_token: r.invite_token ? "set" : null }, token: r.invite_token, vendor: vendor.data, documents: docs.data ?? [], events: events.data ?? [] };
  });

export const createVmsRequest = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({
    kind: z.enum(["onboarding", "subcontractor"]),
    vendor_id: z.string().uuid().optional().nullable(),        // re-due-diligence of an existing vendor
    company_name: z.string().min(2), registration_no: z.string().optional().nullable(),
    entity: z.string().optional().nullable(), category: z.string().optional().nullable(),
    goods_services: z.string().optional().nullable(), justification: z.string().optional().nullable(),
    annual_spend: z.number().nonnegative().optional().nullable(), urgency: z.string().optional().nullable(),
    project: z.string().optional().nullable(), trade: z.string().optional().nullable(), expected_value: z.number().nonnegative().optional().nullable(),
    contact_name: z.string().optional().nullable(), contact_email: z.string().optional().nullable(),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await vms(context);
    const sub = data.kind === "subcontractor";
    if (sub) requireRole(data.acting_role, ["contract_executive", "contract_manager"], "request a subcontractor pre-qualification");
    const category = sub ? "subcontractor" : data.category;
    if (!category || !VENDOR_CATEGORIES[category]) throw new Error("Category is required.");
    if (!sub && !data.justification?.trim()) throw new Error("Justification is required.");
    if (sub && (!data.trade?.trim() || !data.project?.trim())) throw new Error("Trade and project are required.");
    // Name and SSM number against the vendor list and the blacklist.
    const { data: all } = await sb.from("ccms_vendors").select("id,name,registration_no,status").eq("tenant_id", tenantId);
    const same = (all ?? []).filter((v: any) => v.id !== data.vendor_id &&
      ((data.registration_no && v.registration_no && v.registration_no.replace(/\W/g, "") === data.registration_no.replace(/\W/g, "")) || norm(v.name) === norm(data.company_name)));
    const black = same.find((v: any) => v.status === "blacklisted");
    if (black) throw new Error(`${black.name} is on the blacklist and cannot be named.`);
    if (same.length && !data.vendor_id) throw new Error(`${same[0].name} is already on the vendor list — raise re-due-diligence on it instead.`);
    let vendorId = data.vendor_id ?? null;
    if (!vendorId) {
      const { data: v, error } = await sb.from("ccms_vendors").insert({
        tenant_id: tenantId, name: data.company_name, registration_no: data.registration_no ?? null, category,
        status: "pending", risk_rating: "low", related_party: false, entity: data.entity ?? null,
        contact_name: data.contact_name ?? null, contact_email: data.contact_email ?? null, created_by: userId,
      }).select().single();
      if (error) throw new Error(error.message);
      vendorId = v.id;
    }
    const { acting_role, vendor_id, ...fields } = data;
    const { data: row, error } = await sb.from("vms_requests").insert({
      ...fields, category, vendor_id: vendorId, tenant_id: tenantId, status: "submitted", requestor_id: userId, requestor_name: userName,
    }).select().single();
    if (error) throw new Error(error.message);
    await log(sb, { request_id: row.id, vendor_id: vendorId, event_type: "created", actor_name: userName, acting_role,
      detail: `${sub ? "Subcontractor pre-qualification" : data.vendor_id ? "Re-due diligence" : "New vendor"} requested: ${data.company_name}.` });
    return row;
  });

// ── step 3: invite the vendor to the portal (link valid 14 days) ─────────────

export const inviteVmsVendor = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ request_id: z.string().uuid(), reason: z.string().max(500).optional().nullable(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    requireRole(data.acting_role, ["purchasing_executive", "contract_executive", "contract_manager"], "invite the vendor");
    const r = await loadRequest(sb, data.request_id, tenantId);
    if (r.invite_token && r.status !== "returned" && !data.reason?.trim()) throw new Error("Give a reason to re-invite.");
    if (["approved", "conditional", "rejected"].includes(r.status)) throw new Error(`The request is ${r.status}.`);
    const token = randomBytes(24).toString("hex");
    const expires = new Date(Date.now() + 14 * 86_400_000).toISOString();
    await sb.from("vms_requests").update({ invite_token: token, invite_expires: expires, status: r.status === "returned" ? "returned" : "invited", updated_at: new Date().toISOString() }).eq("id", r.id);
    await log(sb, { request_id: r.id, vendor_id: r.vendor_id, event_type: "invited", actor_name: userName, acting_role: data.acting_role,
      detail: `Vendor ${r.invite_token ? "re-invited" : "invited"} to the portal${r.contact_email ? ` (${r.contact_name ?? r.contact_email})` : ""}; link valid to ${expires.slice(0, 10)}.${data.reason ? ` Reason: ${data.reason}` : ""}` });
    return { token, expires };
  });

// ── the vendor portal (no account; the token is the credential) ─────────────

async function portalRequest(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) throw new Error("This link is not valid.");
  const { data: r } = await admin().from("vms_requests").select("*").eq("invite_token", token).single();
  if (!r) throw new Error("This link is not valid.");
  if (r.invite_expires && new Date(r.invite_expires) < new Date()) throw new Error("This link has expired. Ask your contact for a new invitation.");
  return r;
}
const portalOpen = (r: any) => ["invited", "returned"].includes(r.status);

export const getVendorPortal = createServerFn({ method: "GET" })
  .inputValidator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    const r = await portalRequest(data.token);
    const { data: docs } = await admin().from("vms_documents").select("id,doc_type,file_name,status,created_at").eq("request_id", r.id).order("created_at");
    return {
      company: r.company_name, reference: r.reference_number, kind: r.kind, category: r.category,
      categoryLabel: VENDOR_CATEGORIES[r.category] ?? r.category, entity: r.entity,
      status: r.status, open: portalOpen(r), returnReason: r.status === "returned" ? r.return_reason : null,
      register: r.register ?? {}, abms: r.abms ?? {}, expires: r.invite_expires,
      required: docsFor(r.category).map((d) => ({ id: d.id, label: d.label, level: d.level, expires: d.expires })),
      documents: docs ?? [], questions: ABMS_QUESTIONS,
      // What the requester already gave us, so the vendor does not retype it.
      known: { company_name: r.company_name ?? "", registration_no: r.registration_no ?? "", contact_name: r.contact_name ?? "", contact_email: r.contact_email ?? "" },
    };
  });

async function storePortalDocument(r: any, docType: string, fileName: string, mime: string, base64: string) {
  const buf = Buffer.from(base64, "base64");
  const safe = fileName.replace(/[^\w.\- ]+/g, "_");
  const path = `vms/${r.id}/${Date.now()}-${safe}`;
  const up = await admin().storage.from("policies").upload(path, buf, { upsert: false, contentType: mime || "application/octet-stream" });
  if (up.error) throw new Error(up.error.message);
  const url = admin().storage.from("policies").getPublicUrl(path).data.publicUrl;
  const { data: doc, error } = await admin().from("vms_documents").insert({
    request_id: r.id, vendor_id: r.vendor_id, doc_type: docType, file_name: safe, file_url: url, uploaded_by: "Vendor",
  }).select("id,doc_type,file_name,status,created_at").single();
  if (error) throw new Error(error.message);
  return doc;
}

export const uploadVendorPortalDocument = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string(), doc_type: z.string(), file_name: z.string().max(200), mime_type: z.string().max(100), base64: z.string().max(4_200_000) }))
  .handler(async ({ data }) => {
    const r = await portalRequest(data.token);
    if (!portalOpen(r)) throw new Error("This submission is closed.");
    if (!DOC_TYPES.some((d) => d.id === data.doc_type)) throw new Error("Unknown document type.");
    return storePortalDocument(r, data.doc_type, data.file_name, data.mime_type, data.base64);
  });

/** Bulk upload: one file at a time, filed under the document it is — from its
 *  name, or, when the name does not say, from reading the first page. A file
 *  that is none of this category's documents is not stored. */
export const uploadVendorPortalAuto = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string(), file_name: z.string().max(200), mime_type: z.string().max(100), base64: z.string().max(4_200_000) }))
  .handler(async ({ data }) => {
    const r = await portalRequest(data.token);
    if (!portalOpen(r)) throw new Error("This submission is closed.");
    const allowed = docsFor(r.category).filter((d) => !PORTAL_FORMS.has(d.id));
    let docType = docTypeFromName(data.file_name, allowed.map((d) => d.id));
    let how: "name" | "read" = "name";
    const mime = data.mime_type || (/\.pdf$/i.test(data.file_name) ? "application/pdf" : "");
    if (!docType && (mime === "application/pdf" || mime.startsWith("image/"))) {
      how = "read";
      const res: any = await generateWithFallback({ contents: [{ role: "user", parts: [
        { text: `Which one of these vendor onboarding documents is this file? Answer with the id only, or "none" if it is none of them.\n${allowed.map((d) => `${d.id}: ${d.label}`).join("\n")}\nReturn ONLY JSON: {"doc_type": "id or none"}` },
        { inlineData: { mimeType: mime, data: data.base64 } },
      ] }], config: { responseMimeType: "application/json", maxOutputTokens: 256, temperature: 0 } }, { tier: "fast" });
      const id = String(parseJson(res.text ?? "")?.doc_type ?? "");
      docType = allowed.some((d) => d.id === id) ? id : null;
    }
    if (!docType) return { doc_type: null as string | null, file_name: data.file_name, how };
    const doc = await storePortalDocument(r, docType, data.file_name, data.mime_type, data.base64);
    return { ...doc, how };
  });

/** The register form, read from what the vendor uploaded (SSM, company
 *  profile, bank letter, CIDB): only what is printed; blanks otherwise. */
export const readVendorPortalDocuments = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string() }))
  .handler(async ({ data }) => {
    const r = await portalRequest(data.token);
    if (!portalOpen(r)) throw new Error("This submission is closed.");
    const { data: docs } = await admin().from("vms_documents").select("id,doc_type,file_name,file_url").eq("request_id", r.id)
      .in("doc_type", ["ssm", "company_profile", "bank_letter", "cidb"]).order("created_at", { ascending: false });
    const latest = Object.values(Object.fromEntries((docs ?? []).reverse().map((d: any) => [d.doc_type, d]))) as any[];
    if (!latest.length) return { fields: {} as Record<string, any>, read: [] as string[] };
    const parts: any[] = [{ text: `Fill a Malaysian supplier register form from these company documents. Copy values exactly as printed; empty string (or []) when a value is not in the documents — never guess.
Return ONLY JSON: {"company_name":"","registration_no":"","tin":"","address":"","contact_name":"","contact_designation":"","contact_phone":"","contact_email":"","bank_name":"","bank_account":"","directors":[""],"cidb_grade":"","years_in_business":""}` }];
    for (const d of latest) {
      const label = DOC_TYPES.find((t) => t.id === d.doc_type)?.label ?? d.doc_type;
      try {
        const { text, pdfBase64 } = await documentText(d);
        parts.push({ text: `--- ${label} (${d.file_name}) ---` });
        if (pdfBase64) parts.push({ inlineData: { mimeType: "application/pdf", data: pdfBase64 } });
        else parts.push({ text: text.slice(0, 20_000) });
      } catch { /* unreadable file — the rest still fill */ }
    }
    const res: any = await generateWithFallback({ contents: [{ role: "user", parts }],
      config: { responseMimeType: "application/json", maxOutputTokens: 1024, temperature: 0 } }, { tier: "fast" });
    const out = parseJson(res.text ?? "") ?? {};
    const str = (k: string) => (typeof out[k] === "string" ? out[k].trim().slice(0, 300) : "");
    const fields: Record<string, any> = {};
    for (const k of ["company_name", "registration_no", "tin", "address", "contact_name", "contact_designation", "contact_phone", "contact_email", "bank_name", "bank_account", "cidb_grade", "years_in_business"]) if (str(k)) fields[k] = str(k);
    const directors = (Array.isArray(out.directors) ? out.directors : []).filter((x: any) => typeof x === "string" && x.trim()).slice(0, 10);
    if (directors.length) fields.directors = directors.map((name: string) => ({ name: name.trim() }));
    return { fields, read: latest.map((d) => DOC_TYPES.find((t) => t.id === d.doc_type)?.label ?? d.doc_type) };
  });

const registerSchema = z.object({
  company_name: z.string().optional(), registration_no: z.string().optional(), tin: z.string().optional(),
  address: z.string().optional(), contact_name: z.string().optional(), contact_email: z.string().optional(), contact_phone: z.string().optional(),
  bank_name: z.string().optional(), bank_account: z.string().optional(),
  directors: z.array(z.object({ name: z.string(), nric_last4: z.string().optional() })).optional(),
  cidb_grade: z.string().optional(), years_in_business: z.string().optional(), project_references: z.array(z.string()).optional(),
}).passthrough();
const abmsSchema = z.object({
  answers: z.record(z.string(), z.enum(["yes", "no"])).optional(), details: z.string().optional(),
  declaration_interest: z.enum(["none", "declared"]).optional(), interest_details: z.string().optional(),
  pledge: z.boolean().optional(), ctos_consent: z.enum(["signed", "declined"]).optional(), pdpa: z.boolean().optional(),
  signatory: z.string().optional(), designation: z.string().optional(), signed_date: z.string().optional(),
}).passthrough();

export const saveVendorPortal = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string(), register: registerSchema, abms: abmsSchema, submit: z.boolean() }))
  .handler(async ({ data }) => {
    const r = await portalRequest(data.token);
    if (!portalOpen(r)) throw new Error("This submission is closed.");
    const reg = data.register, ab = data.abms;
    if (data.submit) {
      const miss: string[] = [];
      for (const [k, l] of [["company_name", "company name"], ["registration_no", "SSM number"], ["tin", "tax number (TIN)"], ["address", "address"], ["contact_name", "contact name"], ["contact_email", "contact email"], ["bank_name", "bank"], ["bank_account", "bank account"]] as const)
        if (!String((reg as any)[k] ?? "").trim()) miss.push(l);
      if (!(reg.directors ?? []).some((d) => d.name.trim())) miss.push("at least one director");
      if (r.kind === "subcontractor" && (reg.project_references ?? []).filter((x) => x.trim()).length < 2) miss.push("two project references");
      if (ABMS_QUESTIONS.some((q) => !ab.answers?.[q.id])) miss.push("every integrity question (ABMS-004)");
      if (!ab.declaration_interest) miss.push("the declaration of interest (ABMS-001)");
      if (!ab.pledge) miss.push("the integrity pledge (ABMS-005)");
      if (!ab.ctos_consent) miss.push("CTOS consent (signed or declined)");
      if (!ab.pdpa) miss.push("PDPA consent");
      if (!ab.signatory?.trim() || !ab.designation?.trim() || !ab.signed_date) miss.push("signatory name, designation and date");
      const { data: docs } = await admin().from("vms_documents").select("doc_type").eq("request_id", r.id).neq("status", "superseded");
      const have = new Set((docs ?? []).map((d: any) => d.doc_type));
      // The register form, pre-qualification form and ABMS forms are captured in the portal itself.
      const inPortal = new Set(["register_form", "prequal_form", "abms_001", "abms_004", "abms_005", "ctos", "abc_ack"]);
      const needed = docsFor(r.category).filter((d) => d.level === "M" && !inPortal.has(d.id) && !have.has(d.id));
      if (needed.length) miss.push(`documents: ${needed.map((d) => d.label).join(", ")}`);
      if (miss.length) throw new Error(`Still needed: ${miss.join("; ")}.`);
    }
    const patch: any = { register: reg, abms: ab, updated_at: new Date().toISOString() };
    if (data.submit) Object.assign(patch, { status: "vendor_submitted", submitted_by_vendor_at: new Date().toISOString(), return_reason: null });
    await admin().from("vms_requests").update(patch).eq("id", r.id);
    if (data.submit && r.vendor_id) {
      await admin().from("ccms_vendors").update({
        name: reg.company_name || r.company_name, registration_no: reg.registration_no ?? null, tin: reg.tin ?? null,
        bank_name: reg.bank_name ?? null, bank_account: reg.bank_account ?? null, directors: reg.directors ?? [],
        contact_name: reg.contact_name ?? null, contact_email: reg.contact_email ?? null, cidb_grade: reg.cidb_grade ?? null,
      }).eq("id", r.vendor_id);
      // Address and phone (20260930b_vendor_contact.sql) — best effort, so an
      // unmigrated database does not block the vendor's submission.
      await admin().from("ccms_vendors").update({ address: reg.address ?? null, contact_phone: reg.contact_phone ?? null, contact_designation: ab.designation ?? null }).eq("id", r.vendor_id);
      await admin().from("vms_events").insert({ request_id: r.id, vendor_id: r.vendor_id, event_type: "vendor_submitted", actor_name: `Vendor (${ab.signatory ?? ""})`, detail: `Registration submitted by the vendor.${ab.ctos_consent === "declined" ? " CTOS consent declined." : ""}` });
    }
    return { ok: true };
  });

// ── step 6: screening ────────────────────────────────────────────────────────

export const screenVmsRequest = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ request_id: z.string().uuid(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    requireRole(data.acting_role, ["purchasing_executive", "contract_executive", "contract_manager"], "run screening");
    const r = await loadRequest(sb, data.request_id, tenantId);
    if (!r.submitted_by_vendor_at) throw new Error("The vendor has not submitted yet.");
    const { data: vendors } = await sb.from("ccms_vendors").select("*").eq("tenant_id", tenantId);
    const others = (vendors ?? []).filter((v: any) => v.id !== r.vendor_id);
    const reg = r.register ?? {};
    const dirs = new Set((reg.directors ?? []).map((d: any) => norm(d.name)).filter(Boolean));
    const dup = others.filter((v: any) =>
      (reg.registration_no && v.registration_no && v.registration_no.replace(/\W/g, "") === String(reg.registration_no).replace(/\W/g, "")) ||
      (reg.tin && v.tin && v.tin === reg.tin) || (reg.bank_account && v.bank_account && v.bank_account.replace(/\W/g, "") === String(reg.bank_account).replace(/\W/g, "")) ||
      (v.directors ?? []).some((d: any) => dirs.has(norm(d.name))));
    const blacklisted = dup.some((v: any) => v.status === "blacklisted") || others.some((v: any) => v.status === "blacklisted" && norm(v.name) === norm(reg.company_name ?? r.company_name));
    const related = others.some((v: any) => v.related_party && (v.directors ?? []).some((d: any) => dirs.has(norm(d.name))))
      || r.abms?.answers?.lsh_relationship === "yes" || r.abms?.declaration_interest === "declared";
    const s = screen({ abms: r.abms, ctos: r.ctos, blacklisted, relatedPartyMatch: related, duplicates: dup.map((v: any) => v.name) });
    const status = blacklisted ? "rejected" : r.kind === "subcontractor" ? "assessment" : (r.ctos ? "assessment" : "screening");
    await sb.from("vms_requests").update({ screening: s, status, decision: blacklisted ? { outcome: "rejected", reason: "Blacklist hit", by: "Platform", at: new Date().toISOString() } : r.decision, updated_at: new Date().toISOString() }).eq("id", r.id);
    await sb.from("ccms_vendors").update({ risk_rating: s.rating, related_party: s.relatedParty, status: blacklisted ? "rejected" : undefined }).eq("id", r.vendor_id);
    await log(sb, { request_id: r.id, vendor_id: r.vendor_id, event_type: "screened", actor_name: userName, acting_role: data.acting_role,
      detail: blacklisted ? "Blacklist hit — rejected automatically." : `Screened: ${s.rating} risk${s.reasons.length ? ` — ${s.reasons.join("; ")}` : ""}.` });
    return s;
  });

// ── step 7 (onboarding): CTOS report; VMS-02 step 6: Accounts conflict check ─

export const recordVmsCtos = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({
    request_id: z.string().uuid(), score: z.number().optional().nullable(), litigation: z.boolean(), winding_up: z.boolean(), director_flags: z.boolean(),
    file_name: z.string().optional().nullable(), file_url: z.string().url().optional().nullable(), note: z.string().max(1000).optional().nullable(), acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    requireRole(data.acting_role, ["finance", "accounts"], "record the CTOS report");
    const r = await loadRequest(sb, data.request_id, tenantId);
    if (!data.file_url) throw new Error("Attach the CTOS report — pre-qualification cannot be approved without it.");
    await sb.from("vms_documents").insert({ request_id: r.id, vendor_id: r.vendor_id, doc_type: "ctos", file_name: data.file_name ?? "CTOS report", file_url: data.file_url, uploaded_by: userName, status: "verified", verified_by: userName, verified_at: new Date().toISOString() });
    const ctos = { score: data.score ?? null, litigation: data.litigation, winding_up: data.winding_up, director_flags: data.director_flags, note: data.note ?? null, by: userName, at: new Date().toISOString() };
    const s = r.screening ? screen({ abms: r.abms, ctos, blacklisted: r.screening.blacklisted, relatedPartyMatch: r.screening.relatedParty, duplicates: r.screening.duplicateOf ?? [] }) : r.screening;
    await sb.from("vms_requests").update({ ctos, screening: s, status: r.status === "screening" ? "assessment" : r.status, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (s) await sb.from("ccms_vendors").update({ risk_rating: s.rating }).eq("id", r.vendor_id);
    await log(sb, { request_id: r.id, vendor_id: r.vendor_id, event_type: "ctos", actor_name: userName, acting_role: data.acting_role,
      detail: `CTOS report attached${data.score != null ? ` (score ${data.score})` : ""}${[data.litigation && "litigation", data.winding_up && "winding-up", data.director_flags && "director flags"].filter(Boolean).map((x) => `, ${x}`).join("")}.` });
    return { ok: true };
  });

export const recordVmsConflictCheck = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ request_id: z.string().uuid(), decision: z.enum(["cleared", "red_flag"]), note: z.string().max(1000).optional().nullable(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    requireRole(data.acting_role, ["accounts"], "approve the CTOS conflict check");
    const r = await loadRequest(sb, data.request_id, tenantId);
    if (r.kind !== "subcontractor") throw new Error("The conflict check is for subcontractors.");
    if (data.decision === "red_flag" && !data.note?.trim()) throw new Error("Give the reason for the red flag.");
    await sb.from("vms_requests").update({ conflict_check: { accounts_decision: data.decision, note: data.note ?? null, by: userName, at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq("id", r.id);
    await log(sb, { request_id: r.id, vendor_id: r.vendor_id, event_type: "conflict_check", actor_name: userName, acting_role: data.acting_role,
      detail: `Conflict check: ${data.decision === "cleared" ? "cleared" : "red flag"}${data.note ? ` — ${data.note}` : ""}.` });
    return { ok: true };
  });

// ── step 8: verify documents (AI reads, a person confirms) ───────────────────

export const readVmsDocument = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ document_id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId } = await vms(context);
    const { data: doc } = await sb.from("vms_documents").select("*").eq("id", data.document_id).single();
    if (!doc) throw new Error("Document not found");
    const { data: v } = await sb.from("ccms_vendors").select("tenant_id").eq("id", doc.vendor_id).single();
    assertTenant(v?.tenant_id, tenantId);
    const { text, pdfBase64 } = await documentText(doc);
    const parts: any[] = [{ text: `Read this ${DOC_TYPES.find((d) => d.id === doc.doc_type)?.label ?? "certificate"} and extract, only as printed (never guess; empty string if absent):
{"number": "certificate / policy / registration number", "issuer": "issuing body or insurer", "holder": "the company it is issued to", "issued": "yyyy-mm-dd", "expiry": "yyyy-mm-dd"}
Return ONLY JSON.` }];
    if (text.trim()) parts.push({ text: text.slice(0, 40_000) });
    if (pdfBase64) parts.push({ inlineData: { mimeType: "application/pdf", data: pdfBase64 } });
    if (!text.trim() && !pdfBase64) {
      const resp = await fetch(doc.file_url); const buf = Buffer.from(await resp.arrayBuffer());
      const mime = /\.png$/i.test(doc.file_name) ? "image/png" : /\.jpe?g$/i.test(doc.file_name) ? "image/jpeg" : "application/octet-stream";
      if (mime.startsWith("image/")) parts.push({ inlineData: { mimeType: mime, data: buf.toString("base64") } });
    }
    const res: any = await generateWithFallback({ contents: [{ role: "user", parts }], config: { responseMimeType: "application/json", maxOutputTokens: 1024, temperature: 0 } }, { tier: "fast" });
    const out = parseJson(res.text ?? "") ?? {};
    const extracted = { number: String(out.number ?? ""), issuer: String(out.issuer ?? ""), holder: String(out.holder ?? ""), issued: out.issued || null, expiry: out.expiry || null };
    await sb.from("vms_documents").update({ extracted }).eq("id", doc.id);
    return extracted;
  });

export const verifyVmsDocument = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({
    document_id: z.string().uuid(), action: z.enum(["verify", "reject"]),
    number: z.string().max(100).optional().nullable(), issuer: z.string().max(200).optional().nullable(), holder: z.string().max(200).optional().nullable(),
    issued_date: z.string().optional().nullable(), expiry_date: z.string().optional().nullable(), note: z.string().max(500).optional().nullable(), acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    requireRole(data.acting_role, ["purchasing_executive", "contract_executive", "contract_manager"], "verify vendor documents");
    const { data: doc } = await sb.from("vms_documents").select("*").eq("id", data.document_id).single();
    if (!doc) throw new Error("Document not found");
    const { data: v } = await sb.from("ccms_vendors").select("*").eq("id", doc.vendor_id).single();
    assertTenant(v?.tenant_id, tenantId);
    const type = DOC_TYPES.find((d) => d.id === doc.doc_type);
    if (data.action === "verify") {
      if (type?.expires && !data.expiry_date) throw new Error("Give the expiry date — it drives the alerts.");
      if (data.holder?.trim() && norm(data.holder) && norm(v.name) && !norm(data.holder).includes(norm(v.name)) && !norm(v.name).includes(norm(data.holder))) {
        throw new Error(`The document is issued to "${data.holder}", not ${v.name}. A name mismatch blocks verification.`);
      }
    }
    await sb.from("vms_documents").update(data.action === "verify"
      ? { status: "verified", number: data.number ?? null, issuer: data.issuer ?? null, issued_date: data.issued_date || null, expiry_date: data.expiry_date || null, verified_by: userName, verified_at: new Date().toISOString() }
      : { status: "rejected", verified_by: userName, verified_at: new Date().toISOString() }).eq("id", doc.id);
    // A renewal replaces the credential it renews; the old one is kept, superseded.
    if (data.action === "verify") {
      const { data: prior } = await sb.from("vms_documents").select("id").eq("vendor_id", doc.vendor_id).eq("doc_type", doc.doc_type).eq("status", "verified").neq("id", doc.id);
      if (prior?.length) await sb.from("vms_documents").update({ status: "superseded" }).in("id", prior.map((p: any) => p.id));
      await releaseHoldIfClear(sb, doc.vendor_id);
    }
    await log(sb, { request_id: doc.request_id, vendor_id: doc.vendor_id, event_type: "document", actor_name: userName, acting_role: data.acting_role,
      detail: `${type?.label ?? doc.doc_type}: ${data.action === "verify" ? `verified${data.expiry_date ? `, valid to ${data.expiry_date}` : ""}` : `rejected${data.note ? ` — ${data.note}` : ""}`}.` });
    return { ok: true };
  });

// ── step 8 / VMS-02 step 5: the scored assessment ────────────────────────────

export const assessVmsRequest = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({
    request_id: z.string().uuid(), areas: z.record(z.string(), z.number().min(0).max(5)),
    own_conflict: z.enum(["none", "declared"]), own_conflict_details: z.string().max(1000).optional().nullable(),
    scope_fit: z.string().max(1000).optional().nullable(), acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    const r = await loadRequest(sb, data.request_id, tenantId);
    const sub = r.kind === "subcontractor";
    requireRole(data.acting_role, sub ? ["contract_manager"] : ["purchasing_executive"], "complete the assessment");
    if (data.own_conflict === "declared" && !data.own_conflict_details?.trim()) throw new Error("Describe your conflict of interest.");
    if (!r.screening) throw new Error("Run screening first.");
    if (sub && !r.conflict_check?.accounts_decision) throw new Error("Accounts must approve the CTOS conflict check first.");
    if (!sub && !r.ctos) throw new Error("Finance must attach the CTOS report first.");
    const { data: docs } = await sb.from("vms_documents").select("doc_type,status").eq("request_id", r.id);
    const pending = (docs ?? []).filter((d: any) => d.status === "uploaded");
    if (pending.length) throw new Error(`${pending.length} document(s) still to verify.`);
    const total = prequalScore(data.areas);
    const assessment = { areas: data.areas, total, pass: total >= PASS_MARK, own_conflict: data.own_conflict, own_conflict_details: data.own_conflict_details ?? null, scope_fit: data.scope_fit ?? null, by: userName, at: new Date().toISOString() };
    const compl = needsCompliance(r.screening) || data.own_conflict === "declared" || (sub && r.conflict_check?.accounts_decision === "red_flag");
    const status = !assessment.pass ? "manager" : compl ? "compliance" : "manager";
    await sb.from("vms_requests").update({ assessment, status, updated_at: new Date().toISOString() }).eq("id", r.id);
    await log(sb, { request_id: r.id, vendor_id: r.vendor_id, event_type: "assessed", actor_name: userName, acting_role: data.acting_role,
      detail: `Scored ${total}% (pass ${PASS_MARK}%)${assessment.pass ? "" : " — below the pass mark"}. ${compl ? "Routed to Compliance." : "Straight to approval."}${data.own_conflict === "declared" ? " Assessor declared a conflict." : ""}` });
    return { total, status };
  });

// ── step 10 / VMS-02 step 8: Compliance ──────────────────────────────────────

export const complianceVmsDecision = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({
    request_id: z.string().uuid(), decision: z.enum(["approve", "conditional", "reject"]),
    conditions: z.string().max(1000).optional().nullable(), due: z.string().optional().nullable(),
    rationale: z.string().min(3).max(2000), acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    requireRole(data.acting_role, ["compliance"], "record the Compliance decision");
    const r = await loadRequest(sb, data.request_id, tenantId);
    if (r.status !== "compliance") throw new Error("Nothing is awaiting Compliance on this request.");
    if (data.decision === "conditional" && (!data.conditions?.trim() || !data.due)) throw new Error("A conditional decision needs the conditions and a due date.");
    const compliance = { decision: data.decision, conditions: data.conditions ?? null, due: data.due ?? null, rationale: data.rationale, by: userName, at: new Date().toISOString() };
    const reject = data.decision === "reject";
    await sb.from("vms_requests").update({ compliance, status: reject ? "rejected" : "manager",
      decision: reject ? { outcome: "rejected", reason: data.rationale, by: userName, at: new Date().toISOString() } : r.decision, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (reject) await sb.from("ccms_vendors").update({ status: "rejected" }).eq("id", r.vendor_id);
    if (data.decision === "conditional" && r.kind === "subcontractor") await sb.from("ccms_vendors").update({ safeguards: data.conditions }).eq("id", r.vendor_id);
    await log(sb, { request_id: r.id, vendor_id: r.vendor_id, event_type: "compliance", actor_name: userName, acting_role: data.acting_role,
      detail: `Compliance: ${data.decision}${data.conditions ? ` — conditions: ${data.conditions} (due ${data.due})` : ""}. ${data.rationale}` });
    return { ok: true };
  });

// ── step 12–15 / VMS-02 step 10–11: the decision ─────────────────────────────

export const decideVmsRequest = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({
    request_id: z.string().uuid(), outcome: z.enum(["approve", "conditional", "return", "reject"]),
    reason: z.string().max(2000).optional().nullable(), return_items: z.array(z.string()).optional(), acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await vms(context);
    const r = await loadRequest(sb, data.request_id, tenantId);
    const sub = r.kind === "subcontractor";
    requireRole(data.acting_role, sub ? ["head_contracts"] : ["purchasing_manager"], "decide on this vendor");
    if (r.status !== "manager") throw new Error("Nothing is awaiting this decision.");
    if (data.outcome !== "approve" && data.outcome !== "conditional" && !data.reason?.trim()) throw new Error("A reason is required.");
    if (data.outcome === "conditional" && r.compliance?.decision !== "conditional") throw new Error("Conditional approval needs Compliance's concurrence (a conditional Compliance decision).");
    if ((data.outcome === "approve" || data.outcome === "conditional") && r.assessment && !r.assessment.pass) throw new Error(`The assessment scored ${r.assessment.total}%, below the ${PASS_MARK}% pass mark.`);
    const self = selfApproval(r.requestor_id, userId);
    if (self.blocked) throw new Error("You raised this request and cannot approve it.");
    const now = new Date().toISOString();
    const decision = { outcome: data.outcome, reason: data.reason ?? null, by: userName, at: now };
    if (data.outcome === "return") {
      await sb.from("vms_requests").update({ status: "returned", return_reason: `${data.reason}${data.return_items?.length ? ` (${data.return_items.join(", ")})` : ""}`,
        invite_expires: new Date(Date.now() + 14 * 86_400_000).toISOString(), updated_at: now }).eq("id", r.id);
    } else if (data.outcome === "reject") {
      await sb.from("vms_requests").update({ status: "rejected", decision, updated_at: now }).eq("id", r.id);
      await sb.from("ccms_vendors").update({ status: "rejected" }).eq("id", r.vendor_id);
    } else {
      const { data: v } = await sb.from("ccms_vendors").select("*").eq("id", r.vendor_id).single();
      const rating = r.screening?.rating ?? v?.risk_rating ?? "low";
      // Codes run in sequence within the organisation: V-00001, V-00002, …
      let code = v?.vendor_code;
      if (!code) {
        const { data: coded } = await sb.from("ccms_vendors").select("vendor_code").eq("tenant_id", tenantId).like("vendor_code", "V-%");
        const max = Math.max(0, ...(coded ?? []).map((x: any) => Number(String(x.vendor_code).slice(2)) || 0));
        code = `V-${String(max + 1).padStart(5, "0")}`;
      }
      await sb.from("ccms_vendors").update({
        status: data.outcome === "conditional" ? "conditional" : "approved", vendor_code: code,
        dd_valid_until: addMonths(today(), ddMonths(rating)), approved_at: now, approved_by: userName, compliance_hold: false, hold_reason: null,
        conditions: data.outcome === "conditional" ? { text: r.compliance?.conditions, due: r.compliance?.due } : null,
        ...(sub ? { on_master_sub_list: true, list_review_date: addMonths(today(), 12) } : {}),
      }).eq("id", r.vendor_id);
      await sb.from("vms_requests").update({ status: data.outcome === "conditional" ? "conditional" : "approved", decision, invite_token: null, updated_at: now }).eq("id", r.id);
    }
    await log(sb, { request_id: r.id, vendor_id: r.vendor_id, event_type: "decision", actor_name: userName, acting_role: data.acting_role,
      detail: `${CCMS_ROLES[data.acting_role]}: ${data.outcome}${data.reason ? ` — ${data.reason}` : ""}.${data.outcome === "approve" || data.outcome === "conditional" ? ` ${sub ? "Added to the Master Sub-Contractor List." : "Added to the vendor list."} Due diligence valid ${ddMonths(r.screening?.rating ?? "low")} months.` : ""}${self.note}` });
    return { ok: true };
  });

// ── VMS-03: credential and conflict monitoring ───────────────────────────────

async function releaseHoldIfClear(sb: any, vendorId: string) {
  const { data: v } = await sb.from("ccms_vendors").select("*").eq("id", vendorId).single();
  if (!v?.compliance_hold) return;
  const lapsed = await lapsedMandatory(sb, v);
  if (!lapsed.length) {
    await sb.from("ccms_vendors").update({ compliance_hold: false, hold_reason: null }).eq("id", vendorId);
    await log(sb, { vendor_id: vendorId, event_type: "hold_released", actor_name: "Platform", detail: "Compliance hold released — credentials current." });
  }
}
async function lapsedMandatory(sb: any, v: any): Promise<string[]> {
  const out: string[] = [];
  if (v.dd_valid_until && daysTo(v.dd_valid_until) < 0) out.push("due diligence expired");
  const { data: docs } = await sb.from("vms_documents").select("doc_type,expiry_date").eq("vendor_id", v.id).eq("status", "verified");
  for (const d of docs ?? []) {
    const t = DOC_TYPES.find((x) => x.id === d.doc_type);
    if (d.expiry_date && daysTo(d.expiry_date) < 0 && t?.need[v.category ?? ""] === "M") out.push(`${t.label} expired ${d.expiry_date}`);
  }
  return out;
}

/** The daily scan (step 1, 7): any approved vendor with a lapsed mandatory
 *  credential or due diligence goes on compliance hold — no new awards,
 *  purchase orders or renewals. Idempotent; run on opening the monitor. */
export const runVmsScan = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .handler(async ({ context }) => {
    const { sb, tenantId } = await vms(context);
    const { data: vendors } = await sb.from("ccms_vendors").select("*").eq("tenant_id", tenantId).in("status", ["approved", "conditional"]);
    let held = 0;
    for (const v of vendors ?? []) {
      const lapsed = await lapsedMandatory(sb, v);
      if (lapsed.length && !v.compliance_hold) {
        await sb.from("ccms_vendors").update({ compliance_hold: true, hold_reason: lapsed.join("; ") }).eq("id", v.id);
        await log(sb, { vendor_id: v.id, event_type: "hold", actor_name: "Platform", detail: `Compliance hold: ${lapsed.join("; ")}. No new awards or renewals.` });
        held++;
      } else if (!lapsed.length && v.compliance_hold) await releaseHoldIfClear(sb, v.id);
    }
    return { held };
  });

export const getVmsMonitor = createServerFn({ method: "GET" })
  .middleware([requireVms])
  .handler(async ({ context }) => {
    const { sb, tenantId } = await vms(context);
    const { data: vendors } = await sb.from("ccms_vendors").select("*").eq("tenant_id", tenantId).order("name");
    const ids = (vendors ?? []).map((v: any) => v.id);
    const [{ data: docs }, { data: coi }] = await Promise.all([
      ids.length ? sb.from("vms_documents").select("*").in("vendor_id", ids).order("created_at") : Promise.resolve({ data: [] }),
      sb.from("vms_coi").select("*").eq("tenant_id", tenantId),
    ]);
    return { vendors: vendors ?? [], documents: docs ?? [], coi: coi ?? [] };
  });

/** A renewed licence, policy or certificate, uploaded for verification. */
export const uploadVmsRenewal = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ vendor_id: z.string().uuid(), doc_type: z.string(), file_name: z.string(), file_url: z.string().url(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    requireRole(data.acting_role, ["purchasing_executive", "contract_executive"], "upload a renewal");
    const { data: v } = await sb.from("ccms_vendors").select("tenant_id,name").eq("id", data.vendor_id).single();
    assertTenant(v?.tenant_id, tenantId);
    const { data: prev } = await sb.from("vms_documents").select("id").eq("vendor_id", data.vendor_id).eq("doc_type", data.doc_type).eq("status", "verified").limit(1);
    const { data: doc, error } = await sb.from("vms_documents").insert({ vendor_id: data.vendor_id, doc_type: data.doc_type, file_name: data.file_name, file_url: data.file_url, uploaded_by: userName, supersedes_id: prev?.[0]?.id ?? null }).select().single();
    if (error) throw new Error(error.message);
    await log(sb, { vendor_id: data.vendor_id, event_type: "renewal", actor_name: userName, acting_role: data.acting_role, detail: `Renewed ${DOC_TYPES.find((d) => d.id === data.doc_type)?.label ?? data.doc_type} uploaded for verification.` });
    return doc;
  });

// Annual conflict-of-interest campaign (steps 9–15).
export const startVmsCoiCampaign = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ year: z.number().int().min(2025).max(2100), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    requireRole(data.acting_role, ["purchasing_manager", "purchasing_executive"], "start the conflict-of-interest campaign");
    const { data: vendors } = await sb.from("ccms_vendors").select("id").eq("tenant_id", tenantId).in("status", ["approved", "conditional"]);
    const { due } = coiDates(data.year);
    const rows = (vendors ?? []).map((v: any) => ({ tenant_id: tenantId, vendor_id: v.id, year: data.year, due_date: due }));
    if (rows.length) await sb.from("vms_coi").upsert(rows, { onConflict: "vendor_id,year", ignoreDuplicates: true });
    for (const v of vendors ?? []) await log(sb, { vendor_id: v.id, event_type: "coi_issued", actor_name: userName, acting_role: data.acting_role, detail: `${data.year} conflict-of-interest declaration issued; due ${due}.` });
    return { issued: rows.length };
  });

export const recordVmsCoi = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ coi_id: z.string().uuid(), declared: z.boolean(), details: z.string().max(2000).optional().nullable(), signatory: z.string().min(2), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    requireRole(data.acting_role, ["purchasing_executive"], "register a declaration");
    const { data: c } = await sb.from("vms_coi").select("*").eq("id", data.coi_id).single();
    if (!c) throw new Error("Declaration not found");
    assertTenant(c.tenant_id, tenantId);
    if (data.declared && !data.details?.trim()) throw new Error("A declared interest needs the person and the relationship.");
    const now = new Date().toISOString();
    await sb.from("vms_coi").update({ status: "submitted", declared: data.declared, details: data.details ?? null, signatory: data.signatory, submitted_at: now,
      compliance_notified_at: data.declared ? now : null }).eq("id", c.id);
    await log(sb, { vendor_id: c.vendor_id, event_type: "coi", actor_name: userName, acting_role: data.acting_role,
      detail: `${c.year} declaration registered: ${data.declared ? `interest declared — Compliance notified. ${data.details}` : "no interest declared"}.` });
    return { ok: true };
  });

export const assessVmsCoi = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ coi_id: z.string().uuid(), assessment: z.string().min(3), safeguards: z.string().max(1000).optional().nullable(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    requireRole(data.acting_role, ["compliance"], "assess a declared conflict");
    const { data: c } = await sb.from("vms_coi").select("*").eq("id", data.coi_id).single();
    if (!c) throw new Error("Declaration not found");
    assertTenant(c.tenant_id, tenantId);
    await sb.from("vms_coi").update({ compliance_assessment: data.assessment, safeguards: data.safeguards ?? null, assessed_by: userName, assessed_at: new Date().toISOString() }).eq("id", c.id);
    if (data.safeguards?.trim()) await sb.from("ccms_vendors").update({ safeguards: data.safeguards }).eq("id", c.vendor_id);
    await log(sb, { vendor_id: c.vendor_id, event_type: "coi_assessed", actor_name: userName, acting_role: data.acting_role,
      detail: `Conflict assessed by Compliance.${data.safeguards ? ` Safeguards: ${data.safeguards}` : ""}` });
    return { ok: true };
  });

export const escalateVmsCoi = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ year: z.number().int(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = await vms(context);
    requireRole(data.acting_role, ["purchasing_manager"], "escalate non-responders");
    const { data: rows } = await sb.from("vms_coi").select("id,vendor_id,due_date").eq("tenant_id", tenantId).eq("year", data.year).eq("status", "issued");
    const late = (rows ?? []).filter((r: any) => daysTo(r.due_date) < 0);
    if (late.length) await sb.from("vms_coi").update({ status: "escalated" }).in("id", late.map((r: any) => r.id));
    for (const r of late) await log(sb, { vendor_id: r.vendor_id, event_type: "coi_escalated", actor_name: userName, acting_role: data.acting_role, detail: `No ${data.year} declaration by ${r.due_date} — escalated.` });
    return { escalated: late.length };
  });


export const listVmsVendors = createServerFn({ method: "GET" })
  .middleware([requireVms])
  .handler(async ({ context }) => {
    const { sb, tenantId } = await vms(context);
    const { data } = await sb.from("ccms_vendors").select("*").eq("tenant_id", tenantId).order("name");
    return (data ?? []) as any[];
  });

// ── AI assist: drafts the reviewer edits, never a decision ─────────────────

/** What the file shows so far, for the AI to work from. */
async function requestFacts(sb: any, r: any) {
  const { data: docs, error } = await sb.from("vms_documents").select("doc_type,file_name,file_url,status,expiry_date,number,issuer,extracted").eq("request_id", r.id);
  if (error) throw new Error(error.message);
  const have = new Set((docs ?? []).map((d: any) => d.doc_type));
  const missing = docsFor(r.category).filter((d) => d.level === "M" && !PORTAL_FORMS.has(d.id) && !have.has(d.id)).map((d) => d.label);
  // The company profile says what the vendor does, since when, with whom.
  const pd = (docs ?? []).find((d: any) => d.doc_type === "company_profile");
  let profile = "";
  // (The generated demo files carry a "Demo document — invented …" footer; it is not evidence about the vendor.)
  if (pd) { try { profile = (await documentText(pd)).text.replace(/Demo document[^.]*\./gi, "").replace(/\s+/g, " ").slice(0, 2000); } catch { /* unreadable */ } }
  const yes = ABMS_QUESTIONS.filter((q) => r.abms?.answers?.[q.id] === "yes").map((q) => q.text);
  return [
    `Vendor: ${r.company_name} · ${VENDOR_CATEGORIES[r.category] ?? r.category} · ${r.kind}${r.trade ? ` · trade ${r.trade}` : ""}${r.project ? ` · project ${r.project}` : ""}`,
    r.goods_services ? `Goods/services: ${r.goods_services}` : "",
    r.justification ? `Justification: ${r.justification}` : "",
    r.register ? `Register form: ${JSON.stringify({ ...r.register, bank_account: r.register.bank_account ? "given" : "" })}` : "Register form: not submitted",
    r.screening ? `Screening: risk ${r.screening.rating}${r.screening.relatedParty ? ", RELATED PARTY" : ""}; ${(r.screening.reasons ?? []).join("; ") || "no issues"}` : "Screening: not run",
    r.ctos ? `CTOS: score ${r.ctos.score ?? "—"}; ${[r.ctos.litigation && "litigation", r.ctos.winding_up && "winding-up", r.ctos.director_flags && "director flags"].filter(Boolean).join(", ") || "no adverse records"}` : "CTOS: not recorded",
    r.conflict_check?.accounts_decision ? `Conflict check: ${r.conflict_check.accounts_decision}${r.conflict_check.note ? ` (${r.conflict_check.note})` : ""}` : "",
    `Integrity questionnaire: ${yes.length ? `YES to: ${yes.join(" | ")}${r.abms?.details ? ` — details: ${r.abms.details}` : ""}` : r.abms?.answers ? "all No" : "not answered"}; declaration of interest: ${r.abms?.declaration_interest ?? "—"}${r.abms?.interest_details ? ` (${r.abms.interest_details})` : ""}; CTOS consent: ${r.abms?.ctos_consent ?? "—"}`,
    `Documents uploaded: ${(docs ?? []).map((d: any) => {
      const x = d.extracted ?? {};
      const bits = [d.status, d.number || x.number, d.issuer || x.issuer, (d.expiry_date || x.expiry) && `expires ${d.expiry_date || x.expiry}`].filter(Boolean).join(", ");
      return `${DOC_TYPES.find((t) => t.id === d.doc_type)?.label ?? d.doc_type}: file "${d.file_name}" (${bits})`;
    }).join("; ") || "none"}`,
    profile ? `Company profile (text): ${profile}` : "",
    missing.length ? `Mandatory documents missing: ${missing.join("; ")}` : "All mandatory documents uploaded",
    r.assessment ? `Pre-qualification: ${r.assessment.total}% (${r.assessment.pass ? "pass" : "fail"})` : "",
    r.compliance ? `Compliance: ${r.compliance.decision}${r.compliance.conditions ? ` — conditions: ${r.compliance.conditions}` : ""}` : "",
  ].filter(Boolean).join("\n");
}

/** The AI assist itself — a plain function so it can be run outside a request. */
export async function runVmsAssist(sb: any, r: any, kind: "compliance" | "decision" | "prequal") {
  const data = { kind };
  const facts = await requestFacts(sb, r);
  const honest = "State only what the facts show. Anything not yet done — CTOS not recorded, a document uploaded but not verified, screening not run — is outstanding: say so, never describe it as clear or verified.";
  const ask = data.kind === "compliance"
    ? `You are the Compliance officer doing extended due diligence. Suggest a decision and write the rationale. ${honest} If a step is outstanding, suggest "conditional" with that step as the condition.
Return ONLY JSON: {"decision": "approve" | "conditional" | "reject", "conditions": "for conditional only — what must be done, one line", "due_days": 30, "rationale": ["3–5 bullets, each at most 18 words, citing the facts"]}`
    : data.kind === "decision"
    ? `You are the Purchasing Manager signing off. Write the reason for the decision. If anything is missing or adverse, list what the vendor must correct; otherwise summarise why it is acceptable. ${honest}
Return ONLY JSON: {"suggested": "approve" | "return" | "reject", "bullets": ["2–5 bullets, each at most 16 words"]}`
    : `You are the assessor. Suggest a pre-qualification score 0–5 for each area from the facts (0 = no evidence, 3 = adequate, 5 = strong). Score only on evidence actually present. A document type label lists what it may cover (e.g. "ISO 9001 / 14001 / 45001") — credit only the standard named in the file name or number, never the others. Where there is no evidence, say so and score 0–2.
Areas: ${PREQUAL_AREAS.map((a) => `${a.id}: ${a.label}`).join("; ")}.
Return ONLY JSON: {"areas": {"legal": 0, ...}, "why": {"legal": "at most 12 words", ...}, "scope_fit": "one line"}`;
  const res: any = await generateWithFallback({ contents: [{ role: "user", parts: [{ text: `${ask}\n\nFACTS:\n${facts}` }] }],
    config: { responseMimeType: "application/json", maxOutputTokens: 1500, temperature: 0.2 } }, { tier: "fast" });
  const out = parseJson(res.text ?? "") ?? {};
  const bullets = (xs: any) => (Array.isArray(xs) ? xs : []).filter((x) => typeof x === "string" && x.trim()).map((x: string) => `- ${x.trim().replace(/^[-•*]\s*/, "")}`).join("\n");
  if (data.kind === "compliance") {
    const due = new Date(); due.setDate(due.getDate() + (Number(out.due_days) > 0 ? Math.min(Number(out.due_days), 180) : 30));
    return { decision: ["approve", "conditional", "reject"].includes(out.decision) ? out.decision : "approve", conditions: String(out.conditions ?? ""), due: due.toISOString().slice(0, 10), text: bullets(out.rationale) };
  }
  if (data.kind === "decision") return { suggested: String(out.suggested ?? ""), text: bullets(out.bullets) };
  const areas: Record<string, number> = {}; const why: Record<string, string> = {};
  for (const a of PREQUAL_AREAS) {
    const n = Number(out.areas?.[a.id]);
    if (Number.isFinite(n)) areas[a.id] = Math.max(0, Math.min(5, Math.round(n)));
    if (typeof out.why?.[a.id] === "string") why[a.id] = out.why[a.id].slice(0, 120);
  }
  return { areas, why, text: String(out.scope_fit ?? "") };
}

export const vmsAiAssist = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ request_id: z.string().uuid(), kind: z.enum(["compliance", "decision", "prequal"]) }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId } = await vms(context);
    const r = await loadRequest(sb, data.request_id, tenantId);
    return runVmsAssist(sb, r, data.kind);
  });

/** Finance's CTOS report, read: score and adverse records, as printed. */
export const readCtosReport = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ file_name: z.string().max(200), mime_type: z.string().max(100), base64: z.string().max(4_200_000) }))
  .handler(async ({ data }) => {
    const mime = data.mime_type || (/\.pdf$/i.test(data.file_name) ? "application/pdf" : "");
    if (!(mime === "application/pdf" || mime.startsWith("image/"))) return null;
    const res: any = await generateWithFallback({ contents: [{ role: "user", parts: [
      { text: `Read this CTOS credit report. Only what is printed; never guess.
Return ONLY JSON: {"score": number or null, "litigation": true/false, "winding_up": true/false, "director_flags": true/false, "note": "at most 20 words: anything adverse, or 'No adverse records.'"}` },
      { inlineData: { mimeType: mime, data: data.base64 } },
    ] }], config: { responseMimeType: "application/json", maxOutputTokens: 512, temperature: 0 } }, { tier: "fast" });
    const o = parseJson(res.text ?? "") ?? {};
    return { score: Number.isFinite(Number(o.score)) && o.score !== null ? Number(o.score) : null, litigation: !!o.litigation, winding_up: !!o.winding_up, director_flags: !!o.director_flags, note: String(o.note ?? "").slice(0, 200) };
  });

/** A certificate chosen in a form (before it is stored), read: number, issuer,
 *  holder and dates as printed — for the renewal pop-up. */
export const readVmsCertificateFile = createServerFn({ method: "POST" })
  .middleware([requireVms])
  .inputValidator(z.object({ file_name: z.string().max(200), mime_type: z.string().max(100), base64: z.string().max(4_200_000) }))
  .handler(async ({ data }) => {
    const mime = data.mime_type || (/\.pdf$/i.test(data.file_name) ? "application/pdf" : "");
    if (!(mime === "application/pdf" || mime.startsWith("image/"))) return null;
    const res: any = await generateWithFallback({ contents: [{ role: "user", parts: [
      { text: `Read this certificate and extract, only as printed (never guess; empty string if absent):
{"number": "certificate / policy / registration number", "issuer": "issuing body or insurer", "holder": "the company it is issued to", "issued": "yyyy-mm-dd", "expiry": "yyyy-mm-dd"}
Return ONLY JSON.` },
      { inlineData: { mimeType: mime, data: data.base64 } },
    ] }], config: { responseMimeType: "application/json", maxOutputTokens: 512, temperature: 0 } }, { tier: "fast" });
    const o = parseJson(res.text ?? "") ?? {};
    return { number: String(o.number ?? ""), issuer: String(o.issuer ?? ""), holder: String(o.holder ?? ""), issued: o.issued || null, expiry: o.expiry || null };
  });
