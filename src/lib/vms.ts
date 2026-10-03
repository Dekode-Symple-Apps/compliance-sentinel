// ----------------------------------------------------------------------------
// Vendor Management (Module 1) — shared rules, client-safe, no I/O.
// VMS-01 onboarding, VMS-02 subcontractor pre-qualification, VMS-03
// credential and conflict monitoring. From the Lim Seong Hai spec (22 Sep
// 2026); anything marked ASSUMPTION is a placeholder until the client confirms.
// ----------------------------------------------------------------------------

export const VMS_FEATURE = "vendor_management";

export const VENDOR_CATEGORIES: Record<string, string> = {
  supplier_material: "Supplier — material",
  supplier_pme: "Supplier — PME / rental / transport",
  services: "Services (testing, maintenance)",
  subcontractor: "Subcontractor",
  consultant: "Consultant",
  agent: "Agent",
  it_service: "IT service provider",
};
const CATS = Object.keys(VENDOR_CATEGORIES);

/** How the business is constituted (from the SSM certificate). Sole
 *  proprietors and partnerships give a personal guarantee (29 Sep review). */
export const BUSINESS_TYPES: Record<string, string> = {
  sdn_bhd: "Sdn Bhd (private limited)", berhad: "Berhad (public limited)", plt: "PLT (limited liability partnership)",
  partnership: "Partnership", sole_prop: "Sole proprietor",
};
export const needsGuarantee = (bt?: string | null) => bt === "sole_prop" || bt === "partnership";
/** The business type: what the vendor declared, else what the requester entered. */
export const businessTypeOf = (r: any): string | null => r?.register?.business_type || r?.business_type || null;

// ── the documentation matrix (spec p.4) ──────────────────────────────────────
// M = mandatory, C = conditional (when relevant), S = suggested, - = n/a.
// Order of the letters follows CATS above.
type Need = "M" | "C" | "S" | "-";
export interface DocType { id: string; label: string; expires: boolean; need: Record<string, Need> }
const row = (id: string, label: string, expires: boolean, needs: string): DocType =>
  ({ id, label, expires, need: Object.fromEntries(CATS.map((c, i) => [c, (needs[i] ?? "-") as Need])) });
export const DOC_TYPES: DocType[] = [
  row("register_form", "Supplier Register Form", false, "MMMMMMM"),
  row("company_profile", "Company profile", false, "MMMMMMM"),
  row("ssm", "SSM company registration", false, "MMMMMMM"),
  row("prequal_form", "Pre-qualification assessment form", false, "MMMMM-M"),
  row("ctos", "CTOS report (Finance)", true, "MMMMMSM"),
  row("ctos_consent", "CTOS consent form (signed)", false, "MMMMMSM"),
  row("personal_guarantee", "Personal guarantee (signed)", false, "-------"),
  row("abms_001", "ABMS-001 Declaration of Interest", true, "MMMMMMM"),
  row("abms_004", "ABMS-004 Questionnaire for Third Parties", true, "MMMMMMM"),
  row("abms_005", "ABMS-005 Third Party Integrity Pledge", true, "MMMMMMM"),
  row("bank_letter", "Bank account verification", false, "MMMMMMM"),
  row("afs", "Audited financial statements (latest year)", false, "SSSSSSS"),
  row("insurance", "Insurance coverage certificates", true, "SMMMS-S"),
  row("licence", "Licences / permits for the goods or services", true, "CCCCCCC"),
  row("cidb", "CIDB registration (and Green Card)", true, "--CM---"),
  row("iso", "ISO 9001 / 14001 / 45001 certificates", true, "CCCC---"),
  row("material_cert", "Material certification / test reports", false, "C--C---"),
  row("machinery_cf", "Machinery Certificate of Fitness (PMA/PMT/PMD)", true, "-M-C---"),
  row("competency", "Operator / personnel competency certificates", true, "-CCC---"),
  row("calibration", "Calibration certificates", true, "--CC---"),
  row("abc_ack", "ABC / Whistleblowing / Code of Conduct acknowledgement", true, "MMMMMMM"),
];
export const docsFor = (category: string, businessType?: string | null) =>
  DOC_TYPES.filter((d) => (d.need[category] && d.need[category] !== "-") || (d.id === "personal_guarantee" && needsGuarantee(businessType)))
    .map((d) => ({ ...d, level: d.id === "personal_guarantee" ? ("M" as Need) : d.need[category] }));

/** Not uploaded by the vendor: filled in on the portal's own forms, done by
 *  the team (the assessment), or uploaded by Finance (the CTOS report). */
export const PORTAL_FORMS = new Set(["register_form", "prequal_form", "abms_001", "abms_004", "abms_005", "ctos", "abc_ack"]);
/** LSH's own forms the vendor must sign by hand: downloaded from the portal,
 *  signed, uploaded back; the AI checks the signature. ASSUMPTION: the form
 *  layout is a placeholder until LSH sends its own. */
