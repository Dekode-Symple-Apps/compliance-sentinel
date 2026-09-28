// ----------------------------------------------------------------------------
// Commercial CMS — shared rules (client-safe, no I/O).
//
// Vendor contracts and Letters of Award (tender-out, CMS-01) and client
// contracts (tender-in, CMS-02): request → validate and flag → review, flag and
// comment → approval by matrix. Review only — nothing here rewrites a contract.
//
// Everything marked ASSUMPTION is a placeholder until Lim Seong Hai confirms
// its own figures (approval matrix, Letter of Award items, FX, SLAs). They are
// kept together here so replacing them is one edit, and the screens show them
// as assumptions rather than as policy.
// ----------------------------------------------------------------------------

import NDA_TEMPLATE from "./ccms-templates/lsh-nda-mutual.json";

export const CCMS_FEATURE = "commercial_cms";

/** Demo-only: one person can walk the whole flow. Self-approval is then
 *  recorded as an exception in the audit trail instead of being refused. */
export const DEMO_SINGLE_USER = true;

// ── roles ────────────────────────────────────────────────────────────────────
export const CCMS_ROLES = {
  requestor:          "Requestor",
  contract_executive: "Contract Executive",
  legal:              "Legal",
  finance:            "Finance",
  contract_manager:   "Contract Manager",
  committee:          "Audit & Risk Mgmt Committee",
  approver:           "Approver",
  purchasing_executive: "Purchasing Executive",
  purchasing_manager: "Purchasing Manager",
  compliance:         "Compliance",
  accounts:           "Accounts",
  head_contracts:     "Head of Contracts & Procurement",
  operations_manager: "Operations Manager",
  head_of_department: "Head of Department",
  safety_health:      "Safety and Health",
} as const;
/** The personas grouped by module, for the "Acting as" switcher. */
export const ROLE_GROUPS: { label: string; roles: (keyof typeof CCMS_ROLES)[] }[] = [
  { label: "Contracts", roles: ["requestor", "contract_executive", "legal", "finance", "contract_manager", "committee", "approver"] },
  { label: "Vendors", roles: ["purchasing_executive", "purchasing_manager", "compliance", "accounts", "head_contracts"] },
  { label: "Assets", roles: ["operations_manager", "head_of_department", "safety_health"] },
];
export type CcmsRole = keyof typeof CCMS_ROLES;
/** The author role on comment threads the AI review opens. Not a persona. */
export const AI_ROLE = "ai_reviewer";
export const roleLabel = (r: string | null | undefined): string =>
  r === AI_ROLE ? "AI Reviewer" : (CCMS_ROLES as Record<string, string>)[r ?? ""] ?? "—";

// ── group entities (ASSUMPTION: from public filings) ─────────────────────────
export const LSH_ENTITIES = [
  "Lim Seong Hai Capital Berhad",
  "LSH BEST Builders Sdn Bhd",
  "Astana Setia Sdn Bhd",
  "Lim Seong Hai Lighting Sdn Bhd",
  "Knight Auto Sdn Bhd",
  "Lim Seong Hai Ventures Sdn Bhd",
];

// ── contract types ───────────────────────────────────────────────────────────
export interface ContractTypeSpec {
  label: string;
  side: "vendor" | "client";
  /** An approved award (Approval Form / Board) must be referenced. */
  needsAward?: boolean;
  /** Check the draft against the Letter of Award mandatory items. */
  loaCheck?: boolean;
  /** Legal vetting whatever the draft says. */
  legalAlways?: boolean;
  itService?: boolean;
  /** Hard value cap in MYR. */
  capMyr?: number;
  templateId?: string;
  /** Lite flow: a template document (an NDA, not a contract) — Legal decides
   *  alone, and stamping, bonds and the close-out checklist are not required. */
  lite?: boolean;
}
export const CONTRACT_TYPES: Record<string, ContractTypeSpec> = {
  letter_of_award:       { label: "Letter of Award",                side: "vendor", needsAward: true, loaCheck: true },
  work_order:            { label: "Work Order",                     side: "vendor", needsAward: true, loaCheck: true, capMyr: 500_000 },
  subcontract:           { label: "Subcontract agreement",          side: "vendor", needsAward: true },
  supply_agreement:      { label: "Supply agreement",               side: "vendor" },
  service_agreement:     { label: "Service / maintenance agreement", side: "vendor" },
  rental_agreement:      { label: "Machinery / PME rental",         side: "vendor" },
  consultancy_agreement: { label: "Consultancy agreement",          side: "vendor" },
  agency_agreement:      { label: "Letter of Agreement (agent)",    side: "vendor", legalAlways: true },
  it_service_agreement:  { label: "IT service agreement",           side: "vendor", itService: true, legalAlways: true },
  nda:                   { label: "Non-disclosure agreement",       side: "vendor", templateId: "lsh-nda-mutual", lite: true },
  client_loa:            { label: "Client Letter of Award",         side: "client", legalAlways: true },
  client_contract:       { label: "Client contract",                side: "client", legalAlways: true },
};

/** Lite for template documents, full for contracts. Derived from the type, so
 *  nothing is stored and a type can be moved between flows in one edit. */
export const flowOf = (c: { contract_type: string }): "lite" | "full" => (CONTRACT_TYPES[c.contract_type]?.lite ? "lite" : "full");

// ── templates ────────────────────────────────────────────────────────────────
export interface TemplateClause {
  id: string; number: string; title: string; mandatory: boolean; locked: boolean;
  keyPosition: string; paragraphs: string[];
}
export interface ContractTemplate {
  id: string; code: string; title: string; version: string; effectiveDate: string; owner: string;
  status: string; usageNote: string; assumptions: string[]; contractTypes: string[];
  clauses: TemplateClause[];
}
export const TEMPLATES: ContractTemplate[] = [NDA_TEMPLATE as ContractTemplate];
export const templateFile = (t: ContractTemplate) =>
  `/templates/ccms/${t.code}-${t.title.replace(/ /g, "-")}-v${t.version}.docx`;
export const templateById = (id?: string | null) => TEMPLATES.find((t) => t.id === id);
/** A template's status as a short chip ("Draft for Legal adoption" → Draft). */
export const templateStatus = (s: string) =>
  /^draft/i.test(s) ? { label: "Draft", tone: "border-amber-200 bg-amber-50/70 text-amber-800" } : { label: "Approved", tone: "border-emerald-200 bg-emerald-50/70 text-emerald-800" };

