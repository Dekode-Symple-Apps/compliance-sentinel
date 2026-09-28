import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProduct } from "@/lib/feature-middleware";
import { generateWithFallback, getDefaultModel } from "@/lib/gemini";
import { docxToText, escapeXml, looksLikeDocx } from "@/lib/docx-editor";
import PizZip from "pizzip";
import { FILLABLE_DOCX_BASE64 as NDA_FILLABLE } from "@/lib/ccms-templates/lsh-nda-mutual.fill";
import { addAnchoredCommentsToDocx, type AnchoredComment } from "@/lib/docx-anchored-comments";
import { extractPdfPages } from "@/lib/pdf-pages";
import { computeCost } from "@/lib/pricing";
import { assertRowTenant, getCallerTenant, requireFeature } from "@/lib/tenant.functions";
import {
  CONTRACT_TYPES, CCMS_ROLES, DEMO_SINGLE_USER, flowOf, LSH_ENTITIES, LOA_ITEMS, BLOCKING_FLAGS, AI_ROLE, roleLabel,
  buildRoute, computeFlags, nextApproval, reviewsDone, templateById, toMyr, fillNda, displayName,
  COMPARISON_AREAS, defaultSecurities, SECURITY_TYPES, APPROVAL_BANDS, type Security, type KeyTerms,
  autoObligations, contractOwner, normalizeObligations,
  type CcmsRole, type Flag, type Stage, type VendorLite,
} from "@/lib/ccms";

/** One cost-log line: exact token counts from the API, priced from the table. */
/** "Head — note." for a one-line note; a bulleted note keeps its own lines. */
const withNote = (head: string, note?: string | null) =>
  !note?.trim() ? `${head}.` : note.includes("\n") ? `${head}:\n${note.trim()}` : `${head} — ${note.trim()}.`;

function costEntry(op: string, res: any, model: string) {
  const u = res.usageMetadata ?? {};
  const tokens = { input: u.promptTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0, output: u.candidatesTokenCount ?? 0 };
  const cost = computeCost({ inputTokens: tokens.input, outputTokens: tokens.output, thinkingTokens: tokens.thinking, calls: 1 }, model);
  return { op, usd: Number(cost.usd.toFixed(6)), model, tokens, at: new Date().toISOString() };
}


// ---------------------------------------------------------------------------
// Commercial CMS — server functions.
//
// Every function: signed in (requireSupabaseAuth), feature on for the caller's
// organisation (commercial_cms), and by-id rows checked against the caller's
// tenant so another organisation's contract behaves like a missing one.
// Roles are the demo "acting as" persona, checked per action here so a
// reviewer outcome can only be recorded by the role that owns it.
// ---------------------------------------------------------------------------

const requireCcms = requireProduct("commercial_cms");
/** Fill-in versions of the approved templates, by template id. */
const FILLABLE: Record<string, string> = { "lsh-nda-mutual": NDA_FILLABLE };
const roleSchema = z.enum(Object.keys(CCMS_ROLES) as [CcmsRole, ...CcmsRole[]]);

async function ccms(context: any) {
  const { tenantId, features } = context?.tenant ?? await getCallerTenant(context.userId);
  requireFeature(features, "commercial_cms");
  // People are shown by name only — never an email address, whose domain
  // names the organisation.
  const meta = context?.claims?.user_metadata ?? {};
  const email = (context?.claims?.email as string | undefined) ?? "";
  return {
    sb: context.supabase as any,
    tenantId,
    userId: (context?.userId as string | undefined) ?? null,
    userName: String(meta.full_name || meta.name || displayName(email) || "Unknown user"),
  };
}

function requireRole(role: CcmsRole, allowed: CcmsRole[], action: string) {
  if (!allowed.includes(role)) {
    throw new Error(`${CCMS_ROLES[role]} cannot ${action}. Switch "Acting as" to ${allowed.map((r) => CCMS_ROLES[r]).join(" or ")}.`);
  }
}

// Audit writes never fail the action they record.
async function logEvent(sb: any, row: Record<string, unknown>) {
  try { await sb.from("ccms_contract_events").insert(row); }
  catch (e) { console.error("[ccms] event log failed:", e); }
}

async function loadContract(sb: any, id: string, tenantId: string) {
  const { data, error } = await sb.from("ccms_contracts").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Contract not found");
  assertRowTenant(data.tenant_id, tenantId);
  return data;
}

async function loadVendor(sb: any, id: string | null | undefined, tenantId: string): Promise<(VendorLite & Record<string, any>) | null> {
  if (!id) return null;
  const { data } = await sb.from("ccms_vendors").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  assertRowTenant(data.tenant_id, tenantId);
  return data;
}

/** Latest AI review summarised into the inputs the flag rules need. */
function reviewSignals(doc: any) {
  if (!doc) return null;
  const dev = doc.deviation;
  const loa = doc.loa_check;
  return {
    deviation: !!dev && !dev.noTemplate && (dev.clauses ?? []).some((c: any) => c.status !== "same") ,
    nonStandard: !!dev?.noTemplate,
    loaMissing: (loa?.items ?? []).filter((i: any) => i.status !== "present").map((i: any) => i.label ?? i.id),
  };
}

/** Recompute flags and route from the current request, vendor and latest
 *  draft review; carry decisions forward. Returns the patch to write. */
async function refreshRouting(sb: any, contract: any, tenantId: string) {
  const vendor = await loadVendor(sb, contract.vendor_id, tenantId);
  const { data: docs } = await sb.from("ccms_documents").select("*")
    .eq("contract_id", contract.id).in("doc_role", ["draft", "counterparty"])
    .order("created_at", { ascending: false }).limit(1);
  const flags = computeFlags({ ...contract, review: reviewSignals(docs?.[0]) }, vendor);
  const route = buildRoute(contract, flags, contract.approval_route ?? []);
  return { flags, approval_route: route };
}

/** What stops a request being approved: a blocking flag, or a generated draft
 *  whose particulars are still blank ([●]) and so cannot be signed. Shared by
 *  the approval stage and by Lite, where Legal's decision is the approval. */
async function approvalBlocks(sb: any, contract: any): Promise<string | null> {
  const { data: latestDoc } = await sb.from("ccms_documents").select("ai_review").eq("contract_id", contract.id)
    .in("doc_role", ["draft", "counterparty"]).order("created_at", { ascending: false }).limit(1);
  const blanks = latestDoc?.[0]?.ai_review?.generated ? (latestDoc[0].ai_review.findings ?? []).length : 0;
  if (blanks) return `${blanks} required particular(s) are blank in the draft. Regenerate the draft with them completed before approval.`;
  const blocking = ((contract.flags ?? []) as Flag[]).filter((f) => BLOCKING_FLAGS.includes(f.key));
  if (blocking.length) return `Cannot approve while these are outstanding: ${blocking.map((f) => f.detail).join(" ")}`;
  return null;
}

function statusFor(route: Stage[], hasDraft: boolean): string {
  if (!hasDraft) return "submitted";
  if (!reviewsDone(route)) return "in_review";
  const next = nextApproval(route);
  if (!next) return "approved";
  return next.role === "committee" ? "pending_committee" : "pending_approval";
}

// ---------------------------------------------------------------------------
// Vendors (interim master list)
// ---------------------------------------------------------------------------

export const listCcmsVendors = createServerFn({ method: "GET" })
  .middleware([requireCcms])
  .handler(async ({ context }) => {
    const { sb, tenantId } = await ccms(context);
    const { data, error } = await sb.from("ccms_vendors").select("*").eq("tenant_id", tenantId).order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  });

const vendorSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2),
  registration_no: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  status: z.enum(["approved", "pending", "on_hold", "blacklisted"]),
  dd_valid_until: z.string().optional().nullable(),
  risk_rating: z.enum(["low", "medium", "high"]),
  related_party: z.boolean(),
  related_party_note: z.string().optional().nullable(),
  cidb_grade: z.string().optional().nullable(),
  contact_name: z.string().optional().nullable(),
  contact_email: z.string().optional().nullable(),
  contact_designation: z.string().max(200).optional().nullable(),
  contact_phone: z.string().max(100).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  notes: z.string().optional().nullable(),
});

/** Address, designation and phone live in columns added by
 *  20260930b_vendor_contact.sql. Written separately, so saving a vendor still
 *  works on a database where that migration has not been applied yet. */
const CONTACT_EXTRAS = ["address", "contact_designation", "contact_phone"] as const;
async function saveContactExtras(sb: any, id: string, data: Record<string, any>) {
  const extras = Object.fromEntries(CONTACT_EXTRAS.filter((k) => k in data).map((k) => [k, data[k] || null]));
  if (!Object.keys(extras).length) return;
  const { error } = await sb.from("ccms_vendors").update(extras).eq("id", id);
  if (error && !/column/i.test(error.message)) throw new Error(error.message);
}

export const saveCcmsVendor = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(vendorSchema)
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId } = await ccms(context);
    const { address, contact_designation, contact_phone, ...base } = data;
    const extras = { address, contact_designation, contact_phone };
    const row = { ...base, dd_valid_until: data.dd_valid_until || null, updated_at: new Date().toISOString() };
    if (data.id) {
      await loadVendor(sb, data.id, tenantId);
      const { data: out, error } = await sb.from("ccms_vendors").update(row).eq("id", data.id).select().single();
      if (error) throw new Error(error.message);
      await saveContactExtras(sb, data.id, extras);
      return { ...out, ...extras };
    }
    // Duplicate check on SSM number — one master record per company.
    if (data.registration_no) {
      const { data: dup } = await sb.from("ccms_vendors").select("id,name")
        .eq("tenant_id", tenantId).eq("registration_no", data.registration_no).maybeSingle();
      if (dup) throw new Error(`${dup.name} already has registration no. ${data.registration_no}.`);
    }
    const { data: out, error } = await sb.from("ccms_vendors")
      .insert({ ...row, id: undefined, tenant_id: tenantId, created_by: userId }).select().single();
    if (error) throw new Error(error.message);
    await saveContactExtras(sb, out.id, extras);
    return { ...out, ...extras };
  });

/** Sample vendors so the flow can be walked before real data exists. Only
 *  inserted when the organisation has none. Names are fictitious. */
