// Reconciliation rules for note-line tagging, on Yee Fatt's real PPE note (31 Jan 2026).
import { reconcileTagging, applyRelatedParties } from "../src/lib/mbrs-extract";
import { generateMbrsXbrl } from "../src/lib/mbrs-xbrl";
import { normalizeExtraction } from "../src/lib/mbrs";
const P = "ifrs-smes:PropertyPlantAndEquipment";
const line = (label: string, concept: string, current: number) => ({ label, concept, current, previous: null });
const yee = [
  line("Furniture and fittings", "ssmt-mpers:OfficeEquipmentFixtureAndFittings", 24754),
  line("Motor vehicles", "ifrs-smes:Vehicles", 141313),
  line("Office equipment", "ssmt-mpers:OfficeEquipmentFixtureAndFittings", 20994),
  line("Plant and machinery", "ssmt-mpers:PlantAndEquipment", 11),
  line("Renovation", "ssmt-mpers:OfficeEquipmentFixtureAndFittings", 36276),
  line("Showroom", "ssmt-mpers:BuildingOnFreeholdLand", 1010093),
  line("Signboards", "ifrs-smes:OtherPropertyPlantAndEquipment", 27435),
  line("Workshop tools", "ssmt-mpers:PlantAndEquipment", 1500),
];
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