export const SIGNED_FORMS: Record<string, { title: string; body: string[] }> = {
  ctos_consent: {
    title: "CTOS Consent Form",
    body: [
      "I/We, the undersigned, on behalf of the company named below, consent to Lim Seong Hai Capital Berhad and its subsidiaries obtaining a credit report on the company and its directors from CTOS Data Systems Sdn Bhd, for vendor registration and due diligence.",
      "This consent remains valid for the duration of our registration as a vendor, and for each renewal of due diligence.",
    ],
  },
  personal_guarantee: {
    title: "Personal Guarantee",
    body: [
      "In consideration of Lim Seong Hai Capital Berhad or its subsidiary (the Company) registering the business named below as a vendor, I, the undersigned owner/partner, personally guarantee the due performance of the business's obligations to the Company, including the refund of any advance paid and the remedy of defective work or goods.",
      "This guarantee is continuing and remains in force while the business is a registered vendor of the Company.",
    ],
  },
};

// Bulk upload: what a file is, from its name. Specific before general — a
// "CIDB registration" is not an SSM registration. Null when the name does not say.
const NAME_PATTERNS: [string, RegExp][] = [
  ["ctos_consent", /ctos.*consent|consent.*ctos/],
  ["personal_guarantee", /guarant/],
  ["cidb", /\bcidb\b|green ?card|\bpkk\b/],
  ["calibration", /calibrat/],
  ["competency", /competen|operator|\bskm\b|chargeman|wireman/],
  ["machinery_cf", /\bcf\b|certificate of fitness|\bpm[adt]\b|\bdosh\b/],
  ["iso", /\biso\b|9001|14001|45001/],
  ["material_cert", /material|test report|mill cert/],
  ["insurance", /insuran|\bpolicy\b|\bcar\b|public liability/],
  ["bank_letter", /\bbank\b|account (confirmation|verification)/],
  ["afs", /\bafs\b|audited|financial statement/],
  ["company_profile", /profile/],
  ["ssm", /\bssm\b|incorporat|suruhanjaya syarikat|\bform ?(9|24|49)\b|\bsection ?(14|17|58)\b/],
  ["licence", /licen[cs]e|permit/],
];
export function docTypeFromName(fileName: string, allowed: string[]): string | null {
  const n = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[_\-.]+/g, " ");
  for (const [id, re] of NAME_PATTERNS) if (allowed.includes(id) && re.test(n)) return id;
  return null;
}

// ── integrity questionnaire (ABMS-004) — any Yes raises the risk ─────────────
export const ABMS_QUESTIONS: { id: string; text: string }[] = [
  { id: "public_official", text: "Is any owner, director or key employee a public official, or related to one?" },
  { id: "lsh_relationship", text: "Does any owner, director or employee have a family or business relationship with a director or employee of the Lim Seong Hai group?" },
  { id: "investigation", text: "Has the company or any director been investigated, charged or convicted for bribery, fraud or corruption in the last 5 years?" },
  { id: "third_party_bank", text: "Will payment be made to a bank account not in the company's own name?" },
  { id: "restricted_list", text: "Is the company or any director on a government or international restricted or sanctions list?" },
];

// ── pre-qualification: three factors that inform, not block (29 Sep review) ──
// Litigation (from CTOS), financial standing (pass/fail from the audited
// accounts) and experience (the team's judgement). Below the pass mark the
// vendor can still be approved by a manager's override with a recorded reason.
export type FactorId = "litigation" | "financial" | "experience";
export const PREQUAL_FACTORS: { id: FactorId; label: string; hint: string; options: { v: string; label: string; score: number }[] }[] = [
  { id: "litigation", label: "Litigation", hint: "From the CTOS report: litigation, winding-up, director flags.",
    options: [{ v: "clear", label: "Clear", score: 100 }, { v: "flag", label: "Flag", score: 0 }] },
  { id: "financial", label: "Financial standing", hint: "Pass or fail: profitable enough to deliver, from the audited accounts.",
    options: [{ v: "pass", label: "Pass", score: 100 }, { v: "fail", label: "Fail", score: 0 }] },
  { id: "experience", label: "Experience", hint: "The team's judgement, from the project references and the company profile.",
    options: [{ v: "strong", label: "Strong", score: 100 }, { v: "adequate", label: "Adequate", score: 60 }, { v: "limited", label: "Limited", score: 20 }] },
];
export interface FactorResult { result: string; remarks?: string | null }
/** The average of the three factors' scores; null until all three are set. */
export function factorScore(f: Partial<Record<FactorId, FactorResult>> | null | undefined): number | null {
  if (!f) return null;
  const scores = PREQUAL_FACTORS.map((x) => x.options.find((o) => o.v === f[x.id]?.result)?.score);
  return scores.every((n) => n != null) ? Math.round(scores.reduce((a, n) => a + n!, 0) / scores.length) : null;
}
/** Litigation and financial standing as the records show them, for the
 *  assessor to accept or change; null where there is no record yet. */
