import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProduct } from "@/lib/feature-middleware";
import { assertRowTenant } from "@/lib/tenant.functions";
import { generateWithFallback, getDefaultModel } from "@/lib/gemini";
import { extractPdfPages } from "@/lib/pdf-pages";
import { convertToPdf } from "@/lib/pdf-convert";
import { computeCost } from "@/lib/pricing";
import { displayName } from "@/lib/ccms";
import { BRAND_RULES, GUIDELINE, PALETTE, TYPEFACES, ruleById } from "@/lib/brand-guideline";
import {
  VERDICT_LABEL, toFix, AGENCIES, BRAND_WORKSPACE, isStatutory, CHANNELS, MATERIAL_TYPES, findingSeverity, guardVerdict, latestReview,
  type BrandFinding, type BrandReview, type RuleResult,
} from "@/lib/brand";

// ---------------------------------------------------------------------------
// Branding Compliance. A submission is an analysis_reports row in the
// brand_compliance workspace (as Credit Risk is), with the brand record in
// summary_json.brand: versions (each with its AI review), status, decision,
// events and the AI cost log. The feature switch and the caller's tenant are
// checked on every call.
// ---------------------------------------------------------------------------

const requireBrand = requireProduct(BRAND_WORKSPACE);
const MAX_BYTES = 19 * 1024 * 1024;
const MAX_PAGES = 60;

function who(context: any) {
  const meta = context?.claims?.user_metadata ?? {};
  const email = (context?.claims?.email as string | undefined) ?? "";
  return { sb: context.supabase as any, tenantId: context.tenant.tenantId as string, userName: String(meta.full_name || meta.name || displayName(email) || "Unknown user") };
}

async function load(sb: any, id: string, tenantId: string) {
  const { data, error } = await sb.from("analysis_reports").select("*").eq("id", id).single();
  if (error || !data || data.workspace_id !== BRAND_WORKSPACE) throw new Error("Submission not found");
  assertRowTenant(data.tenant_id, tenantId);
  return data;
}

const view = (row: any) => ({ id: row.id, created_at: row.created_at, status: row.status, ...(row.summary_json?.brand ?? {}) });

async function save(sb: any, row: any, brand: any, status?: string) {
  const { error } = await sb.from("analysis_reports").update({
    status: status ?? row.status, summary_json: { ...(row.summary_json ?? {}), brand },
  }).eq("id", row.id);
  if (error) throw new Error(error.message);
}

const event = (by: string, role: string, type: string, detail: string) => ({ at: new Date().toISOString(), by, role, type, detail });

const kindOf = (name: string, mime?: string | null): "pdf" | "image" | "office" => {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (/\.(png|jpe?g|webp)$/.test(n) || (mime ?? "").startsWith("image/")) return "image";
  if (/\.(pptx|ppt|docx|doc)$/.test(n)) return "office";
  throw new Error("This file type can't be checked. Upload a PDF, PowerPoint, Word file or an image (PNG or JPG).");
};

// ── list and read ───────────────────────────────────────────────────────────

export const listBrandSubmissions = createServerFn({ method: "GET" })
  .middleware([requireBrand])
  .handler(async ({ context }) => {
    const { sb, tenantId } = who(context);
    const { data, error } = await sb.from("analysis_reports").select("id,created_at,status,tenant_id,summary_json")
      .eq("workspace_id", BRAND_WORKSPACE).eq("tenant_id", tenantId).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(view);
  });

export const getBrandSubmission = createServerFn({ method: "GET" })
  .middleware([requireBrand])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId } = who(context);
    return view(await load(sb, data.id, tenantId));
  });

// ── submit ──────────────────────────────────────────────────────────────────

const fileSchema = { file_name: z.string().min(1).max(300), file_url: z.string().url(), mime: z.string().max(200).optional().nullable() };

