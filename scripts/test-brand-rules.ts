// Branding Compliance rules: the verdict guard, compliance %, priority, boxes.
import { guardVerdict, complianceOf, agencyCompliance, topViolations, brandPriority, byBrandPriority, boxToPixels, brandActions, brandMilestones, type RuleResult } from "../src/lib/brand";
import { BRAND_RULES, ruleById } from "../src/lib/brand-guideline";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const rules = (fails: string[], na: string[] = []): RuleResult[] =>
  BRAND_RULES.map((r) => ({ rule_id: r.id, outcome: fails.includes(r.id) ? "fail" : na.includes(r.id) ? "not_applicable" : "pass" }));

check("guideline has unique rule ids", new Set(BRAND_RULES.map((r) => r.id)).size === BRAND_RULES.length, String(BRAND_RULES.length));
check("every rule has a severity and a check type", BRAND_RULES.every((r) => ["critical", "major", "minor"].includes(r.severity) && ["visual", "text", "both"].includes(r.check)));
{
  const g = guardVerdict({ verdict: "compliant", riskScore: 10 }, rules(["BC-4.2"]));
  check("a failed critical rule is always a red flag", g.verdict === "red_flag" && g.riskScore >= 70, JSON.stringify(g));
  const m = guardVerdict({ verdict: "compliant", riskScore: 5 }, rules(["BC-2.2"]));
  check("a failed major rule is at least caution, 30–69", m.verdict === "caution" && m.riskScore >= 30 && m.riskScore <= 69, JSON.stringify(m));
  const c = guardVerdict({ verdict: "caution", riskScore: 55 }, rules([]));
  check("nothing failed is compliant, score capped at 20", c.verdict === "compliant" && c.riskScore <= 20, JSON.stringify(c));
  const junk = guardVerdict({ verdict: "maybe" as any, riskScore: 999 }, rules(["BC-8.3"]));
  check("bad model output is clamped", junk.riskScore <= 100 && ["caution", "compliant", "red_flag"].includes(junk.verdict), JSON.stringify(junk));
}
{
  check("compliance % excludes not-applicable", complianceOf([{ rule_id: "a", outcome: "pass" }, { rule_id: "b", outcome: "fail" }, { rule_id: "c", outcome: "not_applicable" }, { rule_id: "d", outcome: "unclear" }]) === 50);
  check("compliance % is null with nothing judged", complianceOf([{ rule_id: "a", outcome: "not_applicable" }]) === null);
  const subs = [
    { agency: "A", status: "cleared", versions: [{ review: { rules: rules([]) } }] },
    { agency: "A", status: "returned", versions: [{ review: { rules: rules(["BC-1.3", "BC-2.2"]) } }] },
    { agency: "B", status: "awaiting_decision", versions: [{ review: { rules: rules(["BC-1.3"]) } }] },
  ];
  const by = agencyCompliance(subs);
  check("agency compliance is per agency, lowest first", by.length === 2 && by[0].compliance! <= by[1].compliance!, JSON.stringify(by));
  check("most-breached rule counted across submissions", topViolations(subs)[0].rule_id === "BC-1.3" && topViolations(subs)[0].count === 2);
}
{
  const red = { status: "awaiting_decision", created_at: "2026-09-01", versions: [{ review: { verdict: "red_flag", riskScore: 90, rules: [] } }] };
  const caution = { status: "awaiting_decision", created_at: "2026-09-02", versions: [{ review: { verdict: "caution", riskScore: 40, rules: [] } }] };
  const returned = { status: "returned", created_at: "2026-09-03", versions: [{}] };
  const cleared = { status: "cleared", created_at: "2026-09-04", versions: [{}] };
  check("red flag awaiting decision is urgent", brandPriority(red) === 1 && brandPriority(caution) === 2 && brandPriority(cleared) === 5);
  const order = [cleared, returned, caution, red].sort(byBrandPriority).map((x) => x.status + (x.versions[0] as any).review?.verdict);
  check("sorted urgent first, cleared last", order[0] === "awaiting_decisionred_flag" && order.at(-1)!.startsWith("cleared"), order.join());
}
{
  const p = boxToPixels([100, 200, 500, 800], 1000, 2000);
  check("box 0–1000 maps to pixels", p.left === 200 && p.top === 200 && p.width === 600 && p.height === 800, JSON.stringify(p));
  const q = boxToPixels([-50, 0, 1200, 1000], 500, 500);
  check("box is clamped to the page", q.top === 0 && q.height === 500, JSON.stringify(q));
}
{
  const aw = { status: "awaiting_decision", versions: [{ review: { verdict: "red_flag" } }] };
  check("red flag: Return is the primary action", brandActions(aw).find((a) => a.primary)?.id === "return");
  check("returned: Upload Revision by the agency", brandActions({ status: "returned", versions: [{}] })[0]?.role === "agency");
  check("cleared: every milestone done", brandMilestones({ status: "cleared", versions: [{ review: {} }] }).every((m) => m.state === "done"));
  check("rule lookup", ruleById("BC-4.2")?.severity === "critical");
}
console.log(`\n${pass}/${pass + fail} brand rule checks passed`);
process.exit(fail ? 1 : 0);