export function suggestFactors(r: any, docs: any[]): { litigation: { result: string; why: string } | null; financial: { result: string; why: string } | null } {
  const c = r.ctos ?? null;
  const litigation = c ? (c.litigation || c.winding_up || c.director_flags
    ? { result: "flag", why: `CTOS: ${[c.litigation && "litigation on record", c.winding_up && "winding-up petition", c.director_flags && "director flags"].filter(Boolean).join(", ")}` }
    : { result: "clear", why: `CTOS: no litigation, winding-up or director flags${c.score != null ? ` (score ${c.score})` : ""}` }) : null;
  const a = docs.find((d) => d.doc_type === "afs" && d.status !== "superseded" && d.extracted?.afs)?.extracted?.afs as Afs | undefined;
  let financial: { result: string; why: string } | null = null;
  if (a) {
    const np = a.current?.net_profit, eq = a.current?.equity;
    const ok = np != null && np > 0 && (eq == null || eq > 0) && !a.going_concern;
    const m = (n?: number | null) => (n == null ? "—" : `RM${Math.round(n).toLocaleString()}`);
    financial = { result: ok ? "pass" : "fail", why: `FY ${a.fy_end ?? "?"}: net profit ${m(np)}, equity ${m(eq)}${a.going_concern ? ", going-concern emphasis" : ""}` };
  }
  return { litigation, financial };
}

// ── the earlier nine-area assessment, kept so old records still read ────────
export const PREQUAL_AREAS: { id: string; label: string }[] = [
  { id: "legal", label: "Company background and legal standing" },
  { id: "financial", label: "Financial capacity" },
  { id: "technical", label: "Technical capability" },
  { id: "experience", label: "Experience and track record" },
  { id: "quality", label: "Quality management" },
  { id: "safety", label: "Safety and health" },
  { id: "environment", label: "Environmental management" },
  { id: "resources", label: "Manpower and equipment" },
  { id: "integrity", label: "Integrity and compliance" },
];
export const PASS_MARK = 60;
/** Each area scored 0–5; the total as a percentage. */
export const prequalScore = (areas: Record<string, number>) =>
  Math.round((PREQUAL_AREAS.reduce((a, x) => a + Math.max(0, Math.min(5, Number(areas[x.id] ?? 0))), 0) / (PREQUAL_AREAS.length * 5)) * 100);

// ── screening (step 6) ───────────────────────────────────────────────────────
export interface Screening { rating: "low" | "medium" | "high"; reasons: string[]; blacklisted: boolean; relatedParty: boolean; duplicateOf: string[] }

/** Risk from the vendor's own answers and our lists. Any Yes in the
 *  questionnaire is Medium or above; two or more, or an investigation or a
 *  restricted-list hit, is High. A blacklist hit rejects outright. */
export function screen(input: {
  abms?: Record<string, any> | null;
  ctos?: { litigation?: boolean; winding_up?: boolean; director_flags?: boolean } | null;
  blacklisted: boolean;
  relatedPartyMatch: boolean;
  duplicates: string[];
}): Screening {
  const yes = ABMS_QUESTIONS.filter((q) => input.abms?.answers?.[q.id] === "yes");
  const reasons = yes.map((q) => q.text.replace(/\?$/, "") + ": Yes");
  let rating: Screening["rating"] = yes.length ? "medium" : "low";
  if (yes.length >= 2 || yes.some((q) => q.id === "investigation" || q.id === "restricted_list")) rating = "high";
  if (input.ctos?.winding_up) { rating = "high"; reasons.push("CTOS: winding-up petition"); }
  if (input.ctos?.litigation) { if (rating === "low") rating = "medium"; reasons.push("CTOS: litigation on record"); }
  if (input.ctos?.director_flags) { if (rating === "low") rating = "medium"; reasons.push("CTOS: director flags"); }
  if (input.relatedPartyMatch) { if (rating === "low") rating = "medium"; reasons.push("Possible related party — confirm the relationship"); }
  if (input.duplicates.length) reasons.push(`Possible duplicate of ${input.duplicates.join(", ")}`);
  if (input.blacklisted) reasons.unshift("On the blacklist");
  return { rating, reasons, blacklisted: input.blacklisted, relatedParty: input.relatedPartyMatch, duplicateOf: input.duplicates };
}

/** Compliance sees it when the rating is Medium or High, a red flag is set,
 *  or the vendor is a related party (step 9). */
export const needsCompliance = (s: Screening | null | undefined) =>
  !!s && (s.rating !== "low" || s.relatedParty || s.reasons.length > 0);

/** Due diligence validity: 24 months, 12 for High risk (step 10). */
export const ddMonths = (rating: string) => (rating === "high" ? 12 : 24);
export const addMonths = (iso: string, m: number) => {
  const d = new Date(iso); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10);
};

// ── request stages, for the milestone tracker ────────────────────────────────
export const VMS_STATUS: Record<string, { label: string; tone: string }> = {
  submitted: { label: "Request raised", tone: "border-gray-300 text-gray-700" },
  invited: { label: "Vendor invited", tone: "border-blue-300 text-blue-800" },
  vendor_submitted: { label: "Vendor submitted", tone: "border-blue-300 text-blue-800" },
  screening: { label: "Screening", tone: "border-blue-300 text-blue-800" },
  assessment: { label: "Assessment", tone: "border-blue-300 text-blue-800" },
  compliance: { label: "Compliance", tone: "border-violet-300 text-violet-800" },
  manager: { label: "Awaiting approval", tone: "border-amber-300 text-amber-800" },
  approved: { label: "Approved", tone: "border-emerald-300 text-emerald-800" },
  conditional: { label: "Conditional", tone: "border-emerald-300 text-emerald-800" },
  returned: { label: "Returned to vendor", tone: "border-orange-300 text-orange-800" },
  rejected: { label: "Rejected", tone: "border-red-300 text-red-800" },
};