export const seedCcmsVendors = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .handler(async ({ context }) => {
    const { sb, tenantId, userId } = await ccms(context);
    const { count } = await sb.from("ccms_vendors").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    if ((count ?? 0) > 0) return { inserted: 0 };
    const y = new Date().getFullYear();
    const rows = [
      { name: "Sinar Precast Industries Sdn Bhd", registration_no: "201501012345", category: "supplier_material", status: "approved", dd_valid_until: `${y + 1}-03-31`, risk_rating: "low", related_party: false, cidb_grade: null },
      { name: "Teguh Piling & Foundation Sdn Bhd", registration_no: "200801023456", category: "subcontractor", status: "approved", dd_valid_until: `${y + 1}-06-30`, risk_rating: "medium", related_party: false, cidb_grade: "G7" },
      { name: "Kenari Crane Rental Sdn Bhd", registration_no: "201201034567", category: "supplier_pme", status: "approved", dd_valid_until: `${y - 1}-12-31`, risk_rating: "low", related_party: false, cidb_grade: null },
      { name: "Setia Hartanah Consultancy Sdn Bhd", registration_no: "201901045678", category: "consultant", status: "approved", dd_valid_until: `${y + 1}-09-30`, risk_rating: "low", related_party: true, related_party_note: "A director of the Company holds 30% of the shares.", cidb_grade: null },
      { name: "Awan Digital Solutions Sdn Bhd", registration_no: "202001056789", category: "it_service", status: "approved", dd_valid_until: `${y + 1}-01-31`, risk_rating: "high", related_party: false, cidb_grade: null },
      { name: "Mega Tukang Enterprise", registration_no: "SA0123456-X", category: "subcontractor", status: "blacklisted", dd_valid_until: null, risk_rating: "high", related_party: false, cidb_grade: "G2", notes: "Blacklisted for abandoned works." },
    ].map((r) => ({ ...r, tenant_id: tenantId, created_by: userId }));
    const { error } = await sb.from("ccms_vendors").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export const listCcmsContracts = createServerFn({ method: "GET" })
  .middleware([requireCcms])
  .handler(async ({ context }) => {
    const { sb, tenantId } = await ccms(context);
    const { data, error } = await sb.from("ccms_contracts")
      .select("*, vendor:ccms_vendors(name,status,risk_rating)")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as any[];
  });

export const getCcmsContract = createServerFn({ method: "GET" })
  .middleware([requireCcms])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId } = await ccms(context);
    const contract = await loadContract(sb, data.id, tenantId);
    const [vendor, docs, comments, reviews, events] = await Promise.all([
      loadVendor(sb, contract.vendor_id, tenantId),
      sb.from("ccms_documents").select("id,contract_id,file_name,file_url,mime_type,size_bytes,doc_role,version,ai_review_status,uploaded_by_name,created_at,ai_review->verdict,ai_review->riskScore,ai_review->summary,ai_review->generated,ai_review->fields,ai_review->findings,comparison")
        .eq("contract_id", data.id).order("created_at", { ascending: false }),
      sb.from("ccms_comments").select("*").eq("contract_id", data.id).order("created_at"),
      sb.from("ccms_reviews").select("*").eq("contract_id", data.id).order("created_at"),
      sb.from("ccms_contract_events").select("*").eq("contract_id", data.id).order("created_at"),
    ]);
    return {
      contract, vendor,
      documents: docs.data ?? [], comments: comments.data ?? [],
      reviews: reviews.data ?? [], events: events.data ?? [],
    };
  });

export const createCcmsContract = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_type: z.string(),
    title: z.string().min(3),
    entity: z.string().min(2),
    vendor_id: z.string().uuid().optional().nullable(),
    counterparty_name: z.string().optional().nullable(),
    project: z.string().optional().nullable(),
    job_number: z.string().optional().nullable(),
    award_reference: z.string().optional().nullable(),
    value: z.number().nonnegative().optional().nullable(),
    currency: z.string().default("MYR"),
    start_date: z.string().optional().nullable(),
    end_date: z.string().optional().nullable(),
    scope_summary: z.string().min(10),
    personal_data_cross_border: z.boolean().default(false),
    requestor_department: z.string().optional().nullable(),
    owner_name: z.string().max(120).optional().nullable(),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    const t = CONTRACT_TYPES[data.contract_type];
    if (!t) throw new Error("Unknown contract type.");

    // Type-specific mandatory fields.
    const missing: string[] = [];
    if (t.side === "vendor" && !data.vendor_id) missing.push("vendor");
    if (t.side === "client" && !data.counterparty_name?.trim()) missing.push("client name");
    if (t.needsAward && !data.award_reference?.trim()) missing.push("award reference (Approval Form or Board approval)");
    if (data.contract_type !== "nda" && (data.value == null)) missing.push("contract value");
    if (t.side === "client" && !data.job_number?.trim()) missing.push("job number");
    if (missing.length) throw new Error(`Required for a ${t.label}: ${missing.join(", ")}.`);
    if (data.start_date && data.end_date && data.end_date < data.start_date) throw new Error("End date is before the start date.");

    // The counterparty must be an approved vendor; a blacklisted one cannot even be named.
    const vendor = t.side === "vendor" ? await loadVendor(sb, data.vendor_id, tenantId) : null;
    if (t.side === "vendor" && !vendor) throw new Error("Vendor not found.");
    if (vendor?.status === "blacklisted") throw new Error(`${vendor.name} is blacklisted and cannot be named on a contract request.`);
    if (vendor?.compliance_hold) throw new Error(`${vendor.name} is on compliance hold (${vendor.hold_reason ?? "credentials lapsed"}) — no new awards until it is cleared.`);

    const value_myr = toMyr(data.value ?? null, data.currency);
    const base = { ...data, value_myr };
    const flags = computeFlags({ ...base, review: null }, vendor);
    const route = buildRoute(base, flags);
    const { acting_role, owner_name, ...fields } = data;
    const { data: row, error } = await sb.from("ccms_contracts").insert({
      ...fields,
      side: t.side,
      counterparty_name: vendor?.name ?? data.counterparty_name,
      value_myr,
      template_id: t.templateId ?? null,
      flags, approval_route: route,
      status: "submitted",
      requestor_id: userId, requestor_name: userName, requestor_email: null,
      tenant_id: tenantId,
    }).select().single();
    if (error) throw new Error(error.message);
    await saveOwner(sb, row.id, owner_name?.trim() || userName);
    await logEvent(sb, {
      contract_id: row.id, event_type: "created", actor_id: userId, actor_name: userName, acting_role,
      detail: `${t.label} requested${flags.length ? ` — flags: ${flags.map((f) => f.key).join(", ")}` : ""}.`,
    });
    return row;
  });

export const attachCcmsDocument = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(),
    file_name: z.string(),
    file_url: z.string().url(),
    mime_type: z.string().optional().nullable(),
    size_bytes: z.number().optional().nullable(),
    doc_role: z.enum(["draft", "counterparty", "supporting", "executed", "tender"]).default("draft"),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["requestor", "contract_executive", "legal"], "upload contract documents");
    const contract = await loadContract(sb, data.contract_id, tenantId);
    if (!["submitted", "in_review", "returned", "pending_committee", "pending_approval"].includes(contract.status) && ["draft", "counterparty"].includes(data.doc_role)) {
      throw new Error(`The request is ${contract.status}; a new draft cannot be added.`);
    }
    if (data.doc_role === "executed" && !["approved", "signed", "stamped", "active"].includes(contract.status)) {
      throw new Error("The signed copy is uploaded after approval.");
    }
    const { count } = await sb.from("ccms_documents").select("id", { count: "exact", head: true })
      .eq("contract_id", data.contract_id).eq("doc_role", data.doc_role);
    const { acting_role, ...fields } = data;
    const { data: doc, error } = await sb.from("ccms_documents").insert({
      ...fields, version: (count ?? 0) + 1, uploaded_by: userId, uploaded_by_name: userName,
    }).select().single();
    if (error) throw new Error(error.message);
    await logEvent(sb, { contract_id: data.contract_id, event_type: "document", actor_id: userId, actor_name: userName, acting_role,
      detail: `${data.doc_role === "draft" ? "Draft" : data.doc_role} v${doc.version} uploaded: ${data.file_name}` });
    return doc;
  });

// ---------------------------------------------------------------------------
// Review and flag — the AI reads the draft; it never rewrites it.
// ---------------------------------------------------------------------------

