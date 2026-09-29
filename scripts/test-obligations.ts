// Obligations: categories from wording, PIC defaults, automatic obligations, due buckets.
import { carryValidation, sameObligation, isPayment, autoObligations, categoryOf, contractOwner, defaultPic, departmentChecklist, departmentRequired, entityShort, normalizeObligations, obligationBucket } from "../src/lib/ccms";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

check("payment wording is Finance", categoryOf("Pay 50% of the contract value on signing") === "finance");
check("invoice wording is Finance", categoryOf("Submit invoices monthly in arrears") === "finance");
check("notice wording is Legal", categoryOf("Notify Disclosing Party without delay on becoming aware of unauthorised use") === "legal");
check("stamping is Legal", categoryOf("Company shall arrange stamping within 30 days from execution.") === "legal");
check("return of information is Legal", categoryOf("Return or destroy Confidential Information within 14 days of request") === "legal");
check("delivery is Business", categoryOf("Deliver UAT environment by week 6") === "business");

const legacy = normalizeObligations(["Pay 30% on UAT acceptance", "Notify breaches within 72 hours", "Deliver monthly progress report"], "Jeremy Teh");
check("text obligations become objects", legacy.length === 3 && legacy.every((o) => o.id && o.status === "open"));
check("PIC by category", legacy[0].pic === "Dabraj" && legacy[1].pic === "Irwin" && legacy[2].pic === "Jeremy Teh", legacy.map((o) => o.pic).join(","));
check("Business PIC follows the owner", defaultPic("business", "Aisyah") === "Aisyah");
check("an explicit PIC and category are kept", normalizeObligations([{ text: "Pay deposit", category: "business", pic: "Someone" }])[0].pic === "Someone");
check("a bad date is dropped", normalizeObligations([{ text: "x y", due_date: "next week" }])[0].due_date === null);

const nda = { contract_type: "nda", signed_date: "2026-09-28", stamping: null };
const autoNda = autoObligations(nda, "2028-09-28", [], "Jeremy Teh");
check("renewal decision due 30 days before expiry", autoNda.length === 1 && autoNda[0].due_date === "2028-08-29" && autoNda[0].pic === "Jeremy Teh", JSON.stringify(autoNda));
check("auto obligations are added once", autoObligations(nda, "2028-09-28", autoNda, "Jeremy Teh").length === 0);
const loa = { contract_type: "letter_of_award", signed_date: "2026-09-01", stamping: null };
const autoLoa = autoObligations(loa, "2027-09-01", [], "Jeremy Teh");
check("unstamped full-flow contract gets a stamping obligation for Legal", autoLoa.some((o) => o.auto === "stamping" && o.pic === "Irwin" && o.due_date === "2026-10-01"), JSON.stringify(autoLoa));

const today = new Date("2026-09-29");
const b = (due: string | null, status: "open" | "done" = "open") => obligationBucket({ id: "x", text: "t", category: "business", pic: "p", due_date: due, status }, today);
check("buckets", b("2026-09-01") === "overdue" && b("2026-10-15") === "soon" && b("2027-01-01") === "later" && b(null) === "nodate" && b("2026-09-01", "done") === "done");

check("owner falls back to the requester", contractOwner({ requestor_name: "Jeremy Teh" }) === "Jeremy Teh" && contractOwner({ owner_name: "Dabraj", requestor_name: "Jeremy Teh" }) === "Dabraj");
check("entity short names", entityShort("Lim Seong Hai Lighting Sdn Bhd") === "LSH Lighting" && entityShort("Lim Seong Hai Capital Berhad") === "LSH Capital" && entityShort("Knight Auto Sdn Bhd") === "Knight Auto");

