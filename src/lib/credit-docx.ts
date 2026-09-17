// ============================================================================
// Credit Risk Alert — .docx export
// ----------------------------------------------------------------------------
// Builds a genuine Word .docx (WordprocessingML) from a CreditRiskAnalysis,
// entirely client-side. The credit application is a PDF, so there's no source
// .docx to amend (unlike the simplify path) — we assemble a minimal-but-valid
// OOXML package by hand with PizZip (already a dependency).
//
// Real numbered/bulleted lists need numbering.xml + relationships; to keep the
// package to the 3 essential parts we render bullets/numbers as literal text
// prefixes with a hanging indent. Word opens this cleanly.
// ============================================================================

import { CREDIT_RISK_SEGMENTS, type CreditRiskAnalysis, type CreditRiskIndicator } from "./gemini";
import { stripInvalidXmlChars } from "./docx-editor";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Traffic-light meta — text colour only (no fills), mirrored from the in-app UI.
const IND: Record<CreditRiskIndicator, { label: string; color: string; rank: number }> = {
  high: { label: "High risk", color: "B91C1C", rank: 0 },
  probe: { label: "Probe", color: "B45309", rank: 1 },
  low: { label: "Low", color: "15803D", rank: 2 },
};

// ── XML primitives ───────────────────────────────────────────────────────────