export async function documentText(doc: any): Promise<{ text: string; pdfBase64?: string }> {
  const resp = await fetch(doc.file_url);
  if (!resp.ok) throw new Error(`Could not fetch the document (${resp.status}).`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const mime = doc.mime_type || resp.headers.get("content-type") || "";
  if (looksLikeDocx(mime, doc.file_name)) return { text: await docxToText(buffer) };
  if (mime.includes("pdf") || /\.pdf($|\?)/i.test(doc.file_name)) {
    let text = "";
    try { text = (await extractPdfPages(buffer)).map((p) => p.text).filter(Boolean).join("\n\n"); } catch { /* scanned */ }
    return text.trim().length > 500 ? { text } : { text, pdfBase64: buffer.toString("base64") };
  }
  return { text: buffer.toString("utf8") };
}

function reviewPrompt(contract: any, vendor: any): string {
  const t = CONTRACT_TYPES[contract.contract_type];
  const tpl = templateById(contract.template_id);
  const parts = [
    `You are reviewing a draft ${t?.label ?? "contract"} for Lim Seong Hai Capital Berhad group ("the Company"), a Malaysian construction, building-materials and property-development group listed on Bursa Malaysia. The Company's side: ${t?.side === "client" ? "the Company is the CONTRACTOR receiving work from a client" : "the Company is the EMPLOYER / BUYER engaging the counterparty"}.`,
    `Request: "${contract.title}" · entity ${contract.entity} · counterparty ${contract.counterparty_name ?? "—"} · value ${contract.currency} ${contract.value ?? "—"} · ${contract.start_date ?? "?"} to ${contract.end_date ?? "?"}.`,
    `Scope as requested: ${contract.scope_summary}`,
    vendor ? `Vendor record: status ${vendor.status}, risk ${vendor.risk_rating}${vendor.related_party ? ", RELATED PARTY" : ""}.` : "",
    "",
    "YOUR JOB IS TO FLAG, NOT TO DRAFT. Never propose replacement wording. Write like a busy lawyer's margin note: short, plain, no preamble, no repetition of the clause text. Explain only when the reason is not obvious.",
    "Apply Malaysian law: Contracts Act 1950 (s.75 penalties; s.28 restraint of trade), Construction Industry Payment and Adjudication Act 2012 (conditional payment void, s.35), PDPA 2010, MACC Act 2009 s.17A, Stamp Act 1949, Companies Act 2016, CIDB Act 1994.",
    "Also check the draft matches the request: counterparty, value, dates and scope. A mismatch is a finding.",
  ];
  if (tpl) {
    parts.push("", `APPROVED TEMPLATE ${tpl.code} "${tpl.title}" v${tpl.version}. Compare the draft to it clause by clause. For each template clause decide: "same" (present, substance unchanged — wording may differ slightly), "changed" (present but the substance departs from the approved position), or "missing". List any draft clause with no template counterpart under "added". A LOCKED clause that is changed or missing is always high severity.`);
    for (const c of tpl.clauses) {
      parts.push(`[${c.id}] ${c.number}. ${c.title} — ${c.locked ? "LOCKED" : c.mandatory ? "MANDATORY" : "optional"}. Approved position: ${c.keyPosition}\n${c.paragraphs.join("\n")}`);
    }
  }
  if (t?.loaCheck) {
    parts.push("", "LETTER OF AWARD MANDATORY ITEMS — for each, decide present / missing / unclear and quote the passage:");
    for (const i of LOA_ITEMS) parts.push(`[${i.id}] ${i.label} — ${i.hint}`);
  }
  parts.push("", `Return ONLY JSON:
{
  "verdict": "red_flag" | "caution" | "compliant",
  "riskScore": 0-100,
  "summary": "at most 2 short sentences: the verdict and the one or two things that matter most",
  "findings": [{
    "id": "f1",
    "ref": "clause number and heading",
    "excerpt": "EXACT verbatim substring of the draft, 8-25 words, copied character for character so it can be located. For something MISSING, quote the heading or opening words of the clause where it belongs (or of the nearest clause)",
    "severity": "red_flag" | "caution" | "info",
    "category": "commercial" | "legal" | "financial" | "compliance" | "operational",
    "issue": "what is wrong or missing — ONE short sentence, at most 18 words",
    "whyItMatters": "the consequence for the Company — at most 18 words; empty string if it is obvious from the issue"
  }]${tpl ? `,
  "deviation": {
    "clauses": [{ "templateClauseId": "<id in brackets above>", "status": "same" | "changed" | "missing", "draftRef": "draft clause number or empty", "excerpt": "EXACT verbatim draft text, or empty if missing", "change": "how it departs from the approved position, at most 15 words (empty if same)", "severity": "high" | "medium" | "low" }],
    "added": [{ "draftRef": "clause number", "excerpt": "EXACT verbatim draft text", "note": "what it does and whether acceptable, at most 15 words" }]
  }` : ""}${t?.loaCheck ? `,
  "loa": { "items": [{ "id": "<id in brackets above>", "status": "present" | "missing" | "unclear", "excerpt": "EXACT verbatim draft text or empty", "note": "at most 12 words" }] }` : ""}
}
Cover the 5-15 most significant findings${tpl ? " and EVERY template clause in deviation.clauses" : ""}. Each finding becomes a review comment that a person must close, so ${tpl ? "every template deviation that matters" : "every material issue"}${t?.loaCheck ? " and every missing or unclear Letter of Award item" : ""} must appear as its own finding; do not raise the same point twice.`);
  return parts.filter((p) => p !== undefined).join("\n");
}

/**
 * The review itself: one model call that flags issues, compares the draft
 * with the approved template clause by clause, and checks the Letter of Award
 * items. Plain function (no I/O beyond the model) so it can be tested on its
 * own against drafts with known deviations.
 */
export async function runDraftReview(contract: any, vendor: any, fileName: string, text: string, pdfBase64?: string) {
  const parts: any[] = [{ text: reviewPrompt(contract, vendor) }];
  if (text.trim()) parts.push({ text: `DRAFT (${fileName}):\n\n${text.slice(0, 150_000)}` });
  if (pdfBase64) parts.push({ inlineData: { mimeType: "application/pdf", data: pdfBase64 } });
  const res: any = await generateWithFallback(
    { contents: [{ role: "user", parts }], config: { responseMimeType: "application/json", maxOutputTokens: 24576, temperature: 0 } },
    { tier: "quality" },
  );
  const out = parseJson(res.text ?? res.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  if (!out || !Array.isArray(out.findings)) throw new Error("The AI review came back in an unexpected format — run it again.");

  const tpl = templateById(contract.template_id);
  const t = CONTRACT_TYPES[contract.contract_type];
  const deviation = tpl
    ? {
        templateId: tpl.id, templateCode: tpl.code, templateVersion: tpl.version,
        // Every template clause gets a row, even if the model skipped it.
        clauses: tpl.clauses.map((c) => {
          const r = (out.deviation?.clauses ?? []).find((x: any) => x.templateClauseId === c.id) ?? {};
          let status = ["same", "changed", "missing"].includes(r.status) ? r.status : "missing";
          let change = r.change ?? "";
          // Optional clauses the draft leaves out are not a deviation.
          if (status === "missing" && !c.mandatory) { status = "same"; change = "Optional clause not used."; }
          return {
            templateClauseId: c.id, number: c.number, title: c.title, mandatory: c.mandatory, locked: c.locked,
            status, draftRef: r.draftRef ?? "", excerpt: r.excerpt ?? "", change,
            severity: c.locked && status !== "same" ? "high" : (r.severity ?? (status === "same" ? "low" : "medium")),
          };
        }),
        added: Array.isArray(out.deviation?.added) ? out.deviation.added : [],
      }
    : { noTemplate: true, clauses: [] as any[], added: [] as any[] };
  const loa_check = t?.loaCheck
    ? { items: LOA_ITEMS.map((i) => {
        const r = (out.loa?.items ?? []).find((x: any) => x.id === i.id) ?? {};
        return { id: i.id, label: i.label, status: ["present", "missing", "unclear"].includes(r.status) ? r.status : "missing", excerpt: r.excerpt ?? "", note: r.note ?? "" };
      }) }
    : null;
  const ai_review = {
    verdict: out.verdict, riskScore: out.riskScore, summary: out.summary,
    findings: out.findings.map((f: any, i: number) => ({ ...f, id: f.id || `f${i + 1}` })),
    documentText: text.slice(0, 60_000), reviewedAt: new Date().toISOString(),
  };
  return { ai_review, deviation, loa_check, res };
}

/**
 * Every red-flag and caution finding becomes a comment thread from the AI
 * Reviewer, anchored to its passage, so it is tracked to closure like any
 * reviewer's comment. On a re-review of the same document, the AI's earlier
 * threads that nobody has touched are replaced; threads a person has replied
 * to or resolved are kept, and a finding repeating one of them is not
 * re-opened.
 */
async function syncAiThreads(sb: any, contractId: string, documentId: string, findings: any[]) {
  const { data: prior } = await sb.from("ccms_comments").select("id,status,anchor_ref,quote")
    .eq("document_id", documentId).eq("acting_role", AI_ROLE).is("parent_id", null);
  const ids = (prior ?? []).map((p: any) => p.id);
  const { data: replies } = ids.length
    ? await sb.from("ccms_comments").select("parent_id").in("parent_id", ids)
    : { data: [] };
  const touched = new Set((replies ?? []).map((r: any) => r.parent_id));
  const keep = (prior ?? []).filter((p: any) => p.status === "resolved" || touched.has(p.id));
  const drop = (prior ?? []).filter((p: any) => !keep.includes(p));
  if (drop.length) await sb.from("ccms_comments").delete().in("id", drop.map((d: any) => d.id));
  const rows = findings
    .filter((f) => f.severity === "red_flag" || f.severity === "caution")
    .map((f) => ({ f, ref: `Finding: ${f.ref}` }))
    .filter(({ f, ref }) => !keep.some((k: any) => k.anchor_ref === ref && (k.quote ?? "") === (f.excerpt ?? "")))
    .map(({ f, ref }) => ({
      contract_id: contractId, document_id: documentId, anchor_type: "finding", anchor_ref: ref,
      quote: f.excerpt || null,
      body: `${f.issue}${f.whyItMatters ? `\nWhy: ${f.whyItMatters}` : ""}`,
      severity: f.severity,
      author_name: "AI Reviewer", acting_role: AI_ROLE,
    }));
  if (rows.length) {
    const { error } = await sb.from("ccms_comments").insert(rows);
    if (error) console.error("[ccms] AI threads insert failed:", error.message);
  }
  return { added: rows.length, kept: keep.length };
}

export const reviewCcmsDocument = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ document_id: z.string().uuid(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["requestor", "contract_executive", "legal"], "run the AI review");
    const { data: doc, error } = await sb.from("ccms_documents").select("*").eq("id", data.document_id).single();
    if (error || !doc) throw new Error("Document not found");
    const contract = await loadContract(sb, doc.contract_id, tenantId);
    const vendor = await loadVendor(sb, contract.vendor_id, tenantId);

    await sb.from("ccms_documents").update({ ai_review_status: "running" }).eq("id", doc.id);
    try {
      const { text, pdfBase64 } = await documentText(doc);
      const { ai_review, deviation, loa_check, res } = await runDraftReview(contract, vendor, doc.file_name, text, pdfBase64);
      const tpl = templateById(contract.template_id);
      await sb.from("ccms_documents").update({ ai_review, deviation, loa_check, ai_review_status: "done" }).eq("id", doc.id);
      const threads = await syncAiThreads(sb, contract.id, doc.id, ai_review.findings);

      // Flags and route follow the new review; status follows the route.
      const routing = await refreshRouting(sb, contract, tenantId);
      const model = res.modelVersion ?? (await getDefaultModel());
      const cost_log = [...(contract.cost_log ?? []).slice(-49), costEntry("Draft review", res, model)];
      await sb.from("ccms_contracts").update({
        ...routing, cost_log,
        status: contract.status === "submitted" ? statusFor(routing.approval_route, true) : contract.status,
        stage_started_at: contract.status === "submitted" ? new Date().toISOString() : contract.stage_started_at,
        updated_at: new Date().toISOString(),
      }).eq("id", contract.id);
      const devCount = (deviation.clauses as any[]).filter((c) => c.status !== "same").length;
      await logEvent(sb, { contract_id: contract.id, event_type: "ai_review", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
        detail: `AI review of v${doc.version}: ${ai_review.findings.length} finding(s), risk ${ai_review.riskScore}` +
          (tpl ? `, ${devCount} template deviation(s)` : ", no approved template") +
          (loa_check ? `, ${loa_check.items.filter((i) => i.status !== "present").length} Letter of Award item(s) missing or unclear` : "") +
          `; ${threads.added} comment thread(s) opened by the AI Reviewer${threads.kept ? `, ${threads.kept} earlier thread(s) kept` : ""}.` });
      return { ok: true, findings: ai_review.findings.length, riskScore: ai_review.riskScore, verdict: ai_review.verdict, threads: threads.added };
    } catch (e: any) {
      await sb.from("ccms_documents").update({ ai_review_status: "failed" }).eq("id", doc.id);
      throw new Error(e?.message ?? "AI review failed");
    }
  });

export function parseJson(raw: string): any {
  const m = raw.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : raw); } catch { return null; }
}

export const getCcmsDocument = createServerFn({ method: "GET" })
  .middleware([requireCcms])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId } = await ccms(context);
    const { data: doc, error } = await sb.from("ccms_documents").select("*").eq("id", data.id).single();
    if (error || !doc) throw new Error("Document not found");
    const contract = await loadContract(sb, doc.contract_id, tenantId);
    const [{ data: comments }, { data: reviews }] = await Promise.all([
      sb.from("ccms_comments").select("*").eq("contract_id", contract.id).order("created_at"),
      sb.from("ccms_reviews").select("*").eq("contract_id", contract.id).order("created_at"),
    ]);
    return { doc, contract, comments: comments ?? [], reviews: reviews ?? [] };
  });

// ---------------------------------------------------------------------------
// Comments — threads anchored to a finding, a template clause or a passage,
// tracked to closure.
// ---------------------------------------------------------------------------

export const addCcmsComment = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(),
    document_id: z.string().uuid().optional().nullable(),
    parent_id: z.string().uuid().optional().nullable(),
    anchor_type: z.enum(["general", "finding", "clause", "quote"]).default("general"),
    anchor_ref: z.string().optional().nullable(),
    quote: z.string().max(2000).optional().nullable(),
    body: z.string().min(1).max(5000),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    await loadContract(sb, data.contract_id, tenantId);
    const { acting_role, ...fields } = data;
    const { data: row, error } = await sb.from("ccms_comments").insert({
      ...fields, author_id: userId, author_name: userName, acting_role,
    }).select().single();
    if (error) throw new Error(error.message);
    if (!data.parent_id) {
      await logEvent(sb, { contract_id: data.contract_id, event_type: "comment", actor_id: userId, actor_name: userName, acting_role,
        detail: `${CCMS_ROLES[acting_role]} raised a comment${data.anchor_ref ? ` on ${data.anchor_ref}` : ""}.` });
    }
    return row;
  });

