// ----------------------------------------------------------------------------
// Branding Compliance — shared rules (client-safe, no I/O).
//
// Agencies submit material; the AI reviews it against the brand guideline
// (src/lib/brand-guideline.ts) the way Commercial CMS reviews a draft — a risk
// score, a verdict and located findings; a UKAS brand officer then clears it
// for public use or returns it. Every review is kept, so the dashboard can show
// each agency's compliance over time.
// ----------------------------------------------------------------------------

import { BRAND_RULES, PALETTE, ruleById, type RuleSeverity } from "./brand-guideline";

export const BRAND_WORKSPACE = "brand_compliance" as const;

/** ASSUMPTION: sample agencies for the demo; the real list comes from the state. */
export const AGENCIES = [
  "Unit Komunikasi Awam Sarawak (UKAS)",
  "Jabatan Premier Sarawak",
  "Jabatan Kerja Raya Sarawak (JKR)",
  "Sarawak Tourism Board (STB)",
  "Kementerian Pelancongan, Industri Kreatif dan Seni Persembahan (MTCP)",
  "Kementerian Utiliti dan Telekomunikasi (MUT)",
  "Sarawak Economic Development Corporation (SEDC)",
  "Sarawak Digital Economy Corporation (SDEC)",
  "Lembaga Sumber Asli dan Alam Sekitar (NREB)",
  "Majlis Bandaraya Kuching Selatan (MBKS)",
  "Sarawak Biodiversity Centre (SBC)",
];
/** Statutory bodies and councils: they carry their own corporate identity and
 *  may use the state crest only with the State Secretary's written permission
 *  (Circular Memorandum 47/75), so the crest, state colour and font rules do
 *  not apply to them. Ministries and departments use the crest. */
export const STATUTORY = new Set(["STB", "SEDC", "SDEC", "NREB", "MBKS", "SBC"]);
export const isStatutory = (agency: string) => STATUTORY.has(agency.match(/\(([^)]+)\)\s*$/)?.[1] ?? "");

export const MATERIAL_TYPES: Record<string, string> = {
  slide_deck: "Slides", brochure: "Brochure", poster: "Poster or banner", social_post: "Social media post",
  proposal: "Proposal or paper", announcement: "Announcement or press statement", other: "Other",
};
export const CHANNELS: Record<string, string> = { print: "Printed", digital: "Online", event: "Event or presentation" };

export type BrandStatus = "reviewing" | "review_failed" | "awaiting_decision" | "returned" | "cleared";
export const STATUS_META: Record<BrandStatus, { label: string; tone: string }> = {
  reviewing: { label: "Checking", tone: "border-sky-200 bg-sky-50/70 text-sky-800" },
  review_failed: { label: "Check failed", tone: "border-red-200 bg-red-50/70 text-red-800" },
  awaiting_decision: { label: "Waiting for approval", tone: "border-amber-200 bg-amber-50/70 text-amber-800" },
  returned: { label: "Sent back", tone: "border-orange-200 bg-orange-50/70 text-orange-800" },
  cleared: { label: "Approved", tone: "border-emerald-200 bg-emerald-50/70 text-emerald-800" },
};

export type Verdict = "red_flag" | "caution" | "compliant";
/** The result in plain words: long on the submission, short in lists. */
export const VERDICT_LABEL: Record<Verdict, string> = { red_flag: "Must fix before publishing", caution: "Needs small fixes", compliant: "Ready to publish" };
export const VERDICT_SHORT: Record<Verdict, string> = { red_flag: "Must fix", caution: "Small fixes", compliant: "Ready" };
/** How serious one item is, in plain words. */
export const SEVERITY_LABEL: Record<BrandFinding["severity"], string> = { red_flag: "Must fix", caution: "Should fix", info: "Tip" };
export const OUTCOME_LABEL: Record<RuleOutcome, string> = { pass: "Passed", fail: "Needs fixing", not_applicable: "Doesn't apply", unclear: "Couldn't tell" };
/** "3 things to fix" / "Nothing to fix". */
export const toFix = (n: number) => (n === 0 ? "Nothing to fix" : `${n} thing${n === 1 ? "" : "s"} to fix`);

/** A colour the AI saw, named in words: the state colour it matches, or the
 *  nearest everyday name and that it is not a state colour. */