export const createBrandSubmission = createServerFn({ method: "POST" })
  .middleware([requireBrand])
  .inputValidator(z.object({
    agency: z.string().min(2).max(200), title: z.string().min(3).max(300),
    material_type: z.enum(Object.keys(MATERIAL_TYPES) as [string, ...string[]]),
    channel: z.enum(Object.keys(CHANNELS) as [string, ...string[]]), ...fileSchema,
  }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = who(context);
    kindOf(data.file_name, data.mime);
    const year = new Date().getFullYear();
    const { count } = await sb.from("analysis_reports").select("id", { count: "exact", head: true })
      .eq("workspace_id", BRAND_WORKSPACE).eq("tenant_id", tenantId);
    const ref = `BC-${year}-${String((count ?? 0) + 1).padStart(4, "0")}`;
    const brand = {
      ref, agency: data.agency, title: data.title, material_type: data.material_type, channel: data.channel, submitted_by: userName,
      versions: [{ v: 1, file_name: data.file_name, file_url: data.file_url, mime: data.mime ?? null, uploaded_by: userName, uploaded_at: new Date().toISOString(), review_status: "pending" }],
      decision: null, cost_log: [],
      events: [event(userName, "agency", "submitted", `${MATERIAL_TYPES[data.material_type]} sent for checking: ${data.title}.`)],
    };
    const { data: row, error } = await sb.from("analysis_reports").insert({
      title: data.title, policy_name: data.agency, status: "reviewing", workflow_type: "brand_review",
      source_file_url: data.file_url, workspace_id: BRAND_WORKSPACE, summary_json: { workflow_type: "brand_review", brand },
    }).select("id").single();
    if (error || !row) throw new Error(error?.message ?? "Could not create the submission");
    return { id: row.id as string, ref };
  });

export const reviseBrandSubmission = createServerFn({ method: "POST" })
  .middleware([requireBrand])
  .inputValidator(z.object({ id: z.string().uuid(), note: z.string().max(1000).optional().nullable(), ...fileSchema }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = who(context);
    kindOf(data.file_name, data.mime);
    const row = await load(sb, data.id, tenantId);
    const brand = row.summary_json.brand;
    if (row.status !== "returned") throw new Error("You can upload a new version once the brand officer sends it back.");
    const v = (brand.versions?.length ?? 0) + 1;
    brand.versions = [...brand.versions, { v, file_name: data.file_name, file_url: data.file_url, mime: data.mime ?? null, uploaded_by: userName, uploaded_at: new Date().toISOString(), review_status: "pending", note: data.note ?? null }];
    brand.decision = null;
    brand.events = [...brand.events, event(userName, "agency", "revised", `Version ${v} uploaded${data.note ? `: ${data.note}` : ""}.`)];
    await save(sb, row, brand, "reviewing");
    return { v };
  });

// ── the AI review ───────────────────────────────────────────────────────────

