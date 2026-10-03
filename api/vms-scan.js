// Quarterly vendor adverse-news scan (Vercel cron, runs outside the SSR handler).
// Weekly, it scans the approved vendors whose last scan is three months old or
// more — so each vendor is scanned once a quarter and the work is spread out.
// Kept in step with scanVendor() in src/lib/vms.functions.ts and
// searchAdverseNews() in src/lib/gemini.ts (same prompt, same stored shape).
// Security: Vercel sends "Authorization: Bearer $CRON_SECRET"; without the
// secret set, the function does nothing.
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

export const config = { runtime: "nodejs" };

const SCAN_MONTHS = 3;
const PER_RUN = 15;

function due(v, today) {
  const last = v.adverse_news?.last_scan_at;
  if (!["approved", "conditional"].includes(v.status)) return false;
  if (!last) return true;
  const next = new Date(last); next.setMonth(next.getMonth() + SCAN_MONTHS);
  return next <= today;
}

async function search(ai, v) {
  const directors = (v.directors ?? []).map((d) => d.name).filter(Boolean).slice(0, 4);
  const targets = [v.name, ...directors];
  const prompt = `You are a credit-risk analyst running an ADVERSE-NEWS / negative screening check. Using web search, look for MATERIAL adverse information about these entities and their key people:
${targets.map((t) => `- ${t}`).join("\n")}

Context (to identify the right entities/people): Malaysian company${v.registration_no ? `, SSM ${v.registration_no}` : ""}, a vendor to a construction group. Directors: ${directors.join(", ") || "not known"}.

Search specifically for: litigation / lawsuits, winding-up / insolvency / default, fraud or financial crime, regulatory or enforcement action, criminal charges, major operational failures, or significant negative press bearing on creditworthiness.

Write a concise MARKDOWN briefing:
- First line: the overall finding — exactly one of "Material adverse news found", "No material adverse news found", or "Inconclusive".
- Then 0-6 bullets, each: **entity** — what was found, the date, and why it matters to credit risk.
- Only CREDIBLE, on-point items — no speculation or padding. If nothing material is found, say so and note what was checked.`;
  let response, lastErr;
  for (const model of ["gemini-3.7-flash", "gemini-3.5-flash"]) {
    try {
      response = await ai.models.generateContent({ model, contents: [{ role: "user", parts: [{ text: prompt }] }], config: { tools: [{ googleSearch: {} }], maxOutputTokens: 2048 } });
      break;
    } catch (e) { lastErr = e; }
  }
  if (!response) throw lastErr ?? new Error("search failed");
  const summary = (response.text ?? "").trim();
  const sources = [];
  const seen = new Set();
  for (const c of response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
    const uri = c?.web?.uri;
    if (uri && !seen.has(uri)) { seen.add(uri); sources.push({ title: String(c?.web?.title ?? uri), uri: String(uri) }); }
  }
  const found = /material adverse news found/i.test(summary) && !/no material adverse/i.test(summary);
  return { summary, sources, found };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorised" });
    return;
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const gkey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!url || !key || !gkey) { res.status(500).json({ error: "not configured" }); return; }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const ai = new GoogleGenAI({ apiKey: gkey });
  const today = new Date();
  const { data: vendors, error } = await db.from("ccms_vendors").select("*").in("status", ["approved", "conditional"]);
  if (error) { res.status(500).json({ error: error.message }); return; }
  const todo = (vendors ?? []).filter((v) => due(v, today)).slice(0, PER_RUN);
  let scanned = 0, found = 0;
  for (const v of todo) {
    try {
      const r = await search(ai, v);
      const next = new Date(today); next.setMonth(next.getMonth() + SCAN_MONTHS);
      await db.from("ccms_vendors").update({ adverse_news: {
        last_scan_at: today.toISOString(), next_scan_at: next.toISOString().slice(0, 10), found: r.found,
        summary: r.summary.slice(0, 3000), sources: r.sources.slice(0, 8), status: r.found ? "to_review" : "clear", reviewed_by: null,
      } }).eq("id", v.id);
      await db.from("vms_events").insert({ vendor_id: v.id, event_type: "scan", actor_name: "Platform (quarterly scan)",
        detail: r.found ? "Adverse-news scan: possible adverse news — to review." : "Adverse-news scan: nothing material found." });
      scanned++; if (r.found) found++;
    } catch (e) {
      console.error("[vms-scan]", v.name, e?.message ?? e);
    }
  }
  res.status(200).json({ scanned, found, due: (vendors ?? []).filter((v) => due(v, today)).length - scanned });
}