export const setCcmsCommentStatus = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ comment_id: z.string().uuid(), status: z.enum(["open", "resolved"]), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    const { data: c } = await sb.from("ccms_comments").select("*").eq("id", data.comment_id).single();
    if (!c) throw new Error("Comment not found");
    await loadContract(sb, c.contract_id, tenantId);
    // A thread is closed by the role that raised it, or by Legal / the Contract
    // Manager. An AI Reviewer thread is closed by any reviewer — never by the requestor.
    if (c.acting_role === AI_ROLE) {
      requireRole(data.acting_role, ["legal", "finance", "contract_manager", "contract_executive"], "close an AI Reviewer thread");
    } else if (c.acting_role && c.acting_role !== data.acting_role && !["legal", "contract_manager"].includes(data.acting_role)) {
      throw new Error(`Only ${CCMS_ROLES[c.acting_role as CcmsRole] ?? "the author"}, Legal or the Contract Manager can close this thread.`);
    }
    const patch = data.status === "resolved"
      ? { status: "resolved", resolved_by_name: userName, resolved_at: new Date().toISOString() }
      : { status: "open", resolved_by_name: null, resolved_at: null };
    await sb.from("ccms_comments").update(patch).eq("id", c.id);
    await logEvent(sb, { contract_id: c.contract_id, event_type: "comment", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `Comment ${data.status === "resolved" ? "resolved" : "reopened"}${c.anchor_ref ? ` (${c.anchor_ref})` : ""}.` });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Reviewer outcomes and approvals
// ---------------------------------------------------------------------------

export const recordCcmsReview = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(),
    stage: z.enum(["legal", "finance", "contracts"]),
    outcome: z.enum(["cleared", "cleared_with_comments", "not_cleared"]),
    note: z.string().max(4000).optional().nullable(),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    const owner: CcmsRole = data.stage === "contracts" ? "contract_manager" : data.stage;
    requireRole(data.acting_role, [owner], `record the ${data.stage === "contracts" ? "tender comparison" : data.stage} outcome`);
    const contract = await loadContract(sb, data.contract_id, tenantId);
    if (contract.status !== "in_review") throw new Error("Reviews are recorded while the request is in review.");
    const route: Stage[] = contract.approval_route ?? [];
    const stage = route.find((s) => s.key === data.stage);
    if (!stage) throw new Error(`This request does not need ${data.stage} review.`);
    if (data.outcome !== "cleared" && !data.note?.trim()) throw new Error("Give the reason or the comments with this outcome.");
    // The document under review is the newest draft OR counterparty markup —
    // the same one routing reads. Checking drafts only let "Cleared" through
    // while the AI's threads on a returned markup were still open.
    const { data: latest } = await sb.from("ccms_documents").select("id").eq("contract_id", contract.id).in("doc_role", ["draft", "counterparty"])
      .order("created_at", { ascending: false }).limit(1);
    // The tender comparison is cleared only when every difference is decided.
    if (data.stage === "contracts" && data.outcome !== "not_cleared") {
      const { data: cmp } = await sb.from("ccms_documents").select("comparison").eq("contract_id", contract.id).not("comparison", "is", null);
      if (!cmp?.length) throw new Error("Run the tender comparison first.");
      const pending = cmp.flatMap((d: any) => d.comparison.items).filter((i: any) => i.status !== "matches" && i.decision === "pending").length;
      if (pending) throw new Error(`${pending} difference(s) with our tender are not decided yet.`);
    }
    if (data.outcome === "cleared") {
      const { count: own } = await sb.from("ccms_comments").select("id", { count: "exact", head: true })
        .eq("contract_id", contract.id).eq("acting_role", owner).eq("status", "open").is("parent_id", null);
      const { count: ai } = latest?.[0]
        ? await sb.from("ccms_comments").select("id", { count: "exact", head: true })
            .eq("document_id", latest[0].id).eq("acting_role", AI_ROLE).eq("status", "open").is("parent_id", null)
        : { count: 0 };
      const open = [own ? `${own} of your own` : "", ai ? `${ai} from the AI Reviewer on the latest draft` : ""].filter(Boolean);
      if (open.length) throw new Error(`Comment threads are still open (${open.join(", ")}). Resolve them, or record "Cleared with comments".`);
    }
    const now = new Date().toISOString();
    const nextRoute = route.map((s) => s.key === data.stage ? { ...s, status: data.outcome, decided_by: userName, decided_at: now, note: data.note ?? null } : s);
    const status = data.outcome === "not_cleared" ? "returned" : statusFor(nextRoute, true);
    // Lite: Legal's decision is the approval, so the approval's blocks apply here.
    if (status === "approved") { const block = await approvalBlocks(sb, contract); if (block) throw new Error(block); }
    await sb.from("ccms_reviews").insert({ contract_id: contract.id, document_id: latest?.[0]?.id ?? null, stage: data.stage,
      outcome: data.outcome, note: data.note, reviewer_id: userId, reviewer_name: userName, acting_role: data.acting_role });
    await sb.from("ccms_contracts").update({
      approval_route: nextRoute, status,
      stage_started_at: status !== contract.status ? now : contract.stage_started_at, updated_at: now,
    }).eq("id", contract.id);
    await logEvent(sb, { contract_id: contract.id, event_type: "review", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: withNote(`${stage.label}: ${data.outcome.replace(/_/g, " ")}`, data.note) });
    return { status };
  });

export const decideCcmsApproval = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(),
    decision: z.enum(["approved", "returned", "rejected"]),
    note: z.string().max(4000).optional().nullable(),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    const contract = await loadContract(sb, data.contract_id, tenantId);
    if (!["pending_committee", "pending_approval"].includes(contract.status)) throw new Error("Nothing is awaiting approval on this request.");
    const route: Stage[] = contract.approval_route ?? [];
    const stage = nextApproval(route);
    if (!stage) throw new Error("No approval stage is pending.");
    requireRole(data.acting_role, [stage.role], `decide at the "${stage.label}" stage`);
    if (data.decision !== "approved" && !data.note?.trim()) throw new Error("A reason is required to return or reject.");
    if (data.decision === "approved") { const block = await approvalBlocks(sb, contract); if (block) throw new Error(block); }
    // Self-approval is blocked; in the single-user demo it is recorded instead.
    const selfApproval = contract.requestor_id && contract.requestor_id === userId;
    if (selfApproval && !DEMO_SINGLE_USER) throw new Error("You raised this request and cannot approve it.");

    await sb.from("ccms_reviews").insert({ contract_id: contract.id, stage: stage.key, outcome: data.decision, note: data.note,
      reviewer_id: userId, reviewer_name: userName, acting_role: data.acting_role });
    const now = new Date().toISOString();
    const nextRoute = route.map((s) => s.key === stage.key ? { ...s, status: data.decision, decided_by: userName, decided_at: now, note: data.note ?? null } : s);
    const status = data.decision === "approved" ? statusFor(nextRoute, true) : data.decision;
    await sb.from("ccms_contracts").update({ approval_route: nextRoute, status, stage_started_at: now, updated_at: now }).eq("id", contract.id);
    await logEvent(sb, { contract_id: contract.id, event_type: "approval", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: withNote(`${stage.label}: ${data.decision}`, data.note) +
        (selfApproval ? " Self-approval — permitted only because the sandbox runs in single-user demo mode." : "") });
    return { status };
  });

/** Back into review after a return: a revised draft is expected, and every
 *  review is taken again (a new version resets reviewer sign-off). */
export const resubmitCcmsContract = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ contract_id: z.string().uuid(), note: z.string().min(3), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["requestor", "contract_executive"], "resubmit a request");
    const contract = await loadContract(sb, data.contract_id, tenantId);
    if (contract.status !== "returned") throw new Error("Only a returned request can be resubmitted.");
    const reset = (contract.approval_route as Stage[]).map((s) => ({ ...s, status: "pending" as const, decided_by: null, decided_at: null, note: null }));
    const routing = await refreshRouting(sb, { ...contract, approval_route: reset }, tenantId);
    const now = new Date().toISOString();
    await sb.from("ccms_contracts").update({ ...routing, status: "in_review", stage_started_at: now, updated_at: now }).eq("id", contract.id);
    await logEvent(sb, { contract_id: contract.id, event_type: "resubmitted", actor_id: userId, actor_name: userName, acting_role: data.acting_role, detail: `Resubmitted — ${data.note}` });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Download with comments — a copy of the draft with every thread as a native
// Word comment on its passage (replies folded in, resolved ones marked done).
// The contract wording is not changed.
// ---------------------------------------------------------------------------

/** Word writes a comment's w:date as LOCAL wall-clock time with a "Z" suffix,
 *  and Word and Pages both read it that way — a true UTC stamp shows as
 *  eight hours off in Malaysia. */
const wordDate = (iso: string) =>
  new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z");

export const exportCcmsDocumentWithComments = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ document_id: z.string().uuid(), include_resolved: z.boolean().default(true) }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    const { data: doc } = await sb.from("ccms_documents").select("*").eq("id", data.document_id).single();
    if (!doc) throw new Error("Document not found");
    const contract = await loadContract(sb, doc.contract_id, tenantId);
    const resp = await fetch(doc.file_url);
    if (!resp.ok) throw new Error(`Could not fetch the document (${resp.status}).`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (!looksLikeDocx(doc.mime_type, doc.file_name)) {
      throw new Error("Download with comments is available for Word (.docx) drafts. For a PDF, use the comment list on the review screen.");
    }
    const { data: all } = await sb.from("ccms_comments").select("*").eq("document_id", doc.id).order("created_at");
    const threads = (all ?? []).filter((c: any) => !c.parent_id && (data.include_resolved || c.status === "open"));
    const stamp = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" });
    const comments: AnchoredComment[] = threads.map((t: any) => {
      const replies = (all ?? []).filter((r: any) => r.parent_id === t.id)
        .map((r: any) => `— ${roleLabel(r.acting_role)} (${displayName(r.author_name)}, ${stamp(r.created_at)}): ${r.body}`);
      const heading = t.anchor_ref ? `${t.anchor_ref}\n` : "";
      const footer = t.status === "resolved" ? `\n[Resolved by ${displayName(t.resolved_by_name)}${t.resolved_at ? `, ${stamp(t.resolved_at)}` : ""}]` : "";
      return {
        quote: t.quote ?? "",
        fallback: (t.anchor_ref ?? "").replace(/^(Finding|Clause|Added clause):?\s*/, "").split(/[—:]/)[0].trim(),
        text: heading + t.body + (replies.length ? `\n${replies.join("\n")}` : "") + footer,
        author: t.acting_role === AI_ROLE ? "AI Reviewer" : `${roleLabel(t.acting_role)} — ${displayName(t.author_name)}`,
        dateIso: wordDate(t.created_at),
        done: t.status === "resolved",
      };
    });
    const out = addAnchoredCommentsToDocx(buffer, comments);
    await logEvent(sb, { contract_id: contract.id, event_type: "export", actor_id: userId, actor_name: userName,
      detail: `Downloaded ${doc.file_name} v${doc.version} with ${comments.length} comment(s).` });
    const base = doc.file_name.replace(/\.docx$/i, "");
    return {
      fileName: `${base} — ${contract.reference_number} review comments.docx`,
      base64: out.buffer.toString("base64"),
      comments: comments.length, exact: out.exact, loose: out.loose, unplaced: out.unplaced,
    };
  });

// ---------------------------------------------------------------------------
// Generate the draft from the approved template (CMS-01 step 4).
// The answers go into the parties block and Schedule 1 only; the wording is
// the approved template's, so the draft is standard by construction — its
// deviation report is written here, not asked of the AI.
// ---------------------------------------------------------------------------