export interface VmsStage { key: string; label: string; state: "done" | "current" | "todo" | "skipped"; detail?: string }

export function requestMilestones(r: any, docs: any[]): { stages: VmsStage[]; next: { text: string; role: string } | null } {
  const sub = r.kind === "subcontractor";
  const verifiedAll = docs.length > 0 && docs.filter((d) => d.status !== "superseded").every((d) => d.status === "verified");
  const compl = needsCompliance(r.screening) || (sub && r.conflict_check?.accounts_decision === "red_flag");
  const steps: { key: string; label: string; ok: boolean; detail?: string; skip?: boolean }[] = [
    { key: "request", label: "Request raised", ok: true },
    { key: "invite", label: "Vendor invited", ok: !!r.invite_token || !!r.invite_expires || !!r.submitted_by_vendor_at },
    { key: "register", label: "Vendor submitted", ok: !!r.submitted_by_vendor_at },
    { key: "screen", label: "Checked", ok: !!r.screening, detail: r.screening ? `${r.screening.rating} risk · auto` : undefined },
    { key: "ctos", label: sub ? "Conflict check" : "CTOS report", ok: sub ? !!r.conflict_check?.accounts_decision : !!r.ctos },
    { key: "assess", label: sub ? "Contract Manager review" : "Documents & pre-qualification", ok: !!r.assessment && verifiedAll, detail: r.assessment ? `${r.assessment.total}%` : undefined },
    { key: "compliance", label: "Compliance", ok: !!r.compliance, skip: !compl },
    { key: "decision", label: sub ? "Head of Contracts" : "Purchasing Manager", ok: !!r.decision },
  ];
  let seen = false;
  const stages: VmsStage[] = steps.map((s) => {
    if (s.skip && !s.ok) return { key: s.key, label: s.label, state: "skipped", detail: "not needed" };
    if (s.ok) return { key: s.key, label: s.label, state: "done", detail: s.detail };
    if (r.status === "rejected") return { key: s.key, label: s.label, state: "skipped" };
    if (!seen) { seen = true; return { key: s.key, label: s.label, state: "current", detail: s.detail }; }
    return { key: s.key, label: s.label, state: "todo" };
  });
  const cur = stages.find((s) => s.state === "current")?.key;
  const next: Record<string, { text: string; role: string }> = {
    invite: { text: "Invite the vendor to the portal (link valid 14 days)", role: "purchasing_executive" },
    register: { text: r.status === "returned" ? "Vendor to correct the returned items and resubmit" : "Waiting for the vendor to complete the register form, documents and integrity forms", role: "vendor" },
    screen: { text: "Run screening for duplicates, related parties, blacklist and red flags", role: "purchasing_executive" },
    ctos: { text: sub ? "Accounts to approve the CTOS conflict check" : "Finance to upload the CTOS report", role: sub ? "accounts" : "finance" },
    assess: { text: sub ? "Contract Manager: confirm scope fit, verify documents and assess the three factors" : "Verify every document and assess litigation, financial standing and experience (pass 60%)", role: sub ? "contract_manager" : "purchasing_executive" },
    compliance: { text: "Compliance decision: approve, conditional or reject", role: "compliance" },
    decision: { text: sub ? "Head of Contracts & Procurement: add to the Master Sub-Contractor List" : "Purchasing Manager: approve, return to vendor or reject", role: sub ? "head_contracts" : "purchasing_manager" },
  };
  return { stages, next: r.status === "rejected" || r.status === "approved" || r.status === "conditional" ? null : cur ? next[cur] ?? null : null };
}

// ── validation: what was filled in, checked against the documents ───────────
// Three sources for each value — the requester's New Request, the vendor's
// register form, and the uploaded documents (read by AI). A row is confirmed
// only when every source that has the value agrees.

export type Check = "match" | "differs" | "unconfirmed";
/** Green: the same, read with confidence. Amber: probably the same (a close
 *  match, e.g. an abbreviated address) or read with low confidence — a person
 *  confirms it. Red: different. None: no document says it. */
