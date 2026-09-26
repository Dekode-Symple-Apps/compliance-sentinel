// Word comments anchored to an exact passage — the review's findings and
// threads written into a copy of the draft, without touching its wording.
//
// Each comment's range covers exactly the quoted words: the runs at either end
// are split at the character boundary (same formatting on both halves), and
// commentRangeStart / commentRangeEnd are placed between runs. A quote that
// cannot be found falls back to the paragraph it most loosely matches, then
// to the first paragraph, marked as such — a comment is never dropped.

import PizZip from "pizzip";
import { attachComments, buildCommentEntry, escapeXml, getParagraphText } from "./docx-editor";
import { foldMatchGlyphs } from "./simplify";

export interface AnchoredComment {
  /** Verbatim-ish text in the document to attach to; empty = whole document. */
  quote: string;
  /** Fallback anchor (e.g. a clause heading) when the quote isn't found. */
  fallback?: string;
  text: string;
  author: string;
  dateIso: string;
  done?: boolean;
}

const PARA_RE = /<w:p\b(?![A-Za-z])[^>]*>(?:(?!<w:p\b(?![A-Za-z]))[\s\S])*?<\/w:p>/g;
const RUN_RE = /<w:r(?=[\s>])[^>]*>[\s\S]*?<\/w:r>/g;

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The text a run contributes, and whether it is a plain single-<w:t> run
 *  that can be split at a character position. */
