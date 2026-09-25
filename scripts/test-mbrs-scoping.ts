// Scoping declarations: read or derived from the report, mapped onto SSM's
// enumerations, with the old literal kept only as a fallback.
import { normalizeExtraction, validateExtraction } from "../src/lib/mbrs";
import { generateMbrsXbrl } from "../src/lib/mbrs-xbrl";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const run = (entity: Record<string, string>) => {
  const x = normalizeExtraction({ entity, current: {}, previous: {}, narratives: {}, missing: [] } as any);
  const { xml } = generateMbrsXbrl(x);
  return { x, get: (c: string) => xml.match(new RegExp(`<${c}[^>]*>([^<]+)<`))?.[1], issues: validateExtraction(x) };
};
const periods = { registrationNumber: "200901038625", previousPeriodStart: "2023-01-01", previousPeriodEnd: "2023-12-31" };
{
  const r = run({ ...periods, entityName: "ACME BERHAD", currentPeriodStart: "2024-01-01", currentPeriodEnd: "2025-06-30",
    cashFlowMethod: "direct method", comparativesRestated: "yes (restated)", businessStatus: "gibberish" });
  check("Berhad → public company", r.get("ssmt-dei:StatusOfCompany") === "Public company");
  check("18-month period → reporting period changed", r.get("ssmt:DisclosureOnWhetherCompanyChangedDurationOfFinancialReportingPeriod") === "Yes");
  check("free text mapped to the enumeration (restated)", r.get("ssmt:DisclosureOnWhetherComparativePeriodValuesAreRestated") === "Yes");
  check("unrecognised answer falls back to the old default", r.get("ssmt-dei:StatusOfCarryingOnBusinessDuringFinancialYear") === "Carrying on business activities");
  check("a comparative year means subsequent preparation", r.get("ssmt-dei:DisclosureOfFinancialStatementsPreparationForCurrentSubmission") === "Subsequent preparation of financial statements");
  check("direct-method cash flow blocks generation", r.issues.some((i) => i.severity === "error" && /DIRECT/.test(i.message)));
  check("changed period is flagged for review", r.issues.some((i) => i.severity === "warning" && /twelve months/.test(i.message)));
}
{
  const r = run({ ...periods, entityName: "QSK REALTY SDN. BHD.", currentPeriodStart: "2024-01-01", currentPeriodEnd: "2024-12-31",
    equityStatementType: "Statement of income and retained earnings" });
  check("Sdn. Bhd. → private company", r.get("ssmt-dei:StatusOfCompany") === "Private company");
  check("twelve months → not changed", r.get("ssmt:DisclosureOnWhetherCompanyChangedDurationOfFinancialReportingPeriod") === "No");
  check("silent on restatement → default No", r.get("ssmt:DisclosureOnWhetherComparativePeriodValuesAreRestated") === "No");
  check("retained-earnings statement blocks generation", r.issues.some((i) => i.severity === "error" && /retained earnings/.test(i.message)));
}
console.log(`\n${pass}/${pass + fail} scoping checks passed`);
process.exit(fail ? 1 : 0);