export const generateCcmsDraft = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(),
    fields: z.record(z.string(), z.string().max(4000)),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["requestor", "contract_executive", "legal"], "generate a draft");
    const contract = await loadContract(sb, data.contract_id, tenantId);
    const tpl = templateById(contract.template_id);
    const fillable = tpl ? FILLABLE[tpl.id] : undefined;
    if (!tpl || !fillable) throw new Error("There is no approved template to generate this contract type from.");
    if (["approved", "rejected", "closed"].includes(contract.status)) throw new Error(`The request is ${contract.status}.`);

    const { values, missing } = fillNda(contract.entity, data.fields);
    const zip = new PizZip(Buffer.from(fillable, "base64"));
    let xml = zip.file("word/document.xml")!.asText();
    for (const [k, v] of Object.entries(values)) xml = xml.split(`{{${k}}}`).join(escapeXml(v));
    if (/\{\{[a-z0-9_]+\}\}/.test(xml)) throw new Error("The template has a placeholder the request did not fill.");
    zip.file("word/document.xml", xml);
    const buffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;

    const { count } = await sb.from("ccms_documents").select("id", { count: "exact", head: true })
      .eq("contract_id", contract.id).eq("doc_role", "draft");
    const version = (count ?? 0) + 1;
    const cp = (data.fields.cp_name || contract.counterparty_name || "Counterparty").replace(/[^\w &.-]+/g, "").trim();
    const fileName = `${contract.reference_number} ${tpl.title} - ${cp} - v${version}.docx`;
    const path = `ccms/${contract.id}/${Date.now()}-generated-v${version}.docx`;
    const up = await sb.storage.from("policies").upload(path, buffer, {
      upsert: false, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    if (up.error) throw new Error(`Could not store the generated draft: ${up.error.message}`);
    const fileUrl = sb.storage.from("policies").getPublicUrl(path).data.publicUrl;

    const deviation = {
      templateId: tpl.id, templateCode: tpl.code, templateVersion: tpl.version, generated: true,
      clauses: tpl.clauses.map((c) => ({
        templateClauseId: c.id, number: c.number, title: c.title, mandatory: c.mandatory, locked: c.locked,
        status: "same", draftRef: c.number, excerpt: "", change: "", severity: "low",
      })),
      added: [],
    };
    const ai_review = {
      verdict: missing.length ? "caution" : "compliant", riskScore: 0, generated: true,
      summary: `Generated from the approved template ${tpl.code} v${tpl.version}. The wording is the template's; only the parties and Schedule 1 were completed from the request.` +
        (missing.length ? ` Missing particulars: ${missing.join(", ")}.` : " Ready to send to the counterparty."),
      findings: missing.map((m, i) => ({ id: `m${i + 1}`, ref: "Schedule 1 / parties", excerpt: "", severity: "caution", category: "commercial",
        issue: `${m} not provided.`, whyItMatters: "The agreement cannot be signed with a blank particular." })),
      fields: data.fields, reviewedAt: new Date().toISOString(),
    };
    const { data: doc, error } = await sb.from("ccms_documents").insert({
      contract_id: contract.id, file_name: fileName, file_url: fileUrl, size_bytes: buffer.length,
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      doc_role: "draft", version, ai_review, deviation, ai_review_status: "done",
      uploaded_by: userId, uploaded_by_name: userName,
    }).select().single();
    if (error) throw new Error(error.message);

    const routing = await refreshRouting(sb, contract, tenantId);
    const now = new Date().toISOString();
    await sb.from("ccms_contracts").update({
      ...routing,
      status: contract.status === "submitted" ? statusFor(routing.approval_route, true) : contract.status,
      stage_started_at: contract.status === "submitted" ? now : contract.stage_started_at, updated_at: now,
    }).eq("id", contract.id);
    await logEvent(sb, { contract_id: contract.id, event_type: "generated", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `Draft v${version} generated from ${tpl.code} v${tpl.version}${missing.length ? ` — ${missing.length} particular(s) still blank` : ""}.` });
    return { document: doc, missing };
  });

/** Record that a draft went to the counterparty. The platform does not send
 *  email yet — the user sends the downloaded file; this keeps the trail. */
export const recordCcmsSentToCounterparty = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(),
    document_id: z.string().uuid(),
    recipient: z.string().min(3).max(300),
    note: z.string().max(2000).optional().nullable(),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["requestor", "contract_executive", "legal"], "send a draft to the counterparty");
    const contract = await loadContract(sb, data.contract_id, tenantId);
    const { data: doc } = await sb.from("ccms_documents").select("id,version,file_name,contract_id").eq("id", data.document_id).single();
    if (!doc || doc.contract_id !== contract.id) throw new Error("Document not found");
    await logEvent(sb, { contract_id: contract.id, event_type: "sent", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      meta: { document_id: doc.id, recipient: data.recipient },
      detail: `Draft v${doc.version} sent to the counterparty (${data.recipient})${data.note ? ` — ${data.note}` : ""}.` });
    return { ok: true };
  });

/** The counterparty accepts our draft without changes — the "their version"
 *  step is then done without a markup to review. */
export const recordCcmsAcceptedAsIs = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ contract_id: z.string().uuid(), note: z.string().max(2000).optional().nullable(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["requestor", "contract_executive", "legal"], "record the counterparty's answer");
    const contract = await loadContract(sb, data.contract_id, tenantId);
    await logEvent(sb, { contract_id: contract.id, event_type: "accepted_as_is", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `Counterparty accepts our draft as is${data.note ? ` — ${data.note}` : ""}.` });
    return { ok: true };
  });

// ===========================================================================
// Client contracts (CMS-02): the client's award checked against our tender.
// ===========================================================================

function comparisonPrompt(contract: any): string {
  return [
    `You are the Head of Contracts at Lim Seong Hai Capital Berhad group, a Malaysian contractor. A client has sent its Letter of Award / contract for "${contract.title}" (client: ${contract.counterparty_name ?? "—"}, job ${contract.job_number ?? "—"}).`,
    "Compare the CLIENT'S AWARD with OUR TENDER SUBMISSION. For each area below say whether the award matches what we tendered, differs, or is silent. The point: nothing we did not price or agree to slips into the contract unnoticed.",
    "Write like a margin note: short and plain. No preamble. Explain only when not obvious.",
    "",
    "AREAS:",
    ...COMPARISON_AREAS.map((a) => `[${a.id}] ${a.label}`),
    "",
    `Return ONLY JSON:
{
  "summary": "at most 2 short sentences",
  "items": [{
    "area": "<area id>",
    "status": "matches" | "differs" | "not_in_award" | "not_in_tender",
    "tender": "what we tendered, at most 15 words (empty if silent)",
    "award": "what the award says, at most 15 words (empty if silent)",
    "impact": "what the difference costs or risks us, at most 15 words (empty if matches)",
    "excerpt": "EXACT verbatim 8-25 words from the AWARD, copied character for character (empty if the award is silent)",
    "severity": "high" | "medium" | "low"
  }]
}
One item per area; if an area has two separate differences, give two items for it. Do not report wording differences that change nothing.`,
  ].join("\n");
}

/** The comparison itself — plain function, testable on its own. Decisions
 *  already taken on an unchanged area carry over a re-run. */
export async function runComparison(
  contract: any,
  tender: { name: string; text: string; pdfBase64?: string },
  award: { name: string; text: string; pdfBase64?: string },
  prev: any[] = [],
) {
  const parts: any[] = [{ text: comparisonPrompt(contract) }];
  parts.push({ text: `\n=== OUR TENDER SUBMISSION (${tender.name}) ===\n${tender.text.slice(0, 90_000)}` });
  if (tender.pdfBase64) parts.push({ inlineData: { mimeType: "application/pdf", data: tender.pdfBase64 } });
  parts.push({ text: `\n=== THE CLIENT'S AWARD (${award.name}) ===\n${award.text.slice(0, 90_000)}` });
  if (award.pdfBase64) parts.push({ inlineData: { mimeType: "application/pdf", data: award.pdfBase64 } });
  const res: any = await generateWithFallback(
    { contents: [{ role: "user", parts }], config: { responseMimeType: "application/json", maxOutputTokens: 12288, temperature: 0 } },
    { tier: "quality" },
  );
  const out = parseJson(res.text ?? "");
  if (!out || !Array.isArray(out.items)) throw new Error("The comparison came back in an unexpected format — run it again.");
  const items = out.items
    .filter((i: any) => COMPARISON_AREAS.some((x) => x.id === i.area))
    .map((i: any, n: number) => {
      const status = ["matches", "differs", "not_in_award", "not_in_tender"].includes(i.status) ? i.status : "differs";
      const p = prev.find((x) => x.area === i.area && x.award === i.award && x.tender === i.tender);
      return {
        id: `${i.area}-${n}`, area: i.area, status, tender: String(i.tender ?? ""), award: String(i.award ?? ""),
        impact: String(i.impact ?? ""), excerpt: String(i.excerpt ?? ""), severity: i.severity ?? "medium",
        decision: status === "matches" ? "accepted" : (p?.decision ?? "pending"), decided_by: p?.decided_by ?? null, note: p?.note ?? null,
      };
    });
  return { items, summary: String(out.summary ?? ""), res };
}

export const compareCcmsAward = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ document_id: z.string().uuid(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["contract_executive", "contract_manager", "legal"], "run the tender comparison");
    const { data: award } = await sb.from("ccms_documents").select("*").eq("id", data.document_id).single();
    if (!award) throw new Error("Document not found");
    const contract = await loadContract(sb, award.contract_id, tenantId);
    if (contract.side !== "client") throw new Error("The tender comparison is for client contracts.");
    const { data: tenders } = await sb.from("ccms_documents").select("*").eq("contract_id", contract.id).eq("doc_role", "tender")
      .order("created_at", { ascending: false }).limit(1);
    const tender = tenders?.[0];
    if (!tender) throw new Error("Attach our tender submission first — the award is compared with it.");
    const [a, t] = await Promise.all([documentText(award), documentText(tender)]);
    const { items, summary, res } = await runComparison(contract, { name: tender.file_name, ...t }, { name: award.file_name, ...a }, award.comparison?.items ?? []);
    const comparison = { summary, tenderDocId: tender.id, comparedAt: new Date().toISOString(), items };
    await sb.from("ccms_documents").update({ comparison }).eq("id", award.id);
    const model = res.modelVersion ?? (await getDefaultModel());
    await sb.from("ccms_contracts").update({
      cost_log: [...(contract.cost_log ?? []).slice(-49), costEntry("Tender comparison", res, model)],
      status: contract.status === "submitted" ? "in_review" : contract.status,
      stage_started_at: contract.status === "submitted" ? new Date().toISOString() : contract.stage_started_at,
    }).eq("id", contract.id);
    const diffs = items.filter((i: any) => i.status !== "matches").length;
    await logEvent(sb, { contract_id: contract.id, event_type: "comparison", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `Award compared with our tender: ${diffs} difference(s) across ${COMPARISON_AREAS.length} areas.` });
    return { differences: diffs };
  });

export const decideCcmsDifference = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    document_id: z.string().uuid(), item_id: z.string(),
    decision: z.enum(["accepted", "confirm_with_client", "pending"]),
    note: z.string().max(1000).optional().nullable(), acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["contract_manager"], "decide a tender difference");
    const { data: doc } = await sb.from("ccms_documents").select("id,contract_id,comparison").eq("id", data.document_id).single();
    if (!doc?.comparison) throw new Error("No comparison on this document.");
    const contract = await loadContract(sb, doc.contract_id, tenantId);
    const items = (doc.comparison.items as any[]).map((i) => i.id === data.item_id
      ? { ...i, decision: data.decision, decided_by: userName, decided_at: new Date().toISOString(), note: data.note ?? null } : i);
    const it = items.find((i) => i.id === data.item_id);
    if (!it) throw new Error("Difference not found.");
    await sb.from("ccms_documents").update({ comparison: { ...doc.comparison, items } }).eq("id", doc.id);
    const area = COMPARISON_AREAS.find((a) => a.id === it.area)?.label ?? it.area;
    await logEvent(sb, { contract_id: contract.id, event_type: "difference", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `${area}: ${data.decision === "accepted" ? "accepted" : data.decision === "confirm_with_client" ? "to confirm with the client" : "reopened"}${data.note ? ` — ${data.note}` : ""}.` });
    return { ok: true };
  });