function reviewPrompt(brand: any, pages: number, isImage: boolean, extra: string) {
  const rules = BRAND_RULES.map((r) => ({ id: r.id, category: r.category, severity: r.severity, rule: r.rule, check: r.check_how, plain_name: r.title }));
  return [
    `You are the brand compliance reviewer at ${GUIDELINE.owner}. Review the attached ${isImage ? "image" : `document (${pages} page${pages === 1 ? "" : "s"}; each slide is one page)`} against the ${GUIDELINE.title} (${GUIDELINE.version}).`,
    `Submitted by: ${brand.agency}. Material: ${MATERIAL_TYPES[brand.material_type] ?? brand.material_type}, channel: ${CHANNELS[brand.channel] ?? brand.channel}. Title: "${brand.title}".`,
    `Approved palette: ${PALETTE.map((p) => `${p.name} ${p.hex} (${p.role})`).join("; ")}. Typefaces: headings ${TYPEFACES.headings}, body ${TYPEFACES.body}, fallback ${TYPEFACES.fallback}.`,
    `State vision (verbatim): "${GUIDELINE.vision}" Pillars: ${GUIDELINE.pillars.join(", ")}.`,
    "The state crest (Jata Negeri Sarawak) may appear as an official artwork or as a clearly labelled placeholder emblem in drafts; treat a labelled placeholder as the crest for position and proportion checks.",
    isStatutory(brand.agency)
      ? "The submitting agency is a statutory body or council with its own corporate identity. Under Circular Memorandum 47/75 it does not use the state crest without the State Secretary's written permission, so BC-1.1, BC-1.2, BC-1.4, BC-1.7, BC-2.1, BC-2.2 and BC-3.1 are not_applicable: judge its own logo and colours only for being clear and undistorted. If it does show the state crest, judge BC-1.2 to BC-1.4 as usual."
      : "",
    brand.material_type === "proposal"
      ? "This is an internal proposal or paper, not designed artwork: the visual identity rules (BC-1.1–1.4, BC-2.x, BC-3.1, BC-6.x, BC-7.x) are not_applicable unless it is clearly laid out for public release. Judge its words, policy alignment and mandatory information."
      : "",
    "",
    "Judge EVERY rule below: pass, fail, not_applicable (the rule does not apply to this material, e.g. classification on a public poster), or unclear (you cannot tell from what is shown). Never guess: unclear is better than a wrong fail.",
    "For every failed rule give at least one finding, one per place it occurs. Each finding names the page (1-indexed; an image is page 1) and:",
    "- box_2d: [ymin, xmin, ymax, xmax] on that page, integers 0–1000, tightly around the offending element (logo, colour band, heading, photo, text block). Always give it for visual breaches; for text breaches box the text too.",
    "- excerpt: the offending words copied EXACTLY as they appear on the page (for text breaches), else empty.",
    "WRITING: the reader is an agency's marketing or admin officer, not a designer or a lawyer. Use everyday words and short sentences. No preamble.",
    "- Never write rule ids (BC-…), hex codes, point or pixel sizes, contrast ratios or jargon such as \"breach\", \"non-compliant\", \"violation\", \"palette\", \"typography\" or \"off-brand\".",
    "- Name colours in plain words (\"bright purple\", \"state red\"). Call the Jata Negeri Sarawak \"the state crest\". Explain an acronym the first time, e.g. \"the state's 2030 plan (PCDS 2030)\".",
    "- issue: what is wrong, where, ≤ 12 words (e.g. \"The crest is stretched sideways.\"). fix: one instruction starting with a verb, ≤ 12 words. Leave whyItMatters empty.",
    "- summary: one or two short sentences. Start with the overall result (\"Ready to publish.\", \"Needs a few small fixes.\" or \"Must be fixed before publishing.\"), then the main reason.",
    "- rule note: ≤ 12 plain words.",
    "Risk score 0–100: how likely this harms the state's brand if published as is. A failed critical rule is a red_flag (70+); failed major rules only is caution (30–69); only minor or none is compliant (0–29).",
    "",
    "Return ONLY JSON:",
    `{"verdict":"red_flag|caution|compliant","riskScore":0,"summary":"at most 2 short sentences","detected":{"logos":[""],"colours":["#hex"],"fonts":[""],"languages":[""]},`,
    `"rules":[{"rule_id":"BC-1.1","outcome":"pass|fail|not_applicable|unclear","note":"≤ 12 words"}],`,
    `"findings":[{"rule_id":"BC-1.3","severity":"red_flag|caution|info","page":1,"box_2d":[0,0,0,0],"excerpt":"","issue":"","whyItMatters":"","fix":""}]}`,
    "",
    "RULES:", JSON.stringify(rules),
    extra ? `\nADDITIONAL GUIDANCE FROM THE BRAND OFFICE:\n${extra}` : "",
  ].join("\n");
}

function parseJson(raw: string): any {
  const m = raw.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : raw); } catch { return null; }
}