// ── Letter of Award mandatory items (ASSUMPTION: the spec names 12 items but
//    does not list them; drafted from the spec's own controls) ───────────────
export const LOA_ITEMS: { id: string; label: string; hint: string }[] = [
  { id: "parties",      label: "Parties and registration numbers",        hint: "Awarding entity and vendor, with SSM numbers" },
  { id: "project",      label: "Project name and job number",             hint: "Links the award to the Job Number Log" },
  { id: "scope",        label: "Scope of works / supply",                  hint: "Or a reference to the scope document and drawings" },
  { id: "sum",          label: "Contract sum and basis",                   hint: "Amount, currency, lump sum or remeasurement, SST" },
  { id: "dates",        label: "Commencement and completion dates",        hint: "Or programme and duration" },
  { id: "payment",      label: "Payment terms",                            hint: "Progress claims, certification and payment period" },
  { id: "retention",    label: "Retention",                                hint: "Rate and release (e.g. 5%: 2.5% at CPC, 2.5% at CMGD)" },
  { id: "bond",         label: "Performance bond / Director's Guarantee",  hint: "5% of contract sum for contractors, validity" },
  { id: "lad",          label: "Liquidated and ascertained damages",       hint: "Rate per day, cap" },
  { id: "insurance",    label: "Insurances",                               hint: "CAR, workmen's compensation / SOCSO, public liability" },
  { id: "dlp",          label: "Defects liability period",                 hint: "Duration and making-good obligations" },
  { id: "abms",         label: "Anti-corruption (ABMS) clause and acceptance", hint: "Locked ABMS clause; acceptance and return within the stated days" },
];

// ── money (ASSUMPTION: indicative rates, replace with Finance's table) ───────
export const FX_TO_MYR: Record<string, number> = { MYR: 1, USD: 4.2, SGD: 3.25, EUR: 4.6, CNY: 0.58, GBP: 5.5 };
export const toMyr = (value: number | null | undefined, currency = "MYR"): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value * (FX_TO_MYR[currency] ?? 1) * 100) / 100 : null;

// ── approval matrix (ASSUMPTION) ─────────────────────────────────────────────
export const APPROVAL_BANDS: { upToMyr: number; label: string }[] = [
  { upToMyr: 500_000,   label: "Director" },
  { upToMyr: 5_000_000, label: "Final Approval Committee" },
  { upToMyr: Infinity,  label: "Board of Directors" },
];
export const SLA_DAYS = { legal: 5, finance: 3, approval: 3, contract_executive: 2 } as const;

// ── flags ────────────────────────────────────────────────────────────────────
export type FlagKey =
  | "related_party" | "it_service" | "high_risk_vendor" | "deviation" | "non_standard"
  | "cross_border_data" | "dd_expired" | "vendor_not_approved" | "loa_items_missing" | "work_order_cap" | "vendor_on_hold";
export const FLAG_META: Record<FlagKey, { label: string; severity: "high" | "medium"; effect: string }> = {
  related_party:       { label: "Related-party transaction", severity: "high",   effect: "Audit & Risk Management Committee, then the non-interested Board" },
  it_service:          { label: "IT service agreement",      severity: "medium", effect: "Legal vetting, then the Board" },
  high_risk_vendor:    { label: "High-risk vendor",          severity: "high",   effect: "Legal vetting; reviewers see the vendor's risk rating" },
  deviation:           { label: "Deviation from template",   severity: "high",   effect: "Legal vetting is mandatory and cannot be bypassed" },
  non_standard:        { label: "No approved template",      severity: "medium", effect: "Treated as non-standard: Legal vetting is mandatory" },
  cross_border_data:   { label: "Personal data leaves Malaysia", severity: "medium", effect: "Legal vetting (PDPA 2010 cross-border transfer)" },
  dd_expired:          { label: "Vendor due diligence expired", severity: "high", effect: "Cannot be approved until due diligence is renewed" },
  vendor_not_approved: { label: "Vendor not approved",       severity: "high",   effect: "Cannot be approved until the vendor is approved" },
  loa_items_missing:   { label: "Letter of Award items missing", severity: "high", effect: "Legal vetting; the missing items must be added" },
  work_order_cap:      { label: "Work Order over RM500,000",  severity: "high",   effect: "Must be issued as a Letter of Award or contract instead" },
  vendor_on_hold:      { label: "Vendor on compliance hold", severity: "high",   effect: "No new award or renewal until the vendor's credentials are current" },
};
/** Flags that stop approval outright, rather than adding a reviewer. */
export const BLOCKING_FLAGS: FlagKey[] = ["dd_expired", "vendor_not_approved", "work_order_cap", "vendor_on_hold"];

export interface Flag { key: FlagKey; source: "platform" | "ai"; detail: string }

export interface VendorLite {
  name: string; status: string; dd_valid_until: string | null; risk_rating: string | null;
  related_party: boolean; related_party_note?: string | null; compliance_hold?: boolean; hold_reason?: string | null;
}
export interface FlagInput {
  contract_type: string; value_myr: number | null; personal_data_cross_border: boolean;
  /** From the latest document review, when one exists. */
  review?: { deviation?: boolean; nonStandard?: boolean; loaMissing?: string[] } | null;
}

/** Flags the platform raises. Pure: re-run whenever the request, the vendor or
 *  the latest review changes. The requestor cannot clear any of them. */
export function computeFlags(c: FlagInput, vendor: VendorLite | null, today = new Date()): Flag[] {
  const t = CONTRACT_TYPES[c.contract_type];
  const out: Flag[] = [];
  if (vendor?.related_party) out.push({ key: "related_party", source: "platform", detail: vendor.related_party_note || `${vendor.name} is on the related-party list.` });
  if (t?.itService) out.push({ key: "it_service", source: "platform", detail: "Contract type is an IT service agreement." });
  if (vendor?.risk_rating === "high") out.push({ key: "high_risk_vendor", source: "platform", detail: `${vendor.name} is rated high risk.` });
  if (c.personal_data_cross_border) out.push({ key: "cross_border_data", source: "platform", detail: "Requestor declared that personal data will be transferred outside Malaysia." });
  if (vendor && !["approved", "conditional"].includes(vendor.status)) out.push({ key: "vendor_not_approved", source: "platform", detail: `${vendor.name} is ${vendor.status.replace("_", " ")}.` });
  if (vendor?.compliance_hold) out.push({ key: "vendor_on_hold", source: "platform", detail: vendor.hold_reason || `${vendor.name} is on compliance hold.` });
  if (vendor?.dd_valid_until && new Date(vendor.dd_valid_until) < today) out.push({ key: "dd_expired", source: "platform", detail: `Due diligence expired on ${vendor.dd_valid_until}.` });
  if (t?.capMyr && (c.value_myr ?? 0) > t.capMyr) out.push({ key: "work_order_cap", source: "platform", detail: `Value exceeds the RM${t.capMyr.toLocaleString()} Work Order cap.` });
  if (c.review?.deviation) out.push({ key: "deviation", source: "ai", detail: "The draft departs from the approved template — see the deviation report." });
  if (c.review?.nonStandard) out.push({ key: "non_standard", source: "ai", detail: "No approved template exists for this contract type, so the draft is non-standard." });
  if (c.review?.loaMissing?.length) out.push({ key: "loa_items_missing", source: "ai", detail: `Missing or unclear: ${c.review.loaMissing.join(", ")}.` });
  return out;
}