/** Our confirmation letter to the client, and the client's reply. A reply
 *  confirms every difference that was waiting on it. */
export const recordCcmsConfirmation = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(), action: z.enum(["sent", "reply"]), date: z.string(),
    sent_to: z.string().max(300).optional().nullable(), note: z.string().max(2000).optional().nullable(), acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["contract_manager", "contract_executive"], "record the confirmation letter");
    const contract = await loadContract(sb, data.contract_id, tenantId);
    const conf = { ...(contract.confirmation ?? {}) };
    if (data.action === "sent") Object.assign(conf, { sent_date: data.date, sent_to: data.sent_to ?? "", reply_date: null, reply_note: null });
    else {
      if (!conf.sent_date) throw new Error("Record the letter as sent first.");
      Object.assign(conf, { reply_date: data.date, reply_note: data.note ?? "" });
      const { data: docs } = await sb.from("ccms_documents").select("id,comparison").eq("contract_id", contract.id).not("comparison", "is", null);
      for (const d of docs ?? []) {
        const items = (d.comparison.items as any[]).map((i) => i.decision === "confirm_with_client"
          ? { ...i, decision: "confirmed", decided_by: userName, decided_at: new Date().toISOString(), note: data.note ?? i.note } : i);
        await sb.from("ccms_documents").update({ comparison: { ...d.comparison, items } }).eq("id", d.id);
      }
    }
    await sb.from("ccms_contracts").update({ confirmation: conf, updated_at: new Date().toISOString() }).eq("id", contract.id);
    await logEvent(sb, { contract_id: contract.id, event_type: "confirmation", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: data.action === "sent" ? `Confirmation letter sent to the client${data.sent_to ? ` (${data.sent_to})` : ""}.` : `Client replied to the confirmation letter${data.note ? ` — ${data.note}` : ""}.` });
    return { ok: true };
  });

// ===========================================================================
// After approval (CMS-01 steps 13–16, CMS-02 steps 8–11): signed, stamped,
// bonds and insurance, then the repository (CMS-03).
// ===========================================================================

export const recordCcmsSigned = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(), signed_date: z.string(),
    signatories: z.array(z.object({ name: z.string().min(2), designation: z.string().optional().nullable(), party: z.string() })).min(1),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["contract_executive", "legal"], "record signing");
    const contract = await loadContract(sb, data.contract_id, tenantId);
    if (contract.status !== "approved") throw new Error("A contract is signed after it is approved.");
    const { count } = await sb.from("ccms_documents").select("id", { count: "exact", head: true }).eq("contract_id", contract.id).eq("doc_role", "executed");
    if (!count) throw new Error("Upload the signed copy first.");
    if (contract.side === "client") {
      const { data: docs } = await sb.from("ccms_documents").select("comparison").eq("contract_id", contract.id).not("comparison", "is", null);
      const waiting = (docs ?? []).flatMap((d: any) => d.comparison.items).filter((i: any) => i.decision === "confirm_with_client" || (i.status !== "matches" && i.decision === "pending"));
      if (waiting.length) throw new Error(`${waiting.length} difference(s) with our tender are not settled in writing — the client must confirm them before signing.`);
    }
    const securities = (contract.securities?.length ? contract.securities : defaultSecurities(contract.contract_type, contract.value_myr));
    await sb.from("ccms_contracts").update({ signed_date: data.signed_date, signatories: data.signatories, securities, status: "signed", updated_at: new Date().toISOString() }).eq("id", contract.id);
    await logEvent(sb, { contract_id: contract.id, event_type: "signed", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `Signed on ${data.signed_date} by ${data.signatories.map((x) => `${x.name} (${x.party})`).join(", ")}. Stamp within 30 days.` });
    return { ok: true };
  });

export const recordCcmsStamping = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(), sent_date: z.string().optional().nullable(), stamped_date: z.string().optional().nullable(),
    duty: z.number().nonnegative().optional().nullable(), certificate_no: z.string().max(100).optional().nullable(), acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["contract_executive", "legal"], "record stamping");
    const contract = await loadContract(sb, data.contract_id, tenantId);
    if (!contract.signed_date) throw new Error("Record signing first.");
    if (data.stamped_date && !data.certificate_no?.trim()) throw new Error("Give the stamp certificate number with the stamped date.");
    const stamping = { ...(contract.stamping ?? {}), ...Object.fromEntries(Object.entries({ sent_date: data.sent_date, stamped_date: data.stamped_date, duty: data.duty, certificate_no: data.certificate_no }).filter(([, v]) => v !== undefined && v !== null && v !== "")) };
    const status = stamping.stamped_date && contract.status === "signed" ? "stamped" : contract.status;
    await sb.from("ccms_contracts").update({ stamping, status, updated_at: new Date().toISOString() }).eq("id", contract.id);
    await logEvent(sb, { contract_id: contract.id, event_type: "stamping", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: stamping.stamped_date ? `Stamped on ${stamping.stamped_date}, certificate ${stamping.certificate_no}${stamping.duty != null ? `, duty RM${stamping.duty}` : ""}.` : `Sent for stamping on ${stamping.sent_date}.` });
    return { ok: true };
  });

export const saveCcmsSecurities = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(),
    securities: z.array(z.object({ type: z.string(), required: z.boolean(), amount: z.number().nullable().optional(), reference: z.string().max(200).optional(), valid_until: z.string().nullable().optional() })),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["finance", "contract_executive"], "record bonds and insurance");
    const contract = await loadContract(sb, data.contract_id, tenantId);
    if (!contract.signed_date) throw new Error("Bonds and insurance are recorded after signing.");
    const clean: Security[] = data.securities.filter((x) => SECURITY_TYPES.some((t) => t.id === x.type))
      .map((x) => ({ ...x, reference: (x.reference ?? "").trim(), valid_until: x.valid_until || null }));
    await sb.from("ccms_contracts").update({ securities: clean, updated_at: new Date().toISOString() }).eq("id", contract.id);
    const req = clean.filter((x) => x.required);
    const done = req.filter((x) => x.type === "cidb_levy" ? !!x.reference : !!x.reference && !!x.valid_until);
    await logEvent(sb, { contract_id: contract.id, event_type: "securities", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `Bonds and insurance: ${done.length} of ${req.length} required on file${done.length === req.length ? " — payment-ready" : ""}.` });
    return { ok: true };
  });

/** The AI reads the signed copy and proposes the repository record; a person
 *  confirms every field before it is saved. */
/** Key terms read from a signed contract — plain function, testable. */
export async function runKeyTerms(fileName: string, text: string, pdfBase64?: string) {
  const prompt = `Read this signed contract and extract its key terms for the contract repository. Copy what the document says; if it does not state a term, return an empty string or null — never guess.
Return ONLY JSON:
{"parties": "both parties' names, short", "value": <number or null>, "currency": "MYR", "start_date": "yyyy-mm-dd or null", "end_date": "yyyy-mm-dd or null (the date it expires; compute from a stated term if the start date is stated)",
 "notice_period": "e.g. 30 days' written notice, or empty", "renewal": "how it renews, at most 12 words, or empty", "governing_law": "short",
 "obligations": [{"text": "the obligation, at most 15 words", "category": "finance" | "business" | "legal", "due_date": "yyyy-mm-dd when the contract fixes or lets you compute the date, else null", "trigger": "the event or timing it depends on, at most 10 words", "percent": <number or null>, "amount": <number or null>}]}
Obligations: up to 8, of either party, that someone must act on. finance = paying, invoicing, deposits, retention, fees; legal = notices, stamping, confidentiality returns, data breaches, compliance; business = delivery, performance, reporting, renewal. A payment schedule gives one finance obligation per milestone, with its percent and amount (percent × contract value).`;
  const parts: any[] = [{ text: prompt }];
  if (text.trim()) parts.push({ text: `CONTRACT (${fileName}):\n${text.slice(0, 120_000)}` });
  if (pdfBase64) parts.push({ inlineData: { mimeType: "application/pdf", data: pdfBase64 } });
  const res: any = await generateWithFallback({ contents: [{ role: "user", parts }], config: { responseMimeType: "application/json", maxOutputTokens: 4096, temperature: 0 } }, { tier: "quality" });
  return { out: parseJson(res.text ?? "") ?? {}, res };
}

export const extractCcmsKeyTerms = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ contract_id: z.string().uuid(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId } = await ccms(context);
    const contract = await loadContract(sb, data.contract_id, tenantId);
    const { data: docs } = await sb.from("ccms_documents").select("*").eq("contract_id", contract.id).eq("doc_role", "executed")
      .order("created_at", { ascending: false }).limit(1);
    const doc = docs?.[0];
    if (!doc) throw new Error("Upload the signed copy first.");
    const { text, pdfBase64 } = await documentText(doc);
    const { out, res } = await runKeyTerms(doc.file_name, text, pdfBase64);
    const model = res.modelVersion ?? (await getDefaultModel());
    await sb.from("ccms_contracts").update({ cost_log: [...(contract.cost_log ?? []).slice(-49), costEntry("Key terms", res, model)] }).eq("id", contract.id);
    const owner = contractOwner(contract);
    const end_date = out.end_date || contract.end_date || null;
    const value = typeof out.value === "number" ? out.value : contract.value ?? null;
    const extracted = normalizeObligations((Array.isArray(out.obligations) ? out.obligations : []).slice(0, 10).map((o: any, i: number) => ({
      ...(typeof o === "string" ? { text: o } : o), id: `o${i + 1}`,
      amount: typeof o?.amount === "number" ? o.amount : typeof o?.percent === "number" && value ? Math.round((o.percent / 100) * value * 100) / 100 : null,
    })), owner);
    const terms: KeyTerms = {
      owner,
      parties: String(out.parties || `${contract.entity} / ${contract.counterparty_name ?? ""}`),
      value,
      currency: String(out.currency || contract.currency || "MYR"),
      start_date: out.start_date || contract.start_date || null,
      end_date,
      notice_period: String(out.notice_period ?? ""), renewal: String(out.renewal ?? ""), governing_law: String(out.governing_law ?? ""),
      obligations: [...extracted, ...autoObligations(contract, end_date, extracted, owner)],
    };
    return { terms, fromDocument: doc.file_name };
  });

const obligationSchema = z.object({
  id: z.string().max(40).optional(), text: z.string().min(2).max(400), category: z.enum(["finance", "business", "legal"]).optional(),
  pic: z.string().max(120).optional(), due_date: z.string().nullable().optional(), trigger: z.string().max(200).optional(),
  amount: z.number().nullable().optional(), percent: z.number().nullable().optional(), status: z.enum(["open", "done"]).optional(),
  done_by: z.string().nullable().optional(), done_at: z.string().nullable().optional(), auto: z.string().optional(),
});

