// LSH feedback (29 Sep): repository by company → project → General, NDA types,
// bonds / BG / retention obligations, 7-year records, the business checklist.
import {
  GENERAL, autoObligations, contractAlerts, inFolder, kindOf, ndaDirectionFor, ndaTemplateFor, needsBusinessChecklist, normalizeObligations,
  projectFolders, retainUntil, templateById, typeLabel, DEFAULT_RETENTION,
} from "../src/lib/ccms";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

// Repository folders: company, then project, then General.
const E = "LSH BEST Builders Sdn Bhd";
const cs = [{ entity: E, project: "LSH 33 Block D" }, { entity: E, project: "LSH 33 Block D" }, { entity: E, project: "Block C Piling" }, { entity: E, project: " " }, { entity: E }, { entity: "Knight Auto Sdn Bhd", project: "X" }];
const f = projectFolders(cs, E);
check("projects sorted, General last", f.map((x) => x.label).join("|") === "Block C Piling|LSH 33 Block D|General", f.map((x) => `${x.label}:${x.n}`).join(" "));
check("project counts", f.find((x) => x.key === "LSH 33 Block D")!.n === 2 && f.find((x) => x.key === GENERAL)!.n === 2);
check("General folder holds the unassigned", cs.filter((c) => inFolder(c, E, GENERAL)).length === 2);
check("company folder holds all its projects", cs.filter((c) => inFolder(c, E)).length === 5);

// NDA types: the direction picks the template.
check("mutual by default", ndaTemplateFor(undefined) === "lsh-nda-mutual" && ndaTemplateFor("Mutual") === "lsh-nda-mutual");
check("we disclose / they disclose", ndaTemplateFor("Company to Counterparty only") === "lsh-nda-company-discloses" && ndaTemplateFor("Counterparty to Company only") === "lsh-nda-counterparty-discloses");
check("round trip", ndaDirectionFor("lsh-nda-counterparty-discloses") === "Counterparty to Company only");
const t2 = templateById("lsh-nda-company-discloses");
check("one-way template is registered and one-way", !!t2 && t2.clauses.length === 19 && t2.clauses[0].paragraphs.some((p) => p.includes('"Disclosing Party" means the Company')));
check("3-year default term in every NDA", ["lsh-nda-mutual", "lsh-nda-company-discloses", "lsh-nda-counterparty-discloses"].every((id) => (templateById(id) as any).schedule.items.find((i: any) => i.number === "5").value.startsWith("[Three (3) years]")));
check("type label shows the direction", typeLabel({ contract_type: "nda", template_id: "lsh-nda-company-discloses" }) === "Non-disclosure agreement · We disclose");

// Automatic obligations: bonds, bank guarantees, retention.
const c = { contract_type: "letter_of_award", signed_date: "2026-10-01", stamping: { stamped_date: "2026-10-05" }, value: 1_000_000,
  securities: [{ type: "performance_bond", required: true, amount: 50_000, reference: "PB-1", valid_until: "2027-12-31" }, { type: "bank_guarantee", required: false, reference: "BG-9", valid_until: "2027-06-30" }],
  retention: DEFAULT_RETENTION };
const auto = autoObligations(c, "2027-09-30", [], "Jeremy Teh");
const by = (k: string) => auto.find((o) => o.auto === k);
check("bond: renew or release 14 days before it lapses", by("sec-performance_bond")?.due_date === "2027-12-17" && by("sec-performance_bond")?.pic === "Dabraj", JSON.stringify(by("sec-performance_bond")));
check("bank guarantee tracked too", by("sec-bank_guarantee")?.due_date === "2027-06-16");
check("performance bond retrieved at completion", by("bond-return")?.due_date === "2027-09-30");
check("retention released in two stages, amounts from the value", by("retention-0")?.amount === 25_000 && by("retention-1")?.amount === 25_000 && by("retention-0")?.due_date === null, `${by("retention-0")?.amount}`);
check("added once", autoObligations(c, "2027-09-30", auto, "Jeremy Teh").length === 0);
check("a returned bond is not tracked", !autoObligations({ ...c, securities: [{ ...c.securities[0], state: "returned" }] }, "2027-09-30", [], "x").some((o) => o.auto?.startsWith("sec-performance") || o.auto === "bond-return"));

// Kinds, for the filter.
const k = (text: string, extra: any = {}) => kindOf(normalizeObligations([{ text, ...extra }])[0]);
check("kinds", k("Pay milestone instalment", { category: "finance", amount: 100 }) === "payment" && k("Renew or release the performance bond", { auto: "sec-performance_bond", category: "finance" }) === "bond"
  && k("Release retention", { auto: "retention-0", category: "finance" }) === "retention" && k("Stamp the contract", { auto: "stamping" }) === "stamping" && k("Decide on renewal", { auto: "renewal" }) === "renewal");

// Records kept 7 years from signing.
check("7 years from signing", retainUntil({ signed_date: "2026-10-01" }) === "2033-10-01");

// Business checklist: full-flow vendor contracts only.
check("needed for a Letter of Award", needsBusinessChecklist({ contract_type: "letter_of_award", side: "vendor" }));
check("not for an NDA or a client contract", !needsBusinessChecklist({ contract_type: "nda" }) && !needsBusinessChecklist({ contract_type: "client_contract", side: "client" }));

// Dashboard window: obligations due inside it.
const filed = { status: "active", expiry_date: "2027-12-31", contract_type: "letter_of_award", repository: { obligations: [{ text: "Pay instalment", category: "finance", due_date: "2026-11-20", amount: 1 }] } };
const today = new Date("2026-10-03");
check("30-day window leaves out a payment due in 48 days", !contractAlerts(filed, today, 30).some((a) => a.kind === "obligation"));
check("60-day window includes it", contractAlerts(filed, today, 60).some((a) => a.kind === "obligation"));

console.log(`\n${pass}/${pass + fail} contract feedback checks passed`);
process.exit(fail ? 1 : 0);
