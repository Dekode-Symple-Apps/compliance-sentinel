import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { runCreditRiskAnalysis, backfillCreditSections } from "@/lib/compliance.functions";
import {
  CREDIT_RISK_SEGMENTS,
  type CreditRiskAnalysis,
  type CreditRiskIndicator,
  type CreditRiskFinding,
  type FinancialRatio,
} from "@/lib/gemini";
import { downloadCreditRiskDocx } from "@/lib/credit-docx";
import { PdfHighlight } from "@/components/pdf-highlight";
import { CreditChat } from "@/components/credit-chat";
import Markdown from "react-markdown";
import { formatDate } from "@/lib/format";
import { computeCost, formatUsd, formatTokens, type TokenUsage } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft,
  MessageSquare,
  Loader2,
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  FileText,
  Info,
  Coins,
  Download,
  CheckCircle2,
  XCircle,
  CircleDot,
  BookOpen,
  ExternalLink,
  X,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/credit/$reportId")({
  component: CreditReportPage,
  errorComponent: ({ error }) => (
    <AppShell>
      <div className="p-10 text-sm text-destructive">{error.message}</div>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell>
      <div className="p-10">Report not found.</div>
    </AppShell>
  ),
});

// ── presentation maps ────────────────────────────────────────────────────────
// Colour lives only in the indicator badges (the traffic light FR-5.02 asks
// for) and the accent on the active nav item. Every surface is white.

const IND_META: Record<
  CreditRiskIndicator,
  { label: string; short: string; classes: string; dot: string; icon: typeof ShieldAlert; rank: number }