export const saveCcmsRepository = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(),
    terms: z.object({
      parties: z.string().min(2), value: z.number().nullable().optional(), currency: z.string().optional(),
      start_date: z.string().nullable().optional(), end_date: z.string().nullable().optional(),
      notice_period: z.string().optional(), renewal: z.string().optional(), governing_law: z.string().optional(),
      obligations: z.array(z.union([z.string(), obligationSchema])).default([]),
      owner: z.string().max(120).optional(),
    }),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["contract_executive", "legal", "contract_manager"], "save to the repository");
    const contract = await loadContract(sb, data.contract_id, tenantId);
    if (!contract.signed_date) throw new Error("Only a signed contract goes into the repository.");
    if (!contract.stamping?.stamped_date && flowOf(contract) === "full") throw new Error("Record stamping first — the repository holds the stamped contract.");
    if (!data.terms.end_date) throw new Error("Give the expiry date — it drives the 30-day alert.");
    const owner = data.terms.owner?.trim() || contractOwner(contract);
    const repository = { ...data.terms, owner, obligations: normalizeObligations(data.terms.obligations, owner), confirmed_by: userName, confirmed_at: new Date().toISOString() };
    await sb.from("ccms_contracts").update({ repository, expiry_date: data.terms.end_date, status: "active", updated_at: new Date().toISOString() }).eq("id", contract.id);
    await saveOwner(sb, contract.id, owner);
    await logEvent(sb, { contract_id: contract.id, event_type: "repository", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `Saved to the repository. Expires ${data.terms.end_date}; alert from 30 days before.` });
    return { ok: true };
  });


/** The owner column is added by 20261001_contract_owner.sql; until it runs the
 *  owner lives in the repository record only. */
async function saveOwner(sb: any, id: string, owner: string) {
  const { error } = await sb.from("ccms_contracts").update({ owner_name: owner || null }).eq("id", id);
  if (error && !/owner_name|column/i.test(error.message)) throw new Error(error.message);
}

export const setCcmsOwner = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ contract_id: z.string().uuid(), owner: z.string().min(2).max(120), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    const contract = await loadContract(sb, data.contract_id, tenantId);
    const owner = data.owner.trim();
    await saveOwner(sb, contract.id, owner);
    if (contract.repository) {
      // Business obligations follow the owner unless someone else was named.
      const prev = contractOwner(contract);
      const obligations = normalizeObligations(contract.repository.obligations, prev).map((o) => o.category === "business" && o.pic === prev ? { ...o, pic: owner } : o);
      await sb.from("ccms_contracts").update({ repository: { ...contract.repository, owner, obligations } }).eq("id", contract.id);
    }
    await logEvent(sb, { contract_id: contract.id, event_type: "owner", actor_id: userId, actor_name: userName, acting_role: data.acting_role, detail: `Contract owner: ${owner}.` });
    return { ok: true };
  });

/** Mark an obligation done (or reopen it), or change its PIC or due date. */
export const updateCcmsObligation = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(), id: z.string().max(40),
    status: z.enum(["open", "done"]).optional(), pic: z.string().max(120).optional(), due_date: z.string().nullable().optional(),
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    const contract = await loadContract(sb, data.contract_id, tenantId);
    if (!contract.repository) throw new Error("This contract is not in the repository yet.");
    const owner = contractOwner(contract);
    const list = normalizeObligations(contract.repository.obligations, owner);
    const o = list.find((x) => x.id === data.id);
    if (!o) throw new Error("Obligation not found.");
    const now = new Date().toISOString();
    const next = list.map((x) => x.id !== data.id ? x : {
      ...x, ...(data.pic ? { pic: data.pic } : {}), ...(data.due_date !== undefined ? { due_date: data.due_date } : {}),
      ...(data.status ? { status: data.status, done_by: data.status === "done" ? userName : null, done_at: data.status === "done" ? now : null } : {}),
    });
    await sb.from("ccms_contracts").update({ repository: { ...contract.repository, obligations: next } }).eq("id", contract.id);
    await logEvent(sb, { contract_id: contract.id, event_type: "obligation", actor_id: userId, actor_name: userName, acting_role: null,
      detail: data.status ? `${data.status === "done" ? "Done" : "Reopened"}: ${o.text}` : `Obligation updated: ${o.text}${data.pic ? ` — PIC ${data.pic}` : ""}${data.due_date ? ` — due ${data.due_date}` : ""}` });
    return { ok: true };
  });

// ===========================================================================
// CMS-03: change requests, renewal and closure.
// ===========================================================================

async function actorCtx(context: any) { return ccms(context); }

export const raiseCcmsChange = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(), kind: z.enum(["scope", "rate", "quantity", "time"]), description: z.string().min(5).max(2000),
    value_impact: z.number(), deviates_template: z.boolean(), acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await actorCtx(context);
    requireRole(data.acting_role, ["contract_executive"], "raise a change request");
    const c = await loadContract(sb, data.contract_id, tenantId);
    if (!["active", "stamped", "signed"].includes(c.status)) throw new Error("Changes are raised on a signed contract.");
    const newTotal = (c.value_myr ?? c.value ?? 0) + data.value_impact;
    const band = APPROVAL_BANDS.find((b) => newTotal <= b.upToMyr)!;
    const change = { id: `CR-${String((c.changes ?? []).length + 1).padStart(2, "0")}`, kind: data.kind, description: data.description, value_impact: data.value_impact,
      new_total: newTotal, band: band.label, legal: data.deviates_template ? "pending" : "not_required", approval: "pending", signed: null,
      raised_by: userName, raised_by_id: userId, raised_at: new Date().toISOString() };
    await sb.from("ccms_contracts").update({ changes: [...(c.changes ?? []), change], updated_at: new Date().toISOString() }).eq("id", c.id);
    await logEvent(sb, { contract_id: c.id, event_type: "change", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `${change.id} raised (${data.kind}): ${data.value_impact >= 0 ? "+" : ""}RM${data.value_impact.toLocaleString()} → RM${newTotal.toLocaleString()}; approval by ${band.label}${data.deviates_template ? "; Legal vetting required" : ""}.` });
    return change;
  });

export const decideCcmsChange = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ contract_id: z.string().uuid(), change_id: z.string(), stage: z.enum(["legal", "approval", "signed"]), outcome: z.enum(["cleared", "approved", "rejected", "signed"]), note: z.string().max(1000).optional().nullable(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await actorCtx(context);
    const c = await loadContract(sb, data.contract_id, tenantId);
    const ch = (c.changes ?? []).find((x: any) => x.id === data.change_id);
    if (!ch) throw new Error("Change not found");
    const now = new Date().toISOString();
    if (data.stage === "legal") {
      requireRole(data.acting_role, ["legal"], "vet the amendment");
      if (ch.legal !== "pending") throw new Error("Legal vetting is not pending on this change.");
      ch.legal = data.outcome === "rejected" ? "rejected" : "cleared";
      if (ch.legal === "rejected") ch.approval = "rejected";
    } else if (data.stage === "approval") {
      requireRole(data.acting_role, ["approver"], `approve at the ${ch.band} level`);
      if (ch.legal === "pending") throw new Error("Legal vetting first.");
      if (data.outcome === "rejected" && !data.note?.trim()) throw new Error("Give the reason.");
      const vendor = await loadVendor(sb, c.vendor_id, tenantId);
      if (data.outcome === "approved" && vendor?.compliance_hold) throw new Error(`${vendor.name} is on compliance hold.`);
      ch.approval = data.outcome === "approved" ? "approved" : "rejected";
      ch.approved_by = userName; ch.approved_at = now;
      if (ch.raised_by_id === userId) ch.self_note = "Self-approval — demo mode only.";
    } else {
      requireRole(data.acting_role, ["contract_executive"], "record the signed appendix");
      if (ch.approval !== "approved") throw new Error("The change must be approved first.");
      ch.signed = now;
    }
    const changes = (c.changes as any[]).map((x) => (x.id === ch.id ? ch : x));
    const patch: any = { changes, updated_at: now };
    // A signed appendix changes the contract: new value, repository updated.
    if (data.stage === "signed") {
      patch.value = (c.value ?? 0) + ch.value_impact;
      patch.value_myr = (c.value_myr ?? c.value ?? 0) + ch.value_impact;
      if (c.repository) patch.repository = { ...c.repository, value: (c.repository.value ?? c.value ?? 0) + ch.value_impact, obligations: [...(c.repository.obligations ?? []), `${ch.id}: ${ch.description}`.slice(0, 200)] };
    }
    await sb.from("ccms_contracts").update(patch).eq("id", c.id);
    await logEvent(sb, { contract_id: c.id, event_type: "change", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `${ch.id}: ${data.stage === "signed" ? `appendix signed — contract value now RM${patch.value.toLocaleString()}` : `${data.stage} ${data.outcome}`}${data.note ? ` — ${data.note}` : ""}.` });
    return ch;
  });

/** Before the notice deadline: renew, renegotiate or let it end. Renewal
 *  re-checks the vendor — a vendor on hold, or with lapsed due diligence,
 *  cannot be renewed (CMS-03 steps 6, 11–13). */
export const decideCcmsRenewal = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ contract_id: z.string().uuid(), decision: z.enum(["renew", "renegotiate", "terminate"]), new_end: z.string().optional().nullable(), note: z.string().max(1000).optional().nullable(), acting_role: roleSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await actorCtx(context);
    requireRole(data.acting_role, ["approver", "contract_manager"], "decide the renewal");
    const c = await loadContract(sb, data.contract_id, tenantId);
    if (c.status !== "active") throw new Error("Only an active contract is renewed.");
    if (data.decision === "renew") {
      if (!data.new_end || (c.expiry_date && data.new_end <= c.expiry_date)) throw new Error("Give a new expiry date after the current one.");
      const v = await loadVendor(sb, c.vendor_id, tenantId);
      if (v) {
        const why = [v.compliance_hold && `on compliance hold (${v.hold_reason ?? ""})`, !["approved", "conditional"].includes(v.status) && `status ${v.status}`,
          v.dd_valid_until && new Date(v.dd_valid_until) < new Date() && `due diligence expired ${v.dd_valid_until}`].filter(Boolean);
        if (why.length) throw new Error(`${v.name} cannot be renewed: ${why.join("; ")}. Clear it first.`);
      }
    }
    const renewal = { decision: data.decision, new_end: data.new_end ?? null, note: data.note ?? null, by: userName, at: new Date().toISOString() };
    const patch: any = { renewal, updated_at: new Date().toISOString() };
    if (data.decision === "renew") {
      patch.expiry_date = data.new_end;
      if (c.repository) patch.repository = { ...c.repository, end_date: data.new_end };
    }
    await sb.from("ccms_contracts").update(patch).eq("id", c.id);
    await logEvent(sb, { contract_id: c.id, event_type: "renewal", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: data.decision === "renew" ? `Renewed to ${data.new_end}; vendor re-validated.` : data.decision === "renegotiate" ? `To renegotiate${data.note ? ` — ${data.note}` : ""}.` : `Not renewed — to be closed at expiry.${data.note ? ` ${data.note}` : ""}` });
    return renewal;
  });

/** Closure: payments, retention (half at CPC, half at CMGD with the final
 *  account), bonds returned, defects closed, obligations met. Blocked while
 *  any is open unless overridden with a reason. Then 7 years' retention. */