export type Level = "green" | "amber" | "red" | "none";
export const CONFIDENCE_FLOOR = 0.8;
export interface ValidationRow {
  key: string; label: string; requester?: string; vendor?: string; doc?: string; source?: { id: string; label: string; url: string };
  check: Check; level: Level; confidence?: number | null; confirmed?: { by: string; at: string } | null; why?: string;
}
// Malaysian address abbreviations, written out before addresses are compared.
const ADDRESS_ABBR: [RegExp, string][] = [
  [/\bjln\b\.?/g, "jalan"], [/\btmn\b\.?/g, "taman"], [/\bkg\b\.?|\bkpg\b\.?/g, "kampung"], [/\bsg\b\.?/g, "sungai"],
  [/\bbt\b\.?/g, "batu"], [/\blrg\b\.?/g, "lorong"], [/\bbdr\b\.?/g, "bandar"], [/\bsek\b\.?/g, "seksyen"], [/\bpsn\b\.?/g, "persiaran"],
  [/\bblk\b\.?/g, "blok"], [/\bkws\b\.?|\bkaw\b\.?/g, "kawasan"], [/\bperind\b\.?/g, "perindustrian"], [/\bwp\b\.?/g, "wilayah persekutuan"],
  [/\bkl\b/g, "kuala lumpur"], [/\bno\.?\s*/g, ""], [/\blot\b\s*/g, ""],
];
export const normAddress = (s: string) => ADDRESS_ABBR.reduce((x, [re, to]) => x.replace(re, to), s.toLowerCase()).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => s.toLowerCase().replace(/\b(sdn\.?\s*bhd\.?|berhad|bhd)\b/g, " sdnbhd ").replace(/[^a-z0-9@. ]+/g, " ").split(/\s+/).filter(Boolean);
const regCore = (s: string) => (s.match(/\d{12}/)?.[0] ?? s.replace(/\D/g, ""));
/** Same value, allowing for format: case, punctuation, the SSM new/old number, spacing. */
export function sameValue(kind: string, a: string, b: string): boolean {
  if (!a || !b) return true;
  switch (kind) {
    case "registration_no": return regCore(a) === regCore(b);
    case "bank_account": return a.replace(/\D/g, "") === b.replace(/\D/g, "");
    case "tin": return a.replace(/\s/g, "").toUpperCase() === b.replace(/\s/g, "").toUpperCase();
    case "email": return a.trim().toLowerCase() === b.trim().toLowerCase();
    case "directors": {
      const set = (x: string) => x.split(/[;,\n]/).map((n) => words(n).join(" ")).filter(Boolean).sort().join("|");
      return set(a) === set(b);
    }
    case "address": {
      const A = new Set(words(normAddress(a))), B = new Set(words(normAddress(b)));
      const [small, big] = A.size <= B.size ? [A, B] : [B, A];
      return [...small].filter((w) => big.has(w)).length >= Math.ceil(small.size * 0.8);
    }
    default: {
      // Names: one contains the other ("Nurul Aina" / "Nurul Aina binti Hashim"; "CIMB Bank" / "CIMB BANK BERHAD").
      const A = words(a), B = words(b);
      const [small, big] = A.length <= B.length ? [A, B] : [B, A];
      return small.every((w) => big.includes(w));
    }
  }
}
/** Exactly the same once format is set aside, or only close (same by the rules
 *  above, but worded differently — e.g. an abbreviated or partial address). */
export function exactValue(kind: string, a: string, b: string): boolean {
  if (!a || !b) return true;
  if (kind === "address") return normAddress(a) === normAddress(b);
  if (kind === "name" || kind === "directors") return words(a).join(" ") === words(b).join(" ") || (kind === "directors" && sameValue(kind, a, b));
  return sameValue(kind, a, b);
}
export function validationRows(r: any, docs: any[]): ValidationRow[] {
  const confirms = r.validation_confirms ?? {};
  const reg = r.register ?? {};
  const latest = (t: string) => docs.filter((d) => d.doc_type === t && d.status !== "superseded").sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const f = (t: string, k: string) => {
    const d = latest(t); const v = d?.extracted?.fields?.[k];
    const c = d?.extracted?.confidence?.[k];
    return d && v != null && v !== "" ? { v: Array.isArray(v) ? v.join(", ") : String(v), d, c: typeof c === "number" ? c : null } : null;
  };
  const label = (t: string) => DOC_TYPES.find((x) => x.id === t)?.label ?? t;
  const row = (key: string, text: string, kind: string, requester: any, vendor: any, found: { v: string; d: any; c: number | null } | null): ValidationRow => {
    const req = requester ? String(requester) : undefined, ven = vendor ? String(vendor) : undefined, doc = found?.v;
    const vals = [req, ven, doc].filter(Boolean) as string[];
    const agree = vals.every((x) => vals.every((y) => sameValue(kind, x, y)));
    const exact = vals.every((x) => vals.every((y) => exactValue(kind, x, y)));
    const check: Check = !agree ? "differs" : doc ? "match" : "unconfirmed";
    const lowConf = found?.c != null && found.c < CONFIDENCE_FLOOR;
    const level: Level = check === "differs" ? "red" : check === "unconfirmed" ? "none" : !exact || lowConf ? "amber" : "green";
    const why = check === "differs" ? "The sources disagree" : level === "amber" ? (lowConf ? `Read with ${Math.round((found!.c ?? 0) * 100)}% confidence` : "Close match, worded differently") : undefined;
    return { key, label: text, requester: req, vendor: ven, doc, check, level, why, confidence: found?.c ?? null, confirmed: confirms[key] ?? null,
      source: found ? { id: found.d.id, label: label(found.d.doc_type), url: found.d.file_url } : undefined };
  };
  const directors = (reg.directors ?? []).map((d: any) => d.name).filter((n: string) => n?.trim()).join(", ");
  return [
    row("company_name", "Company name", "name", r.company_name, reg.company_name, f("ssm", "company_name")),
    row("business_type", "Business type", "name", r.business_type ? BUSINESS_TYPES[r.business_type] : null, reg.business_type ? BUSINESS_TYPES[reg.business_type] : null,
      (() => { const x = f("ssm", "business_type"); return x ? { ...x, v: BUSINESS_TYPES[x.v] ?? x.v } : null; })()),
    row("registration_no", "SSM registration no.", "registration_no", r.registration_no, reg.registration_no, f("ssm", "registration_no")),
    row("tin", "Tax identification no. (TIN)", "tin", null, reg.tin, f("company_profile", "tin")),
    row("address", "Registered address", "address", null, reg.address, f("ssm", "address") ?? f("company_profile", "address")),
    row("directors", "Directors", "directors", null, directors, f("company_profile", "directors")),
    row("bank_name", "Bank", "name", null, reg.bank_name, f("bank_letter", "bank_name")),
    row("bank_account", "Bank account no.", "bank_account", null, reg.bank_account, f("bank_letter", "account_no")),
    row("account_holder", "Account held in the company's name", "name", r.company_name, reg.company_name, f("bank_letter", "account_holder")),
    row("contact_name", "Contact person", "name", r.contact_name, reg.contact_name, f("company_profile", "contact_name")),
    row("contact_email", "Contact email", "email", r.contact_email, reg.contact_email, f("company_profile", "contact_email")),
    row("contact_phone", "Contact phone", "tin", null, reg.contact_phone, f("company_profile", "contact_phone")),
    ...(r.kind === "subcontractor" ? [row("cidb_grade", "CIDB grade", "name", null, reg.cidb_grade, f("cidb", "grade"))] : []),
  ].filter((x) => x.requester || x.vendor || x.doc);
}

