// LSH feedback (29 Sep): three-factor pre-qualification, personal guarantee,
// confidence levels, vendor status light, quarterly scan.
import { PASS_MARK, docsFor, factorScore, needsGuarantee, normAddress, sameValue, scanDue, suggestFactors, validationRows, vendorLight } from "../src/lib/vms";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

// Pre-qualification: three factors, average score, pass mark 60.
check("all three needed", factorScore({ litigation: { result: "clear" }, financial: { result: "pass" } }) === null);
check("clear + pass + strong = 100", factorScore({ litigation: { result: "clear" }, financial: { result: "pass" }, experience: { result: "strong" } }) === 100);
const adequate = factorScore({ litigation: { result: "clear" }, financial: { result: "pass" }, experience: { result: "adequate" } })!;
check("clear + pass + adequate passes", adequate === 87 && adequate >= PASS_MARK, String(adequate));
const failFin = factorScore({ litigation: { result: "clear" }, financial: { result: "fail" }, experience: { result: "adequate" } })!;
check("a failed financial standing falls below the pass mark", failFin === 53 && failFin < PASS_MARK, String(failFin));

const sf = suggestFactors({ ctos: { litigation: false, winding_up: false, director_flags: false, score: 690 } },
  [{ doc_type: "afs", status: "verified", extracted: { afs: { fy_end: "2025-12-31", current: { net_profit: 1_200_000, equity: 8_000_000 }, prior: {} } } }]);
check("CTOS clean suggests Clear", sf.litigation?.result === "clear");
check("profitable with positive equity suggests Pass", sf.financial?.result === "pass", sf.financial?.why);
const sf2 = suggestFactors({ ctos: { litigation: true } }, [{ doc_type: "afs", status: "verified", extracted: { afs: { current: { net_profit: -50_000, equity: 100_000 }, prior: {} } } }]);
check("litigation on record suggests Flag; a loss suggests Fail", sf2.litigation?.result === "flag" && sf2.financial?.result === "fail");
check("no CTOS or accounts: no suggestion", suggestFactors({}, []).litigation === null && suggestFactors({}, []).financial === null);

// Sole proprietors and partnerships give a personal guarantee.
check("sole proprietor needs a guarantee", needsGuarantee("sole_prop") && needsGuarantee("partnership") && !needsGuarantee("sdn_bhd"));
check("guarantee is a mandatory document for a sole proprietor", docsFor("supplier_material", "sole_prop").some((d) => d.id === "personal_guarantee" && d.level === "M"));
check("not for a Sdn Bhd", !docsFor("supplier_material", "sdn_bhd").some((d) => d.id === "personal_guarantee"));
check("CTOS consent is a signed form for suppliers", docsFor("supplier_material").some((d) => d.id === "ctos_consent" && d.level === "M"));

// Addresses: abbreviations written out before comparing.
check("Jln/Tmn written out", normAddress("No. 12, Jln Tmn Maju 3, Kg Baru") === "12 jalan taman maju 3 kampung baru", normAddress("No. 12, Jln Tmn Maju 3, Kg Baru"));
check("abbreviated address matches", sameValue("address", "12, Jln Perindustrian 4, Tmn Industri, 93350 Kuching", "12 Jalan Perindustrian 4, Taman Industri, 93350 Kuching, Sarawak"));

// Confidence levels on the validation table.
const docs = [{ id: "d1", doc_type: "ssm", status: "uploaded", created_at: "2026-10-01", file_url: "x",
  extracted: { fields: { company_name: "Delima Mechanical & Electrical Sdn Bhd", registration_no: "202001012345", address: "12 Jalan Perindustrian 4, Taman Industri, 93350 Kuching, Sarawak" },
    confidence: { company_name: 0.97, registration_no: 0.62, address: 0.95 } } }];
const r = { company_name: "Delima Mechanical & Electrical Sdn Bhd", registration_no: "202001012345", register: { address: "12, Jln Perindustrian 4, Tmn Industri, 93350 Kuching" } };
const rows = validationRows(r, docs);
const by = (k: string) => rows.find((x) => x.key === k)!;
check("exact match, high confidence is green", by("company_name").level === "green");
check("low-confidence read is amber", by("registration_no").level === "amber" && /62%/.test(by("registration_no").why ?? ""), by("registration_no").why);
check("abbreviated address is amber (close match)", by("address").level === "amber", by("address").why);
const rows2 = validationRows({ ...r, register: { address: "88 Jalan Lain, Miri" } }, docs);
check("a different address is red", rows2.find((x) => x.key === "address")!.level === "red");
const rows3 = validationRows({ ...r, validation_confirms: { address: { by: "Jeremy Teh", at: "2026-10-03" } } }, docs);
check("a confirmed row records who confirmed", rows3.find((x) => x.key === "address")!.confirmed?.by === "Jeremy Teh");

// Vendor status light.
const today = new Date("2026-10-03");
const good = { status: "approved", dd_valid_until: "2028-01-01", risk_rating: "low" };
check("approved, documents verified: green", vendorLight(good, ["ssm", "bank_letter", "ctos"], today).light === "green");
const y = vendorLight(good, ["ssm"], today);
check("missing payout documents: yellow", y.light === "yellow" && y.outstanding.length === 2 && !y.paymentAllowed, y.reasons.join("; "));
check("due diligence within 30 days: yellow", vendorLight({ ...good, dd_valid_until: "2026-10-20" }, ["ssm", "bank_letter", "ctos"], today).light === "yellow");
check("due diligence lapsed: red", vendorLight({ ...good, dd_valid_until: "2026-09-01" }, ["ssm", "bank_letter", "ctos"], today).light === "red");
check("on hold: red", vendorLight({ ...good, compliance_hold: true }, ["ssm", "bank_letter", "ctos"], today).light === "red");
const o = vendorLight({ ...good, payment_override: { reason: "urgent", by: "Dabraj", expires: "2026-12-31" } }, ["ssm"], today);
check("Finance override allows payment, items stay outstanding", o.paymentAllowed && o.light === "yellow" && o.outstanding.length === 2);
check("an expired override no longer allows payment", !vendorLight({ ...good, payment_override: { reason: "x", expires: "2026-09-01" } }, ["ssm"], today).paymentAllowed);

// Quarterly scan.
check("never scanned: due", scanDue({ status: "approved" }, today));
check("scanned 2 months ago: not due", !scanDue({ status: "approved", adverse_news: { last_scan_at: "2026-08-03T00:00:00Z" } }, today));
check("scanned 3 months ago: due", scanDue({ status: "approved", adverse_news: { last_scan_at: "2026-07-03T00:00:00Z" } }, today));
check("pending vendors are not scanned", !scanDue({ status: "pending" }, today));

console.log(`\n${pass}/${pass + fail} feedback checks passed`);
process.exit(fail ? 1 : 0);