function costEntry(op: string, res: any, model: string) {
  const u = res.usageMetadata ?? {};
  const tokens = { input: u.promptTokenCount ?? 0, thinking: u.thoughtsTokenCount ?? 0, output: u.candidatesTokenCount ?? 0 };
  const cost = computeCost({ inputTokens: tokens.input, outputTokens: tokens.output, thinkingTokens: tokens.thinking, calls: 1 }, model);
  return { op, usd: Number(cost.usd.toFixed(6)), model, tokens, at: new Date().toISOString() };
}

/** The review itself: a plain function (no database) so it can be tested on
 *  demo files. Takes the bytes of a PDF or image. */
export async function runBrandReviewOn(brand: any, bytes: Buffer, mime: string, pages: number, extra = "") {
  const isImage = mime.startsWith("image/");
  const res: any = await generateWithFallback(
    { contents: [{ role: "user", parts: [{ text: reviewPrompt(brand, pages, isImage, extra) }, { inlineData: { mimeType: mime, data: bytes.toString("base64") } }] }],
      config: { responseMimeType: "application/json", maxOutputTokens: 24576, temperature: 0 } },
    { tier: "quality" },
  );
  const out = parseJson(res.text ?? "");
  if (!out || !Array.isArray(out.rules)) throw new Error("The check didn't finish properly. Press Check Again.");
  const given = new Map<string, any>((out.rules as any[]).filter((r) => ruleById(r?.rule_id)).map((r) => [r.rule_id, r]));
  const rules: RuleResult[] = BRAND_RULES.map((r) => {
    const g = given.get(r.id);
    const outcome = ["pass", "fail", "not_applicable", "unclear"].includes(g?.outcome) ? g.outcome : "unclear";
    return { rule_id: r.id, outcome, note: g?.note ? String(g.note).slice(0, 200) : undefined };
  });
  const clamp = (n: any) => Math.max(0, Math.min(1000, Math.round(Number(n) || 0)));
  const findings: BrandFinding[] = ((out.findings ?? []) as any[]).filter((f) => ruleById(f?.rule_id)).map((f, i) => {
    const b = Array.isArray(f.box_2d) && f.box_2d.length === 4 ? f.box_2d.map(clamp) as [number, number, number, number] : null;
    const box = b && b[2] > b[0] && b[3] > b[1] ? b : null;
    const rule = ruleById(f.rule_id)!;
    return {
      id: `f${i + 1}`, rule_id: rule.id, ref: `${rule.id} · ${rule.category}`, severity: findingSeverity(rule.id, f.severity),
      issue: String(f.issue ?? "").slice(0, 300), whyItMatters: String(f.whyItMatters ?? "").slice(0, 300), fix: String(f.fix ?? "").slice(0, 300),
      excerpt: f.excerpt ? String(f.excerpt).slice(0, 400) : undefined,
      page: Math.max(1, Math.min(pages, Math.round(Number(f.page) || 1))), box,
    };
  });
  // A rule the model failed but gave no finding for still gets one, on page 1,
  // unless an item on the same topic already covers it (the model often files
  // "purple background" under one colour rule and fails the other colour rules
  // too). The Checklist still shows every failed rule.
  for (const r of rules.filter((x) => x.outcome === "fail" && !findings.some((f) => f.rule_id === x.rule_id))) {
    const rule = ruleById(r.rule_id)!;
    if (findings.some((f) => ruleById(f.rule_id)?.category === rule.category)) continue;
    findings.push({ id: `f${findings.length + 1}`, rule_id: rule.id, ref: `${rule.id} · ${rule.category}`, severity: findingSeverity(rule.id),
      issue: r.note || `This does not follow: ${rule.title.toLowerCase()}.`, whyItMatters: "", fix: rule.plain, page: 1, box: null });
  }
  const { verdict, riskScore } = guardVerdict(out, rules);
  const review: BrandReview = {
    verdict, riskScore, summary: String(out.summary ?? "").slice(0, 400), findings, rules,
    detected: out.detected ?? {}, pages, model: res.modelVersion, reviewed_at: new Date().toISOString(),
  };
  return { review, res };
}