// ── audited financial statements ─────────────────────────────────────────────
export interface AfsYear { revenue?: number | null; gross_profit?: number | null; profit_before_tax?: number | null; net_profit?: number | null; total_assets?: number | null; current_assets?: number | null; current_liabilities?: number | null; total_liabilities?: number | null; equity?: number | null; cash?: number | null; operating_cash_flow?: number | null }
export interface Afs { fy_end?: string | null; prior_fy_end?: string | null; currency?: string; auditor?: string; opinion?: "unqualified" | "qualified" | "adverse" | "disclaimer" | string; going_concern?: boolean; current: AfsYear; prior: AfsYear }
export const AFS_ITEMS: [keyof AfsYear, string][] = [
  ["revenue", "Revenue"], ["gross_profit", "Gross profit"], ["profit_before_tax", "Profit before tax"], ["net_profit", "Net profit"],
  ["total_assets", "Total assets"], ["current_assets", "Current assets"], ["current_liabilities", "Current liabilities"],
  ["total_liabilities", "Total liabilities"], ["equity", "Shareholders' equity"], ["cash", "Cash and bank balances"], ["operating_cash_flow", "Operating cash flow"],
];
const ratio = (a?: number | null, b?: number | null) => (a != null && b != null && b !== 0 ? a / b : null);
/** Ratios and flags a buyer looks at before relying on a vendor. */
export function afsRatios(afs: Afs, annualSpend?: number | null) {
  const c = afs.current ?? {}, p = afs.prior ?? {};
  const r = {
    growth: ratio(c.revenue != null && p.revenue != null ? c.revenue - p.revenue : null, p.revenue),
    netMargin: ratio(c.net_profit, c.revenue),
    currentRatio: ratio(c.current_assets, c.current_liabilities),
    debtToEquity: ratio(c.total_liabilities, c.equity),
    dependence: ratio(annualSpend ?? null, c.revenue),
  };
  const flags: string[] = [];
  if (c.net_profit != null && c.net_profit < 0) flags.push("Loss-making in the latest year");
  if (c.equity != null && c.equity < 0) flags.push("Negative shareholders' equity");
  if (r.currentRatio != null && r.currentRatio < 1) flags.push(`Current ratio ${r.currentRatio.toFixed(2)} — below 1`);
  if (afs.opinion && afs.opinion !== "unqualified") flags.push(`Auditor's opinion: ${afs.opinion}`);
  if (afs.going_concern) flags.push("Going-concern emphasis in the auditor's report");
  if (r.dependence != null && r.dependence > 0.1) flags.push(`Our annual spend is ${(r.dependence * 100).toFixed(0)}% of their revenue — dependence`);
  if (c.operating_cash_flow != null && c.operating_cash_flow < 0) flags.push("Negative operating cash flow");
  return { ...r, flags };
}

/** The integrity checklist, flagged only where something needs a person:
 *  a Yes answer, a declared interest, or a missing pledge or consent. */
