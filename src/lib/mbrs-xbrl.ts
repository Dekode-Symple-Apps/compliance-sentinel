// Deterministic MbrsExtraction → XBRL instance document generator.
//
// Every concept name, context id and unit ref comes from the template derived
// from a real SSM filing (mbrs-template.ts). Nothing here is model-generated,
// which is the whole point: an LLM asked to emit XBRL directly will invent
// plausible-looking tags that SSM silently rejects.

import { TEMPLATE_FACTS, TEMPLATE_CONTEXTS, type TemplateFact } from "./mbrs-template";
import { normalizeExtraction, type MbrsExtraction } from "./mbrs";
import { MBRS_CALC, MBRS_CALC_LABELS } from "./mbrs-calc";

const XBRL_HEADER = `<?xml version="1.0" encoding="utf-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:ifrs-smes="https://xbrl.ifrs.org/taxonomy/2022-03-24/ifrs-smes" xmlns:ifrs-full="https://xbrl.ifrs.org/taxonomy/2022-03-24/ifrs-full" xmlns:ssmt-dei="http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-dei-core" xmlns:ssmt-dei-ee-mpers="http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-dei-ee-mpers" xmlns:ssmt-dei-ee-mfrs="http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-dei-ee-mfrs" xmlns:ssmt="http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-cor" xmlns:ssmt-mpers="http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-mpers-cor" xmlns:ssmt-mfrs="http://xbrl.ssm.com.my/taxonomy/2022-12-31/ssmt-mfrs-cor" id="MBRS_Preparation_Tool_2.2">
  <link:schemaRef xlink:type="simple" xlink:href="https://mbrs.ssm.com.my/taxonomy/SSMxT2022v1.0/rep/ssm/ca-2016/fs/mpers/ssmt-fs-mpers_2022-12-31_entry_point.xsd"/>`;

const UNITS = `  <xbrli:unit id="MYR">
    <xbrli:measure>iso4217:MYR</xbrli:measure>
  </xbrli:unit>
  <xbrli:unit id="PURE">
    <xbrli:measure>xbrli:pure</xbrli:measure>
  </xbrli:unit>
  <xbrli:unit id="share">
    <xbrli:measure>xbrli:shares</xbrli:measure>
  </xbrli:unit>`;

/** Escape for ELEMENT TEXT. Quotes are deliberately left literal — XML only
 *  requires them escaped inside attribute values, and the narrative blocks are
 *  quote-dense escaped HTML, so escaping them here diverges from what SSM's
 *  own tool emits. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape for ATTRIBUTE VALUES, where quotes must be encoded. */
function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}

/** yyyy-mm-dd → yyyymmdd, the form used inside context ids. */
function compact(iso: string): string {
  return iso.replace(/-/g, "");
}

/** The instant one day before `iso` — the opening balance date for the
 *  comparative year's statement of changes in equity. */
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

interface TokenMap {
  [token: string]: string;
}

function buildTokens(x: MbrsExtraction): TokenMap {
  const cs = String(x.entity.currentPeriodStart ?? "").trim();
  const ce = String(x.entity.currentPeriodEnd ?? "").trim();
  const ps = String(x.entity.previousPeriodStart ?? "").trim();
  const pe = String(x.entity.previousPeriodEnd ?? "").trim();
  const ppe = ps ? dayBefore(ps) : "";
  return {
    "{CS}": compact(cs), "{CE}": compact(ce),
    "{PS}": compact(ps), "{PE}": compact(pe), "{PPE}": compact(ppe),
    "{CS-}": cs, "{CE-}": ce,
    "{PS-}": ps, "{PE-}": pe, "{PPE-}": ppe,
    "{ENTITY}": String(x.entity.registrationNumber ?? "").trim(),
  };
}

function resolveTokens(s: string, tokens: TokenMap): string {
  return s.replace(/\{[A-Z]+-?\}/g, (m) => tokens[m] ?? m);
}

/**
 * SSM's tool emits every narrative disclosure as a self-contained XHTML
 * document, and its validator expects that envelope. We were emitting bare
 * `<p>` fragments, which is structurally wrong even when the text is right.
 */
function wrapNarrative(body: string): string {
  if (!body.trim()) return "";
  if (body.trimStart().startsWith("<?xml")) return body;
  return [
    '<?xml version="1.0" ?>',
    '<html xmlns="http://www.w3.org/1999/xhtml">',
    "<head>",
    "<title></title>",
    "</head>",
    "<body style=\"font-family:'Arial';font-size:12pt;text-align:left;\">",
    body,
    "</body>",
    "</html>",
  ].join("\n");
}

