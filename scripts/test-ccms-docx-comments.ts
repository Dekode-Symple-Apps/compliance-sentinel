// Word comments anchored to exact passages, on the committed NDA template.
import { readFileSync } from "node:fs";
import PizZip from "pizzip";
import { addAnchoredCommentsToDocx } from "../src/lib/docx-anchored-comments";
import { docxToText } from "../src/lib/docx-editor";
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const src = readFileSync("public/templates/ccms/LSH-CMS-T01-Mutual-Non-Disclosure-Agreement-v1.0.docx");
const d = "2026-09-27T10:00:00Z";
const r = addAnchoredCommentsToDocx(src, [
  { quote: "This Agreement is governed by the laws of Malaysia.", text: "A", author: "AI Reviewer", dateIso: d },
  { quote: "within seventy-two (72) hours", text: "B", author: "Legal", dateIso: d, done: true },
  { quote: "RECITALS\n\nThe Company is an investment holding company", text: "C", author: "AI Reviewer", dateIso: d },
  { quote: "no such passage anywhere", fallback: "GOVERNING LAW AND DISPUTES", text: "D", author: "AI Reviewer", dateIso: d },
  { quote: "no such passage anywhere at all", text: "E", author: "AI Reviewer", dateIso: d },
]);
check("three exact anchors (incl. a quote spanning two paragraphs)", r.exact === 3, `exact ${r.exact}`);
check("fallback heading used for a missing passage", r.loose === 1, `loose ${r.loose}`);
check("an unplaceable comment is kept, not dropped", r.unplaced === 1);
const z = new PizZip(r.buffer);
const doc = z.file("word/document.xml")!.asText();
const span = (id: number) => doc.match(new RegExp(`<w:commentRangeStart w:id="${id}"/>([\\s\\S]*?)<w:commentRangeEnd w:id="${id}"/>`))?.[1].replace(/<[^>]+>/g, "") ?? "";
check("range covers exactly the quoted words", span(0) === "This Agreement is governed by the laws of Malaysia.", span(0));
check("mid-sentence range is split to the words", span(1) === "within seventy-two (72) hours", span(1));
check("five comments written", (z.file("word/comments.xml")!.asText().match(/<w:comment /g) ?? []).length === 5);
check("resolved comment marked done", /w15:done="1"/.test(z.file("word/commentsExtended.xml")!.asText()));
check("unplaceable comment says so", z.file("word/comments.xml")!.asText().includes("Could not locate"));
const [a, b] = await Promise.all([docxToText(src), docxToText(r.buffer)]);
check("the contract wording is unchanged", a === b);
console.log(`\n${pass}/${pass + fail} Word comment checks passed`);
process.exit(fail ? 1 : 0);
