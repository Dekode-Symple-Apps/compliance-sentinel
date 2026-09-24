// Reconciliation rules for note-line tagging, on Yee Fatt's real PPE note (31 Jan 2026).
import { reconcileTagging } from "../src/lib/mbrs-extract";
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
console.log(`\n${pass}/${pass + fail} tagging checks passed`);
process.exit(fail ? 1 : 0);