// 1. reconciles: every node gets a value; named fields written; unnamed tagged; unused classes proven 0
{
  const r = reconcileTagging([{ root: P, lines: yee }], { propertyPlantAndEquipment: 1262376 }, {});
  const f = Object.fromEntries(r.fieldWrites.filter((w) => w.period === "current").map((w) => [w.field, w.value]));
  check("office equipment = furniture + office eqpt + renovation (SSM: 82,024)", f.officeEquipment === 82024, String(f.officeEquipment));
  check("plant and equipment = plant & machinery + tools (SSM: 1,511)", f.plantAndEquipment === 1511, String(f.plantAndEquipment));
  check("other PPE = signboards (SSM: 27,435)", f.otherPropertyPlantAndEquipment === 27435, String(f.otherPropertyPlantAndEquipment));
  check("land and buildings rolls up from the showroom (SSM: 1,010,093)", f.buildings === 1010093, String(f.buildings));
  check("building on freehold land tagged (SSM: 1,010,093)", r.tagged["ssmt-mpers:BuildingOnFreeholdLand"]?.current === 1010093);
  check("buildings subtotal rolled up", r.tagged["ifrs-smes:Buildings"]?.current === 1010093);
  check("unused class proven nil: construction in progress = 0", r.tagged["ifrs-smes:ConstructionInProgress"]?.current === 0);
  check("unused class proven nil: freehold land = 0", r.tagged["ssmt-mpers:FreeholdLand"]?.current === 0);
  check("previous year untouched (no previous figures given)", !r.fieldWrites.some((w) => w.period === "previous"));
}
// 2. a missing line: does not reconcile → nothing filed, reason logged
{
  const r = reconcileTagging([{ root: P, lines: yee.filter((l) => l.label !== "Signboards") }], { propertyPlantAndEquipment: 1262376 }, {});
  check("unreconciled breakdown files nothing", r.fieldWrites.length === 0 && Object.keys(r.tagged).length === 0);
  check("…and says why", r.log.some((l) => /add up to 1,234,941 but the total is 1,262,376/.test(l)), r.log.join(" | "));
}
// 3. no total extracted: cannot verify → nothing filed
{
  const r = reconcileTagging([{ root: P, lines: yee }], {}, {});
  check("unverifiable (no total) files nothing", r.fieldWrites.length === 0 && Object.keys(r.tagged).length === 0);
}
// 4. an invented concept is dropped, not trusted
{
  const bad = [...yee.slice(0, 7), line("Workshop tools", "ssmt-mpers:MadeUpConcept", 1500)];
  const r = reconcileTagging([{ root: P, lines: bad }], { propertyPlantAndEquipment: 1262376 }, {});
  check("line mapped to a non-existent concept is ignored (and so the sum fails)", r.fieldWrites.length === 0 && r.log.some((l) => /ignored/.test(l)));
}
// 5. a line on an intermediate node: its children are UNKNOWN, not nil
{
  const onParent = yee.map((l) => l.label === "Showroom" ? { ...l, concept: "ifrs-smes:Buildings" } : l);
  const r = reconcileTagging([{ root: P, lines: onParent }], { propertyPlantAndEquipment: 1262376 }, {});
  check("line on 'Buildings' still reconciles and files Buildings", r.tagged["ifrs-smes:Buildings"]?.current === 1010093);
  check("…its children are left unfiled, not zeroed", r.tagged["ssmt-mpers:BuildingOnFreeholdLand"]?.current === undefined,
    String(r.tagged["ssmt-mpers:BuildingOnFreeholdLand"]?.current));
  check("…a sibling branch with no lines is still proven nil (freehold land = 0)", r.tagged["ssmt-mpers:FreeholdLand"]?.current === 0);
}
// 6. a field bound at two levels: the lower node is a shadow, filed via tagged, never double-writing the field
{
  const R = "ifrs-smes:TradeAndOtherCurrentReceivables";
  const lines = [
    line("Trade receivables", "ssmt-mpers:OtherCurrentTradeReceivables", 120000),
    line("Less: allowance for impairment", "ssmt-mpers:OtherCurrentTradeReceivables", -20000),
    line("Amount due from a director", "ssmt-mpers:OtherCurrentReceivablesDueFromOtherRelatedParties", 5000),
    line("Deposits", "ssmt-mpers:OtherCurrentNontradeDeposits", 3000),
    line("Prepayments", "ssmt-mpers:OtherCurrentPrepayments", 2000),
  ];
  const r = reconcileTagging([{ root: R, lines }], { totalReceivables: 110000, tradeReceivables: 120000 }, {});
  check("filing-only tree: no form field is rewritten (they are recomputed from parts)", r.fieldWrites.length === 0, JSON.stringify(r.fieldWrites));
  check("trade receivables filed net of the allowance (100,000)", r.tagged["ssmt-mpers:CurrentTradeReceivables"]?.current === 100000);
  check("the shadow child carries the same figure", r.tagged["ssmt-mpers:OtherCurrentTradeReceivables"]?.current === 100000);
  check("unused holding-company balance proven nil", r.tagged["ssmt-mpers:OtherCurrentReceivablesDueFromHoldingCompany"]?.current === 0);
  check("difference from the form is logged", r.log.some((l) => /filed as 100,000 .* the form shows 120,000/.test(l)), r.log.join(" | "));
}
// 7. related parties: grid per counterparty, totals summed into the bound field, junk dropped (QSK's note)
{
  const A = "ifrs-smes:AmountsReceivableRelatedPartyTransactions";
  const rpt = [
    { label: "Amount due from a director", concept: A, party: "KeyManagementPersonnelOfEntityOrParentMember", amount: 24550.05 },
    { label: "Amount due from related companies", concept: A, party: "OtherRelatedPartiesMember", amount: 20699.95 },
    { label: "Dividend received from a related company", concept: "ssmt-mpers:DividendIncomeRelatedPartyTransactions", party: "OtherRelatedPartiesMember", amount: 334115 },
    { label: "Rental paid", concept: "ssmt-mpers:RentalExpensesRelatedPartyTransactions", party: "OtherRelatedPartiesMember", amount: -10958.81 },
    { label: "nonsense", concept: A, party: "MadeUpMember", amount: 1 },
  ];
  const g = applyRelatedParties(rpt, { relatedPartyReceivablesTotal: 24550.05 });
  check("grid cell per party", g.grid[A]?.OtherRelatedPartiesMember === 20699.95 && g.grid[A]?.KeyManagementPersonnelOfEntityOrParentMember === 24550.05);
  const f = Object.fromEntries(g.fieldWrites.map((w) => [w.field, w.value]));
  check("receivable total = both parties (SSM: 45,250)", f.relatedPartyReceivablesTotal === 45250, String(f.relatedPartyReceivablesTotal));
  check("a bracketed expense is filed as a magnitude (SSM: 10,958.81)", f.relatedPartyRentalExpense === 10958.81, String(f.relatedPartyRentalExpense));
  check("unknown party dropped and logged", g.log.some((l) => /ignored/.test(l)));
  check("disagreement with the earlier figure logged", g.log.some((l) => /was 24,550/.test(l)), g.log.join(" | "));
  const x = normalizeExtraction({ entity: { currentPeriodStart: "2024-01-01", currentPeriodEnd: "2024-12-31", previousPeriodStart: "2023-01-01", previousPeriodEnd: "2023-12-31", registrationNumber: "200901038625", entityName: "T" },
    current: { ...f }, previous: {}, narratives: {}, missing: [], rptGrid: g.grid } as any);
  const { xml } = generateMbrsXbrl(x);
  const cell = (ctx: string) => xml.match(new RegExp(`<ifrs-smes:AmountsReceivableRelatedPartyTransactions contextRef="${ctx}"[^>]*>([^<]+)<`))?.[1];
  check("XBRL: other-related-parties cell filed", cell("asof_20241231_SeparateMember_OtherRelatedPartiesMember") === "20699.95", cell("asof_20241231_SeparateMember_OtherRelatedPartiesMember"));
  check("XBRL: all-parties total filed as the sum", cell("asof_20241231_SeparateMember") === "45250", cell("asof_20241231_SeparateMember"));
}
console.log(`\n${pass}/${pass + fail} tagging checks passed`);
process.exit(fail ? 1 : 0);
