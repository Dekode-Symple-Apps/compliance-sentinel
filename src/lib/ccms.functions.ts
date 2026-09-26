import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProduct } from "@/lib/feature-middleware";
import { generateWithFallback, getDefaultModel } from "@/lib/gemini";
import { docxToText, looksLikeDocx } from "@/lib/docx-editor";
import { extractPdfPages } from "@/lib/pdf-pages";
import { computeCost } from "@/lib/pricing";
import { maskDemoEmail } from "@/lib/legal.functions";
import { assertRowTenant, getCallerTenant, requireFeature } from "@/lib/tenant.functions";
import {
  CONTRACT_TYPES, CCMS_ROLES, DEMO_SINGLE_USER, LOA_ITEMS, BLOCKING_FLAGS,
  buildRoute, computeFlags, nextApproval, reviewsDone, templateById, toMyr,
  type CcmsRole, type Flag, type Stage, type VendorLite,
} from "@/lib/ccms";

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
const roleSchema = z.enum(Object.keys(CCMS_ROLES) as [CcmsRole, ...CcmsRole[]]);

async function ccms(context: any) {
  const { tenantId, features } = await getCallerTenant(context.userId);
  requireFeature(features, "commercial_cms");
  const rawEmail = (context?.claims?.email as string | undefined) ?? null;
  return {
    sb: context.supabase as any,
    tenantId,
    userId: (context?.userId as string | undefined) ?? null,
    userName: rawEmail ? maskDemoEmail(rawEmail) : "Unknown user",
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
  notes: z.string().optional().nullable(),
});