// ── route ────────────────────────────────────────────────────────────────────
export interface Stage {
  key: string;                 // legal | finance | committee | board_noninterested | approval | board_it
  label: string;
  kind: "review" | "approval";
  role: CcmsRole;
  sla_days: number;
  reason: string;
  status: "pending" | "cleared" | "cleared_with_comments" | "not_cleared" | "approved" | "returned" | "rejected";
  decided_by?: string | null;
  decided_at?: string | null;
  note?: string | null;
}

/** The route a request must take, from its flags, type and value. Reviews run
 *  in parallel; approvals run in order. Decisions already taken on a stage
 *  that is still required are carried over by key. */
export function buildRoute(
  c: { contract_type: string; value_myr: number | null },
  flags: Flag[],
  previous: Stage[] = [],
): Stage[] {
  const t = CONTRACT_TYPES[c.contract_type];
  const has = (k: FlagKey) => flags.some((f) => f.key === k);
  const legalReasons = [
    t?.legalAlways && `${t.label} always goes to Legal`,
    has("deviation") && "deviation from the approved template",
    has("non_standard") && "no approved template",
    has("it_service") && "IT service agreement",
    has("cross_border_data") && "personal data leaves Malaysia",
    has("high_risk_vendor") && "high-risk vendor",
    has("loa_items_missing") && "Letter of Award items missing",
  ].filter(Boolean) as string[];
  const band = APPROVAL_BANDS.find((b) => (c.value_myr ?? 0) <= b.upToMyr)!;
  const stages: Omit<Stage, "status">[] = [];
  if (t?.lite) {
    // One decision by Legal, beside the document and the AI's comments. A
    // related party still goes to the Committee — Lite never skips governance.
    stages.push({ key: "legal", label: "Legal Decision", kind: "review", role: "legal", sla_days: SLA_DAYS.legal,
      reason: ["Template document — Legal decides", ...legalReasons].join("; ") });
    if (has("related_party")) stages.push({ key: "committee", label: "Audit & Risk Management Committee", kind: "approval", role: "committee", sla_days: SLA_DAYS.approval, reason: "Related-party transaction" });
    return carry(stages, previous);
  }
  if (t?.side === "client") stages.push({ key: "contracts", label: "Tender Comparison", kind: "review", role: "contract_manager", sla_days: 5, reason: "Award checked against our tender; every difference decided" });
  if (legalReasons.length) stages.push({ key: "legal", label: "Legal Vetting", kind: "review", role: "legal", sla_days: SLA_DAYS.legal, reason: legalReasons.join("; ") });
  stages.push({ key: "finance", label: "Finance Review", kind: "review", role: "finance", sla_days: SLA_DAYS.finance, reason: "Payment terms, bonds, insurance and budget" });
  if (has("related_party")) {
    stages.push({ key: "committee", label: "Audit & Risk Management Committee", kind: "approval", role: "committee", sla_days: SLA_DAYS.approval, reason: "Related-party transaction" });
    stages.push({ key: "board_noninterested", label: "Non-interested Board", kind: "approval", role: "approver", sla_days: SLA_DAYS.approval, reason: "Related-party transaction; interested directors excluded" });
  }
  if (has("it_service")) {
    stages.push({ key: "board_it", label: "Board of Directors", kind: "approval", role: "approver", sla_days: SLA_DAYS.approval, reason: "IT service agreement" });
  }
  // The value band applies unless a Board stage above already sits over it —
  // the Board is the top of the matrix, so a lower band would add nothing.
  if (!stages.some((s) => s.key.startsWith("board"))) {
    stages.push({ key: "approval", label: band.label, kind: "approval", role: "approver", sla_days: SLA_DAYS.approval, reason: `Approval matrix: value ${(c.value_myr ?? 0) > 0 ? "RM" + (c.value_myr ?? 0).toLocaleString() : "not stated"}` });
  }
  return carry(stages, previous);
}

/** Decisions already taken on a stage that is still required carry over by key. */
function carry(stages: Omit<Stage, "status">[], previous: Stage[]): Stage[] {
  return stages.map((s) => {
    const prev = previous.find((p) => p.key === s.key);
    return prev && prev.status !== "pending" && prev.status !== "returned" && prev.status !== "not_cleared"
      ? { ...s, status: prev.status, decided_by: prev.decided_by, decided_at: prev.decided_at, note: prev.note }
      : { ...s, status: "pending" };
  });
}

export const reviewsDone = (route: Stage[]) =>
  route.filter((s) => s.kind === "review").every((s) => s.status === "cleared" || s.status === "cleared_with_comments");
export const nextApproval = (route: Stage[]) => route.find((s) => s.kind === "approval" && s.status !== "approved");

// ── status presentation ──────────────────────────────────────────────────────
// Light tints only — a hint of colour, never a block of it.
export const STATUS_META: Record<string, { label: string; tone: string }> = {
  submitted:         { label: "Awaiting Draft",     tone: "border-gray-200 bg-gray-50 text-gray-700" },
  in_review:         { label: "In Review",          tone: "border-sky-200 bg-sky-50/70 text-sky-800" },
  pending_committee: { label: "Committee",          tone: "border-amber-200 bg-amber-50/70 text-amber-800" },
  pending_approval:  { label: "Pending Approval",   tone: "border-amber-200 bg-amber-50/70 text-amber-800" },
  approved:          { label: "Approved", tone: "border-sky-200 bg-sky-50/70 text-sky-800" },
  returned:          { label: "Returned",           tone: "border-orange-200 bg-orange-50/70 text-orange-800" },
  rejected:          { label: "Rejected",           tone: "border-gray-200 bg-gray-50 text-gray-500" },
  signing:           { label: "Signing",            tone: "border-sky-200 bg-sky-50/70 text-sky-800" },
  signed:            { label: "Pending Stamping",  tone: "border-sky-200 bg-sky-50/70 text-sky-800" },
  stamped:           { label: "Stamped",            tone: "border-sky-200 bg-sky-50/70 text-sky-800" },
  stamping:          { label: "Stamping",           tone: "border-sky-200 bg-sky-50/70 text-sky-800" },
  active:            { label: "Active",             tone: "border-emerald-200 bg-emerald-50/70 text-emerald-800" },
  closed:            { label: "Closed",             tone: "border-gray-200 bg-gray-50 text-gray-500" },
};
/** Status label, allowing for Lite (no stamping step, so "Signed" is just that). */
export const statusLabel = (c: { status: string; contract_type?: string }) =>
  c.status === "signed" && c.contract_type && flowOf(c as any) === "lite" ? "Pending Filing" : STATUS_META[c.status]?.label ?? c.status;
