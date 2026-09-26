// Commercial CMS routing rules: flags from the request, vendor and review; the
// route they produce; decisions carried across a re-route.
import { buildRoute, computeFlags, nextApproval, reviewsDone, templateById, TEMPLATES, type Stage } from "../src/lib/ccms";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const ok = { name: "Sinar", status: "approved", dd_valid_until: "2099-01-01", risk_rating: "low", related_party: false };
const keys = (s: Stage[]) => s.map((x) => x.key).join(",");

{ // standard NDA with an approved template: finance + director only
  const f = computeFlags({ contract_type: "nda", value_myr: null, personal_data_cross_border: false, review: { deviation: false } }, ok);
  const r = buildRoute({ contract_type: "nda", value_myr: null }, f);
  check("clean NDA on the template: no flags", f.length === 0, JSON.stringify(f));
  check("clean NDA skips Legal", keys(r) === "finance,approval", keys(r));
}
{ // deviation forces Legal
  const f = computeFlags({ contract_type: "nda", value_myr: null, personal_data_cross_border: false, review: { deviation: true } }, ok);
  check("deviation sends the NDA to Legal", buildRoute({ contract_type: "nda", value_myr: null }, f)[0].key === "legal");
}
{ // related party → committee + non-interested board, no lower band
  const f = computeFlags({ contract_type: "subcontract", value_myr: 200_000, personal_data_cross_border: false }, { ...ok, related_party: true });
  const r = buildRoute({ contract_type: "subcontract", value_myr: 200_000 }, f);
  check("related party routes Committee then non-interested Board", keys(r).endsWith("committee,board_noninterested"), keys(r));
  check("…and drops the Director band", !r.some((s) => s.key === "approval"));
}
{ // bands
  const band = (v: number) => buildRoute({ contract_type: "supply_agreement", value_myr: v }, []).at(-1)!.label;
  check("RM400k → Director", band(400_000) === "Director", band(400_000));
  check("RM2m → Final Approval Committee", band(2_000_000) === "Final Approval Committee", band(2_000_000));
  check("RM8m → Board", band(8_000_000) === "Board of Directors", band(8_000_000));
}
{ // blocking conditions
  const f = computeFlags({ contract_type: "work_order", value_myr: 650_000, personal_data_cross_border: false }, { ...ok, dd_valid_until: "2020-01-01" });
  check("expired due diligence flagged", f.some((x) => x.key === "dd_expired"));
  check("Work Order over RM500k flagged", f.some((x) => x.key === "work_order_cap"));
}
{ // IT service: Legal always, Board
  const f = computeFlags({ contract_type: "it_service_agreement", value_myr: 100_000, personal_data_cross_border: true }, ok);
  const r = buildRoute({ contract_type: "it_service_agreement", value_myr: 100_000 }, f);
  check("IT service: Legal + Board, cross-border noted", keys(r) === "legal,finance,board_it" && r[0].reason.includes("personal data"), keys(r));
}
{ // decisions carried; a return is not carried
  const f = computeFlags({ contract_type: "letter_of_award", value_myr: 100_000, personal_data_cross_border: false, review: { loaMissing: ["Retention"] } }, ok);
  let r = buildRoute({ contract_type: "letter_of_award", value_myr: 100_000 }, f);
  r = r.map((s) => s.key === "finance" ? { ...s, status: "cleared" } : s.key === "legal" ? { ...s, status: "not_cleared" } : s);
  const again = buildRoute({ contract_type: "letter_of_award", value_myr: 100_000 }, f, r);
  check("finance clearance carried across a re-route", again.find((s) => s.key === "finance")!.status === "cleared");
  check("a Legal 'not cleared' is reset to pending", again.find((s) => s.key === "legal")!.status === "pending");
  check("reviews not done while Legal pending", !reviewsDone(again));
  check("next approval is the Director band", nextApproval(again)?.label === "Director");
}
{ // template integrity
  const t = templateById("lsh-nda-mutual")!;
  check("NDA template loads with its clauses", !!t && t.clauses.length >= 15, String(t?.clauses.length));
  check("ABMS and inside-information clauses are locked", t.clauses.filter((c) => c.locked).map((c) => c.id).sort().join() === "anti_corruption,inside_information");
  check("clause ids unique", new Set(t.clauses.map((c) => c.id)).size === t.clauses.length);
  check("one template registered", TEMPLATES.length === 1);
}
console.log(`\n${pass}/${pass + fail} rule checks passed`);
process.exit(fail ? 1 : 0);
