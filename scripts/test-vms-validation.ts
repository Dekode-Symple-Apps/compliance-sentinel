// Vendor validation: matching rules, the three-way rows, AFS ratios and flags, AFS file names.
import { afsRatios, docTypeFromName, docsFor, PORTAL_FORMS, sameValue, validationRows } from "../src/lib/vms";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

check("SSM new and old number match", sameValue("registration_no", "201901045678 (1334567-M)", "201901045678"));
check("different SSM numbers differ", !sameValue("registration_no", "201901045678", "201901045679"));
check("account numbers match on digits", sameValue("bank_account", "8603 4471 2290", "860344712290"));
check("different account differs", !sameValue("bank_account", "8603 4471 2290", "8603 4471 2291"));
check("names: short form inside long form", sameValue("name", "Nurul Aina", "Nurul Aina binti Hashim"));
check("names: case and Berhad", sameValue("name", "CIMB Bank", "CIMB BANK BERHAD"));
check("company Sdn. Bhd. vs Sdn Bhd", sameValue("name", "Delima Mechanical & Electrical Sdn. Bhd.", "DELIMA MECHANICAL & ELECTRICAL SDN BHD"));
check("different company differs", !sameValue("name", "Delima Mechanical Sdn Bhd", "Kukuh Formwork Sdn Bhd"));
check("directors in any order", sameValue("directors", "Chong Mei Ling, Mohd Hafiz bin Ismail", "Mohd Hafiz bin Ismail, Chong Mei Ling"));
check("address with line breaks", sameValue("address", "No. 21, Jalan Pelukis U1/46, Temasya Industrial Park, 40150 Shah Alam, Selangor", "No. 21, Jalan Pelukis U1/46, Temasya Industrial Park, 40150 Shah Alam,\nSelangor"));

const r = { kind: "onboarding", company_name: "Delima Mechanical & Electrical Sdn Bhd", registration_no: "201901045678 (1334567-M)", contact_name: "Nurul Aina binti Hashim", contact_email: "aina@delima-me.example",
  register: { company_name: "Delima Mechanical & Electrical Sdn Bhd", registration_no: "201901045678 (1334567-M)", tin: "C 2471 0935 08", bank_name: "CIMB Bank Berhad", bank_account: "8603 4471 2290", contact_name: "Nurul Aina binti Hashim", contact_email: "aina@delima-me.example", directors: [{ name: "Mohd Hafiz bin Ismail" }, { name: "Chong Mei Ling" }] } };
const docs = [
  { id: "1", doc_type: "ssm", status: "uploaded", created_at: "1", file_url: "u1", extracted: { fields: { company_name: "DELIMA MECHANICAL & ELECTRICAL SDN BHD", registration_no: "201901045678 (1334567-M)" } } },
  { id: "2", doc_type: "bank_letter", status: "uploaded", created_at: "1", file_url: "u2", extracted: { fields: { bank_name: "CIMB BANK BERHAD", account_no: "8603 4471 2290", account_holder: "DELIMA MECHANICAL & ELECTRICAL SDN BHD" } } },
  { id: "3", doc_type: "company_profile", status: "uploaded", created_at: "1", file_url: "u3", extracted: { fields: { tin: "C 2471 0935 08", directors: ["Mohd Hafiz bin Ismail", "Chong Mei Ling"], contact_name: "Nurul Aina binti Hashim", contact_email: "aina@delima-me.example" } } },
];
const rows = validationRows(r, docs);
check("all rows confirmed when everything agrees", rows.every((x) => x.check === "match"), rows.filter((x) => x.check !== "match").map((x) => `${x.key}:${x.check}`).join(","));
check("source document is named", rows.find((x) => x.key === "bank_account")?.source?.label === "Bank account verification");
const bad = validationRows({ ...r, register: { ...r.register, bank_account: "8603 4471 9999" } }, docs);
check("a changed bank account differs", bad.find((x) => x.key === "bank_account")?.check === "differs");
const noDoc = validationRows(r, docs.filter((d) => d.doc_type !== "bank_letter"));
check("no document means unconfirmed", noDoc.find((x) => x.key === "bank_account")?.check === "unconfirmed");

const healthy = afsRatios({ opinion: "unqualified", current: { revenue: 12_400_000, net_profit: 1_150_000, current_assets: 5_200_000, current_liabilities: 2_600_000, total_liabilities: 3_100_000, equity: 6_900_000, operating_cash_flow: 1_400_000 }, prior: { revenue: 10_800_000 } }, 450_000);
check("healthy AFS has no flags", healthy.flags.length === 0, healthy.flags.join("; "));
check("ratios", Math.abs((healthy.growth ?? 0) - 0.148) < 0.01 && Math.abs((healthy.currentRatio ?? 0) - 2) < 0.01 && Math.abs((healthy.netMargin ?? 0) - 0.0927) < 0.01);
const weak = afsRatios({ opinion: "qualified", going_concern: true, current: { revenue: 2_000_000, net_profit: -50_000, current_assets: 900_000, current_liabilities: 1_000_000, equity: -10_000, operating_cash_flow: -5 }, prior: {} }, 450_000);
check("weak AFS raises every flag", weak.flags.length === 7, weak.flags.join("; "));

const allowed = docsFor("services").map((d) => d.id).filter((x) => !PORTAL_FORMS.has(x));
check("AFS is a suggested document", docsFor("services").find((d) => d.id === "afs")?.level === "S");
check("AFS file names", docTypeFromName("08 Audited financial statements FY2025.pdf", allowed) === "afs" && docTypeFromName("AFS 2025.pdf", allowed) === "afs");
check("bank letter still files as bank", docTypeFromName("03 Bank account confirmation.pdf", allowed) === "bank_letter");

console.log(`\n${pass}/${pass + fail} validation checks passed`);
process.exit(fail ? 1 : 0);