export const OUTCOME_LABEL: Record<string, string> = {
  cleared: "Cleared", cleared_with_comments: "Cleared with comments", not_cleared: "Not cleared",
  approved: "Approved", returned: "Returned", rejected: "Rejected", pending: "Pending",
};

/** Working days elapsed since `from` (Mon–Fri; public holidays not modelled). */
export function workingDaysSince(from: string | null | undefined, now = new Date()): number {
  if (!from) return 0;
  const d = new Date(from); let n = 0;
  while (d < now) { d.setDate(d.getDate() + 1); if (d <= now && d.getDay() % 6 !== 0) n++; }
  return n;
}

// ── generating a draft from a template ───────────────────────────────────────
// A business user raises the request and answers a few questions; the draft is
// the approved template with those answers in the parties block and Schedule 1
// — nothing else in the wording changes, so a generated draft is standard by
// construction and needs no deviation review until the counterparty marks it up.

/** Group entity particulars for the parties block and notices.
 *  ASSUMPTION: DEMO values — the registration numbers are placeholders in a
 *  visibly fake pattern, not the entities' real numbers; replace them with the
 *  group's entity master before any draft is used for real. */
export interface EntityDetails { regNo: string; address: string; contact: string; whistleblowing: string }
const HQ = "Wisma Lim Seong Hai, Kuala Lumpur";
const legalContact = "Head of Legal, " + HQ + ", legal@example.com";
export const ENTITY_DETAILS: Record<string, EntityDetails> = {
  "Lim Seong Hai Capital Berhad": { regNo: "199001012345 (123456-X)", address: HQ, contact: legalContact, whistleblowing: "whistleblowing@example.com" },
  "LSH BEST Builders Sdn Bhd": { regNo: "200501023456 (234567-A)", address: HQ, contact: legalContact, whistleblowing: "whistleblowing@example.com" },
  "Astana Setia Sdn Bhd": { regNo: "200801034567 (345678-B)", address: HQ, contact: legalContact, whistleblowing: "whistleblowing@example.com" },
  "Lim Seong Hai Lighting Sdn Bhd": { regNo: "201101045678 (456789-C)", address: HQ, contact: legalContact, whistleblowing: "whistleblowing@example.com" },
  "Knight Auto Sdn Bhd": { regNo: "201401056789 (567890-D)", address: HQ, contact: legalContact, whistleblowing: "whistleblowing@example.com" },
  "Lim Seong Hai Ventures Sdn Bhd": { regNo: "201701067890 (678901-E)", address: HQ, contact: legalContact, whistleblowing: "whistleblowing@example.com" },
};

/** "Lim Seong Hai Lighting Sdn Bhd" → "LSH Lighting", for lists and folders. */
export const entityShort = (e?: string | null) =>
  String(e ?? "").replace(/^Lim Seong Hai\b/, "LSH").replace(/\s+(Sdn\.? Bhd\.?|Berhad|Bhd)$/i, "").trim();

// ── ownership and obligations ────────────────────────────────────────────────
// A contract has an owner in the business, not only Legal; each obligation has
// a category, a person in charge and a due date, so each person sees their own.

export type ObligationCategory = "finance" | "business" | "legal";
export const OBLIGATION_CATEGORIES: Record<ObligationCategory, string> = { finance: "Finance", business: "Business", legal: "Legal" };
/** ASSUMPTION: demo people — placeholders until the client's user list is connected. */
export const DEMO_PEOPLE: { name: string; team: ObligationCategory }[] = [
  { name: "Jeremy Teh", team: "business" }, { name: "Dabraj", team: "finance" }, { name: "Irwin", team: "legal" },
];
/** A name, never an email address (older requests stored the requester's email). */
export const contractOwner = (c: any): string => {
  const v = c?.owner_name || c?.repository?.owner || c?.requestor_name || "";
  return v && v.includes("@") ? displayName(v) : v;
};
/** Finance and Legal go to their teams; Business to the contract owner. */
export const defaultPic = (cat: ObligationCategory, owner?: string) =>
  cat === "business" ? owner || DEMO_PEOPLE.find((p) => p.team === "business")!.name : DEMO_PEOPLE.find((p) => p.team === cat)!.name;

export interface Obligation {
  id: string; text: string; category: ObligationCategory; pic: string; due_date: string | null; trigger?: string;
  amount?: number | null; percent?: number | null; status: "open" | "done"; done_by?: string | null; done_at?: string | null; auto?: string;
}
/** A category from the wording, for obligations saved before categories existed. */
export function categoryOf(text: string): ObligationCategory {
  if (/\b(pay|paid|payment|invoice|deposit|retention|instal|fee|fees|remit|refund)\w*|\d+\s?%|\bRM\s?\d/i.test(text)) return "finance";
  if (/\b(notif|notice|stamp|return|destroy|confidential|conflict|comply|compliance|law|breach|personal data|dispute|indemn)\w*/i.test(text)) return "legal";
  return "business";
}
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Old (text) or new (object) obligations → objects with category, PIC and status. */
export function normalizeObligations(list: any[] | null | undefined, owner?: string): Obligation[] {
  return (list ?? []).filter(Boolean).map((x: any, i: number) => {
    const o = typeof x === "string" ? { text: x } : x;
    const category: ObligationCategory = ["finance", "business", "legal"].includes(o.category) ? o.category : categoryOf(String(o.text ?? ""));
    return {
      id: o.id || `o${i + 1}`, text: String(o.text ?? "").trim(), category, pic: o.pic || defaultPic(category, owner),
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(o.due_date ?? "") ? o.due_date : null, trigger: o.trigger ?? "",
      amount: typeof o.amount === "number" ? o.amount : o.amount ? Number(o.amount) || null : null,
      percent: typeof o.percent === "number" ? o.percent : o.percent ? Number(o.percent) || null : null,
      status: o.status === "done" ? "done" : "open", done_by: o.done_by ?? null, done_at: o.done_at ?? null, auto: o.auto,
    } as Obligation;
  }).filter((o) => o.text);
}
/** Obligations every filed contract has: decide on renewal 30 days before expiry,
 *  and stamping while a full-flow contract is unstamped. Added once (by `auto` key). */