export const saveCcmsVendor = createServerFn({ method: "POST" })
  .middleware([requireCcms])
  .inputValidator(vendorSchema)
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId } = await ccms(context);
    const row = { ...data, dd_valid_until: data.dd_valid_until || null, updated_at: new Date().toISOString() };
    if (data.id) {
      await loadVendor(sb, data.id, tenantId);
      const { data: out, error } = await sb.from("ccms_vendors").update(row).eq("id", data.id).select().single();
      if (error) throw new Error(error.message);
      return out;
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
    return out;
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
      sb.from("ccms_documents").select("id,contract_id,file_name,file_url,mime_type,size_bytes,doc_role,version,ai_review_status,uploaded_by_name,created_at,ai_review->verdict,ai_review->riskScore,ai_review->summary")
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

    const value_myr = toMyr(data.value ?? null, data.currency);
    const base = { ...data, value_myr };
    const flags = computeFlags({ ...base, review: null }, vendor);
    const route = buildRoute(base, flags);
    const { acting_role, ...fields } = data;
    const { data: row, error } = await sb.from("ccms_contracts").insert({
      ...fields,
      side: t.side,
      counterparty_name: vendor?.name ?? data.counterparty_name,
      value_myr,
      template_id: t.templateId ?? null,
      flags, approval_route: route,
      status: "submitted",
      requestor_id: userId, requestor_name: userName,
      requestor_email: (context?.claims?.email as string | undefined) ?? null,
      tenant_id: tenantId,
    }).select().single();
    if (error) throw new Error(error.message);
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
    doc_role: z.enum(["draft", "counterparty", "supporting", "executed"]).default("draft"),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, ["requestor", "contract_executive", "legal"], "upload contract documents");
    const contract = await loadContract(sb, data.contract_id, tenantId);
    if (["approved", "rejected", "closed"].includes(contract.status) && data.doc_role === "draft") {
      throw new Error(`The request is ${contract.status}; a new draft cannot be added.`);
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

async function documentText(doc: any): Promise<{ text: string; pdfBase64?: string }> {
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
    "YOUR JOB IS TO FLAG, NOT TO DRAFT. Never propose replacement wording. For each issue say what is wrong and why it matters to the Company, so a reviewer can comment on it.",
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
  "summary": "3-4 sentences for the reviewer",
  "findings": [{
    "id": "f1",
    "ref": "clause number and heading",
    "excerpt": "EXACT verbatim substring of the draft, 8-25 words, copied character for character so it can be located",
    "severity": "red_flag" | "caution" | "info",
    "category": "commercial" | "legal" | "financial" | "compliance" | "operational",
    "issue": "what is wrong or missing",
    "whyItMatters": "the consequence for the Company"
  }]${tpl ? `,
  "deviation": {
    "clauses": [{ "templateClauseId": "<id in brackets above>", "status": "same" | "changed" | "missing", "draftRef": "draft clause number or empty", "excerpt": "EXACT verbatim draft text, or empty if missing", "change": "how it departs from the approved position (empty if same)", "severity": "high" | "medium" | "low" }],
    "added": [{ "draftRef": "clause number", "excerpt": "EXACT verbatim draft text", "note": "what the added clause does and whether it is acceptable" }]
  }` : ""}${t?.loaCheck ? `,
  "loa": { "items": [{ "id": "<id in brackets above>", "status": "present" | "missing" | "unclear", "excerpt": "EXACT verbatim draft text or empty", "note": "short" }] }` : ""}
}
Cover the 5-12 most significant findings${tpl ? " and EVERY template clause in deviation.clauses" : ""}.`);
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

      // Flags and route follow the new review; status follows the route.
      const routing = await refreshRouting(sb, contract, tenantId);
      const model = res.modelVersion ?? (await getDefaultModel());
      const u = res.usageMetadata ?? {};
      const cost = computeCost({ inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0, thinkingTokens: u.thoughtsTokenCount ?? 0, calls: 1 }, model);
      const cost_log = [...(contract.cost_log ?? []).slice(-49), { op: "Draft review", usd: Number(cost.usd.toFixed(6)), model, at: new Date().toISOString() }];
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
          (loa_check ? `, ${loa_check.items.filter((i) => i.status !== "present").length} Letter of Award item(s) missing or unclear` : "") + "." });
      return { ok: true };
    } catch (e: any) {
      await sb.from("ccms_documents").update({ ai_review_status: "failed" }).eq("id", doc.id);
      throw new Error(e?.message ?? "AI review failed");
    }
  });

function parseJson(raw: string): any {
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
    // A thread is closed by the role that raised it, or by Legal / the Contract Manager.
    if (c.acting_role && c.acting_role !== data.acting_role && !["legal", "contract_manager"].includes(data.acting_role)) {
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
    stage: z.enum(["legal", "finance"]),
    outcome: z.enum(["cleared", "cleared_with_comments", "not_cleared"]),
    note: z.string().max(4000).optional().nullable(),
    acting_role: roleSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userId, userName } = await ccms(context);
    requireRole(data.acting_role, [data.stage], `record the ${data.stage} outcome`);
    const contract = await loadContract(sb, data.contract_id, tenantId);
    if (contract.status !== "in_review") throw new Error("Reviews are recorded while the request is in review.");
    const route: Stage[] = contract.approval_route ?? [];
    const stage = route.find((s) => s.key === data.stage);
    if (!stage) throw new Error(`This request does not need ${data.stage} review.`);
    if (data.outcome !== "cleared" && !data.note?.trim()) throw new Error("Give the reason or the comments with this outcome.");
    if (data.outcome === "cleared") {
      const { count } = await sb.from("ccms_comments").select("id", { count: "exact", head: true })
        .eq("contract_id", contract.id).eq("acting_role", data.stage).eq("status", "open").is("parent_id", null);
      if ((count ?? 0) > 0) throw new Error(`${count} ${data.stage} comment thread(s) are still open. Resolve them, or record "Cleared with comments".`);
    }
    const { data: latest } = await sb.from("ccms_documents").select("id").eq("contract_id", contract.id).eq("doc_role", "draft")
      .order("created_at", { ascending: false }).limit(1);
    await sb.from("ccms_reviews").insert({ contract_id: contract.id, document_id: latest?.[0]?.id ?? null, stage: data.stage,
      outcome: data.outcome, note: data.note, reviewer_id: userId, reviewer_name: userName, acting_role: data.acting_role });

    const now = new Date().toISOString();
    const nextRoute = route.map((s) => s.key === data.stage ? { ...s, status: data.outcome, decided_by: userName, decided_at: now, note: data.note ?? null } : s);
    const status = data.outcome === "not_cleared" ? "returned" : statusFor(nextRoute, true);
    await sb.from("ccms_contracts").update({
      approval_route: nextRoute, status,
      stage_started_at: status !== contract.status ? now : contract.stage_started_at, updated_at: now,
    }).eq("id", contract.id);
    await logEvent(sb, { contract_id: contract.id, event_type: "review", actor_id: userId, actor_name: userName, acting_role: data.acting_role,
      detail: `${stage.label}: ${data.outcome.replace(/_/g, " ")}${data.note ? ` — ${data.note}` : ""}.` });
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
    const blocking = ((contract.flags ?? []) as Flag[]).filter((f) => BLOCKING_FLAGS.includes(f.key));
    if (data.decision === "approved" && blocking.length) {
      throw new Error(`Cannot approve while these are outstanding: ${blocking.map((f) => f.detail).join(" ")}`);
    }
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
      detail: `${stage.label}: ${data.decision}${data.note ? ` — ${data.note}` : ""}.` +
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