const ndaC = { contract_type: "nda", approval_route: [{ key: "legal", label: "Legal Decision", kind: "review", status: "pending" }] } as any;
check("NDA: only Legal clears", departmentRequired(ndaC, "legal").required && !departmentRequired(ndaC, "finance").required && !departmentRequired(ndaC, "business").required, departmentRequired(ndaC, "finance").why);
const loaC = { contract_type: "letter_of_award", requestor_name: "Jeremy Teh", created_at: "2026-09-28", approval_route: [
  { key: "legal", label: "Legal Vetting", kind: "review", status: "cleared", decided_by: "Irwin" }, { key: "finance", label: "Finance Review", kind: "review", status: "pending" },
  { key: "approval", label: "Final Approval Committee", kind: "approval", status: "pending" }] } as any;
check("Letter of Award: all three clear", ["legal", "finance", "business"].every((k) => departmentRequired(loaC, k as any).required));
const finList = departmentChecklist(loaC, "finance", normalizeObligations([{ text: "Pay progress claims", category: "finance", amount: 100 }]));
check("finance checklist: review pending, schedule still to validate", finList[0].label === "Finance Review" && !finList[0].done && finList.some((x) => x.label === "Finance obligations validated" && !x.done), JSON.stringify(finList));
check("legal checklist: vetting done by Irwin", departmentChecklist(loaC, "legal", [])[0].done && departmentChecklist(loaC, "legal", [])[0].note?.startsWith("Irwin") === true);
check("NDA finance checklist is empty (nothing for Finance to do)", departmentChecklist(ndaC, "finance", []).length === 0);

const mk = (text: string) => normalizeObligations([{ text, category: "finance", amount: 1000 }])[0];
check("instalments are payments", isPayment(mk("Pay contract signing instalment")) && isPayment(mk("Pay UAT acceptance instalment")));
check("a performance bond is not a payment", !isPayment(mk("Deliver on-demand performance bond bank guarantee")) && !isPayment(mk("Deliver performance bond of 5% of contract price")));
check("\"Supplier shall deliver performance bond\" is not a payment", !isPayment(mk("Supplier shall deliver performance bond of five percent of contract price")) && isPayment(mk("Purchaser shall pay Batch 1 payment instalment")) && isPayment(mk("Purchaser shall release retention sum to Supplier")));
check("an advance paid against a bond is a payment", isPayment(mk("Pay advance payment against advance payment bond")) && isPayment(mk("Release retention sum to Supplier")));

// Validation in review carries to a re-run, a new version, and the signed copy.
const v1 = normalizeObligations([{ text: "Pay advance payment against bond", category: "finance", amount: 128000, validated_by: "Dabraj", validated_at: "2026-09-29T10:00:00Z" },
  { text: "Pay Batch 1 instalment", category: "finance", amount: 384000 }, { text: "Arrange stamping within 30 days", category: "legal", validated_by: "Irwin" }]);
const reread = normalizeObligations([{ text: "Purchaser pays the advance payment (10%)", category: "finance", amount: 128000 },
  { text: "Pay Batch 1 instalment", category: "finance", amount: 384000 }, { text: "Arrange  stamping within 30 days.", category: "legal" }, { text: "Pay retention", category: "finance", amount: 64000 }]);
const carried = carryValidation(reread, v1);
check("same amount keeps the validation (wording changed)", carried[0].validated_by === "Dabraj" && carried[0].validated_at === "2026-09-29T10:00:00Z");
check("an unvalidated one stays unvalidated", !carried[1].validated_by && !carried[3].validated_by);
check("same wording keeps the validation", carried[2].validated_by === "Irwin");
check("a changed amount is not the same obligation", !sameObligation(normalizeObligations([{ text: "Pay advance", category: "finance", amount: 100 }])[0], normalizeObligations([{ text: "Pay advance payment", category: "finance", amount: 200 }])[0]));
check("normalize keeps validated_by", normalizeObligations([{ text: "x y", validated_by: "Dabraj" }])[0].validated_by === "Dabraj");
const finChk = departmentChecklist(loaC, "finance", carried);
check("finance checklist counts validations", finChk.some((x) => x.label === "Finance obligations validated" && !x.done && x.note === "1 of 3 validated"), JSON.stringify(finChk));
console.log(`\n${pass}/${pass + fail} obligation checks passed`);
process.exit(fail ? 1 : 0);
