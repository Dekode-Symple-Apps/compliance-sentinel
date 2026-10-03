// ----------------------------------------------------------------------------
// The forms a vendor signs by hand (29 Sep review: existing forms must be
// followed; some need a physical signature). The portal generates the form
// with the vendor's details filled in; the vendor prints, signs, scans and
// uploads it; the AI checks the signature. ASSUMPTION: the layout is a
// placeholder until LSH sends its own forms — the wording is in SIGNED_FORMS.
// Client-side only (jsPDF).
// ----------------------------------------------------------------------------

import jsPDF from "jspdf";
import { BUSINESS_TYPES, SIGNED_FORMS } from "@/lib/vms";

export interface FormParty { company: string; registration_no?: string; address?: string; business_type?: string; reference?: string }

/** Builds the form and starts the download. */
export function downloadSignedForm(formId: string, p: FormParty) {
  const form = SIGNED_FORMS[formId];
  if (!form) return;
  const pdf = new jsPDF("p", "mm", "a4");
  const W = 210, M = 20;
  let y = 22;
  pdf.setFillColor(26, 26, 26); pdf.rect(0, 0, W, 8, "F");
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(10); pdf.setTextColor(90);
  pdf.text("LIM SEONG HAI CAPITAL BERHAD · VENDOR REGISTRATION", M, y);
  y += 10;
  pdf.setTextColor(20); pdf.setFontSize(17); pdf.text(form.title, M, y);
  y += 6;
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(110);
  pdf.text(`Form ${formId === "ctos_consent" ? "LSH-VMS-CTOS" : "LSH-VMS-PG"} · ${p.reference ? `Request ${p.reference} · ` : ""}print, sign, scan and upload`, M, y);
  y += 10;

  // The party, filled in from the registration.
  const rows: [string, string][] = [
    ["Company / business name", p.company],
    ["Registration no.", p.registration_no || ""],
    ["Business type", p.business_type ? BUSINESS_TYPES[p.business_type] ?? p.business_type : ""],
    ["Address", p.address || ""],
  ];
  pdf.setFontSize(10); pdf.setTextColor(20);
  for (const [k, v] of rows) {
    pdf.setFont("helvetica", "bold"); pdf.text(k, M, y);
    pdf.setFont("helvetica", "normal");
    const lines = pdf.splitTextToSize(v || "______________________________________________", W - M - 75);
    pdf.text(lines, M + 55, y);
    y += 6 * Math.max(1, lines.length) + 1;
  }
  y += 4;
  pdf.setDrawColor(200); pdf.line(M, y, W - M, y); y += 8;

  // The wording.
  pdf.setFontSize(10.5);
  for (const para of form.body) {
    const lines = pdf.splitTextToSize(para, W - 2 * M);
    pdf.text(lines, M, y);
    y += lines.length * 5.2 + 4;
  }

  // Signature block.
  y += 8;
  const box = (x: number, label: string, h = 26) => {
    pdf.setDrawColor(150); pdf.rect(x, y, 78, h);
    pdf.setFontSize(8.5); pdf.setTextColor(110); pdf.text(label, x + 2, y + h + 5);
  };
  box(M, "Signature");
  box(W - M - 78, formId === "ctos_consent" ? "Company stamp" : "Witness signature");
  y += 40;
  pdf.setFontSize(10); pdf.setTextColor(20);
  for (const label of ["Name", formId === "personal_guarantee" ? "NRIC / passport no." : "Designation", "Date"]) {
    pdf.text(`${label}:`, M, y); pdf.setDrawColor(150); pdf.line(M + 42, y + 1, W - M, y + 1); y += 10;
  }
  pdf.setFontSize(7.5); pdf.setTextColor(140);
  pdf.text("Draft form — to be replaced by Lim Seong Hai's issued form.", M, 287);
  pdf.save(`${form.title} - ${p.company.replace(/[^\w ]+/g, "").trim() || "vendor"}.pdf`);
}