export interface IntegrityItem { label: string; ok: boolean; note?: string }
export function integrityChecklist(r: any, docs: any[] = []): IntegrityItem[] {
  const ab = r.abms ?? {};
  const consent = docs.filter((d) => d.doc_type === "ctos_consent" && d.status !== "superseded").sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const signed = consent?.extracted?.signed;
  const yes = ABMS_QUESTIONS.filter((q) => ab.answers?.[q.id] === "yes");
  return [
    { label: "Integrity questionnaire (ABMS-004)", ok: !!ab.answers && yes.length === 0, note: yes.length ? `Yes to: ${yes.map((q) => q.text).join("; ")}${ab.details ? ` — ${ab.details}` : ""}` : ab.answers ? "All answered No" : "Not answered" },
    { label: "Declaration of interest (ABMS-001)", ok: ab.declaration_interest === "none", note: ab.declaration_interest === "declared" ? `Declared: ${ab.interest_details ?? ""}` : ab.declaration_interest === "none" ? "Nothing to declare" : "Not given" },
    { label: "Integrity pledge (ABMS-005)", ok: !!ab.pledge, note: ab.pledge ? "Signed" : "Not signed" },
    consent
      ? { label: "CTOS consent form", ok: consent.status === "verified" || (!!signed?.form_matches && !!signed?.signature_present),
          note: !consent.extracted ? "Uploaded, not read yet" : !signed?.form_matches ? "The upload is not the CTOS consent form" : signed?.signature_present ? `Signed${signed.signatory_name ? ` by ${signed.signatory_name}` : ""}${signed.signed_date ? ` on ${signed.signed_date}` : ""}` : "No signature found — check the upload" }
      : { label: "CTOS consent", ok: ab.ctos_consent === "signed", note: ab.ctos_consent === "signed" ? "Given" : ab.ctos_consent === "declined" ? "Declined — Finance still runs the report" : "Signed form not uploaded" },
    { label: "PDPA consent", ok: !!ab.pdpa, note: ab.pdpa ? "Given" : "Not given" },
  ];
}

/** What to do next on a request, as buttons: each opens its section and, in
 *  the single-user demo, acts as the role that does it. */
export interface VmsAction { id: string; label: string; role: string; section: string }
export function vmsActions(r: any, docs: any[]): VmsAction[] {
  if (["approved", "conditional", "rejected"].includes(r.status)) return [];
  const { stages } = requestMilestones(r, docs);
  const cur = stages.find((s) => s.state === "current")?.key;
  const sub = r.kind === "subcontractor";
  const assessor = sub ? "contract_manager" : "purchasing_executive";
  switch (cur) {
    case "invite": return [{ id: "invite", label: "Invite Vendor", role: "purchasing_executive", section: "portal" }];
    case "register": return [{ id: "portal", label: "Open Vendor Portal", role: "vendor", section: "portal" }];
    // Screening runs by itself when the vendor submits; this is only for older requests.
    case "screen": return [{ id: "screen", label: "Run Checks", role: "purchasing_executive", section: "screening" }];
    case "ctos": return [sub ? { id: "conflict", label: "Conflict Check", role: "accounts", section: "ctos" } : { id: "ctos", label: "Upload CTOS Report", role: "finance", section: "ctos" }];
    case "assess": return [
      ...(docs.some((d) => d.status === "uploaded") ? [{ id: "verify", label: "Check Flagged Documents", role: assessor, section: "documents" }] : []),
      ...(!r.assessment ? [{ id: "score", label: "Score Pre-qualification", role: assessor, section: "assessment" }] : []),
    ];
    case "compliance": return [{ id: "compliance", label: "Compliance Decision", role: "compliance", section: "compliance" }];
    case "decision": return [{ id: "decision", label: sub ? "Add to Master List" : "Approve or Return", role: sub ? "head_contracts" : "purchasing_manager", section: "decision" }];
    default: return [];
  }
}
/** Where each milestone leads when clicked, and who acts on it — for going back
 *  to any step in the demo. */
export function milestoneTarget(r: any, key: string): { section: string; role: string } | null {
  const sub = r.kind === "subcontractor";
  const map: Record<string, { section: string; role: string }> = {
    request: { section: "portal", role: "purchasing_executive" }, invite: { section: "portal", role: "purchasing_executive" },
    register: { section: "validation", role: "purchasing_executive" }, screen: { section: "screening", role: "purchasing_executive" },
    ctos: { section: "ctos", role: sub ? "accounts" : "finance" }, assess: { section: r.assessment ? "assessment" : "documents", role: sub ? "contract_manager" : "purchasing_executive" },
    compliance: { section: "compliance", role: "compliance" }, decision: { section: "decision", role: sub ? "head_contracts" : "purchasing_manager" },
  };
  return map[key] ?? null;
}

/** Priority for the Requests list: the reviewer's turn first, then waiting on the vendor, then done. */
export const vmsPriority = (r: any) =>
  ["approved", "conditional", "rejected"].includes(r.status) ? 4 : !r.submitted_by_vendor_at ? 3 : r.status === "returned" ? 3 : 1;

// ── credential monitoring (VMS-03) ───────────────────────────────────────────
export const ALERT_DAYS = [60, 30, 7];
export const daysTo = (iso: string, today = new Date()) =>
  Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000);