const TAG_FACE_CTX = new Set(["asof_{CE}_SeparateMember", "asof_{PE}_SeparateMember"]);

function factValue(f: TemplateFact, x: MbrsExtraction): string | null {
  if (f.narrative) {
    const v = x.narratives?.[f.c];
    return typeof v === "string" ? wrapNarrative(v) : "";
  }
  if (f.rpt) {
    const row = x.rptGrid?.[f.c];
    if (row) {
      const v = f.rpt === "total" ? Object.values(row).reduce((a, b) => a + b, 0) : row[f.rpt];
      if (typeof v === "number" && Number.isFinite(v)) return String(Math.round(v * 100) / 100);
      // The note was read and names no amount for this party: fall through to
      // the slot's own field or literal (a donor's structural 0).
    }
  }
  // A reconciled note breakdown beats a named field for the same concept and
  // period on the face contexts it was reconciled in.
  if (f.tagOverride || (f.field && f.period && TAG_FACE_CTX.has(f.ctx ?? ""))) {
    const v = x.tagged?.[f.c]?.[f.period ?? "current"];
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  if (f.tagged) {
    const v = x.tagged?.[f.c]?.[f.period ?? "current"];
    return typeof v === "number" && Number.isFinite(v) ? String(v) : null;
  }
  if (f.field) {
    if (f.period) {
      const bag: Record<string, number | null> =
        f.period === "current" ? x.current : x.previous;
      const raw = bag?.[f.field];
      if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
      // Signs are carried in the canonical values exactly as the statement
      // prints them, so nothing is flipped here. Net-outflow lines stay
      // negative; gross "purchase of" lines stay positive.
      return String(raw);
    }
    const v = x.entity?.[f.field];
    // A defaulted declaration keeps its old literal for when the report is silent.
    return typeof v === "string" && v.trim() ? v.trim() : (f.v ?? null);
  }
  // No field, no narrative and no literal: the box exists in the template but
  // nothing is bound to it yet. Skip it — an empty element is not a valid fact.
  return f.v ?? null;
}

function renderContexts(used: Set<string>, tokens: TokenMap): string {
  const out: string[] = [];
  for (const [tokId, def] of Object.entries(TEMPLATE_CONTEXTS)) {
    if (!used.has(tokId)) continue;
    const id = resolveTokens(tokId, tokens);
    const period = def.i
      ? `      <xbrli:instant>${resolveTokens(def.i, tokens)}</xbrli:instant>`
      : `      <xbrli:startDate>${resolveTokens(def.s ?? "", tokens)}</xbrli:startDate>\n` +
        `      <xbrli:endDate>${resolveTokens(def.e ?? "", tokens)}</xbrli:endDate>`;

    let scenario = "";
    const bits: string[] = [];
    for (const [axis, member] of def.dims ?? []) {
      bits.push(`      <xbrldi:explicitMember dimension="${axis}">${member}</xbrldi:explicitMember>`);
    }
    for (const [axis, el, val] of def.typed ?? []) {
      bits.push(
        `      <xbrldi:typedMember dimension="${axis}">\n` +
        `        <${el}>${esc(val)}</${el}>\n` +
        `      </xbrldi:typedMember>`,
      );
    }
    if (bits.length) {
      scenario = `\n    <xbrli:scenario>\n${bits.join("\n")}\n    </xbrli:scenario>`;
    }

    out.push(
      `  <xbrli:context id="${id}">\n` +
      `    <xbrli:entity>\n` +
      `      <xbrli:identifier scheme="https://www.ssm.com.my/">${escAttr(tokens["{ENTITY}"])}</xbrli:identifier>\n` +
      `    </xbrli:entity>\n` +
      `    <xbrli:period>\n${period}\n    </xbrli:period>${scenario}\n` +
      `  </xbrli:context>`,
    );
  }
  return out.join("\n");
}

export interface CalcInconsistency {
  /** SSM calculation role the relationship comes from, e.g. "200200". */
  role: string;
  parent: string;
  /** SSM's label for the total, and for each part that was summed. */
  parentLabel: string;
  childLabels: string[];
  /** Which year the check failed for, when the context is a plain one. */
  period?: "current" | "previous";
  context: string;
  reported: number;
  /** Weighted sum of the children that were reported in the same context. */
  summed: number;
  children: string[];
}

export interface GenerateResult {
  xml: string;
  /** Facts actually written. */
  factCount: number;
  /** Template facts skipped because the extraction had no value for them. */
  skipped: string[];
  /** Totals the instance reports that do not equal the sum of the parts it
   *  also reports, per SSM's own calculation linkbase — the consistency check
   *  an XBRL validator runs on submission. */
  calcInconsistencies: CalcInconsistency[];
}

/**
 * XBRL 2.1 summation check over the facts actually written: wherever a total
 * and at least one of its contributing items are both reported in the same
 * context, the weighted sum of the reported items must equal the total. Items
 * the instance does not report are simply not counted — that is the spec's
 * rule, and it is also why a partly-broken-down total fails: SSM sees the
 * parts that are there and they do not add up.
 */
function checkCalculations(facts: Map<string, number>, currentEnd: string): CalcInconsistency[] {
  const groups = new Map<string, { role: string; parent: string; kids: [string, number][] }>();
  for (const [role, parent, child, w] of MBRS_CALC) {
    const k = `${role}|${parent}`;
    const g = groups.get(k) ?? { role, parent, kids: [] };
    g.kids.push([child, w]);
    groups.set(k, g);
  }
  const byConceptCtx = new Map<string, Map<string, number>>();
  for (const [key, v] of facts) {
    const [c, ctx] = key.split("\u0000");
    const m = byConceptCtx.get(c) ?? new Map<string, number>();
    m.set(ctx, v);
    byConceptCtx.set(c, m);
  }
  const out: CalcInconsistency[] = [];
  const seen = new Set<string>();
  for (const g of groups.values()) {
    const parentFacts = byConceptCtx.get(g.parent);
    if (!parentFacts) continue;
    for (const [ctx, reported] of parentFacts) {
      let summed = 0;
      const present: string[] = [];
      for (const [child, w] of g.kids) {
        const v = byConceptCtx.get(child)?.get(ctx);
        if (v === undefined) continue;
        summed += Math.round(v) * w;
        present.push(child);
      }
      if (!present.length) continue;
      // decimals="0": each value rounds to the unit; allow for that rounding
      // across the items summed.
      if (Math.abs(Math.round(reported) - summed) <= Math.max(1, present.length / 2)) continue;
      const key = `${g.parent}|${ctx}|${present.sort().join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        role: g.role, parent: g.parent, context: ctx, reported: Math.round(reported), summed, children: present,
        parentLabel: MBRS_CALC_LABELS[g.parent] ?? g.parent.split(":")[1],
        childLabels: present.map((c) => MBRS_CALC_LABELS[c] ?? c.split(":")[1]),
        period: currentEnd && ctx.includes(currentEnd) ? "current" : "previous",
      });
    }
  }
  return out;
}

export function generateMbrsXbrl(input: MbrsExtraction): GenerateResult {
  const x = normalizeExtraction(input);
  const tokens = buildTokens(x);

  const rendered: string[] = [];
  const usedContexts = new Set<string>();
  const skipped: string[] = [];
  const numeric = new Map<string, number>();

  for (const f of TEMPLATE_FACTS) {
    const value = factValue(f, x);
    if (value === null) {
      skipped.push(f.field ? `${f.c} (${f.field}/${f.period ?? "entity"})` : f.c);
      continue;
    }
    if (f.ctx) usedContexts.add(f.ctx);
    const attrs = [
      f.ctx ? `contextRef="${resolveTokens(f.ctx, tokens)}"` : "",
      f.u ? `unitRef="${f.u}"` : "",
      f.d ? `decimals="${f.d}"` : "",
    ].filter(Boolean).join(" ");
    const body = f.v !== undefined && !f.field && !f.narrative
      ? esc(resolveTokens(value, tokens))
      : esc(value);
    rendered.push(`  <${f.c} ${attrs}>${body}</${f.c}>`);
    if (f.u === "MYR") {
      const n = Number(value);
      if (Number.isFinite(n)) numeric.set(`${f.c}\u0000${f.ctx ? resolveTokens(f.ctx, tokens) : ""}`, n);
    }
  }

  const xml = [
    XBRL_HEADER,
    renderContexts(usedContexts, tokens),
    UNITS,
    rendered.join("\n"),
    "</xbrli:xbrl>",
  ].join("\n");

  return {
    xml, factCount: rendered.length, skipped,
    calcInconsistencies: checkCalculations(numeric, compact(String(x.entity.currentPeriodEnd ?? "").trim())),
  };
}

/** Filename SSM's portal expects: SSM_<submission>_<regno>_<yyyymmdd>.xml */
export function mbrsFilename(x: MbrsExtraction): string {
  const reg = String(x.entity.registrationNumber ?? "unknown").trim();
  const end = compact(String(x.entity.currentPeriodEnd ?? "").trim());
  return `SSM_FS-MPERS_${reg}_${end}.xml`;
}