function runInfo(run: string): { text: string; simple: boolean } {
  const ts = [...run.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
  const tabs = (run.match(/<w:tab\b[^>]*\/>/g) ?? []).length;
  const brs = (run.match(/<w:br\b[^>]*\/>/g) ?? []).length;
  const text = ts.map((m) => unescape(m[1])).join("") + " ".repeat(tabs + brs);
  return { text, simple: ts.length === 1 && tabs + brs === 0 };
}

/** Folded (case, quotes, dashes, whitespace) copy of `raw` with a map from
 *  each folded character back to its raw index. */
function foldWithMap(raw: string): { s: string; map: number[] } {
  let s = ""; const map: number[] = []; let lastSpace = true;
  for (let i = 0; i < raw.length; i++) {
    const f = foldMatchGlyphs(raw[i]).toLowerCase();
    if (!f) continue;
    if (/\s/.test(f)) { if (lastSpace) continue; s += " "; map.push(i); lastSpace = true; continue; }
    for (const ch of f) { s += ch; map.push(i); }
    lastSpace = false;
  }
  return { s, map };
}
const fold = (t: string) => foldWithMap(t).s.trim();

/** Split a simple run at `at` characters into two runs with the same rPr. */
function splitRun(run: string, at: number): [string, string] {
  const open = run.match(/^<w:r(?=[\s>])[^>]*>/)![0];
  const rPr = run.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
  const text = runInfo(run).text;
  const mk = (t: string) => `${open}${rPr}<w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r>`;
  return [mk(text.slice(0, at)), mk(text.slice(at))];
}

/** Wrap [start, end) of the paragraph's run text in a comment range. */
function wrapSpan(para: string, start: number, end: number, id: number): string {
  // Split at `end` first so `start`'s offsets stay valid.
  for (const cut of [end, start]) {
    let pos = 0; let out = ""; let last = 0; let done = false;
    for (const m of para.matchAll(RUN_RE)) {
      const info = runInfo(m[0]);
      const a = pos, b = pos + info.text.length;
      if (!done && cut > a && cut < b && info.simple) {
        const [x, y] = splitRun(m[0], cut - a);
        out += para.slice(last, m.index) + x + y;
        last = m.index! + m[0].length; done = true;
      }
      pos = b;
    }
    para = out + para.slice(last);
  }
  // Place markers: before the first run that starts at/after `start` (or the
  // run containing it, if it could not be split), after the run reaching `end`.
  let pos = 0; let startAt = -1; let endAt = -1;
  for (const m of para.matchAll(RUN_RE)) {
    const len = runInfo(m[0]).text.length;
    const a = pos, b = pos + len;
    if (startAt < 0 && b > start) startAt = m.index!;
    if (a < end) endAt = m.index! + m[0].length;
    pos = b;
  }
  if (startAt < 0 || endAt < 0) return wrapWholeParagraph(para, id);
  const ref = `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`;
  return para.slice(0, startAt) + `<w:commentRangeStart w:id="${id}"/>` + para.slice(startAt, endAt) +
    `<w:commentRangeEnd w:id="${id}"/>${ref}` + para.slice(endAt);
}

function wrapWholeParagraph(para: string, id: number): string {
  const head = para.match(/^<w:p\b[^>]*>(?:<w:pPr\b[\s\S]*?<\/w:pPr>)?/)![0];
  const inner = para.slice(head.length, para.length - "</w:p>".length);
  return head + `<w:commentRangeStart w:id="${id}"/>` + inner + `<w:commentRangeEnd w:id="${id}"/>` +
    `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r></w:p>`;
}

/** Where `quote` sits: the paragraph and the raw character span inside its
 *  run text. Exact (folded) match only; null if absent. */
function locate(xml: string, quote: string): { pIndex: number; pLen: number; start: number; end: number } | null {
  const q = fold(quote);
  if (q.length < 3) return null;
  for (const m of xml.matchAll(PARA_RE)) {
    const runText = [...m[0].matchAll(RUN_RE)].map((r) => runInfo(r[0]).text).join("");
    const { s, map } = foldWithMap(runText);
    const at = s.indexOf(q);
    if (at < 0) continue;
    return { pIndex: m.index!, pLen: m[0].length, start: map[at], end: map[at + q.length - 1] + 1 };
  }
  return null;
}

/** First paragraph whose text contains the fallback, or whose text shares the
 *  quote's first words — the loose tier. */
function locateLoose(xml: string, c: AnchoredComment): { pIndex: number; pLen: number } | null {
  const tries = [c.fallback, c.quote.split(/\s+/).slice(0, 6).join(" ")].filter((x): x is string => !!x && x.trim().length > 3);
  for (const t of tries) {
    const f = fold(t);
    for (const m of xml.matchAll(PARA_RE)) if (fold(getParagraphText(m[0])).includes(f)) return { pIndex: m.index!, pLen: m[0].length };
  }
  return null;
}

export function addAnchoredCommentsToDocx(
  source: Buffer,
  comments: AnchoredComment[],
): { buffer: Buffer; exact: number; loose: number; unplaced: number } {
  const zip = new PizZip(source);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Not a Word document (no word/document.xml).");
  let xml = docFile.asText();

  // Number past any comments the draft already carries.
  const existing = zip.file("word/comments.xml")?.asText() ?? "";
  let nextId = Math.max(-1, ...[...existing.matchAll(/<w:comment\b[^>]*w:id="(\d+)"/g)].map((m) => Number(m[1]))) + 1;

  const entries: string[] = []; const paraIds: string[] = []; const done: boolean[] = [];
  let exact = 0, loose = 0, unplaced = 0;
  for (const c of comments) {
    const id = nextId++;
    let text = c.text;
    // A quote spanning two paragraphs (a letterhead, a heading and its first
    // line) cannot match one paragraph: try its longest line on its own.
    const lines = c.quote.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 3).sort((a, b) => b.length - a.length);
    const hit = c.quote ? (locate(xml, c.quote) ?? (lines.length > 1 ? locate(xml, lines[0]) : null)) : null;
    if (hit) {
      const para = xml.slice(hit.pIndex, hit.pIndex + hit.pLen);
      xml = xml.slice(0, hit.pIndex) + wrapSpan(para, hit.start, hit.end, id) + xml.slice(hit.pIndex + hit.pLen);
      exact++;
    } else {
      const lp = locateLoose(xml, c);
      const first = [...xml.matchAll(PARA_RE)].find((m) => getParagraphText(m[0]));
      const target = lp ?? (first ? { pIndex: first.index!, pLen: first[0].length } : null);
      if (!target) { unplaced++; continue; }
      if (lp) loose++;
      else { unplaced++; text = `[Could not locate the passage in this copy]\n${text}`; }
      const para = xml.slice(target.pIndex, target.pIndex + target.pLen);
      xml = xml.slice(0, target.pIndex) + wrapWholeParagraph(para, id) + xml.slice(target.pIndex + target.pLen);
    }
    const pid = (0x10000000 + id * 7919).toString(16).toUpperCase().slice(-8);
    entries.push(buildCommentEntry(id, text, c.author, c.dateIso, pid));
    paraIds.push(pid); done.push(!!c.done);
  }
  zip.file("word/document.xml", xml);
  attachComments(zip, entries, paraIds, done);
  return { buffer: zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer, exact, loose, unplaced };
}
