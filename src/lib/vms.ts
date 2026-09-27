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
  row("ctos", "CTOS consent and report", true, "MMMMMSM"),
  row("abms_001", "ABMS-001 Declaration of Interest", true, "MMMMMMM"),
  row("abms_004", "ABMS-004 Questionnaire for Third Parties", true, "MMMMMMM"),
  row("abms_005", "ABMS-005 Third Party Integrity Pledge", true, "MMMMMMM"),
  row("bank_letter", "Bank account verification", false, "MMMMMMM"),
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
export const docsFor = (category: string) =>
  DOC_TYPES.filter((d) => d.need[category] && d.need[category] !== "-").map((d) => ({ ...d, level: d.need[category] }));

// ── integrity questionnaire (ABMS-004) — any Yes raises the risk ─────────────
export const ABMS_QUESTIONS: { id: string; text: string }[] = [
  { id: "public_official", text: "Is any owner, director or key employee a public official, or related to one?" },
  { id: "lsh_relationship", text: "Does any owner, director or employee have a family or business relationship with a director or employee of the Lim Seong Hai group?" },
  { id: "investigation", text: "Has the company or any director been investigated, charged or convicted for bribery, fraud or corruption in the last 5 years?" },
  { id: "third_party_bank", text: "Will payment be made to a bank account not in the company's own name?" },
  { id: "restricted_list", text: "Is the company or any director on a government or international restricted or sanctions list?" },
];

// ── pre-qualification assessment (9 areas, pass mark 60%) — ASSUMPTION ──────
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
  if (input.relatedPartyMatch) { if (rating === "low") rating = "medium"; reasons.push("Name matches the related-party list — confirm"); }
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
    { key: "invite", label: "Vendor invited", ok: !!r.invite_token },
    { key: "register", label: "Vendor submitted", ok: !!r.submitted_by_vendor_at },
    { key: "screen", label: "Screened", ok: !!r.screening, detail: r.screening ? `${r.screening.rating} risk` : undefined },
    { key: "ctos", label: sub ? "Conflict check" : "CTOS report", ok: sub ? !!r.conflict_check?.accounts_decision : !!r.ctos },
    { key: "assess", label: sub ? "Contract Manager review" : "Documents & scoring", ok: !!r.assessment && verifiedAll, detail: r.assessment ? `${r.assessment.total}%` : undefined },
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
    assess: { text: sub ? "Contract Manager: confirm scope fit, verify documents and score" : "Verify every document and score the nine areas (pass 60%)", role: sub ? "contract_manager" : "purchasing_executive" },
    compliance: { text: "Compliance decision: approve, conditional or reject", role: "compliance" },
    decision: { text: sub ? "Head of Contracts & Procurement: add to the Master Sub-Contractor List" : "Purchasing Manager: approve, return to vendor or reject", role: sub ? "head_contracts" : "purchasing_manager" },
  };
  return { stages, next: r.status === "rejected" || r.status === "approved" || r.status === "conditional" ? null : cur ? next[cur] ?? null : null };
}

// ── credential monitoring (VMS-03) ───────────────────────────────────────────
export const ALERT_DAYS = [60, 30, 7];
export const daysTo = (iso: string, today = new Date()) =>
  Math.round((new Date(iso).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000);

export interface CredentialAlert { vendor_id: string; vendor: string; item: string; days: number; stage: "60" | "30" | "7" | "overdue"; mandatory: boolean }

/** Every credential, due-diligence date and conditional-approval due date
 *  inside the alert window (60 days), or already lapsed. */
export function credentialAlerts(vendors: any[], docs: any[], today = new Date()): CredentialAlert[] {
  const out: CredentialAlert[] = [];
  const push = (v: any, item: string, iso: string, mandatory: boolean) => {
    const d = daysTo(iso, today);
    if (d > 60) return;
    out.push({ vendor_id: v.id, vendor: v.name, item, days: d, stage: d < 0 ? "overdue" : d <= 7 ? "7" : d <= 30 ? "30" : "60", mandatory });
  };
  for (const v of vendors) {
    if (v.status === "blacklisted" || v.status === "rejected") continue;
    if (v.dd_valid_until) push(v, "Due diligence", v.dd_valid_until, true);
    if (v.conditions?.due) push(v, "Conditional approval", v.conditions.due, true);
    for (const d of docs.filter((x) => x.vendor_id === v.id && x.status === "verified" && x.expiry_date)) {
      const t = DOC_TYPES.find((x) => x.id === d.doc_type);
      push(v, t?.label ?? d.doc_type, d.expiry_date, (t?.need[v.category ?? ""] ?? "-") === "M");
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

/** Annual conflict-of-interest campaign: issued 5 January, due 30 January. */
export const coiDates = (year: number) => ({ issue: `${year}-01-05`, due: `${year}-01-30` });
