// A draft generated from the template: particulars filled, wording untouched.
import PizZip from "pizzip";
import { FILLABLE_DOCX_BASE64 } from "../src/lib/ccms-templates/lsh-nda-mutual.fill";
import { fillNda, templateById } from "../src/lib/ccms";
import { docxToText, escapeXml } from "../src/lib/docx-editor";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const gen = (fields: Record<string, string>) => {
  const { values, missing } = fillNda("Lim Seong Hai Capital Berhad", fields);
  const zip = new PizZip(Buffer.from(FILLABLE_DOCX_BASE64, "base64"));
  let xml = zip.file("word/document.xml")!.asText();
  for (const [k, v] of Object.entries(values)) xml = xml.split(`{{${k}}}`).join(escapeXml(v));
  zip.file("word/document.xml", xml);
  return { buf: zip.generate({ type: "nodebuffer" }) as Buffer, missing, xml };
};
const full = { date: "2026-10-01", purpose: "Evaluation of a proposal for a project-management system for the Group's construction projects.", direction: "Mutual", term: "Two (2) years",
  disputes: "Courts of Malaysia", stamp_duty: "Counterparty", non_solicit: "No", company_reg: "201901000001", company_address: "Wisma Lim Seong Hai, Kuala Lumpur",
  company_contact: "Head of Group IT, Wisma Lim Seong Hai, it@lsh.example", whistleblowing: "whistleblowing@lsh.example", cp_name: "Awan Digital Solutions Sdn Bhd",
  cp_reg: "202001056789", cp_form: "company", cp_country: "Malaysia", cp_address: "Level 8, Menara Awan, Petaling Jaya", cp_contact: "CEO, legal@awan.example" };
const g = gen(full);
const text = await docxToText(g.buf);
check("no placeholder left", !/\{\{/.test(g.xml));
check("nothing missing when all particulars given", g.missing.length === 0, g.missing.join(", "));
check("parties block names both parties", text.includes("AWAN DIGITAL SOLUTIONS SDN BHD (Registration No. 202001056789)") && text.includes("LIM SEONG HAI CAPITAL BERHAD (Registration No. 201901000001)"));
check("Schedule 1 date written out", text.includes("1 October 2026"));
check("whistleblowing channel in clause 12.4", text.includes("through the Company's whistleblowing channel at whistleblowing@lsh.example"));
// every clause paragraph of the approved template appears verbatim
const t = templateById("lsh-nda-mutual")!;
const paras = t.clauses.flatMap((c) => c.paragraphs.map((p) => p.replace("[●]", "whistleblowing@lsh.example")));
const norm = (s: string) => s.replace(/\s+/g, " ");
const missingParas = paras.filter((p) => !norm(text).includes(norm(p)));
check("every clause of the approved template is there word for word", missingParas.length === 0, `${missingParas.length} differ`);
check("no template note page in a generated draft", !text.includes("TEMPLATE NOTE"));
const partial = gen({ ...full, company_reg: "", cp_address: "" });
check("blank particulars listed and shown as [●]", partial.missing.length === 2 && (await docxToText(partial.buf)).includes("Registration No. [●]"), partial.missing.join(", "));
console.log(`\n${pass}/${pass + fail} generation checks passed`);
process.exit(fail ? 1 : 0);
