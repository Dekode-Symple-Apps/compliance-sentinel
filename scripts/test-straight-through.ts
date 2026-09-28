// Straight-through: which contracts clear and approve without waiting, and why others do not.
import { STP_ACTOR, straightThrough, wasStraightThrough, type Flag } from "../src/lib/ccms";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const vendor = { status: "approved", risk_rating: "low", related_party: false };
const clean = { verdict: "compliant", riskScore: 8, findings: [{ severity: "info" }] };
const supply = { contract_type: "supply_agreement", value_myr: 186_500 };
const nonStd: Flag[] = [{ key: "non_standard", source: "ai", detail: "" }];

const ok = straightThrough(supply, vendor, nonStd, clean);
check("routine, low value, clean, approved vendor → straight-through", ok.eligible, ok.blockers.join("; "));
check("reasons are given", ok.reasons.length === 7);
check("over RM500,000 → normal route", !straightThrough({ ...supply, value_myr: 650_000 }, vendor, nonStd, clean).eligible);
check("a red-flag finding → normal route", !straightThrough(supply, vendor, nonStd, { ...clean, findings: [{ severity: "red_flag" }] }).eligible);
check("minor cautions on a compliant draft still go straight through", straightThrough(supply, vendor, nonStd, { ...clean, findings: [{ severity: "caution" }, { severity: "info" }] }).eligible);
check("risk over 20 → normal route", !straightThrough(supply, vendor, nonStd, { ...clean, riskScore: 35 }).eligible);
check("verdict caution → normal route", !straightThrough(supply, vendor, nonStd, { ...clean, verdict: "caution" }).eligible);
check("high-risk vendor → normal route", !straightThrough(supply, { ...vendor, risk_rating: "high" }, nonStd, clean).eligible);
check("conditional vendor → normal route", !straightThrough(supply, { ...vendor, status: "conditional" }, nonStd, clean).eligible);
check("related party → normal route", !straightThrough(supply, { ...vendor, related_party: true }, [...nonStd, { key: "related_party", source: "platform", detail: "" }], clean).eligible);
check("Letter of Award is not routine", !straightThrough({ contract_type: "letter_of_award", value_myr: 100_000 }, vendor, nonStd, clean).eligible);
check("IT service agreement is not routine", !straightThrough({ contract_type: "it_service_agreement", value_myr: 100_000 }, vendor, [], clean).eligible);
const lo = straightThrough({ contract_type: "letter_of_award", value_myr: 1_850_000 }, vendor, nonStd, { verdict: "red_flag", riskScore: 92, findings: [{ severity: "red_flag" }] });
check("blockers explain why not", lo.blockers.length >= 4, lo.blockers.join("; "));
check("route recognised as straight-through", wasStraightThrough([{ key: "legal", label: "", kind: "review", role: "legal", sla_days: 5, reason: "", status: "cleared", decided_by: STP_ACTOR }]) && !wasStraightThrough([]));
console.log(`\n${pass}/${pass + fail} straight-through checks passed`);
process.exit(fail ? 1 : 0);