const EVERYDAY: [string, string][] = [
  ["Purple", "#7B2D8E"], ["Violet", "#8A5CF6"], ["Pink", "#E86AA6"], ["Orange", "#F28C28"], ["Brown", "#8B5A2B"],
  ["Green", "#2E8B57"], ["Lime", "#9ACD32"], ["Teal", "#13827A"], ["Blue", "#1E5AA8"], ["Light blue", "#6CB4EE"], ["Navy", "#1F2A55"],
  ["Gold", "#C9A227"], ["Maroon", "#7A1F2B"], ["Cream", "#F3E9D2"],
];
const rgb = (h: string) => { const x = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
const dist = (a: number[], b: number[]) => Math.sqrt(a.reduce((n, v, i) => n + (v - b[i]) ** 2, 0));
export function colourName(hex: string): { name: string; state: boolean } | null {
  const h = hex.trim().startsWith("#") ? hex.trim() : `#${hex.trim()}`;
  if (!/^#[0-9a-f]{6}$/i.test(h)) return null;
  const c = rgb(h);
  const pal = PALETTE.map((p) => ({ name: p.name, d: dist(c, rgb(p.hex)) })).sort((a, b) => a.d - b.d)[0];
  if (pal.d < 60) return { name: pal.name, state: true };
  const ev = EVERYDAY.map(([name, x]) => ({ name, d: dist(c, rgb(x)) })).sort((a, b) => a.d - b.d)[0];
  return { name: ev.d < pal.d ? ev.name : pal.name.replace(/^Sarawak /, ""), state: false };
}

export type RuleOutcome = "pass" | "fail" | "not_applicable" | "unclear";
export interface RuleResult { rule_id: string; outcome: RuleOutcome; note?: string }
export interface BrandFinding {
  id: string;
  rule_id: string;
  ref: string;
  severity: "red_flag" | "caution" | "info";
  issue: string;
  whyItMatters: string;
  fix: string;
  /** Verbatim text on the page, when the breach is in the words. */
  excerpt?: string;
  /** 1-indexed page (slide) the breach is on. */
  page: number;
  /** [ymin, xmin, ymax, xmax] in 0–1000 of the page, when the breach is visual. */
  box?: [number, number, number, number] | null;
}
export interface BrandReview {
  verdict: Verdict;
  riskScore: number;
  summary: string;
  /** What the design does well, in plain words (2–5 points). */
  strengths?: string[];
  findings: BrandFinding[];
  rules: RuleResult[];
  detected: { logos?: string[]; colours?: string[]; fonts?: string[]; languages?: string[] };
  pages: number;
  model?: string;
  reviewed_at: string;
}

const SEV_FROM_RULE: Record<RuleSeverity, BrandFinding["severity"]> = { critical: "red_flag", major: "caution", minor: "info" };
export const findingSeverity = (ruleId: string, given?: string): BrandFinding["severity"] =>
  given === "red_flag" || given === "caution" || given === "info" ? given : SEV_FROM_RULE[ruleById(ruleId)?.severity ?? "minor"];

/** The verdict and score, held to the guideline: a failed critical rule is
 *  always a red flag, whatever the model said; a clean result is compliant. */
export function guardVerdict(ai: { verdict?: string; riskScore?: number }, rules: RuleResult[]): { verdict: Verdict; riskScore: number } {
  const failed = rules.filter((r) => r.outcome === "fail").map((r) => ruleById(r.rule_id)).filter(Boolean);
  const critical = failed.some((r) => r!.severity === "critical");
  const major = failed.some((r) => r!.severity === "major");
  let score = Math.max(0, Math.min(100, Math.round(Number(ai.riskScore ?? 0)) || 0));
  let verdict: Verdict = ai.verdict === "red_flag" || ai.verdict === "caution" || ai.verdict === "compliant" ? ai.verdict : "caution";
  if (critical) { verdict = "red_flag"; score = Math.max(score, 70); }
  else if (major && verdict === "compliant") verdict = "caution";
  else if (!failed.length) { verdict = "compliant"; score = Math.min(score, 20); }
  if (verdict === "caution") score = Math.min(Math.max(score, 30), 69);
  return { verdict, riskScore: score };
}

/** Share of applicable rules passed (N/A and unclear excluded), 0–100. */
export function complianceOf(rules: RuleResult[]): number | null {
  const judged = rules.filter((r) => r.outcome === "pass" || r.outcome === "fail");
  if (!judged.length) return null;
  return Math.round((judged.filter((r) => r.outcome === "pass").length / judged.length) * 100);
}

/** Per agency, from each submission's latest reviewed version. */
export function agencyCompliance(subs: any[]): { agency: string; compliance: number | null; submissions: number; cleared: number; returned: number }[] {
  const by = new Map<string, any[]>();
  for (const s of subs) by.set(s.agency, [...(by.get(s.agency) ?? []), s]);
  return [...by.entries()].map(([agency, list]) => {
    const rules = list.flatMap((s) => latestReview(s)?.rules ?? []);
    return { agency, compliance: complianceOf(rules), submissions: list.length,
      cleared: list.filter((s) => s.status === "cleared").length, returned: list.filter((s) => s.status === "returned").length };
  }).sort((a, b) => (a.compliance ?? 101) - (b.compliance ?? 101));
}

/** Most-failed rules across all latest reviews: every review becomes data. */
export function topViolations(subs: any[], n = 6): { rule_id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const s of subs) for (const r of latestReview(s)?.rules ?? []) if (r.outcome === "fail") counts.set(r.rule_id, (counts.get(r.rule_id) ?? 0) + 1);
  return [...counts.entries()].map(([rule_id, count]) => ({ rule_id, count })).sort((a, b) => b.count - a.count).slice(0, n);
}

export const latestVersion = (s: any) => (s?.versions ?? []).at(-1) ?? null;
export const latestReview = (s: any): BrandReview | null => latestVersion(s)?.review ?? null;

/** 1 urgent · 2 needs a decision · 3 in progress · 5 done. */
export function brandPriority(s: any): 1 | 2 | 3 | 5 {
  const r = latestReview(s);
  if (s.status === "cleared") return 5;
  if (s.status === "review_failed") return 1;
  if (s.status === "returned") return 2;
  if (s.status === "awaiting_decision") return r?.verdict === "red_flag" ? 1 : 2;
  return 3;
}
export const byBrandPriority = (a: any, b: any) =>
  brandPriority(a) - brandPriority(b) || (latestReview(b)?.riskScore ?? 0) - (latestReview(a)?.riskScore ?? 0) || String(b.created_at).localeCompare(String(a.created_at));

/** A 0–1000 box to pixel coordinates on a rendered page of width × height. */
export function boxToPixels(box: [number, number, number, number], width: number, height: number) {
  const [ymin, xmin, ymax, xmax] = box.map((v) => Math.max(0, Math.min(1000, v)));
  return { left: (xmin / 1000) * width, top: (ymin / 1000) * height, width: ((xmax - xmin) / 1000) * width, height: ((ymax - ymin) / 1000) * height };
}

/** Milestones for the submission page. */
export function brandMilestones(s: any): { key: string; label: string; state: "done" | "current" | "todo" }[] {
  const reviewed = !!latestReview(s);
  const steps = [
    { key: "submitted", label: "Submitted", ok: true },
    { key: "review", label: "Checked", ok: reviewed && s.status !== "reviewing" },
    { key: "decision", label: "Brand officer's decision", ok: s.status === "cleared" },
    { key: "cleared", label: "Approved for use", ok: s.status === "cleared" },
  ];
  let cur = false;
  return steps.map((x) => {
    if (x.ok) return { key: x.key, label: x.label, state: "done" as const };
    if (!cur) { cur = true; return { key: x.key, label: x.label, state: "current" as const }; }
    return { key: x.key, label: x.label, state: "todo" as const };
  });
}

export const BRAND_ROLES = { agency: "Agency staff", ukas: "Brand officer (UKAS)" } as const;
export type BrandRole = keyof typeof BRAND_ROLES;

/** The buttons for the current step. */
export function brandActions(s: any): { id: "clear" | "return" | "revise" | "rerun"; label: string; role: BrandRole; primary?: boolean }[] {
  if (s.status === "review_failed") return [{ id: "rerun", label: "Check Again", role: "agency", primary: true }];
  if (s.status === "awaiting_decision") {
    const red = latestReview(s)?.verdict === "red_flag";
    return [
      { id: "return", label: "Send Back", role: "ukas", primary: red },
      { id: "clear", label: "Approve for Use", role: "ukas", primary: !red },
    ];
  }
  if (s.status === "returned") return [{ id: "revise", label: "Upload New Version", role: "agency", primary: true }];
  return [];
}

export const RULE_COUNT = BRAND_RULES.length;