export interface CredentialAlert {
  vendor_id: string; vendor: string; item: string; days: number; stage: "60" | "30" | "7" | "overdue"; mandatory: boolean;
  /** What lapses: due diligence, a conditional-approval deadline, or a document (with its type and id). */
  kind: "dd" | "condition" | "doc"; doc_type?: string; doc_id?: string; date: string;
}

/** Every credential, due-diligence date and conditional-approval due date
 *  inside the alert window (60 days), or already lapsed. */
export function credentialAlerts(vendors: any[], docs: any[], today = new Date()): CredentialAlert[] {
  const out: CredentialAlert[] = [];
  const push = (v: any, item: string, iso: string, mandatory: boolean, extra: Pick<CredentialAlert, "kind" | "doc_type" | "doc_id">) => {
    const d = daysTo(iso, today);
    if (d > 60) return;
    out.push({ vendor_id: v.id, vendor: v.name, item, days: d, stage: d < 0 ? "overdue" : d <= 7 ? "7" : d <= 30 ? "30" : "60", mandatory, date: iso, ...extra });
  };
  for (const v of vendors) {
    if (v.status === "blacklisted" || v.status === "rejected") continue;
    if (v.dd_valid_until) push(v, "Due diligence", v.dd_valid_until, true, { kind: "dd" });
    if (v.conditions?.due) push(v, "Conditional approval", v.conditions.due, true, { kind: "condition" });
    for (const d of docs.filter((x) => x.vendor_id === v.id && x.status === "verified" && x.expiry_date)) {
      const t = DOC_TYPES.find((x) => x.id === d.doc_type);
      push(v, t?.label ?? d.doc_type, d.expiry_date, (t?.need[v.category ?? ""] ?? "-") === "M", { kind: "doc", doc_type: d.doc_type, doc_id: d.id });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

// ── vendor status light (29 Sep review) ──────────────────────────────────────
/** Documents a vendor must have verified before the first payout. */
export const PAYOUT_DOCS = ["ssm", "bank_letter", "ctos"];
export type Light = "green" | "yellow" | "red";
export interface VendorLight { light: Light; label: string; reasons: string[]; outstanding: string[]; paymentAllowed: boolean; override: any | null }
/** Green: approved, documents for payout verified, due diligence valid.
 *  Yellow: pending items for Finance to review. Red: a blocking issue. A
 *  Finance override can allow payment while items are still outstanding. */
export function vendorLight(v: any, verifiedTypes: string[], today = new Date()): VendorLight {
  const reasons: string[] = [];
  const dd = v.dd_valid_until ? daysTo(v.dd_valid_until, today) : null;
  const red = v.compliance_hold || ["blacklisted", "rejected", "on_hold"].includes(v.status) || (dd != null && dd < 0)
    || (v.risk_rating === "high" && !["approved", "conditional"].includes(v.status));
  if (v.compliance_hold) reasons.push(`On hold${v.hold_reason ? `: ${v.hold_reason}` : ""}`);
  if (["blacklisted", "rejected"].includes(v.status)) reasons.push(v.status === "blacklisted" ? "Blacklisted" : "Rejected");
  if (dd != null && dd < 0) reasons.push(`Due diligence lapsed ${v.dd_valid_until}`);
  if (v.risk_rating === "high" && !["approved", "conditional"].includes(v.status)) reasons.push("High risk, not yet cleared");
  const outstanding = PAYOUT_DOCS.filter((t) => !verifiedTypes.includes(t)).map((t) => DOC_TYPES.find((d) => d.id === t)?.label ?? t);
  if (!["approved", "conditional"].includes(v.status) && !red) reasons.push("Onboarding not complete");
  if (v.status === "conditional") reasons.push(`Conditional${v.conditions?.text ? `: ${v.conditions.text}` : ""}`);
  if (dd != null && dd >= 0 && dd <= 30) reasons.push(`Due diligence due in ${dd} days`);
  if (outstanding.length) reasons.push(`Before payout: ${outstanding.join(", ")}`);
  const light: Light = red ? "red" : reasons.length ? "yellow" : "green";
  const o = v.payment_override && (!v.payment_override.expires || daysTo(v.payment_override.expires, today) >= 0) ? v.payment_override : null;
  return { light, label: light === "green" ? "Clear to pay" : light === "yellow" ? "Finance to review" : "Blocked", reasons, outstanding,
    paymentAllowed: light === "green" || !!o, override: o };
}

/** Quarterly adverse-news scan (29 Sep review: quarterly is enough). */
export const SCAN_MONTHS = 3;
export const scanDue = (v: any, today = new Date()) => {
  const last = v.adverse_news?.last_scan_at;
  return ["approved", "conditional"].includes(v.status) && (!last || daysTo(addMonths(String(last).slice(0, 10), SCAN_MONTHS), today) <= 0);
};

/** Annual conflict-of-interest campaign: issued 5 January, due 30 January. */
export const coiDates = (year: number) => ({ issue: `${year}-01-05`, due: `${year}-01-30` });