export const runBrandReview = createServerFn({ method: "POST" })
  .middleware([requireBrand])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = who(context);
    const row = await load(sb, data.id, tenantId);
    const brand = row.summary_json.brand;
    const ver = brand.versions.at(-1);
    const setVer = (patch: any) => { brand.versions = brand.versions.map((x: any) => (x.v === ver.v ? { ...x, ...patch } : x)); Object.assign(ver, patch); };
    try {
      setVer({ review_status: "running" });
      await save(sb, row, brand, "reviewing");
      // Everything is reviewed as a PDF or an image; Office files are converted
      // first, and the converted PDF is kept so the viewer shows what was reviewed.
      const kind = kindOf(ver.file_name, ver.mime);
      let bytes: Buffer; let mime: string; let viewUrl = ver.file_url;
      if (kind === "office") {
        bytes = await convertToPdf(ver.file_url);
        const path = `brand/${row.id}/v${ver.v}-${Date.now()}.pdf`;
        const up = await sb.storage.from("policies").upload(path, bytes, { contentType: "application/pdf", upsert: true });
        if (up.error) throw new Error("We couldn't save a copy of the file. Press Check Again.");
        viewUrl = sb.storage.from("policies").getPublicUrl(path).data.publicUrl;
        mime = "application/pdf";
      } else {
        const r = await fetch(ver.file_url);
        if (!r.ok) throw new Error("We couldn't open the file. Upload it again.");
        bytes = Buffer.from(await r.arrayBuffer());
        mime = kind === "pdf" ? "application/pdf" : (ver.mime && ver.mime.startsWith("image/") ? ver.mime : /\.png$/i.test(ver.file_name) ? "image/png" : "image/jpeg");
      }
      if (bytes.length > MAX_BYTES) throw new Error("The file is too big (over 19 MB). Save it at a smaller size and upload again.");
      let pages = 1;
      if (mime === "application/pdf") {
        pages = (await extractPdfPages(bytes)).length || 1;
        if (pages > MAX_PAGES) throw new Error(`It has ${pages} pages. Split it into parts of up to ${MAX_PAGES} pages.`);
      }
      // Extra guidance the brand office wrote for this workspace, if any.
      const { data: g } = await sb.from("analysis_guidance").select("guidance").eq("workspace_id", BRAND_WORKSPACE).maybeSingle();
      const { review, res } = await runBrandReviewOn(brand, bytes, mime, pages, String(g?.guidance ?? "").slice(0, 8000));
      const model = res.modelVersion ?? (await getDefaultModel());
      setVer({ review_status: "done", review, view_url: viewUrl, view_kind: mime === "application/pdf" ? "pdf" : "image", error: null });
      brand.cost_log = [...(brand.cost_log ?? []).slice(-49), costEntry(`AI review v${ver.v}`, res, model)];
      const n = review.findings.filter((f) => f.severity !== "info").length;
      brand.events = [...brand.events, event("Automatic check", "ai", "reviewed",
        `Version ${ver.v} checked: ${VERDICT_LABEL[review.verdict].toLowerCase()}${n ? `, ${toFix(n).toLowerCase()}` : ""}.`)];
      await save(sb, row, brand, "awaiting_decision");
      return { ok: true, riskScore: review.riskScore, verdict: review.verdict, findings: review.findings.length };
    } catch (e: any) {
      setVer({ review_status: "failed", error: String(e?.message ?? e).slice(0, 400) });
      brand.events = [...brand.events, event(userName, "agency", "review_failed", `Version ${ver.v} couldn't be checked. ${String(e?.message ?? e).slice(0, 200)}`)];
      await save(sb, row, brand, "review_failed");
      throw e;
    }
  });

// ── the brand officer's decision ────────────────────────────────────────────