export const closeCcmsContract = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({
    contract_id: z.string().uuid(),
    checklist: z.object({
      payments: z.boolean(), retention_cpc: z.string().max(100).optional().nullable(), retention_cmgd: z.string().max(100).optional().nullable(),
      bonds_returned: z.boolean(), defects_closed: z.boolean(), obligations_met: z.boolean(),
    }),
    override_reason: z.string().max(1000).optional().nullable(), legal_hold: z.boolean().default(false), acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await actorCtx(context);
    requireRole(data.acting_role, ["contract_manager"], "close a contract");
    const c = await loadContract(sb, data.contract_id, tenantId);
    if (c.status !== "active") throw new Error("Only an active contract is closed.");
    const works = ["letter_of_award", "work_order", "subcontract", "client_loa", "client_contract"].includes(c.contract_type);
    const k = data.checklist;
    // Lite (a template document): nothing to pay, return or make good — it
    // ends with a reason and is kept like any other contract.
    const lite = flowOf(c) === "lite";
    if (lite && !data.override_reason?.trim()) throw new Error("Say why it ends — e.g. expired, purpose completed.");
    const open = lite ? [] : [
      !k.payments && "final payments", works && !k.retention_cpc && "first half of retention (CPC reference)", works && !k.retention_cmgd && "second half of retention (CMGD and final account reference)",
      !k.bonds_returned && "bonds returned", !k.defects_closed && "defects closed", !k.obligations_met && "obligations met",
      (c.changes ?? []).some((x: any) => x.approval === "pending" || (x.approval === "approved" && !x.signed)) && "open change requests",
    ].filter(Boolean) as string[];
    if (open.length && !data.override_reason?.trim()) throw new Error(`Still open: ${open.join(", ")}. Close them, or override with a reason.`);
    const now = new Date();
    const retain = new Date(now); retain.setFullYear(retain.getFullYear() + 7);
    const closure = { checklist: k, open_at_close: open, override_reason: open.length || lite ? data.override_reason : null, legal_hold: data.legal_hold,
      closed_at: now.toISOString(), by: userName, retain_until: retain.toISOString().slice(0, 10) };
    await sb.from("ccms_contracts").update({ closure, status: "closed", updated_at: now.toISOString() }).eq("id", c.id);
    await logEvent(sb, { contract_id: c.id, event_type: "closed", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `${lite ? `Ended — ${data.override_reason}` : `Closed${open.length ? ` with override (${open.join(", ")}): ${data.override_reason}` : ""}`}. Retained to ${closure.retain_until}${data.legal_hold ? " — legal hold" : ""}.${c.vendor_id && works ? " Subcontractor evaluation due." : ""}` });
    return closure;
  });

// ---------------------------------------------------------------------------
// AI Chat intake — the same stateless interview as Legal CMS's intake: the
// client sends the whole conversation each turn; the model asks at most one
// question at a time and, once it has enough, proposes the request as
// structured fields that fill the New Request form.
// ---------------------------------------------------------------------------

function intakeSystem(vendors: any[]): string {
  const types = Object.entries(CONTRACT_TYPES).map(([k, t]) => `${k}: ${t.label} (${t.side === "vendor" ? "we award" : "we are awarded"}${t.templateId ? "; approved template, draft generated from it" : ""})`);
  const today = new Date().toISOString().slice(0, 10);
  return `You are the Commercial Contracts Intake Assistant for the Lim Seong Hai group. You replace the contract request form: interview the requester in plain English, then propose the request.

Ask AT MOST ONE question per turn and at most four in total. Be brief and warm. Today is ${today}.

What a request needs: which side (vendor contract — the Company awards work; or client contract — the Company is awarded work), the contract type, the contracting entity, the vendor (or the client's name), a short title, the scope in 1–2 sentences, value and currency (not needed for an NDA), start and end dates, and the requesting department. For an NDA also: the purpose of the disclosure, who discloses (Mutual / Company to Counterparty only / Counterparty to Company only), the term (One (1) year / Two (2) years / Three (3) years).

CONTRACT TYPES (use the key): ${types.join("; ")}.
ENTITIES: ${LSH_ENTITIES.join("; ")}.
VENDORS ON FILE (name — status): ${vendors.map((v) => `${v.name} — ${v.compliance_hold ? "on compliance hold" : v.status}`).join("; ") || "none"}.

Rules:
- Use a vendor from the list, spelled exactly. If the vendor is not on file, blacklisted or on hold, say so and tell them to onboard or clear it in Vendor Management first; do not propose.
- Never invent a value, date or reference the requester did not give; leave it null. NDAs run from today; end date = start + term − 1 day.
- Propose only when you have the type, entity, counterparty, title and scope, plus the NDA answers for an NDA, or the value and the start and end dates (ask for both dates in one question, field "dates") for any other contract. Never on the first turn unless the first message already has all of it.

When you ask a question, also say what you are asking for in "ask", so the screen can offer choices:
- "field": one of side, contract_type, entity, vendor, department, purpose, direction, term, start_date, dates, value, scope, title, other.
- "options": for department, purpose, scope, title or other, up to 5 short likely answers drawn from the conversation (e.g. departments: Group IT, Project Management, Procurement, Finance, Legal). Leave [] for the rest; the screen supplies them.
Do not list the choices in "reply" — the screen shows them. Set "ask" to null when you propose.

Reply with ONLY JSON, no markdown:
{"reply": "your message", "ask": null | {"field": "", "options": []}, "action": null | {"type": "propose_request", "draft": {
  "side": "vendor" | "client", "contract_type": "key", "entity": "exact entity", "vendor_name": "exact vendor name or null", "counterparty_name": "client name or null",
  "title": "", "scope_summary": "", "project": "", "award_reference": "", "value": null, "currency": "MYR", "start_date": "yyyy-mm-dd or null", "end_date": "yyyy-mm-dd or null",
  "requestor_department": "", "personal_data_cross_border": false,
  "particulars": {"purpose": "", "direction": "Mutual", "term": "Two (2) years"} }}}`;
}

/** The choices shown under the assistant's question. Lists the records hold
 *  (types, entities, vendors) come from the records, not from the model. */
function intakeAsk(ask: any, vendors: any[]): { field: string; kind: "choice" | "date" | "dates" | "value"; options: string[] } | null {
  const field = typeof ask?.field === "string" ? ask.field : "";
  if (!field) return null;
  const clean = (xs: any) => (Array.isArray(xs) ? xs : []).filter((x) => typeof x === "string" && x.trim()).map((x: string) => x.trim().slice(0, 120)).slice(0, 5);
  switch (field) {
    case "side": return { field, kind: "choice", options: ["Vendor contract — we award the work", "Client contract — we are awarded the work"] };
    case "contract_type": return { field, kind: "choice", options: Object.values(CONTRACT_TYPES).map((t) => t.label) };
    case "entity": return { field, kind: "choice", options: [...LSH_ENTITIES] };
    case "vendor": return { field, kind: "choice", options: vendors.filter((v) => ["approved", "conditional"].includes(v.status) && !v.compliance_hold).map((v) => v.name) };
    case "direction": return { field, kind: "choice", options: ["Mutual", "Company to Counterparty only", "Counterparty to Company only"] };
    case "term": return { field, kind: "choice", options: ["One (1) year", "Two (2) years", "Three (3) years"] };
    case "start_date": return { field, kind: "date", options: [] };
    case "dates": return { field, kind: "dates", options: [] };
    case "value": return { field, kind: "value", options: [] };
    default: { const o = clean(ask.options); return o.length ? { field, kind: "choice", options: o } : null; }
  }
}

export const ccmsIntakeChat = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).min(1).max(40) }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId } = await ccms(context);
    const { data: vendors } = await sb.from("ccms_vendors").select("name,status,compliance_hold").eq("tenant_id", tenantId).order("name");
    const res: any = await generateWithFallback({
      contents: data.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] })),
      config: { systemInstruction: intakeSystem(vendors ?? []), responseMimeType: "application/json", maxOutputTokens: 2048, temperature: 0.2 },
    }, { tier: "quality" });
    const text = res.text ?? res.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const out = parseJson(text);
    if (out && typeof out.reply === "string") {
      const d = out.action?.type === "propose_request" ? out.action.draft : null;
      // Keep only a proposal the form can take: a known type and entity.
      const ok = d && CONTRACT_TYPES[d.contract_type] && LSH_ENTITIES.includes(d.entity);
      return { reply: out.reply, ask: ok ? null : intakeAsk(out.ask, vendors ?? []), action: ok ? { type: "propose_request", draft: d } : null };
    }
    return { reply: text || "Sorry — could you say a bit more about the contract you need?", ask: null, action: null };
  });

/** The return note, drafted from what the review found: the latest draft's
 *  red flags and cautions, the open comment threads and any blocking flags,
 *  as short bullets (most serious first). The reviewer edits it before returning. */
export const draftCcmsReturnNote = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(z.object({ contract_id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId } = await ccms(context);
    const contract = await loadContract(sb, data.contract_id, tenantId);
    const [{ data: docs }, { data: threads }] = await Promise.all([
      sb.from("ccms_documents").select("id,file_name,version,ai_review,deviation").eq("contract_id", contract.id).neq("doc_role", "executed")
        .not("ai_review", "is", null).order("created_at", { ascending: false }).limit(1),
      sb.from("ccms_comments").select("anchor_ref,body,status,parent_id,acting_role").eq("contract_id", contract.id).is("parent_id", null).eq("status", "open"),
    ]);
    const doc = docs?.[0];
    const findings = ((doc?.ai_review?.findings ?? []) as any[]).filter((f) => f.severity !== "info")
      .sort((a, b) => (a.severity === "red_flag" ? 0 : 1) - (b.severity === "red_flag" ? 0 : 1));
    const locked = ((doc?.deviation?.clauses ?? []) as any[]).filter((c) => c.locked && c.status !== "same");
    const blocks = ((contract.flags ?? []) as any[]).filter((f) => BLOCKING_FLAGS.includes(f.key));
    const input = [
      ...findings.map((f) => `[${f.severity === "red_flag" ? "RED FLAG" : "CAUTION"}] ${f.ref}: ${f.issue}${f.whyItMatters ? ` (${f.whyItMatters})` : ""}`),
      ...locked.map((c) => `[LOCKED CLAUSE] Clause ${c.number} ${c.title}: ${c.change || c.status}`),
      // The AI's own threads repeat its findings; people's comments are added.
      ...(threads ?? []).filter((t: any) => t.acting_role !== AI_ROLE).map((t: any) => `[COMMENT] ${t.anchor_ref ?? "General"}: ${String(t.body ?? "").slice(0, 300)}`),
      ...blocks.map((f) => `[BLOCKING] ${f.detail}`),
    ];
    if (!input.length) return { note: "", bullets: [] as string[] };
    const prompt = `You write the note returning a contract draft for amendment (${CONTRACT_TYPES[contract.contract_type]?.label ?? "contract"} with ${contract.counterparty_name ?? "the counterparty"}).
Summarise the issues below into 3–6 bullets, most serious first. Each bullet: what must change, in the imperative, at most 16 words, naming the clause where known. Merge duplicates. No preamble, no legal advice beyond the issues given.
ISSUES:
${input.join("\n")}
Return ONLY JSON: {"bullets": ["..."]}`;
    const res: any = await generateWithFallback({ contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", maxOutputTokens: 1024, temperature: 0.2 } }, { tier: "fast" });
    const model = res.modelVersion ?? (await getDefaultModel());
    await sb.from("ccms_contracts").update({ cost_log: [...(contract.cost_log ?? []).slice(-49), costEntry("Return note", res, model)] }).eq("id", contract.id);
    const bullets = ((parseJson(res.text ?? "")?.bullets ?? []) as any[]).filter((b) => typeof b === "string" && b.trim()).map((b: string) => b.trim().replace(/^[-•*]\s*/, "")).slice(0, 8);
    return { note: bullets.map((b) => `- ${b}`).join("\n"), bullets };
  });
