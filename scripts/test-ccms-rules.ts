// Commercial CMS routing rules: flags from the request, vendor and review; the
// route they produce; decisions carried across a re-route.
import { buildRoute, computeFlags, nextApproval, reviewsDone, templateById, TEMPLATES, contractAlerts, contractMilestones, displayName, paymentReady, defaultSecurities, type Stage } from "../src/lib/ccms";
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
{ // names only
  check("an email shows as a name", displayName("jeremy.teh@cloud-space.co") === "Jeremy Teh", displayName("jeremy.teh@cloud-space.co"));
  check("a name stays a name", displayName("Siti Aminah") === "Siti Aminah");
}
{ // client route: tender comparison + Legal always
  const r = buildRoute({ contract_type: "client_loa", value_myr: 4_650_000 }, []);
  check("client award: Tender comparison → Legal → Finance → FAC", keys(r) === "contracts,legal,finance,approval" && r.at(-1)!.label === "Final Approval Committee", keys(r));
}
{ // alerts
  const d = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const a = contractAlerts({ status: "active", expiry_date: d(20) });
  check("expiry alert inside 30 days", a.length === 1 && a[0].kind === "expiry" && /20 days/.test(a[0].text), JSON.stringify(a));
  check("no expiry alert at 45 days", contractAlerts({ status: "active", expiry_date: d(45) }).length === 0);
  const s = contractAlerts({ signed_date: d(-26), stamping: null });
  check("stamping urgent from day 25", s[0]?.kind === "stamping" && s[0].severity === "high", JSON.stringify(s));
  check("no stamping alert before day 14", contractAlerts({ signed_date: d(-5) }).length === 0);
  check("lapsing bond alerted", contractAlerts({ securities: [{ type: "performance_bond", required: true, valid_until: d(10) }] })[0]?.kind === "security");
  check("unanswered client letter after 7 days", contractAlerts({ confirmation: { sent_date: d(-9) } })[0]?.kind === "confirmation");
}
{ // payment-ready
  const sec = defaultSecurities("letter_of_award", 1_000_000);
  check("LoA needs a 5% bond", sec.find((x) => x.type === "performance_bond")?.amount === 50_000);
  check("not payment-ready while empty", !paymentReady(sec));
  const filled = sec.map((x) => ({ ...x, reference: "REF", valid_until: "2027-12-31" }));
  check("payment-ready once every required item is on file", paymentReady(filled));
}
{ // milestones
  const c = { side: "vendor", status: "stamped", created_at: "2026-09-01", signed_date: "2026-09-10", stamping: { stamped_date: "2026-09-20" },
    securities: [], approval_route: [{ key: "finance", kind: "review", status: "cleared" }, { key: "approval", kind: "approval", status: "approved", role: "approver", label: "Director" }] };
  const m = contractMilestones(c, [{ doc_role: "draft" }], []);
  check("stamped contract: bonds & insurance is the current stage", m.stages.find((x) => x.state === "current")?.key === "securities", JSON.stringify(m.stages.map((x) => x.key + ":" + x.state)));
  check("…and the next step names Finance", m.next?.role === "finance");
  const client = contractMilestones({ side: "client", status: "in_review", created_at: "2026-09-01", approval_route: [] }, [{ doc_role: "counterparty" }], [],
    { items: [{ status: "differs", decision: "confirm_with_client" }, { status: "matches", decision: "accepted" }] });
  check("client: waiting on the client's confirmation", client.stages.find((x) => x.state === "current")?.key === "tender", JSON.stringify(client.stages.map((x) => x.key + ":" + x.state)));
}
console.log(`\n${pass}/${pass + fail} rule checks passed`);
process.exit(fail ? 1 : 0);
