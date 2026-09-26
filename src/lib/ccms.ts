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
} as const;
export type CcmsRole = keyof typeof CCMS_ROLES;

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
  nda:                   { label: "Non-disclosure agreement",       side: "vendor", templateId: "lsh-nda-mutual" },
  client_loa:            { label: "Client Letter of Award",         side: "client", legalAlways: true },
  client_contract:       { label: "Client contract",                side: "client", legalAlways: true },
};

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
  | "cross_border_data" | "dd_expired" | "vendor_not_approved" | "loa_items_missing" | "work_order_cap";
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
};
/** Flags that stop approval outright, rather than adding a reviewer. */
export const BLOCKING_FLAGS: FlagKey[] = ["dd_expired", "vendor_not_approved", "work_order_cap"];

export interface Flag { key: FlagKey; source: "platform" | "ai"; detail: string }

export interface VendorLite {
  name: string; status: string; dd_valid_until: string | null; risk_rating: string | null;
  related_party: boolean; related_party_note?: string | null;
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
  if (vendor && vendor.status !== "approved") out.push({ key: "vendor_not_approved", source: "platform", detail: `${vendor.name} is ${vendor.status.replace("_", " ")}.` });
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
  if (legalReasons.length) stages.push({ key: "legal", label: "Legal vetting", kind: "review", role: "legal", sla_days: SLA_DAYS.legal, reason: legalReasons.join("; ") });
  stages.push({ key: "finance", label: "Finance review", kind: "review", role: "finance", sla_days: SLA_DAYS.finance, reason: "Payment terms, bonds, insurance and budget" });
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
export const STATUS_META: Record<string, { label: string; tone: string }> = {
  submitted:         { label: "Awaiting draft",     tone: "border-gray-300 text-gray-700" },
  in_review:         { label: "In review",          tone: "border-blue-300 text-blue-800" },
  pending_committee: { label: "Committee",          tone: "border-violet-300 text-violet-800" },
  pending_approval:  { label: "Pending approval",   tone: "border-amber-300 text-amber-800" },
  approved:          { label: "Approved",           tone: "border-emerald-300 text-emerald-800" },
  returned:          { label: "Returned",           tone: "border-orange-300 text-orange-800" },
  rejected:          { label: "Rejected",           tone: "border-red-300 text-red-800" },
  signing:           { label: "Signing",            tone: "border-gray-300 text-gray-700" },
  stamping:          { label: "Stamping",           tone: "border-gray-300 text-gray-700" },
  active:            { label: "Active",             tone: "border-emerald-300 text-emerald-800" },
  closed:            { label: "Closed",             tone: "border-gray-300 text-gray-500" },
};
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