export const decideBrandSubmission = createServerFn({ method: "POST" })
  .middleware([requireBrand])
  .inputValidator(z.object({ id: z.string().uuid(), outcome: z.enum(["clear", "return"]), note: z.string().max(2000).optional().nullable() }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId, userName } = who(context);
    const row = await load(sb, data.id, tenantId);
    const brand = row.summary_json.brand;
    if (row.status !== "awaiting_decision") throw new Error("This design isn't waiting for approval.");
    const review = latestReview(brand);
    const red = (review?.findings ?? []).filter((f) => f.severity === "red_flag").length;
    if (data.outcome === "return" && !data.note?.trim()) throw new Error("Say what to change.");
    if (data.outcome === "clear" && red && !data.note?.trim()) throw new Error(`${red} must-fix item${red === 1 ? " is" : "s are"} still open. Send it back, or say why you are approving it anyway.`);
    const now = new Date().toISOString();
    let clearance_ref: string | null = null;
    if (data.outcome === "clear") {
      const { data: rows } = await sb.from("analysis_reports").select("status").eq("workspace_id", BRAND_WORKSPACE).eq("tenant_id", tenantId).eq("status", "cleared");
      clearance_ref = `UKAS-BC-${new Date().getFullYear()}-${String((rows?.length ?? 0) + 1).padStart(4, "0")}`;
    }
    brand.decision = { outcome: data.outcome, by: userName, at: now, note: data.note ?? null, clearance_ref, version: brand.versions.at(-1)?.v };
    brand.events = [...brand.events, event(userName, "ukas", data.outcome === "clear" ? "cleared" : "returned",
      data.outcome === "clear" ? `Approved for public use. Approval no. ${clearance_ref}${data.note ? ` (${data.note})` : ""}.` : data.note?.includes("\n") ? `Sent back. What to change:\n${data.note}` : `Sent back: ${data.note}`)];
    await save(sb, row, brand, data.outcome === "clear" ? "cleared" : "returned");
    return { clearance_ref };
  });

export const BRAND_AGENCIES = AGENCIES;

/** The return note, drafted from the latest review's findings: what the agency
 *  must change, as short bullets with the page, most serious first. */
export const draftBrandReturnNote = createServerFn({ method: "POST" })
  .middleware([requireBrand])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { sb, tenantId } = who(context);
    const row = await load(sb, data.id, tenantId);
    const brand = row.summary_json.brand;
    const findings = (latestReview(brand)?.findings ?? []).filter((f) => f.severity !== "info")
      .sort((a, b) => (a.severity === "red_flag" ? 0 : 1) - (b.severity === "red_flag" ? 0 : 1));
    if (!findings.length) return { note: "", bullets: [] as string[] };
    const prompt = `You write a brand officer's note sending a design back to a government agency to fix. The reader is a marketing or admin officer, not a designer.
Turn the items below into 3–6 bullets, most important first. Each bullet: one plain instruction starting with a verb, at most 14 words, ending with the page, e.g. "(page 2)". Everyday words; no rule codes, hex codes or jargon. Merge duplicates. No preamble.
ITEMS:
${findings.map((f) => `[${f.severity === "red_flag" ? "MUST FIX" : "SHOULD FIX"}] ${ruleById(f.rule_id)?.title ?? ""}, page ${f.page}: ${f.issue}${f.fix ? ` What to do: ${f.fix}` : ""}`).join("\n")}
Return ONLY JSON: {"bullets": ["..."]}`;
    const res: any = await generateWithFallback({ contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json", maxOutputTokens: 1024, temperature: 0.2 } }, { tier: "fast" });
    const model = res.modelVersion ?? (await getDefaultModel());
    brand.cost_log = [...(brand.cost_log ?? []).slice(-49), costEntry("Return note", res, model)];
    await save(sb, row, brand);
    const bullets = ((parseJson(res.text ?? "")?.bullets ?? []) as any[]).filter((b) => typeof b === "string" && b.trim()).map((b: string) => b.trim().replace(/^[-•*]\s*/, "")).slice(0, 8);
    return { note: bullets.map((b) => `- ${b}`).join("\n"), bullets };
  });