export function autoObligations(c: any, end_date: string | null | undefined, existing: Obligation[], owner: string): Obligation[] {
  const out: Obligation[] = [];
  const has = (k: string) => existing.some((o) => o.auto === k);
  if (end_date && !has("renewal")) {
    const d = new Date(end_date); d.setDate(d.getDate() - 30);
    out.push({ id: "auto-renewal", auto: "renewal", text: "Decide on renewal or exit before expiry", category: "business", pic: owner || defaultPic("business"), due_date: isoDay(d), trigger: `30 days before expiry (${end_date})`, status: "open" });
  }
  if (flowOf(c) === "full" && !c.stamping?.stamped_date && !has("stamping")) {
    const base = c.signed_date ? new Date(c.signed_date) : new Date(); base.setDate(base.getDate() + 30);
    out.push({ id: "auto-stamping", auto: "stamping", text: "Stamp the contract (within 30 days of signing)", category: "legal", pic: defaultPic("legal"), due_date: isoDay(base), trigger: "30 days from signing", status: "open" });
  }
  return out;
}
export type ObligationBucket = "overdue" | "soon" | "later" | "nodate" | "done";
export function obligationBucket(o: Obligation, today = new Date()): ObligationBucket {
  if (o.status === "done") return "done";
  if (!o.due_date) return "nodate";
  const d = daysBetween(today, o.due_date);
  return d < 0 ? "overdue" : d <= 30 ? "soon" : "later";
}

/** The counterparty's notice line from the vendor record: name, designation,
 *  address, email — whatever the record has. */
export const vendorContact = (v: any): string =>
  [v?.contact_name, v?.contact_designation, v?.address, v?.contact_email, v?.contact_phone].map((x) => String(x ?? "").trim()).filter(Boolean).join(", ");

/** Template particulars that come from the records: the entity's and the vendor's. */
export function particularsFromRecords(entity: string, vendor: any | null): Record<string, string> {
  const e = ENTITY_DETAILS[entity];
  const out: Record<string, string> = {};
  if (e) Object.assign(out, { company_reg: e.regNo, company_address: e.address, company_contact: e.contact, whistleblowing: e.whistleblowing });
  if (vendor) {
    out.cp_name = vendor.name ?? "";
    out.cp_reg = vendor.registration_no ?? "";
    if (vendor.address) out.cp_address = vendor.address;
    const c = vendorContact(vendor);
    if (c) out.cp_contact = c;
  }
  return out;
}

export interface TemplateField {
  key: string; label: string; kind: "text" | "textarea" | "date" | "select";
  options?: string[]; required?: boolean; hint?: string; group: "Agreement" | "The Company" | "Counterparty";
}
export const NDA_FIELDS: TemplateField[] = [
  { key: "date", label: "Date of Agreement", kind: "date", required: true, group: "Agreement" },
  { key: "purpose", label: "Purpose of the disclosure", kind: "textarea", required: true, group: "Agreement", hint: "What the information is exchanged for — e.g. tender for a named project, pre-qualification, a proposed joint development" },
  { key: "direction", label: "Who discloses", kind: "select", options: ["Mutual", "Company to Counterparty only", "Counterparty to Company only"], required: true, group: "Agreement" },
  { key: "term", label: "Term", kind: "select", options: ["Two (2) years", "One (1) year", "Three (3) years"], required: true, group: "Agreement" },
  { key: "disputes", label: "Disputes", kind: "select", options: ["Courts of Malaysia", "AIAC arbitration, Kuala Lumpur"], required: true, group: "Agreement" },
  { key: "stamp_duty", label: "Stamp duty borne by", kind: "select", options: ["Counterparty", "Company", "Both Parties equally"], required: true, group: "Agreement" },
  { key: "non_solicit", label: "Clause 13 (non-solicitation) applies", kind: "select", options: ["No", "Yes"], required: true, group: "Agreement" },
  { key: "company_reg", label: "Company registration no.", kind: "text", required: true, group: "The Company" },
  { key: "company_address", label: "Company registered address", kind: "text", required: true, group: "The Company" },
  { key: "company_contact", label: "Company contact and notice address", kind: "textarea", required: true, group: "The Company", hint: "Name, designation, address, email" },
  { key: "whistleblowing", label: "Whistleblowing channel (clause 12.4)", kind: "text", required: true, group: "The Company", hint: "Email or web address of the Company's whistleblowing channel" },
  { key: "cp_name", label: "Counterparty name", kind: "text", required: true, group: "Counterparty" },
  { key: "cp_reg", label: "Counterparty registration no.", kind: "text", required: true, group: "Counterparty" },
  { key: "cp_form", label: "Counterparty is a", kind: "select", options: ["company", "partnership", "sole proprietorship", "limited liability partnership"], required: true, group: "Counterparty" },
  { key: "cp_country", label: "Registered in", kind: "text", required: true, group: "Counterparty" },
  { key: "cp_address", label: "Counterparty registered address", kind: "text", required: true, group: "Counterparty" },
  { key: "cp_contact", label: "Counterparty contact and notice address", kind: "textarea", required: true, group: "Counterparty", hint: "Name, designation, address, email" },
];