function xml(s: unknown): string {
  // stripInvalidXmlChars first: escaping does not save us from C0 controls or
  // lone surrogates, which are illegal anywhere in an XML 1.0 document and make
  // Word offer to "repair" the file (dropping content).
  return stripInvalidXmlChars(String(s ?? ""))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** A run. Multi-line text is split on \n and rejoined with <w:br/>. sz is half-points. */
function run(
  text: string,
  o: { b?: boolean; i?: boolean; color?: string; sz?: number } = {},
): string {
  const rpr =
    [
      o.b ? "<w:b/>" : "",
      o.i ? "<w:i/>" : "",
      o.color ? `<w:color w:val="${o.color}"/>` : "",
      o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : "",
    ].join("") || "";
  const t = String(text ?? "")
    .split("\n")
    .map((p, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${xml(p)}</w:t>`)
    .join("");
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}${t}</w:r>`;
}

/** Like run(), but bolds any occurrence of the match terms within the text. */
function runsHighlighted(
  text: string,
  terms: string[] | undefined,
  base: { i?: boolean; color?: string; sz?: number } = {},
): string {
  const clean = (terms ?? []).map((t) => t.trim()).filter((t) => t.length >= 2);
  if (clean.length === 0) return run(text, base);
  const escaped = clean
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  return String(text ?? "")
    .split(re)
    .filter((p) => p !== "")
    .map((p) =>
      clean.some((t) => t.toLowerCase() === p.toLowerCase()) ? run(p, { ...base, b: true }) : run(p, base),
    )
    .join("");
}

function para(
  runsXml: string,
  o: {
    spaceBefore?: number;
    spaceAfter?: number;
    align?: "left" | "center" | "right";
    indentLeft?: number;
    hanging?: number;
    shd?: string;
    keepNext?: boolean;
  } = {},
): string {
  const spacing =
    o.spaceBefore != null || o.spaceAfter != null
      ? `<w:spacing${o.spaceBefore != null ? ` w:before="${o.spaceBefore}"` : ""}${
          o.spaceAfter != null ? ` w:after="${o.spaceAfter}"` : ""
        }/>`
      : "";
  const ind =
    o.indentLeft != null || o.hanging != null
      ? `<w:ind${o.indentLeft != null ? ` w:left="${o.indentLeft}"` : ""}${
          o.hanging != null ? ` w:hanging="${o.hanging}"` : ""
        }/>`
      : "";
  const ppr =
    [
      spacing,
      ind,
      o.align ? `<w:jc w:val="${o.align}"/>` : "",
      o.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shd}"/>` : "",
      o.keepNext ? "<w:keepNext/>" : "",
    ].join("") || "";
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${runsXml}</w:p>`;
}

const EMPTY_PARA = "<w:p/>";

/** Inline markdown → runs: bolds **wrapped** segments. */
function mdRuns(text: string, base: { sz?: number; color?: string } = {}): string {
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((p, i) => (p ? run(p, { ...base, b: i % 2 === 1 }) : ""))
    .join("");
}

function heading(text: string, o: { sz?: number; color?: string; spaceBefore?: number } = {}): string {
  return para(run(text, { b: true, sz: o.sz ?? 26, color: o.color ?? "0F172A" }), {
    spaceBefore: o.spaceBefore ?? 280,
    spaceAfter: 100,
    keepNext: true,
  });
}

function bullet(text: string, prefix = "•  "): string {
  return para(run(`${prefix}${text}`, { sz: 21 }), { indentLeft: 360, hanging: 240, spaceAfter: 40 });
}

// ── table primitives ──────────────────────────────────────────────────────────

function cell(
  contentXml: string,
  o: { w: number; fill?: string; valign?: "top" | "center" } = { w: 1000 },
): string {
  const tcpr = [
    `<w:tcW w:w="${o.w}" w:type="dxa"/>`,
    o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : "",
    `<w:vAlign w:val="${o.valign ?? "top"}"/>`,
    `<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar>`,
  ].join("");
  return `<w:tc><w:tcPr>${tcpr}</w:tcPr>${contentXml}</w:tc>`;
}

function table(rowsXml: string, colWidths: number[]): string {
  const grid = colWidths.map((w) => `<w:gridCol w:w="${w}"/>`).join("");
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="D1D9E0"/>`)
    .join("");
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>` +
    `<w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid>${grid}</w:tblGrid>${rowsXml}</w:tbl>`
  );
}

// ── document assembly ──────────────────────────────────────────────────────────

export interface CreditDocxMeta {
  borrowerName: string;
  sourceFilename?: string;
  generatedAt: string; // preformatted date string from the caller
}

function buildDocumentXml(analysis: CreditRiskAnalysis, meta: CreditDocxMeta): string {
  const body: string[] = [];
  const byKey = new Map(analysis.riskTable.map((f) => [f.segment, f] as const));
  const facts = analysis.applicationFacts;
  const muted = "64748B";

  /** Header row for a table: dark fill, white bold text. */
  const th = (labels: string[], cols: number[]) =>
    `<w:tr>${labels.map((l, i) => cell(para(run(l, { b: true, color: "FFFFFF", sz: 18 })), { w: cols[i], fill: "0F172A" })).join("")}</w:tr>`;
  /** One line for the table; one sentence for "why it matters" — same
   *  fallbacks as the screen, so file and screen never disagree. */
  const lines = (f?: { headline?: string; whyItMatters?: string; finding: string }) => {
    if (!f) return { line: "Nothing to report for this category.", why: "" };
    const idx = f.finding.search(/this mirrors/i);
    const obs = idx === -1 ? f.finding.trim() : f.finding.slice(0, idx).trim().replace(/[.\s]+$/, "");
    const w = idx === -1 ? "" : f.finding.slice(idx).replace(/^.*?which warns that[,:\s]*/i, "").trim();
    return { line: f.headline?.trim() || obs, why: f.whyItMatters?.trim() || w };
  };
  const sectionTitle = (n: number, t: string) => heading(`${n}. ${t}`);
  const emptyLine = (t: string) => para(run(t, { i: true, sz: 20, color: "94A3B8" }), { spaceAfter: 80 });

  // ── Title block + overview header (FR-7.07) ──
  body.push(
    para(run("Credit Risk Assessment", { b: true, sz: 40, color: "0F172A" }), { spaceAfter: 40 }),
    para(run(meta.borrowerName || facts?.borrower || "Credit Application", { b: true, sz: 30, color: "B91C1C" }), { spaceAfter: 40 }),
  );
  const ov = IND[analysis.overallRisk] ?? IND.probe;
  body.push(
    para(run("Overall indicator:  ", { b: true, sz: 22, color: "0F172A" }) + run(ov.label, { b: true, sz: 22, color: ov.color }), { spaceAfter: 40 }),
    para(
      run(
        [
          facts?.facilityAmount ? `Facility: ${facts.facilityAmount}${facts.facilityType ? ` (${facts.facilityType})` : ""}` : null,
          facts?.applicationDate ? `Application date: ${facts.applicationDate}` : null,
          `Analysed: ${meta.generatedAt}`,
          meta.sourceFilename ? `Source: ${meta.sourceFilename}` : null,
        ].filter(Boolean).join("    ·    "),
        { sz: 18, color: muted },
      ),
      { spaceAfter: 120 },
    ),
  );

  // ── 1. Application overview ──
  body.push(sectionTitle(1, "Application overview"));
  if (facts) {
    const C = [2600, 6760];
    const rows = [
      ["Borrower", facts.borrower || meta.borrowerName],
      ["Facility", facts.facilityType],
      ["Amount", facts.facilityAmount],
      ["Application date", facts.applicationDate],
      ["Application type", facts.applicationType],
      ["Segment", facts.segment],
      ["Purpose", facts.purpose],
    ].map(([k, v], i) => `<w:tr>${cell(para(run(k, { b: true, sz: 18 })), { w: C[0], fill: i % 2 ? "F8FAFC" : undefined })}${cell(para(run(v || "Not stated", { sz: 18, color: v ? undefined : "94A3B8" })), { w: C[1], fill: i % 2 ? "F8FAFC" : undefined })}</w:tr>`).join("");
    body.push(table(rows, C));
    if (facts.notFound.length) body.push(para(run(`Not stated in the application: ${facts.notFound.join(", ")}.`, { i: true, sz: 16, color: muted }), { spaceBefore: 40 }));
  }
  body.push(para(run("Executive summary", { b: true, sz: 20 }), { spaceBefore: 80, spaceAfter: 20 }));
  body.push(para(run(analysis.applicationSummary || "—", { sz: 20 }), { spaceAfter: 120 }));

  // ── 2. Risk alerts (FR-5.09: category · indicator · finding · reference) ──
  body.push(sectionTitle(2, "Risk alerts"));
  {
    const C = [1700, 1100, 4200, 2360];
    const ordered = [...CREDIT_RISK_SEGMENTS].sort((a, b) => (IND[byKey.get(a.key)?.indicator ?? "low"].rank ?? 2) - (IND[byKey.get(b.key)?.indicator ?? "low"].rank ?? 2));
    const rows = ordered.map(({ key, label }, i) => {
      const f = byKey.get(key); const ind = IND[f?.indicator ?? "low"]; const { line, why } = lines(f);
      const z = i % 2 ? "F8FAFC" : undefined;
      const findingCell = para(run(line, { sz: 18 })) + (why ? para(run(why, { i: true, sz: 16, color: muted }), { spaceBefore: 20 }) : "");
      const ref = f?.traceReference
        ? para(run(`${f.traceReference}${f.evidence?.casePage != null ? ` · p.${f.evidence.casePage}` : ""}`, { b: true, sz: 16, color: "1D4ED8" }))
        : para(run("No close precedent", { i: true, sz: 16, color: "94A3B8" }));
      return `<w:tr>${cell(para(run(label, { b: true, sz: 18 })), { w: C[0], fill: z })}${cell(para(run(ind.label, { b: true, sz: 18, color: ind.color })), { w: C[1], fill: z })}${cell(findingCell, { w: C[2], fill: z })}${cell(ref, { w: C[3], fill: z })}</w:tr>`;
    }).join("");
    body.push(table(th(["Risk category", "Indicator", "Finding", "Precedent"], C) + rows, C));
    body.push(EMPTY_PARA);
  }

  // ── 3. Suggested mitigations ──
  body.push(sectionTitle(3, "Suggested mitigations"));
  {
    const C = [1900, 5260, 2200];
    const rows: string[] = [];
    for (const { key, label } of CREDIT_RISK_SEGMENTS) {
      const f = byKey.get(key);
      if (!f || (f.indicator ?? "low") === "low" || !f.mitigations?.length) continue;
      f.mitigations.forEach((mi, i) => {
        const basis = mi.source === "case" ? (mi.reference ?? "case") : mi.source === "policy" ? (mi.reference ?? "policy") : "best practice";
        rows.push(`<w:tr>${cell(para(run(i === 0 ? label : "", { b: true, sz: 18 })), { w: C[0] })}${cell(para(run(mi.action, { sz: 18 })), { w: C[1] })}${cell(para(run(basis, { sz: 16, color: muted })), { w: C[2] })}</w:tr>`);
      });
    }
    body.push(rows.length ? table(th(["Risk", "Mitigation", "Basis"], C) + rows.join(""), C) : emptyLine("No material risks requiring mitigation."));
    body.push(EMPTY_PARA);
  }

  // ── 4. Financial analysis (FR-3.06: tables, not narrative) ──
  body.push(sectionTitle(4, "Financial analysis"));
  if (analysis.financialRatios?.length) {
    const C = [2200, 1300, 1300, 1200, 1200, 2160];
    const FL: Record<string, { l: string; c: string }> = { adverse: { l: "Adverse", c: "B91C1C" }, watch: { l: "Watch", c: "B45309" }, ok: { l: "Within policy", c: "047857" }, none: { l: "", c: muted } };
    const rows = analysis.financialRatios.map((r, i) => {
      const z = i % 2 ? "F8FAFC" : undefined; const fl = FL[r.flag] ?? FL.none;
      return `<w:tr>${cell(para(run(r.metric, { b: true, sz: 18 })), { w: C[0], fill: z })}${cell(para(run(r.current || "—", { sz: 18 }), { align: "right" }), { w: C[1], fill: z })}${cell(para(run(r.prior || "—", { sz: 18, color: muted }), { align: "right" }), { w: C[2], fill: z })}${cell(para(run(r.movement || "—", { sz: 18 }), { align: "right" }), { w: C[3], fill: z })}${cell(para(run(fl.l, { b: true, sz: 16, color: fl.c })), { w: C[4], fill: z })}${cell(para(run(r.note, { sz: 16, color: muted })), { w: C[5], fill: z })}</w:tr>`;
    }).join("");
    body.push(table(th(["Metric", "Current", "Prior", "Movement", "Flag", "Reading"], C) + rows, C));
  } else {
    body.push(emptyLine("Ratio table not generated for this report."));
  }
  if (analysis.financialAnomalies?.length) {
    body.push(para(run("Anomalies and inconsistencies", { b: true, sz: 20 }), { spaceBefore: 80, spaceAfter: 20 }));
    const C = [1300, 2600, 5460];
    const rows = analysis.financialAnomalies.map((a, i) => `<w:tr>${cell(para(run(a.severity.toUpperCase(), { b: true, sz: 16, color: a.severity === "high" ? "B91C1C" : a.severity === "medium" ? "B45309" : muted })), { w: C[0], fill: i % 2 ? "F8FAFC" : undefined })}${cell(para(run(a.label, { b: true, sz: 18 })), { w: C[1], fill: i % 2 ? "F8FAFC" : undefined })}${cell(para(run(a.detail, { sz: 18 })), { w: C[2], fill: i % 2 ? "F8FAFC" : undefined })}</w:tr>`).join("");
    body.push(table(rows, C));
  }
  body.push(EMPTY_PARA);

  // ── 5. Policy check ──
  body.push(sectionTitle(5, "Policy check"));
  if (analysis.policyAlerts.length) {
    const C = [1400, 2800, 5160];
    const order = { fail: 0, probe: 1, pass: 2 } as const;
    const rows = [...analysis.policyAlerts].sort((a, b) => order[a.status] - order[b.status]).map((a, i) => {
      const st = a.status === "pass" ? IND.low : a.status === "fail" ? IND.high : IND.probe;
      const lbl = a.status === "pass" ? "Compliant" : a.status === "fail" ? "Fail" : "Probe";
      const z = i % 2 ? "F8FAFC" : undefined;
      return `<w:tr>${cell(para(run(lbl, { b: true, sz: 18, color: st.color })), { w: C[0], fill: z })}${cell(para(run(a.reference || "—", { b: true, sz: 18 })), { w: C[1], fill: z })}${cell(para(run(a.description || "", { sz: 18 })), { w: C[2], fill: z })}</w:tr>`;
    }).join("");
    body.push(table(th(["Status", "Clause", "What was found"], C) + rows, C));
  } else {
    body.push(emptyLine("No policy points were raised against this application."));
  }
  body.push(EMPTY_PARA);

  // ── 6. Industry assessment (internal / external labelled, FR-6.02) ──
  body.push(sectionTitle(6, "Industry assessment"));
  if (analysis.industryAssessment) {
    const ia = analysis.industryAssessment;
    body.push(para(run(`Outlook: ${ia.outlook === "unknown" ? "unclear" : ia.outlook}`, { b: true, sz: 18, color: ia.outlook === "negative" ? "B91C1C" : ia.outlook === "positive" ? "047857" : muted }), { spaceAfter: 20 }));
    body.push(para(run(ia.summary || "—", { sz: 20 }), { spaceAfter: 60 }));
    body.push(para(run("Internal — from the application and knowledge base", { b: true, sz: 16, color: muted }), { spaceAfter: 20 }));
    if (ia.internal.length) for (const t of ia.internal) body.push(bullet(t)); else body.push(emptyLine("Nothing recorded."));
    body.push(para(run("External — web sources, each attributed", { b: true, sz: 16, color: muted }), { spaceBefore: 60, spaceAfter: 20 }));
    if (ia.external.length) for (const e of ia.external) body.push(bullet(`${e.text} — ${e.source}${e.uri ? ` (${e.uri})` : ""}`)); else body.push(emptyLine("Nothing material found from external sources."));
  } else {
    body.push(emptyLine("Industry assessment not generated for this report."));
  }
  body.push(EMPTY_PARA);

  // ── 7. Adverse news screening ──
  body.push(sectionTitle(7, "Adverse news screening"));
  if (analysis.adverseNews && (analysis.adverseNews.summary || analysis.adverseNews.sources?.length)) {
    for (const raw of (analysis.adverseNews.summary || "").split(/\n/)) {
      const line = raw.trim(); if (!line) continue;
      const b = line.match(/^[-*]\s+(.*)$/);
      body.push(b ? para(run("•  ", { sz: 20 }) + mdRuns(b[1], { sz: 20 }), { indentLeft: 360, hanging: 240, spaceAfter: 30 }) : para(mdRuns(line, { sz: 20 }), { spaceAfter: 40 }));
    }
    if (analysis.adverseNews.sources?.length) {
      body.push(para(run("Sources (external)", { b: true, sz: 16, color: muted }), { spaceBefore: 60, spaceAfter: 20 }));
      for (const s of analysis.adverseNews.sources.slice(0, 8)) body.push(para(run(`•  ${s.title} — ${s.uri}`, { sz: 16, color: "1D4ED8" }), { indentLeft: 360, spaceAfter: 16 }));
    }
  } else {
    body.push(emptyLine("Nothing was found. The applicant name was screened and no material adverse coverage surfaced."));
  }
  body.push(EMPTY_PARA);

  // ── 8. Questions for probe ──
  body.push(sectionTitle(8, "Questions for probe"));
  if (analysis.probeQuestions.length) analysis.probeQuestions.forEach((q, i) => body.push(bullet(q, `${i + 1}.  `)));
  else body.push(emptyLine("No probe questions were generated."));
  body.push(EMPTY_PARA);

  // ── 9. Overall recap ──
  body.push(sectionTitle(9, "Overall recap"));
  if (analysis.riskNarrative?.trim()) {
    for (const raw of analysis.riskNarrative.split(/\n/)) {
      const line = raw.trim(); if (!line) continue;
      const b = line.match(/^[-*]\s+(.*)$/);
      body.push(b ? para(run("•  ", { sz: 20 }) + mdRuns(b[1], { sz: 20 }), { indentLeft: 360, hanging: 240, spaceAfter: 40 }) : para(mdRuns(line, { sz: 20 }), { spaceAfter: 60 }));
    }
  } else {
    body.push(emptyLine("No recap was generated."));
  }
  body.push(EMPTY_PARA);

  // ── 10. References ──
  body.push(sectionTitle(10, "References"));
  if (analysis.referencesUsed.length) for (const r of analysis.referencesUsed) body.push(para(run(`•  ${r}`, { sz: 18, color: "1D4ED8" }), { indentLeft: 360, spaceAfter: 16 }));
  else body.push(emptyLine("No knowledge base documents were cited."));
  if (analysis.adverseNews?.sources?.length) for (const s of analysis.adverseNews.sources.slice(0, 8)) body.push(para(run(`•  ${s.title} (external) — ${s.uri}`, { sz: 16, color: "1D4ED8" }), { indentLeft: 360, spaceAfter: 16 }));

  // ── Disclaimer ──
  body.push(
    para(
      run(
        "Decision support only — this assessment does not approve, decline or score the facility. Credit authority remains with the credit manager. Verify every finding against the cited source before acting.",
        { i: true, sz: 16, color: "94A3B8" },
      ),
      { spaceBefore: 200 },
    ),
  );

  const sectPr =
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
    `<w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body.join("")}${sectPr}</w:body></w:document>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;

const RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

/** Build the .docx as a Blob. PizZip is lazy-imported to keep it out of the initial bundle. */
export async function buildCreditRiskDocx(
  analysis: CreditRiskAnalysis,
  meta: CreditDocxMeta,
): Promise<Blob> {
  const PizZip = (await import("pizzip")).default;
  const zip = new PizZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", buildDocumentXml(analysis, meta));
  const buf = zip.generate({ type: "arraybuffer", compression: "DEFLATE" });
  return new Blob([buf], { type: DOCX_MIME });
}

/** Build and trigger a browser download of the .docx. */
export async function downloadCreditRiskDocx(
  analysis: CreditRiskAnalysis,
  meta: CreditDocxMeta,
): Promise<void> {
  const blob = await buildCreditRiskDocx(analysis, meta);
  const safe = (meta.borrowerName || "credit-risk").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Credit Risk Alert - ${safe || "report"}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