> = {
  high: { label: "High risk", short: "High", classes: "bg-rose-100 text-rose-800 border-rose-200", dot: "bg-rose-500", icon: ShieldAlert, rank: 0 },
  probe: { label: "Probe", short: "Probe", classes: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500", icon: ShieldQuestion, rank: 1 },
  low: { label: "Low", short: "Low", classes: "bg-emerald-100 text-emerald-800 border-emerald-200", dot: "bg-emerald-500", icon: ShieldCheck, rank: 2 },
};

const ALERT_META: Record<"pass" | "fail" | "probe", { label: string; classes: string; icon: typeof CheckCircle2 }> = {
  pass: { label: "Compliant", classes: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
  fail: { label: "Fail", classes: "bg-rose-100 text-rose-800 border-rose-200", icon: XCircle },
  probe: { label: "Probe", classes: "bg-amber-100 text-amber-800 border-amber-200", icon: CircleDot },
};

const RATIO_FLAG: Record<FinancialRatio["flag"], { label: string; classes: string }> = {
  adverse: { label: "Adverse", classes: "bg-rose-100 text-rose-800 border-rose-200" },
  watch: { label: "Watch", classes: "bg-amber-100 text-amber-800 border-amber-200" },
  ok: { label: "Within policy", classes: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  none: { label: "—", classes: "bg-white text-muted-foreground border-transparent" },
};

const FIN_SEV: Record<"high" | "medium" | "low", { label: string; classes: string }> = {
  high: { label: "High", classes: "bg-rose-100 text-rose-800 border-rose-200" },
  medium: { label: "Medium", classes: "bg-amber-100 text-amber-800 border-amber-200" },
  low: { label: "Low", classes: "bg-white text-slate-700 border-slate-300" },
};

/** The ten sections of the assessment, in the order the specification fixes
 *  (FR-7.01). Every section renders every time; an empty one says so. */
const SECTIONS = [
  { id: "overview", label: "Application overview" },
  { id: "risks", label: "Risk alerts" },
  { id: "mitigations", label: "Suggested mitigations" },
  { id: "financial", label: "Financial analysis" },
  { id: "policy", label: "Policy check" },
  { id: "industry", label: "Industry assessment" },
  { id: "adverse", label: "Adverse news" },
  { id: "probes", label: "Questions for probe" },
  { id: "recap", label: "Overall recap" },
  { id: "references", label: "References" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

// Shared table styling: white header with a heavier rule, no row tint.
const TH = "bg-white text-xs uppercase tracking-wide text-muted-foreground font-semibold h-9";
const TR_HEAD = "bg-white hover:bg-white border-b-2";
const TR = "bg-white hover:bg-white align-top";

// ── helpers ────────────────────────────────────────────────────────────────

/** Strip the noisy "Hong Leong Bank Berhad Mail Fwd/Re" prefix from KB titles. */
function cleanCaseTitle(t: string): string {
  return t.replace(/^hong leong bank berhad mail (fwd|re)\s*/i, "").replace(/\s{2,}/g, " ").trim() || t;
}

/** Split "<observation>. This mirrors [Case XX] logic, which warns that <lesson>." */
function splitFinding(finding: string): { observation: string; lesson: string } {
  const idx = finding.search(/this mirrors/i);
  if (idx === -1) return { observation: finding.trim(), lesson: "" };
  const observation = finding.slice(0, idx).trim().replace(/[.\s]+$/, "");
  const rest = finding.slice(idx);
  const warnIdx = rest.search(/which warns that/i);
  let lesson = warnIdx === -1 ? "" : rest.slice(warnIdx + "which warns that".length).trim();
  lesson = lesson.replace(/^[,:\s]+/, "");
  if (lesson) lesson = lesson.charAt(0).toUpperCase() + lesson.slice(1);
  return { observation: observation || finding.trim(), lesson };
}

/** One line for the table; one sentence for "why it matters". Older reports
 *  carry neither field, so both fall back to splitting the finding text. */
function findingLines(f?: CreditRiskFinding): { line: string; why: string } {
  if (!f) return { line: "Nothing to report for this category.", why: "" };
  const { observation, lesson } = splitFinding(f.finding);
  return { line: f.headline?.trim() || observation, why: f.whyItMatters?.trim() || lesson };
}

/** Bold the match terms inside a block of text (case-insensitive, exact term). */
function Highlighted({ text, terms }: { text: string; terms?: string[] }) {
  const clean = (terms ?? []).map((t) => t.trim()).filter((t) => t.length >= 2);
  if (!text) return null;
  if (clean.length === 0) return <>{text}</>;
  const escaped = clean.sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        p && clean.some((t) => t.toLowerCase() === p.toLowerCase()) ? (
          <mark key={i} className="bg-transparent font-semibold underline decoration-amber-500 decoration-2 underline-offset-2">{p}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** The executive-summary markdown, split into the parts the recap shows
 *  separately: the verdict, the key concerns, the mitigants. */
function parseNarrative(md: string): { lead: string; concerns: string[]; mitigants: string[] } {
  const lead: string[] = [], concerns: string[] = [], mitigants: string[] = [];
  let mode: "lead" | "concerns" | "mitigants" = "lead";
  for (const raw of (md || "").split(/\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (/^\*\*\s*key concern/i.test(l)) { mode = "concerns"; continue; }
    if (/^\*\*\s*mitigant/i.test(l)) { mode = "mitigants"; continue; }
    const b = l.match(/^[-*]\s+(.*)$/);
    if (mode === "lead") lead.push(l);
    else if (b) (mode === "concerns" ? concerns : mitigants).push(b[1]);
  }
  return { lead: lead.join(" "), concerns, mitigants };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NARRATIVE_MD: any = {
  p: ({ children }: any) => <p className="mb-3">{children}</p>,
  ul: ({ children }: any) => <ul className="list-disc pl-5 mb-3 space-y-1.5">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal pl-5 mb-3 space-y-1.5">{children}</ol>,
  li: ({ children }: any) => <li className="leading-snug">{children}</li>,
  strong: ({ children }: any) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }: any) => <em className="italic">{children}</em>,
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const INLINE_MD: any = { ...NARRATIVE_MD, p: ({ children }: any) => <span>{children}</span> };

// ── page ─────────────────────────────────────────────────────────────────────

function CreditReportPage() {
  const { reportId } = Route.useParams();
  const qc = useQueryClient();
  const runAnalysisFn = useServerFn(runCreditRiskAnalysis);
  const backfillFn = useServerFn(backfillCreditSections);
  const [analyzing, setAnalyzing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [filter, setFilter] = useState<"all" | CreditRiskIndicator>("all");
  const [evidence, setEvidence] = useState<{ finding: CreditRiskFinding; label: string } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [showLow, setShowLow] = useState(false);
  const [fullRecap, setFullRecap] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [active, setActive] = useState<SectionId>("overview");
  const startedRef = useRef(false);

  const report = useQuery({
    queryKey: ["credit_report", reportId],
    queryFn: async () => {
      const { data, error } = await supabase.from("analysis_reports").select("*").eq("id", reportId).single();
      if (error) throw error;
      return data;
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sj = ((report.data as any)?.summary_json ?? {}) as any;
  const analysis: CreditRiskAnalysis | undefined = sj.credit_analysis;

  /** Did the run actually land, regardless of what the HTTP call reported? A long
   *  analysis can outlive the request and still finish server-side; calling that
   *  a failure invites a re-run that bills the whole (~5-call) analysis twice. */
  async function runLanded(): Promise<boolean> {
    try {
      const { data, error } = await supabase.from("analysis_reports").select("summary_json").eq("id", reportId).single();
      if (error || !data) return false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = ((data.summary_json as any) ?? {}) as any;
      return !s.pending_analysis && !!s.credit_analysis && s.credit_status !== "failed";
    } catch { return false; }
  }

  async function runAnalysis() {
    setFailed(false); setAnalyzing(true); startedRef.current = true;
    try {
      await runAnalysisFn({ data: { reportId } });
      await qc.invalidateQueries({ queryKey: ["credit_report", reportId] });
    } catch (e: any) {
      if (await runLanded()) await qc.invalidateQueries({ queryKey: ["credit_report", reportId] });
      else { setFailed(true); toast.error("Credit risk analysis didn't finish", { description: e?.message?.slice(0, 200) }); }
    } finally { setAnalyzing(false); }
  }

  async function runBackfill() {
    if (backfilling) return;
    setBackfilling(true);
    try {
      const r = await backfillFn({ data: { reportId } });
      await qc.invalidateQueries({ queryKey: ["credit_report", reportId] });
      toast.success(r.updated.length ? "Report brought up to date" : "Nothing to add");
    } catch (e: any) {
      toast.error("Couldn't generate the missing sections", { description: e?.message?.slice(0, 200) });
    } finally { setBackfilling(false); }
  }

  useEffect(() => {
    if (startedRef.current) return;
    if (report.isLoading || !report.data) return;
    if (sj.pending_analysis) runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.isLoading, report.data]);

  // Section nav follows the scroll.
  useEffect(() => {
    if (!analysis) return;
    const els = SECTIONS.map((s) => document.getElementById(`sec-${s.id}`)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id.replace("sec-", "") as SectionId);
      },
      { rootMargin: "-120px 0px -60% 0px", threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [analysis]);

  async function handleDownload() {
    if (!analysis || downloading) return;
    setDownloading(true);
    try {
      await downloadCreditRiskDocx(analysis, {
        borrowerName: sj.borrower_name ?? (report.data as any)?.title ?? "Applicant",
        sourceFilename: sj.source_filename,
        generatedAt: formatDate(new Date().toISOString()),
      });
    } catch (e: any) {
      toast.error("Couldn't generate the Word document", { description: e?.message?.slice(0, 200) });
    } finally { setDownloading(false); }
  }

  const derived = useMemo(() => {
    if (!analysis) return null;
    const byKey = new Map(analysis.riskTable.map((f) => [f.segment, f] as const));
    const counts = { high: 0, probe: 0, low: 0 } as Record<CreditRiskIndicator, number>;
    for (const { key } of CREDIT_RISK_SEGMENTS) counts[byKey.get(key)?.indicator ?? "low"]++;
    const ordered = CREDIT_RISK_SEGMENTS.map(({ key, label }) => ({ key, label, finding: byKey.get(key) }));
    ordered.sort((a, b) => {
      const r = IND_META[a.finding?.indicator ?? "low"].rank - IND_META[b.finding?.indicator ?? "low"].rank;
      return r !== 0 ? r : (b.finding?.confidence ?? 0) - (a.finding?.confidence ?? 0);
    });
    const concerns = ordered.filter((o) => o.finding && (o.finding.indicator ?? "low") !== "low");
    const narrative = parseNarrative(analysis.riskNarrative || "");
    const missing = [
      !analysis.applicationFacts && "application facts",
      !analysis.financialRatios && "financial ratios",
      !analysis.industryAssessment && "industry assessment",
    ].filter(Boolean) as string[];
    return { counts, ordered, concerns, narrative, missing };
  }, [analysis]);

  if (report.isLoading) {
    return (
      <AppShell>
        <div className="p-8 space-y-4 animate-pulse bg-white min-h-screen">
          <div className="h-4 border rounded w-32" /><div className="h-8 border rounded w-2/5" /><div className="h-20 border rounded" /><div className="h-64 border rounded" />
        </div>
      </AppShell>
    );
  }
  if (!report.data) throw notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const title = ((report.data as any).title as string) ?? "Credit application";
  const borrower = sj.borrower_name ?? title;
  const runFailed = failed || sj.credit_status === "failed";
  const isAnalyzing = analyzing || (sj.pending_analysis && !startedRef.current);

  if (isAnalyzing) return <AppShell><CreditAnalyzingView borrower={borrower} failed={false} error={null} onRetry={runAnalysis} /></AppShell>;
  if (runFailed || !analysis || !derived) return <AppShell><CreditAnalyzingView borrower={borrower} failed error={sj.credit_error ?? null} onRetry={runAnalysis} /></AppShell>;

  const { counts, ordered, concerns, narrative, missing } = derived;
  const overall = IND_META[analysis.overallRisk] ?? IND_META.probe;
  const usage: TokenUsage | undefined = sj.usage;
  const facts = analysis.applicationFacts;
  const analysedAt = formatDate((report.data as any).created_at ?? new Date().toISOString());

  const openEvidence = (label: string, finding?: CreditRiskFinding) => { if (finding) setEvidence({ finding, label }); };
  /** From a "Case NN" mention in chat: close the chat, open that case. */
  const openCase = (caseRef: string) => {
    const n = caseRef.replace(/\D/g, "");
    const hit = ordered.find((o) => o.finding?.traceReference && new RegExp(`\\b${n}\\b`).test(o.finding.traceReference));
    if (hit?.finding) { setChatOpen(false); setEvidence({ finding: hit.finding, label: hit.label }); }
    else toast.message(`${caseRef} isn't cited by a finding in this assessment.`);
  };
  const jump = (id: SectionId) => { document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setActive(id); };
  const filterTo = (ind: CreditRiskIndicator) => { setFilter((f) => (f === ind ? "all" : ind)); jump("risks"); };

  const visibleRows = ordered.filter((o) => filter === "all" || (o.finding?.indicator ?? "low") === filter);
  const lowRows = visibleRows.filter((o) => (o.finding?.indicator ?? "low") === "low");
  const mainRows = visibleRows.filter((o) => (o.finding?.indicator ?? "low") !== "low");
  const rowsToShow = showLow || filter === "low" ? visibleRows : mainRows;

  const sectionCounts: Partial<Record<SectionId, number>> = {
    risks: counts.high + counts.probe,
    mitigations: concerns.filter((c) => (c.finding?.mitigations?.length ?? 0) > 0).length,
    financial: (analysis.financialRatios?.length ?? 0) + (analysis.financialAnomalies?.length ?? 0),
    policy: analysis.policyAlerts.filter((a) => a.status !== "pass").length,
    adverse: analysis.adverseNews?.foundConcerns ? analysis.adverseNews.sources?.length ?? 1 : 0,
    probes: analysis.probeQuestions.length,
    references: analysis.referencesUsed.length,
  };
  const ia = analysis.industryAssessment;

  return (
    <AppShell>
      <div className="bg-white min-h-screen text-foreground">
        {/* ── header: borrower, indicator, counts, facts, actions (FR-5.11, FR-7.07) ── */}
        <div className="sticky top-0 z-20 bg-white border-b">
          <div className="max-w-6xl mx-auto px-6 py-3">
            <Link to="/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3" /> All credit analyses
            </Link>
            <div className="flex items-center gap-4 mt-1">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl font-bold tracking-tight truncate">{borrower}</h1>
                  <Badge variant="outline" className={cn("font-bold text-xs uppercase tracking-wide", overall.classes)}>
                    <span className={cn("size-1.5 rounded-full mr-1.5", overall.dot)} /> Overall · {overall.label}
                  </Badge>
                  <span className="flex items-center gap-1.5">
                    <CountPill indicator="high" n={counts.high} active={filter === "high"} onClick={() => filterTo("high")} />
                    <CountPill indicator="probe" n={counts.probe} active={filter === "probe"} onClick={() => filterTo("probe")} />
                    <CountPill indicator="low" n={counts.low} active={filter === "low"} onClick={() => filterTo("low")} />
                  </span>
                </div>
                <div className="text-sm text-muted-foreground mt-1 flex items-center gap-x-3 flex-wrap">
                  {facts?.facilityAmount && <span className="font-semibold text-foreground">{facts.facilityAmount}</span>}
                  {facts?.facilityType && <span>{facts.facilityType}</span>}
                  {facts?.applicationDate && <span>Application {facts.applicationDate}</span>}
                  <span>Analysed {analysedAt}</span>
                  {usage && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="text-muted-foreground/60 hover:text-foreground" aria-label="Run details"><Info className="size-3.5" /></button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 text-sm bg-white"><CostBreakdown usage={usage} /></PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => setChatOpen(true)} className="gap-2 bg-white border-red-300 text-red-700 hover:bg-white hover:border-red-500">
                  <MessageSquare className="size-4" /> Ask AI
                </Button>
                <Button size="sm" onClick={handleDownload} disabled={downloading} className="gap-2 bg-red-600 hover:bg-red-700 text-white">
                  {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Download
                </Button>
                <Button variant="outline" size="sm" onClick={runAnalysis} className="gap-2 bg-white hover:bg-white"><RefreshCw className="size-4" /> Re-run</Button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-[12rem_minmax(0,1fr)] gap-8">
          {/* ── section nav ── */}
          <nav className="hidden md:block sticky top-[5.25rem] self-start max-h-[calc(100vh-5.25rem)] overflow-y-auto py-6 pr-4 border-r">
            <ol className="space-y-0.5">
              {SECTIONS.map((s, i) => {
                const n = sectionCounts[s.id]; const on = active === s.id;
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => jump(s.id)}
                      className={cn("w-full text-left flex items-center gap-2 px-2 py-1.5 text-sm border-l-2 -ml-px", on ? "border-red-600 text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground")}>
                      <span className="tabular-nums text-xs w-4 shrink-0 opacity-60">{i + 1}</span>
                      <span className="truncate">{s.label}</span>
                      {typeof n === "number" && n > 0 && <span className="ml-auto text-xs tabular-nums text-muted-foreground">{n}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {/* ── assessment ── */}
          <main className="py-6 space-y-10 min-w-0">
            {missing.length > 0 && (
              <div className="rounded-md border px-4 py-3 flex items-center gap-3 text-sm bg-white">
                <Sparkles className="size-4 text-amber-600 shrink-0" />
                <span>This report predates the current format — {missing.join(", ")} not yet generated.</span>
                <Button size="sm" variant="outline" onClick={runBackfill} disabled={backfilling} className="ml-auto gap-1.5 bg-white hover:bg-white">
                  {backfilling ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Generate missing sections
                </Button>
              </div>
            )}

            {/* 1. Application overview */}
            <Section id="overview" n={1} title="Application overview">
              {facts ? (
                <Frame>
                  <Table>
                    <TableBody>
                      {[
                        ["Borrower", facts.borrower || borrower],
                        ["Facility", facts.facilityType],
                        ["Amount", facts.facilityAmount],
                        ["Application date", facts.applicationDate],
                        ["Application type", facts.applicationType],
                        ["Segment", facts.segment],
                        ["Purpose", facts.purpose],
                      ].map(([k, v]) => (
                        <TableRow key={k} className={TR}>
                          <TableCell className="w-[12rem] text-sm font-semibold text-muted-foreground">{k}</TableCell>
                          <TableCell className={cn("text-sm", k === "Amount" && "font-semibold", !v && "text-muted-foreground")}>{v || "Not stated"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {facts.notFound.length > 0 && <p className="px-4 py-2 text-sm text-muted-foreground border-t">Not stated in the application: {facts.notFound.join(", ")}.</p>}
                </Frame>
              ) : (
                <Empty>Header facts not yet generated for this report.</Empty>
              )}
              <Disclosure open={showSummary} onToggle={() => setShowSummary((v) => !v)} label="Executive summary of the application">
                <p className="text-sm leading-relaxed whitespace-pre-wrap max-w-3xl">{analysis.applicationSummary || "—"}</p>
              </Disclosure>
            </Section>

            {/* 2. Risk alerts */}
            <Section id="risks" n={2} title="Risk alerts" sub="most significant first — click a row to see the evidence"
              aside={filter !== "all" ? (
                <button onClick={() => setFilter("all")} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  Showing {IND_META[filter].short.toLowerCase()} only · clear <X className="size-3.5" />
                </button>
              ) : null}>
              <Frame>
                <Table>
                  <TableHeader>
                    <TableRow className={TR_HEAD}>
                      <TableHead className={cn(TH, "w-[11rem]")}>Risk category</TableHead>
                      <TableHead className={cn(TH, "w-[6.5rem]")}>Indicator</TableHead>
                      <TableHead className={TH}>Finding</TableHead>
                      <TableHead className={cn(TH, "w-[13rem]")}>Precedent</TableHead>
                      <TableHead className={cn(TH, "w-8")} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rowsToShow.map(({ key, label, finding }) => {
                      const m = IND_META[finding?.indicator ?? "low"]; const { line } = findingLines(finding);
                      return (
                        <TableRow key={key} onClick={() => openEvidence(label, finding)} className={cn(TR, finding && "cursor-pointer group")}>
                          <TableCell className="font-semibold text-sm">{label}</TableCell>
                          <TableCell><Badge variant="outline" className={cn("font-bold text-xs", m.classes)}>{m.short}</Badge></TableCell>
                          <TableCell className="text-sm leading-snug group-hover:underline decoration-muted-foreground/40 underline-offset-2">{line}</TableCell>
                          <TableCell className="text-sm">
                            {finding?.traceReference ? (
                              <span className="inline-flex items-center gap-1.5 text-blue-800"><BookOpen className="size-3.5 shrink-0" /><span className="truncate">{cleanCaseTitle(finding.traceReference)}</span></span>
                            ) : <span className="text-muted-foreground">No close precedent</span>}
                          </TableCell>
                          <TableCell>{finding && <ChevronRight className="size-4 text-muted-foreground" />}</TableCell>
                        </TableRow>
                      );
                    })}
                    {rowsToShow.length === 0 && <TableRow className={TR}><TableCell colSpan={5} className="text-sm text-muted-foreground py-6 text-center">Nothing to report for this filter.</TableCell></TableRow>}
                  </TableBody>
                </Table>
                {filter !== "low" && lowRows.length > 0 && (
                  <button type="button" onClick={() => setShowLow((v) => !v)} className="w-full text-left px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground border-t inline-flex items-center gap-2 bg-white">
                    <ChevronDown className={cn("size-4 transition-transform", showLow && "rotate-180")} />
                    {showLow ? "Hide" : "Show"} {lowRows.length} low-risk {lowRows.length === 1 ? "category" : "categories"} — aligned with policy, no historical red-flag pattern
                  </button>
                )}
              </Frame>
            </Section>

            {/* 3. Suggested mitigations */}
            <Section id="mitigations" n={3} title="Suggested mitigations" sub="against each material risk identified">
              {concerns.some((c) => (c.finding?.mitigations?.length ?? 0) > 0) ? (
                <Frame>
                  <Table>
                    <TableHeader><TableRow className={TR_HEAD}><TableHead className={cn(TH, "w-[11rem]")}>Risk</TableHead><TableHead className={TH}>Mitigation</TableHead><TableHead className={cn(TH, "w-[12rem]")}>Basis</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {concerns.flatMap(({ key, label, finding }) =>
                        (finding?.mitigations ?? []).map((mi, i) => (
                          <TableRow key={`${key}-${i}`} className={cn(TR, "cursor-pointer")} onClick={() => openEvidence(label, finding)}>
                            <TableCell className="text-sm">{i === 0 && <span className="inline-flex items-center gap-1.5 font-semibold"><span className={cn("size-1.5 rounded-full", IND_META[finding!.indicator].dot)} />{label}</span>}</TableCell>
                            <TableCell className="text-sm leading-snug">{mi.action}</TableCell>
                            <TableCell><MitigationTag source={mi.source} reference={mi.reference} /></TableCell>
                          </TableRow>
                        )),
                      )}
                    </TableBody>
                  </Table>
                </Frame>
              ) : <Empty>No material risks requiring mitigation.</Empty>}
            </Section>

            {/* 4. Financial analysis */}
            <Section id="financial" n={4} title="Financial analysis" sub="ratios and trends, then anomalies in the statements">
              {analysis.financialRatios?.length ? (
                <Frame>
                  <Table>
                    <TableHeader>
                      <TableRow className={TR_HEAD}>
                        <TableHead className={TH}>Metric</TableHead>
                        <TableHead className={cn(TH, "text-right w-[7rem]")}>Current</TableHead>
                        <TableHead className={cn(TH, "text-right w-[7rem]")}>Prior</TableHead>
                        <TableHead className={cn(TH, "text-right w-[6rem]")}>Movement</TableHead>
                        <TableHead className={cn(TH, "w-[7.5rem]")}>Flag</TableHead>
                        <TableHead className={TH}>Reading</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.financialRatios.map((r, i) => {
                        const f = RATIO_FLAG[r.flag] ?? RATIO_FLAG.none;
                        return (
                          <TableRow key={i} className={TR}>
                            <TableCell className="font-medium text-sm">{r.metric}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{r.current || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{r.prior || "—"}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{r.movement || "—"}</TableCell>
                            <TableCell>{r.flag !== "none" && <Badge variant="outline" className={cn("text-xs font-semibold", f.classes)}>{f.label}</Badge>}</TableCell>
                            <TableCell className="text-sm text-muted-foreground leading-snug">{r.note}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Frame>
              ) : <Empty>Ratio table not yet generated for this report.</Empty>}
              {analysis.financialAnomalies?.length ? (
                <Frame>
                  <Table>
                    <TableHeader><TableRow className={TR_HEAD}><TableHead className={cn(TH, "w-[6rem]")}>Severity</TableHead><TableHead className={cn(TH, "w-[14rem]")}>Anomaly</TableHead><TableHead className={TH}>Detail</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {analysis.financialAnomalies.map((a, i) => {
                        const sv = FIN_SEV[a.severity] ?? FIN_SEV.medium;
                        return (
                          <TableRow key={i} className={TR}>
                            <TableCell><Badge variant="outline" className={cn("text-xs font-semibold", sv.classes)}>{sv.label}</Badge></TableCell>
                            <TableCell className="text-sm font-medium">{a.label}<div className="text-xs text-muted-foreground capitalize">{a.category}</div></TableCell>
                            <TableCell className="text-sm leading-snug">{a.detail}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Frame>
              ) : <p className="text-sm text-muted-foreground">No inconsistencies found in the financial statements.</p>}
            </Section>

            {/* 5. Policy check */}
            <Section id="policy" n={5} title="Policy check" sub="each policy point marked fail, probe or compliant, with the clause">
              {analysis.policyAlerts.length ? (
                <Frame>
                  <Table>
                    <TableHeader><TableRow className={TR_HEAD}><TableHead className={cn(TH, "w-[7.5rem]")}>Status</TableHead><TableHead className={cn(TH, "w-[14rem]")}>Clause</TableHead><TableHead className={TH}>What was found</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {[...analysis.policyAlerts].sort((a, b) => ({ fail: 0, probe: 1, pass: 2 })[a.status] - ({ fail: 0, probe: 1, pass: 2 })[b.status]).map((a, i) => {
                        const am = ALERT_META[a.status] ?? ALERT_META.probe; const AmIcon = am.icon;
                        return (
                          <TableRow key={i} className={TR}>
                            <TableCell><Badge variant="outline" className={cn("font-bold text-xs", am.classes)}><AmIcon className="size-3 mr-1" />{am.label}</Badge></TableCell>
                            <TableCell className="text-sm font-medium">{a.reference || "—"}</TableCell>
                            <TableCell className="text-sm leading-snug">{a.description}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Frame>
              ) : <Empty>No policy points were raised against this application.</Empty>}
            </Section>

            {/* 6. Industry assessment */}
            <Section id="industry" n={6} title="Industry assessment" sub="sector conditions — internal and external sources labelled">
              {ia ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <OutlookBadge outlook={ia.outlook} />
                    <p className="text-sm leading-relaxed max-w-3xl">{ia.summary || "—"}</p>
                  </div>
                  <Frame>
                    <Table>
                      <TableHeader><TableRow className={TR_HEAD}><TableHead className={cn(TH, "w-[6rem]")}>Source</TableHead><TableHead className={TH}>Point</TableHead><TableHead className={cn(TH, "w-[14rem]")}>Reference</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {ia.internal.map((t, i) => (
                          <TableRow key={`i${i}`} className={TR}>
                            <TableCell className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal</TableCell>
                            <TableCell className="text-sm leading-snug">{t}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">Application / knowledge base</TableCell>
                          </TableRow>
                        ))}
                        {ia.external.map((e, i) => (
                          <TableRow key={`e${i}`} className={TR}>
                            <TableCell className="text-xs font-semibold uppercase tracking-wide text-blue-800">External</TableCell>
                            <TableCell className="text-sm leading-snug">{e.text}</TableCell>
                            <TableCell className="text-sm">
                              {e.uri ? <a href={e.uri} target="_blank" rel="noopener noreferrer" className="text-blue-800 hover:underline inline-flex items-center gap-1"><ExternalLink className="size-3" /> {e.source}</a> : <span className="text-muted-foreground">{e.source}</span>}
                            </TableCell>
                          </TableRow>
                        ))}
                        {ia.internal.length + ia.external.length === 0 && <TableRow className={TR}><TableCell colSpan={3} className="text-sm text-muted-foreground py-4 text-center">Nothing material recorded.</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </Frame>
                </div>
              ) : <Empty>Industry assessment not yet generated for this report.</Empty>}
            </Section>

            {/* 7. Adverse news */}
            <Section id="adverse" n={7} title="Adverse news screening" sub="external negative coverage against the applicant name">
              {analysis.adverseNews && (analysis.adverseNews.summary || analysis.adverseNews.sources?.length) ? (
                <div className="space-y-3">
                  <div className="text-sm leading-relaxed max-w-3xl"><Markdown components={NARRATIVE_MD}>{analysis.adverseNews.summary}</Markdown></div>
                  {analysis.adverseNews.sources?.length ? (
                    <Frame>
                      <Table>
                        <TableHeader><TableRow className={TR_HEAD}><TableHead className={TH}>Source</TableHead><TableHead className={cn(TH, "w-[8rem]")}>Origin</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {analysis.adverseNews.sources.slice(0, 8).map((s, i) => (
                            <TableRow key={i} className={TR}>
                              <TableCell className="text-sm"><a href={s.uri} target="_blank" rel="noopener noreferrer" className="text-blue-800 hover:underline inline-flex items-center gap-1.5"><ExternalLink className="size-3.5 shrink-0" /> {s.title}</a></TableCell>
                              <TableCell className="text-xs font-semibold uppercase tracking-wide text-blue-800">External</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Frame>
                  ) : null}
                </div>
              ) : <Empty>Nothing was found. The applicant name was screened and no material adverse coverage surfaced.</Empty>}
            </Section>

            {/* 8. Questions for probe */}
            <Section id="probes" n={8} title="Questions for probe" sub="for the credit manager to raise with the relationship team or the borrower">
              {analysis.probeQuestions.length ? (
                <Frame>
                  <Table>
                    <TableBody>
                      {analysis.probeQuestions.map((q, i) => (
                        <TableRow key={i} className={TR}>
                          <TableCell className="w-10 text-sm font-bold text-red-700 tabular-nums">{i + 1}.</TableCell>
                          <TableCell className="text-sm leading-snug">{q}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Frame>
              ) : <Empty>No probe questions were generated.</Empty>}
            </Section>

            {/* 9. Overall recap */}
            <Section id="recap" n={9} title="Overall recap">
              {analysis.riskNarrative ? (
                <div className="space-y-4 max-w-3xl">
                  {narrative.lead && <div className="text-sm leading-relaxed"><Markdown components={NARRATIVE_MD}>{narrative.lead}</Markdown></div>}
                  {(narrative.concerns.length > 0 || narrative.mitigants.length > 0) && (
                    <Frame>
                      <Table>
                        <TableBody>
                          {narrative.concerns.slice(0, 5).map((c, i) => (
                            <TableRow key={`c${i}`} className={TR}>
                              <TableCell className="w-[8rem] text-xs font-semibold uppercase tracking-wide text-rose-700">Concern</TableCell>
                              <TableCell className="text-sm leading-snug"><Markdown components={INLINE_MD}>{c}</Markdown></TableCell>
                            </TableRow>
                          ))}
                          {narrative.mitigants.slice(0, 4).map((c, i) => (
                            <TableRow key={`m${i}`} className={TR}>
                              <TableCell className="w-[8rem] text-xs font-semibold uppercase tracking-wide text-emerald-700">Mitigant</TableCell>
                              <TableCell className="text-sm leading-snug"><Markdown components={INLINE_MD}>{c}</Markdown></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Frame>
                  )}
                  <Disclosure open={fullRecap} onToggle={() => setFullRecap((v) => !v)} label="Read the full narrative">
                    <div className="text-sm leading-relaxed"><Markdown components={NARRATIVE_MD}>{analysis.riskNarrative}</Markdown></div>
                  </Disclosure>
                </div>
              ) : <Empty>No recap was generated.</Empty>}
            </Section>

            {/* 10. References */}
            <Section id="references" n={10} title="References" sub="every knowledge base document and external source cited">
              <Frame>
                <Table>
                  <TableHeader><TableRow className={TR_HEAD}><TableHead className={TH}>Document</TableHead><TableHead className={cn(TH, "w-[8rem]")}>Origin</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {analysis.referencesUsed.map((r, i) => {
                      const hit = ordered.find((o) => o.finding?.traceReference === r);
                      return (
                        <TableRow key={`k${i}`} className={cn(TR, hit && "cursor-pointer")} onClick={() => hit && openEvidence(hit.label, hit.finding)}>
                          <TableCell className="text-sm"><span className={cn("inline-flex items-center gap-2", hit ? "text-blue-800 hover:underline" : "")}><BookOpen className="size-3.5 shrink-0" /> {cleanCaseTitle(r)}</span></TableCell>
                          <TableCell className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal</TableCell>
                        </TableRow>
                      );
                    })}
                    {(analysis.adverseNews?.sources ?? []).slice(0, 8).map((s, i) => (
                      <TableRow key={`x${i}`} className={TR}>
                        <TableCell className="text-sm"><a href={s.uri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-blue-800 hover:underline"><ExternalLink className="size-3.5 shrink-0" /> {s.title}</a></TableCell>
                        <TableCell className="text-xs font-semibold uppercase tracking-wide text-blue-800">External</TableCell>
                      </TableRow>
                    ))}
                    {(ia?.external ?? []).map((e, i) => (
                      <TableRow key={`ie${i}`} className={TR}>
                        <TableCell className="text-sm">{e.uri ? <a href={e.uri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-blue-800 hover:underline"><ExternalLink className="size-3.5 shrink-0" /> {e.source}</a> : e.source}</TableCell>
                        <TableCell className="text-xs font-semibold uppercase tracking-wide text-blue-800">External</TableCell>
                      </TableRow>
                    ))}
                    {analysis.referencesUsed.length + (analysis.adverseNews?.sources?.length ?? 0) + (ia?.external.length ?? 0) === 0 && (
                      <TableRow className={TR}><TableCell colSpan={2} className="text-sm text-muted-foreground py-4 text-center">No documents were cited.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </Frame>
            </Section>

            <p className="text-xs text-muted-foreground italic max-w-3xl">
              Decision support only — this assessment does not approve, decline or score the facility. Credit authority remains with the credit manager. Verify every finding against the cited source before acting.
            </p>
          </main>
        </div>
      </div>

      <EvidenceDialog item={evidence} borrower={borrower} onClose={() => setEvidence(null)} />
      <CreditChat open={chatOpen} onOpenChange={setChatOpen} reportId={reportId} borrower={borrower} onCite={openCase} />
    </AppShell>
  );
}

// ── sub-components ───────────────────────────────────────────────────────────

function Section({ id, n, title, sub, aside, children }: { id: SectionId; n: number; title: string; sub?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={`sec-${id}`} className="scroll-mt-28 space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap border-b pb-2">
        <h2 className="font-bold text-base tracking-tight flex items-center gap-2"><span className="text-muted-foreground tabular-nums text-sm">{n}.</span>{title}</h2>
        {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A white, bordered box around a table. */
function Frame({ children }: { children: ReactNode }) {
  return <div className="rounded-md border overflow-hidden bg-white">{children}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground rounded-md border border-dashed px-4 py-3 bg-white">{children}</p>;
}

function Disclosure({ open, onToggle, label, children }: { open: boolean; onToggle: () => void; label: string; children: ReactNode }) {
  return (
    <div>
      <button type="button" onClick={onToggle} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} /> {label}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function CountPill({ indicator, n, active, onClick }: { indicator: CreditRiskIndicator; n: number; active: boolean; onClick: () => void }) {
  const m = IND_META[indicator];
  return (
    <button type="button" onClick={onClick} title={`${n} ${m.label.toLowerCase()} — click to filter`}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold", m.classes, active && "ring-2 ring-offset-1 ring-current")}>
      <span className="tabular-nums">{n}</span> {m.short}
    </button>
  );
}

function OutlookBadge({ outlook }: { outlook: "positive" | "neutral" | "negative" | "unknown" }) {
  const map = {
    positive: "bg-emerald-100 text-emerald-800 border-emerald-200",
    neutral: "bg-white text-slate-700 border-slate-300",
    negative: "bg-rose-100 text-rose-800 border-rose-200",
    unknown: "bg-white text-muted-foreground border-slate-300",
  } as const;
  return <Badge variant="outline" className={cn("text-xs font-semibold shrink-0 capitalize mt-0.5", map[outlook])}>{outlook === "unknown" ? "Outlook unclear" : `${outlook} outlook`}</Badge>;
}

/** Small inline tag showing where a mitigation comes from. */
function MitigationTag({ source, reference }: { source: "case" | "policy" | "best_practice"; reference?: string }) {
  const cls = source === "case" ? "text-blue-800 border-blue-300" : source === "policy" ? "text-amber-800 border-amber-300" : "text-slate-600 border-slate-300";
  const label = source === "case" ? (reference ? cleanCaseTitle(reference) : "case") : source === "policy" ? reference || "policy" : "best practice";
  return <Badge variant="outline" className={cn("text-xs font-medium bg-white", cls)}>{label}</Badge>;
}

function CostBreakdown({ usage }: { usage: TokenUsage }) {
  const cost = computeCost(usage);
  return (
    <div className="space-y-2">
      <div className="font-bold text-sm flex items-center gap-1.5"><Coins className="size-3.5 text-red-600" /> Run cost</div>
      <div className="space-y-1 text-muted-foreground">
        <CostRow label="Model" value={cost.model} />
        <CostRow label="Model calls" value={String(cost.calls)} />
        <CostRow label={`Input · ${formatTokens(cost.inputTokens)} tokens`} value={formatUsd(cost.inputUsd)} />
        <CostRow label={`Output · ${formatTokens(cost.outputTokens + cost.thinkingTokens)} tokens`} value={formatUsd(cost.outputUsd)} />
      </div>
      <div className="border-t pt-1.5 flex items-center justify-between font-bold"><span>Total</span><span className="tabular-nums">{formatUsd(cost.usd)}</span></div>
    </div>
  );
}

function CostRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="truncate">{label}</span><span className="font-medium text-foreground tabular-nums shrink-0">{value}</span></div>;
}

/**
 * Evidence as a large pop-up: the finding and why it matters, the application
 * passage beside the case passage it mirrors (FR-5.04), then ONE source PDF at
 * a time filling the rest of the dialog, with page navigation and zoom
 * (FR-7.03). Sized to the screen so the page is actually readable.
 */
function EvidenceDialog({ item, borrower, onClose }: { item: { finding: CreditRiskFinding; label: string } | null; borrower: string; onClose: () => void }) {
  const [tab, setTab] = useState<"app" | "kb">("app");
  useEffect(() => { setTab("app"); }, [item]);
  const finding = item?.finding;
  const m = IND_META[finding?.indicator ?? "low"];
  const ev = finding?.evidence ?? {};
  const { line, why } = findingLines(finding);
  const appQuote = finding ? finding.applicationQuote || splitFinding(finding.finding).observation : "";
  const hasKb = !!finding?.traceReference;

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-none w-[96vw] h-[94vh] p-0 gap-0 flex flex-col bg-white overflow-hidden">
        {finding && item && (
          <>
            <div className="px-5 py-3 border-b shrink-0">
              <DialogTitle className="flex items-center gap-2.5 flex-wrap text-base">
                <span className="font-semibold">{item.label}</span>
                <Badge variant="outline" className={cn("font-bold text-xs", m.classes)}>{m.label}</Badge>
                <span className="text-sm font-normal text-muted-foreground">· {borrower}</span>
              </DialogTitle>
              <p className="text-sm font-medium leading-snug mt-1.5">{line}</p>
              {why && <p className="text-sm text-muted-foreground leading-snug mt-1"><span className="font-semibold text-foreground/70">Why it matters: </span>{why}</p>}
            </div>

            {/* paired passages — application beside the case it mirrors */}
            <div className={cn("grid border-b shrink-0 divide-x", hasKb ? "grid-cols-2" : "grid-cols-1")}>
              <button type="button" onClick={() => setTab("app")} className={cn("text-left bg-white p-3.5 space-y-1 border-b-2", tab === "app" ? "border-b-red-600" : "border-b-transparent")}>
                <div className="text-xs uppercase tracking-wide font-semibold text-muted-foreground inline-flex items-center gap-1.5"><FileText className="size-3.5" /> Application{ev.applicationPage ? ` · p.${ev.applicationPage}` : ""}</div>
                <p className="text-sm leading-snug line-clamp-4"><Highlighted text={appQuote} terms={finding.matchTerms} /></p>
              </button>
              {hasKb && (
                <button type="button" onClick={() => setTab("kb")} className={cn("text-left bg-white p-3.5 space-y-1 border-b-2", tab === "kb" ? "border-b-red-600" : "border-b-transparent")}>
                  <div className="text-xs uppercase tracking-wide font-semibold text-blue-800 inline-flex items-center gap-1.5"><BookOpen className="size-3.5" /> {cleanCaseTitle(finding.traceReference)}{ev.casePage ? ` · p.${ev.casePage}` : ""}</div>
                  <p className="text-sm leading-snug line-clamp-4 italic">“<Highlighted text={finding.traceExcerpt} terms={finding.matchTerms} />”</p>
                </button>
              )}
            </div>

            {/* the source, one document at a time, filling the dialog */}
            <Tabs value={tab} onValueChange={(v) => setTab(v as "app" | "kb")} className="flex-1 min-h-0 flex flex-col">
              <div className="px-3 pt-2 pb-1 shrink-0 flex items-center gap-2">
                <TabsList className="h-8 bg-white border">
                  <TabsTrigger value="app" className="text-xs h-7 data-[state=active]:bg-white data-[state=active]:shadow-none data-[state=active]:font-semibold">Application PDF</TabsTrigger>
                  {hasKb && <TabsTrigger value="kb" className="text-xs h-7 data-[state=active]:bg-white data-[state=active]:shadow-none data-[state=active]:font-semibold">Knowledge base PDF</TabsTrigger>}
                </TabsList>
                {(tab === "app" ? ev.applicationFileUrl : ev.caseFileUrl) && (
                  <a href={tab === "app" ? ev.applicationFileUrl : ev.caseFileUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ExternalLink className="size-3" /> Open in new tab</a>
                )}
              </div>
              <TabsContent value="app" className="flex-1 min-h-0 mt-0 border-t bg-white">
                {ev.applicationFileUrl ? <PdfHighlight url={ev.applicationFileUrl} page={ev.applicationPage} quote={appQuote} controls fill className="bg-white" /> : <NoSource />}
              </TabsContent>
              {hasKb && (
                <TabsContent value="kb" className="flex-1 min-h-0 mt-0 border-t bg-white">
                  {ev.caseFileUrl ? <PdfHighlight url={ev.caseFileUrl} page={ev.casePage} quote={finding.traceExcerpt} controls fill className="bg-white" /> : <NoSource />}
                </TabsContent>
              )}
            </Tabs>

            {(finding.mitigations?.length ?? 0) > 0 && (
              <div className="border-t px-5 py-2.5 shrink-0 max-h-28 overflow-y-auto bg-white">
                <div className="text-xs uppercase tracking-wide font-semibold text-emerald-800 inline-flex items-center gap-1.5 mb-1"><ShieldCheck className="size-3.5" /> Suggested mitigations</div>
                <ul className="space-y-1">
                  {finding.mitigations!.map((mi, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm leading-snug"><CheckCircle2 className="size-3.5 text-emerald-600 mt-0.5 shrink-0" /><span>{mi.action} <MitigationTag source={mi.source} reference={mi.reference} /></span></li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoSource() {
  return <div className="h-full grid place-items-center text-center px-6 text-sm text-muted-foreground">Source file not available for inline preview — the cited passage is shown above.</div>;
}

function CreditAnalyzingView({ borrower, failed, error, onRetry }: { borrower: string; failed: boolean; error: string | null; onRetry: () => void }) {
  return (
    <div className="grid place-items-center p-8 bg-white" style={{ minHeight: "calc(100vh - 3.5rem)" }}>
      <div className="w-full max-w-md text-center space-y-6">
        <Link to="/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft className="size-3" /> All credit analyses</Link>
        {failed ? (
          <>
            <div className="size-14 mx-auto rounded-2xl border text-rose-600 grid place-items-center"><AlertTriangle className="size-7" /></div>
            <div className="space-y-1">
              <h2 className="font-bold text-lg">Analysis didn't finish</h2>
              <p className="text-sm text-muted-foreground">The risk screening for <span className="font-medium text-foreground">{borrower}</span> didn't complete. The application is saved — you can try again.</p>
              {error && <p className="text-sm text-rose-700 border border-rose-200 rounded-lg px-3 py-2 mt-2">{error}</p>}
            </div>
            <Button onClick={onRetry} className="gap-2 bg-red-600 hover:bg-red-700 text-white"><RefreshCw className="size-4" /> Retry</Button>
          </>
        ) : (
          <>
            <div className="mx-auto size-16 rounded-2xl border bg-white grid place-items-center"><Loader2 className="size-8 text-red-600 animate-spin" strokeWidth={1.75} /></div>
            <div className="space-y-1">
              <h2 className="font-bold text-lg">Screening {borrower}</h2>
              <p className="text-sm text-muted-foreground">Reading the application, assessing each risk category, checking policy, screening for adverse news and drafting the probes.</p>
            </div>
            <p className="text-xs text-muted-foreground/70">This usually takes a few minutes. You can keep this tab open.</p>
          </>
        )}
      </div>
    </div>
  );
}