const BLANK = "[●]";
const or = (v?: string) => (v ?? "").trim() || BLANK;
const longDate = (iso?: string) => {
  if (!iso) return BLANK;
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? BLANK : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

/** Answers → placeholder values, plus the required answers still missing
 *  (left as [●] in the draft, so an incomplete draft is visibly incomplete). */
export function fillNda(entity: string, f: Record<string, string>): { values: Record<string, string>; missing: string[] } {
  const missing = NDA_FIELDS.filter((x) => x.required && !(f[x.key] ?? "").trim()).map((x) => x.label);
  const company = entity.toUpperCase();
  const cp = or(f.cp_name).toUpperCase();
  return {
    missing,
    values: {
      company_party: `${company} (Registration No. ${or(f.company_reg)}), a company incorporated in Malaysia with its registered address at ${or(f.company_address)} (the "Company"), acting for itself and on behalf of its Affiliates`,
      cp_party: `${cp} (Registration No. ${or(f.cp_reg)}), a ${or(f.cp_form)} registered in ${or(f.cp_country)} with its registered address at ${or(f.cp_address)} (the "Counterparty")`,
      company_upper: company,
      cp_upper: cp,
      whistleblowing: or(f.whistleblowing),
      s1: longDate(f.date), s2: or(f.purpose), s3: entity, s4: or(f.direction), s5: `${or(f.term)} from the Date of Agreement`,
      s6: or(f.company_contact), s7: or(f.cp_contact), s8: or(f.stamp_duty), s9: or(f.disputes), s10: or(f.non_solicit),
    },
  };
}

// ── people ───────────────────────────────────────────────────────────────────
/** A person's name for display — never an email address or its domain. */
export function displayName(v: string | null | undefined): string {
  const raw = (v ?? "").trim();
  if (!raw) return "—";
  if (!raw.includes("@")) return raw;
  return raw.split("@")[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// ── client contracts: the award checked against our tender (CMS-02) ─────────
export const COMPARISON_AREAS: { id: string; label: string }[] = [
  { id: "scope", label: "Scope of works" },
  { id: "price", label: "Contract sum and payment" },
  { id: "dates", label: "Commencement and completion dates" },
  { id: "lad", label: "Liquidated damages" },
  { id: "esh", label: "Environment, safety and health" },
  { id: "legal", label: "Legal terms" },
  { id: "insurance", label: "Insurance, bonds and retention" },
];
export type Decision = "pending" | "accepted" | "confirm_with_client" | "confirmed";
export const DECISION_LABEL: Record<Decision, string> = {
  pending: "To decide", accepted: "Accepted", confirm_with_client: "Confirm with client", confirmed: "Client confirmed",
};

// ── execution: bonds, insurance, levy (CMS-01 step 15) ───────────────────────
export const SECURITY_TYPES: { id: string; label: string }[] = [
  { id: "performance_bond", label: "Performance bond" },
  { id: "directors_guarantee", label: "Director's guarantee" },
  { id: "insurance_car", label: "Contractor's all-risks insurance" },
  { id: "insurance_wc", label: "Workmen's compensation / SOCSO" },
  { id: "insurance_pl", label: "Public liability insurance" },
  { id: "cidb_levy", label: "CIDB levy" },
];
export interface Security { type: string; required: boolean; amount?: number | null; reference?: string; valid_until?: string | null }

/** What a contract type needs on file before payment (ASSUMPTION: the spec's
 *  5% bond for contractors; insurance for works; CIDB levy on works). */
export function defaultSecurities(contractType: string, valueMyr: number | null): Security[] {
  const works = ["letter_of_award", "work_order", "subcontract", "client_loa", "client_contract"].includes(contractType);
  const bond = works && valueMyr ? Math.round(valueMyr * 0.05) : null;
  return [
    { type: "performance_bond", required: works, amount: bond },
    { type: "insurance_car", required: works },
    { type: "insurance_wc", required: works },
    { type: "insurance_pl", required: works },
    { type: "cidb_levy", required: ["client_loa", "client_contract"].includes(contractType) },
  ];
}
/** Payment-ready: every required instrument is on file with amount and validity. */
export const paymentReady = (sec: Security[]) =>
  sec.filter((x) => x.required).every((x) => (x.type === "cidb_levy" ? !!x.reference : !!x.reference && !!x.valid_until));

// ── the repository record (CMS-03) ───────────────────────────────────────────
export interface KeyTerms {
  parties: string; value?: number | null; currency?: string; start_date?: string | null; end_date?: string | null;
  notice_period?: string; renewal?: string; governing_law?: string;
  /** Saved as objects; older records hold plain text — read through normalizeObligations(). */
  obligations: (string | Obligation)[]; owner?: string;
}

// ── dates ────────────────────────────────────────────────────────────────────
export const daysBetween = (from: string | Date, to: string | Date) =>
  Math.round((new Date(to).setHours(0, 0, 0, 0) - new Date(from).setHours(0, 0, 0, 0)) / 86_400_000);

// ── alerts ───────────────────────────────────────────────────────────────────
export interface Alert { kind: "expiry" | "stamping" | "security" | "confirmation"; days: number; text: string; severity: "high" | "medium" }

/** What needs attention on a contract today: expiry within 30 days, stamping
 *  against its 30-day window (flagged from day 14, urgent from day 25), a bond
 *  or policy lapsing within 30 days, a client confirmation unanswered for 7. */
export function contractAlerts(c: any, today = new Date()): Alert[] {
  const out: Alert[] = [];
  if (c.status === "active" && c.expiry_date) {
    const d = daysBetween(today, c.expiry_date);
    if (d <= 30) out.push({ kind: "expiry", days: d, severity: d <= 7 ? "high" : "medium",
      text: d < 0 ? `Expired ${-d} day${d === -1 ? "" : "s"} ago` : `Expires in ${d} day${d === 1 ? "" : "s"} — renew, renegotiate or let lapse` });
  }
  if (c.signed_date && !c.stamping?.stamped_date && flowOf(c) === "full") {
    const day = daysBetween(c.signed_date, today);
    if (day >= 14) out.push({ kind: "stamping", days: 30 - day, severity: day >= 25 ? "high" : "medium",
      text: day > 30 ? `Stamping overdue — ${day - 30} days past the 30-day window` : `Stamp by day 30 — ${30 - day} day${30 - day === 1 ? "" : "s"} left` });
  }
  for (const x of (c.securities ?? []) as Security[]) {
    if (!x.valid_until) continue;
    const d = daysBetween(today, x.valid_until);
    if (d <= 30) out.push({ kind: "security", days: d, severity: d <= 7 ? "high" : "medium",
      text: `${SECURITY_TYPES.find((s) => s.id === x.type)?.label ?? x.type} ${d < 0 ? "lapsed" : `lapses in ${d} days`}` });
  }
  if (c.confirmation?.sent_date && !c.confirmation?.reply_date) {
    const d = daysBetween(c.confirmation.sent_date, today);
    if (d >= 7) out.push({ kind: "confirmation", days: d, severity: "medium", text: `Client has not replied to our confirmation letter (${d} days)` });
  }
  return out;
}

// ── milestones ───────────────────────────────────────────────────────────────
export interface Milestone {
  key: string; label: string; state: "done" | "current" | "todo" | "skipped";
  detail?: string; date?: string | null;
}

/** Where a contract is, stage by stage, and the one thing to do next. Lite
 *  (template documents) stops at Legal's decision, signing and filing. */
export function contractMilestones(c: any, docs: any[], events: any[], comparison?: any): { stages: Milestone[]; next: { text: string; role: CcmsRole | null } | null } {
  const client = c.side === "client";
  const lite = flowOf(c) === "lite";
  const route: Stage[] = c.approval_route ?? [];
  const has = (role: string) => docs.some((d) => d.doc_role === role);
  const ev = (type: string) => events.filter((e) => e.event_type === type).at(-1)?.created_at ?? null;
  const reviews = route.filter((s) => s.kind === "review");
  const approvals = route.filter((s) => s.kind === "approval");
  const reviewsOk = reviews.every((s) => s.status === "cleared" || s.status === "cleared_with_comments");
  const approvalsOk = approvals.every((s) => s.status === "approved");
  const after = ["approved", "signed", "stamped", "active", "closed"].includes(c.status);
  const signed = !!c.signed_date;
  const stamped = !!c.stamping?.stamped_date;
  const secs: Security[] = c.securities ?? [];
  const secOk = secs.length > 0 && paymentReady(secs);
  const inRepo = c.status === "active" || c.status === "closed";
  const generated = docs.some((d) => d.generated);
  const theirDocs = docs.filter((d) => d.doc_role === "counterparty");
  const asIs = ev("accepted_as_is");
  const items = (comparison?.items ?? []) as any[];
  const open = items.filter((i) => i.status !== "matches" && (i.decision ?? "pending") === "pending").length;
  const unconfirmed = items.filter((i) => i.decision === "confirm_with_client").length;

  const list: Omit<Milestone, "state">[] & { ok: boolean }[] = [] as any;
  const push = (key: string, label: string, ok: boolean, detail?: string, date?: string | null) => (list as any).push({ key, label, ok, detail, date });
  push("request", client ? "Award Logged" : "Request Raised", true, undefined, c.created_at);
  if (client) {
    push("tender", "Tender Attached", has("tender"));
    push("compare", "Tender Comparison", items.length > 0, items.length ? `${items.filter((i) => i.status !== "matches").length} difference(s)` : undefined);
    push("differences", "Differences Settled", items.length > 0 && open === 0 && unconfirmed === 0,
      open ? `${open} pending` : unconfirmed ? `${unconfirmed} with client` : undefined);
  } else {
    push("draft", "Draft Ready", has("draft"), docs.find((d) => d.doc_role === "draft")?.generated ? "Template" : undefined);
    if (generated) {
      push("sent", "Sent to Counterparty", !!ev("sent"), undefined, ev("sent"));
      push("theirs", "Counterparty Revision", theirDocs.length > 0 || !!asIs || after,
        theirDocs.length ? `v${theirDocs[0].version} · AI reviewed` : asIs ? "No changes" : undefined);
    }
  }
  if (lite) {
    push("decision", "Legal Decision", reviewsOk && approvalsOk && after, c.status === "returned" ? "Returned" : undefined);
  } else {
    push("review", "Reviews", reviewsOk, reviews.filter((s) => s.status === "pending").map((s) => s.label).join(", ") || undefined);
    push("approval", "Approval", approvalsOk && after, approvals.map((s) => s.label).join(" → "));
  }
  push("signed", "Signed", signed, undefined, c.signed_date);
  if (!lite) {
    push("stamped", "Stamped", stamped, !stamped && signed ? `Day ${daysBetween(c.signed_date, new Date())} of 30` : undefined, c.stamping?.stamped_date);
    push("securities", "Bonds & Insurance", secOk, secs.length ? (secOk ? "Payment-ready" : "Incomplete") : undefined);
  }
  push("repository", "Repository", inRepo, c.expiry_date ? `Expires ${c.expiry_date}` : undefined);
  push("closed", "Closed", c.status === "closed", c.closure?.retain_until ? `Retained to ${c.closure.retain_until}` : undefined);

  let currentSet = false;
  const stages: Milestone[] = (list as any[]).map((m) => {
    if (m.ok) return { key: m.key, label: m.label, state: "done", detail: m.detail, date: m.date };
    if (c.status === "rejected") return { key: m.key, label: m.label, state: "skipped" };
    if (!currentSet) { currentSet = true; return { key: m.key, label: m.label, state: "current", detail: m.detail, date: m.date }; }
    return { key: m.key, label: m.label, state: "todo", detail: m.detail };
  });
  const cur = stages.find((s) => s.state === "current")?.key;
  const pending = reviews.filter((s) => s.status === "pending");
  const appr = nextApproval(route);
  const returned = c.status === "returned";
  const next: Record<string, { text: string; role: CcmsRole | null }> = {
    tender: { text: "Awaiting tender submission", role: "contract_executive" },
    compare: { text: "Awaiting tender comparison", role: "contract_manager" },
    differences: { text: open ? "Differences pending decision" : "Awaiting client confirmation", role: "contract_manager" },
    draft: { text: "Awaiting draft", role: "requestor" },
    sent: { text: "Awaiting dispatch to counterparty", role: "requestor" },
    theirs: { text: "Awaiting counterparty revision", role: "requestor" },
    decision: { text: returned ? "Returned for revision" : "Awaiting Legal decision", role: returned ? "requestor" : "legal" },
    review: { text: returned ? "Returned for revision" : `Awaiting ${pending.map((s) => stageTitle(s.label)).join(" and ")}`, role: returned ? "requestor" : pending[0]?.role ?? null },
    approval: { text: appr ? `Awaiting ${appr.label} approval` : "Awaiting approval", role: appr?.role ?? "approver" },
    signed: { text: "Awaiting signed copy", role: "contract_executive" },
    stamped: { text: "Awaiting stamping — 30 days from signing", role: "contract_executive" },
    securities: { text: "Awaiting bonds and insurance", role: "finance" },
    repository: { text: "Awaiting repository filing", role: "contract_executive" },
    closed: { text: "Active — renewal or close-out", role: "contract_manager" },
  };
  return { stages, next: c.status === "rejected" ? null : cur ? next[cur] ?? null : null };
}

// ── the action for the current stage ─────────────────────────────────────────
// One to three buttons under the current milestone. Each opens a pop-up with
// only that action in it (or goes to the review screen), and names who acts.

export type ActionId =
  | "generate" | "upload_draft" | "download" | "mark_sent" | "upload_theirs" | "accepted_as_is" | "upload_revised" | "resubmit"
  | "review" | "decide" | "sign" | "stamp" | "securities" | "repository" | "renew" | "change" | "change_step" | "close"
  | "attach_tender" | "upload_award" | "open_review" | "confirm_sent" | "confirm_reply";
export interface NextAction {
  id: ActionId; label: string; role: CcmsRole; primary?: boolean;
  /** Review stage key, document or change the action is on. */
  stage?: string; docId?: string; changeId?: string;
}
/** Stage names as the system shows them — also for routes stored before the
 *  labels were title-cased. */
export const stageTitle = (x: string) => x.replace(/(^|\s)([a-z])/g, (_m, a, b) => a + b.toUpperCase());

/** Actions that navigate rather than open a pop-up. */
export const LINK_ACTIONS: ActionId[] = ["review", "open_review", "download"];

export function nextActions(c: any, docs: any[], events: any[], comparison?: any): NextAction[] {
  if (["rejected", "closed"].includes(c.status)) return [];
  const lite = flowOf(c) === "lite";
  const route: Stage[] = c.approval_route ?? [];
  const tpl = !!CONTRACT_TYPES[c.contract_type]?.templateId;
  // docs are newest first; the one under review is the newest draft or markup.
  const latest = docs.find((d) => d.doc_role === "draft" || d.doc_role === "counterparty");
  const theirs = docs.some((d) => d.doc_role === "counterparty");

  if (c.status === "returned") {
    return [
      { id: theirs ? "upload_theirs" : "upload_revised", label: "Upload Revision", role: "requestor" },
      ...(tpl ? [{ id: "generate" as const, label: "Regenerate Draft", role: "requestor" as const }] : []),
      { id: "resubmit", label: "Resubmit", role: "requestor", primary: true },
    ];
  }
  const { stages } = contractMilestones(c, docs, events, comparison);
  const cur = stages.find((s) => s.state === "current")?.key;
  const decide = (): NextAction[] => {
    const pending = route.filter((s) => s.kind === "review" && s.status === "pending");
    if (pending.length) {
      return pending.map((s, i) => ({ id: "review" as const, label: stageTitle(s.label), role: s.role, primary: i === 0, stage: s.key, docId: latest?.id }));
    }
    const appr = nextApproval(route);
    return appr ? [{ id: "decide", label: `${stageTitle(appr.label)} Approval`, role: appr.role, primary: true, stage: appr.key }] : [];
  };
  switch (cur) {
    case "tender": return [{ id: "attach_tender", label: "Attach Tender", role: "contract_executive", primary: true }];
    case "compare": {
      const award = docs.find((d) => d.doc_role === "counterparty");
      return award
        ? [{ id: "open_review", label: "Tender Comparison", role: "contract_manager", primary: true, docId: award.id }]
        : [{ id: "upload_award", label: "Upload Client Award", role: "contract_executive", primary: true }];
    }
    case "differences": {
      const award = docs.find((d) => d.comparison);
      const items = (comparison?.items ?? []) as any[];
      if (items.some((i) => i.status !== "matches" && (i.decision ?? "pending") === "pending")) {
        return [{ id: "open_review", label: "Resolve Differences", role: "contract_manager", primary: true, docId: award?.id }];
      }
      return c.confirmation?.sent_date
        ? [{ id: "confirm_reply", label: "Record Client Reply", role: "contract_manager", primary: true }]
        : [{ id: "confirm_sent", label: "Confirmation Letter Sent", role: "contract_manager", primary: true }];
    }
    case "draft": return [
      ...(tpl ? [{ id: "generate" as const, label: "Select Template", role: "requestor" as const, primary: true }] : []),
      { id: "upload_draft", label: "Upload Draft", role: "contract_executive", primary: !tpl },
    ];
    case "sent": {
      const draft = docs.find((d) => d.doc_role === "draft");
      return [
        { id: "download", label: "Download Draft", role: "requestor", docId: draft?.id },
        { id: "mark_sent", label: "Mark as Sent", role: "requestor", primary: true, docId: draft?.id },
      ];
    }
    case "theirs": return [
      { id: "upload_theirs", label: "Upload Revision", role: "requestor", primary: true },
      { id: "accepted_as_is", label: "Accepted Without Changes", role: "requestor" },
    ];
    case "review": case "decision": case "approval": return decide();
    case "signed": return [{ id: "sign", label: "Upload Signed Copy", role: "contract_executive", primary: true }];
    case "stamped": return [{ id: "stamp", label: "Record Stamping", role: "contract_executive", primary: true }];
    case "securities": return [{ id: "securities", label: "Bonds & Insurance", role: "finance", primary: true }];
    case "repository": return [{ id: "repository", label: "File to Repository", role: "contract_executive", primary: true }];
    case "closed": {
      const out: NextAction[] = [];
      for (const x of (c.changes ?? []) as any[]) {
        if (x.signed || x.approval === "rejected") continue;
        if (x.legal === "pending") out.push({ id: "change_step", label: `${x.id} Legal Vetting`, role: "legal", changeId: x.id, stage: "legal" });
        else if (x.approval === "pending") out.push({ id: "change_step", label: `${x.id} Approval`, role: "approver", changeId: x.id, stage: "approval" });
        else if (x.approval === "approved") out.push({ id: "change_step", label: `${x.id} Signed Appendix`, role: "contract_executive", changeId: x.id, stage: "signed" });
      }
      const expiring = c.expiry_date && daysBetween(new Date(), c.expiry_date) <= 30;
      out.push({ id: "renew", label: "Renewal", role: "contract_manager", primary: !!expiring && !out.length });
      if (!lite) out.push({ id: "change", label: "Change Request", role: "contract_executive" });
      out.push({ id: "close", label: lite ? "Close & Archive" : "Close-out", role: "contract_manager" });
      if (out.length && !out.some((a) => a.primary)) out[0].primary = true;
      return out;
    }
    default: return [];
  }
}

// ── who is it waiting on, and how urgent ─────────────────────────────────────

/** The stage a request is waiting on, and whether it is past its service level. */
export function waitingOn(c: any): { label: string; overdue: boolean } | null {
  const route: Stage[] = c.approval_route ?? [];
  if (c.status === "submitted") return { label: "Draft", overdue: workingDaysSince(c.created_at) > SLA_DAYS.contract_executive };
  if (c.status === "in_review") {
    const open = route.filter((s) => s.kind === "review" && s.status === "pending");
    const sla = Math.max(0, ...open.map((s) => s.sla_days));
    return { label: open.map((s) => s.label).join(" · ") || "Review", overdue: workingDaysSince(c.stage_started_at) > sla };
  }
  if (c.status === "pending_committee" || c.status === "pending_approval") {
    const s = nextApproval(route);
    return s ? { label: s.label, overdue: workingDaysSince(c.stage_started_at) > s.sla_days } : null;
  }
  if (c.status === "returned") return { label: "Requestor revision", overdue: false };
  return null;
}

/** 1 urgent · 2 needs a decision · 3 in progress · 4 active · 5 closed. Lists
 *  sort by rank, then by whatever is due soonest. */
export interface Priority { rank: 1 | 2 | 3 | 4 | 5; reason: string; due: number }
export function priorityOf(c: any, today = new Date()): Priority {
  if (["closed", "rejected"].includes(c.status)) return { rank: 5, reason: "", due: 99_999 };
  const alerts = contractAlerts(c, today);
  const soonest = alerts.length ? Math.min(...alerts.map((a) => a.days)) : 99_999;
  const w = waitingOn(c);
  const blocking = ((c.flags ?? []) as Flag[]).filter((f) => BLOCKING_FLAGS.includes(f.key));
  const urgent = alerts.find((a) => a.severity === "high" || a.kind === "expiry");
  if (w?.overdue) return { rank: 1, reason: `${w.label} overdue`, due: -1 };
  if (blocking.length && c.status !== "active") return { rank: 1, reason: FLAG_META[blocking[0].key].label, due: 0 };
  if (urgent) return { rank: 1, reason: urgent.text, due: soonest };
  if (c.status === "returned") return { rank: 2, reason: "Returned for revision", due: 90_000 };
  if (c.status === "pending_approval" || c.status === "pending_committee") return { rank: 2, reason: `Awaiting ${w?.label ?? "approval"}`, due: 90_000 };
  if (alerts.length) return { rank: 2, reason: alerts[0].text, due: soonest };
  if (blocking.length) return { rank: 2, reason: FLAG_META[blocking[0].key].label, due: 90_000 };
  if (c.status === "active") return { rank: 4, reason: "", due: 99_999 };
  return { rank: 3, reason: w?.label ? `Awaiting ${w.label}` : "", due: 95_000 };
}
export function byPriority(a: any, b: any): number {
  const pa = priorityOf(a), pb = priorityOf(b);
  return pa.rank - pb.rank || pa.due - pb.due || String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? ""));
}

export const fmtMoneyPlain = (v: number | null | undefined) =>
  typeof v === "number" ? `RM${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—";
