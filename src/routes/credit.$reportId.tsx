import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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
import { CreditChatPanel } from "@/components/credit-chat";
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
  Globe,
  Building2,
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

const IND_META: Record<
  CreditRiskIndicator,
  { label: string; short: string; classes: string; dot: string; icon: typeof ShieldAlert; rank: number }
> = {
  high: {
    label: "High risk",
    short: "High",
    classes: "bg-rose-100 text-rose-800 border-rose-200",
    dot: "bg-rose-500",
    icon: ShieldAlert,
    rank: 0,
  },
  probe: {
    label: "Probe",
    short: "Probe",
    classes: "bg-amber-100 text-amber-800 border-amber-200",
    dot: "bg-amber-500",
    icon: ShieldQuestion,
    rank: 1,
  },
  low: {
    label: "Low",
    short: "Low",
    classes: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dot: "bg-emerald-500",
    icon: ShieldCheck,
    rank: 2,
  },
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
  none: { label: "—", classes: "bg-muted text-muted-foreground border-transparent" },
};

const FIN_SEV: Record<"high" | "medium" | "low", { label: string; classes: string }> = {
  high: { label: "High", classes: "bg-rose-100 text-rose-800 border-rose-200" },
  medium: { label: "Medium", classes: "bg-amber-100 text-amber-800 border-amber-200" },
  low: { label: "Low", classes: "bg-slate-100 text-slate-700 border-slate-200" },
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

// ── helpers ────────────────────────────────────────────────────────────────

/** Strip the noisy "Hong Leong Bank Berhad Mail Fwd/Re" prefix from KB titles. */
function cleanCaseTitle(t: string): string {
  return (
    t
      .replace(/^hong leong bank berhad mail (fwd|re)\s*/i, "")
      .replace(/\s{2,}/g, " ")
      .trim() || t
  );
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
  const escaped = clean
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        p && clean.some((t) => t.toLowerCase() === p.toLowerCase()) ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 font-semibold text-amber-900">
            {p}
          </mark>
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
  const lead: string[] = [];
  const concerns: string[] = [];
  const mitigants: string[] = [];
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
const INLINE_MD: any = {
  ...NARRATIVE_MD,
  p: ({ children }: any) => <span>{children}</span>,
};

/** True at or above the width where the right-hand panel fits beside the
 *  assessment. Below it the same panel opens as an overlay sheet. */
function useIsWide(px = 1280) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(`(min-width:${px}px)`);
    const f = () => setWide(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [px]);
  return wide;
}

type Panel = { kind: "evidence"; finding: CreditRiskFinding; label: string } | { kind: "chat" } | null;

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
  const [panel, setPanel] = useState<Panel>(null);
  const [showLow, setShowLow] = useState(false);
  const [fullRecap, setFullRecap] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [active, setActive] = useState<SectionId>("overview");
  const startedRef = useRef(false);
  const wide = useIsWide();

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
    } catch {
      return false;
    }
  }

  async function runAnalysis() {
    setFailed(false);
    setAnalyzing(true);
    startedRef.current = true;
    try {
      await runAnalysisFn({ data: { reportId } });
      await qc.invalidateQueries({ queryKey: ["credit_report", reportId] });
    } catch (e: any) {
      if (await runLanded()) {
        await qc.invalidateQueries({ queryKey: ["credit_report", reportId] });
      } else {
        setFailed(true);
        toast.error("Credit risk analysis didn't finish", { description: e?.message?.slice(0, 200) });
      }
    } finally {
      setAnalyzing(false);
    }
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
    } finally {
      setBackfilling(false);
    }
  }

  // Auto-run once for a freshly created report.
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
    } finally {
      setDownloading(false);
    }
  }

  // ── derived ──
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
    return { byKey, counts, ordered, concerns, narrative, missing };
  }, [analysis]);

  // ── early returns ──
  if (report.isLoading) {
    return (
      <AppShell>
        <div className="p-8 space-y-4 animate-pulse">
          <div className="h-4 bg-muted rounded w-32" />
          <div className="h-8 bg-muted rounded w-2/5" />
          <div className="h-20 bg-muted rounded-xl" />
          <div className="h-64 bg-muted rounded-xl" />
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

  if (isAnalyzing) {
    return (
      <AppShell>
        <CreditAnalyzingView borrower={borrower} failed={false} error={null} onRetry={runAnalysis} />
      </AppShell>
    );
  }
  if (runFailed || !analysis || !derived) {
    return (
      <AppShell>
        <CreditAnalyzingView borrower={borrower} failed error={sj.credit_error ?? null} onRetry={runAnalysis} />
      </AppShell>
    );
  }

  const { counts, ordered, concerns, narrative, missing } = derived;
  const overall = IND_META[analysis.overallRisk] ?? IND_META.probe;
  const usage: TokenUsage | undefined = sj.usage;
  const facts = analysis.applicationFacts;
  const analysedAt = formatDate((report.data as any).created_at ?? new Date().toISOString());

  const openEvidence = (label: string, finding?: CreditRiskFinding) => {
    if (!finding) return;
    setPanel({ kind: "evidence", finding, label });
  };
  /** From a "Case NN" mention in chat: open the finding that cites that case. */
  const openCase = (caseRef: string) => {
    const n = caseRef.replace(/\D/g, "");
    const hit = ordered.find((o) => o.finding?.traceReference && new RegExp(`\\b${n}\\b`).test(o.finding.traceReference));
    if (hit?.finding) setPanel({ kind: "evidence", finding: hit.finding, label: hit.label });
    else toast.message(`${caseRef} isn't cited by a finding in this assessment.`);
  };
  const jump = (id: SectionId) => {
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

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

  const panelNode =
    panel?.kind === "evidence" ? (
      <EvidencePanel finding={panel.finding} label={panel.label} borrower={borrower} onClose={() => setPanel(null)} />
    ) : panel?.kind === "chat" ? (
      <CreditChatPanel reportId={reportId} borrower={borrower} onClose={() => setPanel(null)} onCite={openCase} />
    ) : null;

  return (
    <AppShell>
      {/* ── summary strip: everything a manager needs before reading on (FR-5.11, FR-7.07) ── */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b">
        <div className="px-6 py-3 flex items-center gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <Link to="/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3" /> All credit analyses
            </Link>
            <div className="flex items-center gap-3 flex-wrap mt-0.5">
              <h1 className="text-xl font-bold tracking-tight truncate">{borrower}</h1>
              <Badge variant="outline" className={cn("font-bold text-xs uppercase tracking-wide", overall.classes)}>
                <span className={cn("size-1.5 rounded-full mr-1.5", overall.dot)} />
                Overall · {overall.label}
              </Badge>
              <div className="flex items-center gap-1.5 text-xs">
                <CountPill indicator="high" n={counts.high} active={filter === "high"} onClick={() => { setFilter((f) => (f === "high" ? "all" : "high")); jump("risks"); }} />
                <CountPill indicator="probe" n={counts.probe} active={filter === "probe"} onClick={() => { setFilter((f) => (f === "probe" ? "all" : "probe")); jump("risks"); }} />
                <CountPill indicator="low" n={counts.low} active={filter === "low"} onClick={() => { setFilter((f) => (f === "low" ? "all" : "low")); jump("risks"); }} />
              </div>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
              {facts?.facilityAmount && <span className="font-medium text-foreground">{facts.facilityAmount}</span>}
              {facts?.facilityType && <span>{facts.facilityType}</span>}
              {facts?.applicationDate && <span>Application {facts.applicationDate}</span>}
              <span>Analysed {analysedAt}</span>
              {usage && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="text-muted-foreground/60 hover:text-foreground" aria-label="Run details">
                      <Info className="size-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 text-sm">
                    <CostBreakdown usage={usage} />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant={panel?.kind === "chat" ? "default" : "outline"}
              size="sm"
              onClick={() => setPanel((p) => (p?.kind === "chat" ? null : { kind: "chat" }))}
              className={cn("gap-2", panel?.kind === "chat" ? "bg-red-600 hover:bg-red-700 text-white" : "border-red-200 text-red-700 hover:bg-red-50")}
            >
              <MessageSquare className="size-4" /> Ask AI
            </Button>
            <Button size="sm" onClick={handleDownload} disabled={downloading} className="gap-2 bg-red-600 hover:bg-red-700 text-white">
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Download
            </Button>
            <Button variant="outline" size="sm" onClick={runAnalysis} className="gap-2">
              <RefreshCw className="size-4" /> Re-run
            </Button>
          </div>
        </div>
      </div>

      <div className={cn("grid gap-0 min-h-[calc(100vh-4rem)]", wide && panel ? "grid-cols-[13rem_minmax(0,1fr)_30rem]" : "grid-cols-[13rem_minmax(0,1fr)]")}>
        {/* ── section nav ── */}
        <nav className="border-r bg-muted/20 py-4 pr-2 pl-4 sticky top-[4.5rem] self-start max-h-[calc(100vh-4.5rem)] overflow-y-auto hidden md:block">
          <ol className="space-y-0.5">
            {SECTIONS.map((s, i) => {
              const n = sectionCounts[s.id];
              const on = active === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => jump(s.id)}
                    className={cn(
                      "w-full text-left flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                      on ? "bg-red-50 text-red-800 font-semibold" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <span className="tabular-nums text-xs w-4 shrink-0 opacity-60">{i + 1}</span>
                    <span className="truncate">{s.label}</span>
                    {typeof n === "number" && n > 0 && (
                      <span className={cn("ml-auto text-xs tabular-nums rounded-full px-1.5", on ? "bg-red-100" : "bg-muted")}>{n}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* ── assessment ── */}
        <main className="px-6 py-6 space-y-8 min-w-0">
          {missing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 flex items-center gap-3 text-sm">
              <Sparkles className="size-4 text-amber-700 shrink-0" />
              <span className="text-amber-900">
                This report predates the current format — {missing.join(", ")} not yet generated.
              </span>
              <Button size="sm" variant="outline" onClick={runBackfill} disabled={backfilling} className="ml-auto gap-1.5 border-amber-300 text-amber-900 hover:bg-amber-100">
                {backfilling ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                Generate missing sections
              </Button>
            </div>
          )}

          {/* 1. Application overview */}
          <Section id="overview" n={1} title="Application overview">
            {facts ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
                <Fact label="Borrower" value={facts.borrower || borrower} />
                <Fact label="Facility" value={facts.facilityType} />
                <Fact label="Amount" value={facts.facilityAmount} strong />
                <Fact label="Application date" value={facts.applicationDate} />
                <Fact label="Application type" value={facts.applicationType} />
                <Fact label="Segment" value={facts.segment} />
                <div className="sm:col-span-2 lg:col-span-3">
                  <Fact label="Purpose" value={facts.purpose} />
                </div>
                {facts.notFound.length > 0 && (
                  <div className="sm:col-span-2 lg:col-span-3 text-sm text-muted-foreground">
                    Not stated in the application: {facts.notFound.join(", ")}.
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Header facts not yet generated for this report.</p>
            )}
            <Disclosure open={showSummary} onToggle={() => setShowSummary((v) => !v)} label="Executive summary of the application">
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 max-w-3xl">
                {analysis.applicationSummary || "—"}
              </p>
            </Disclosure>
          </Section>

          {/* 2. Risk alerts */}
          <Section
            id="risks"
            n={2}
            title="Risk alerts"
            sub="one finding per category, most significant first — click a row for the evidence"
            aside={
              filter !== "all" ? (
                <button onClick={() => setFilter("all")} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  Showing {IND_META[filter].short.toLowerCase()} only · clear <X className="size-3.5" />
                </button>
              ) : null
            }
          >
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-[11rem]">Risk category</TableHead>
                    <TableHead className="w-[6.5rem]">Indicator</TableHead>
                    <TableHead>Finding</TableHead>
                    <TableHead className="w-[12rem]">Precedent</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rowsToShow.map(({ key, label, finding }) => {
                    const m = IND_META[finding?.indicator ?? "low"];
                    const { line } = findingLines(finding);
                    const clickable = !!finding;
                    return (
                      <TableRow
                        key={key}
                        onClick={() => clickable && openEvidence(label, finding)}
                        className={cn("align-top", clickable && "cursor-pointer", panel?.kind === "evidence" && panel.finding.segment === key && "bg-red-50/60")}
                      >
                        <TableCell className="font-semibold text-sm">{label}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("font-bold text-xs", m.classes)}>{m.short}</Badge>
                        </TableCell>
                        <TableCell className="text-sm leading-snug">{line}</TableCell>
                        <TableCell className="text-sm text-blue-800">
                          {finding?.traceReference ? (
                            <span className="inline-flex items-center gap-1.5">
                              <BookOpen className="size-3.5 shrink-0" />
                              <span className="truncate">{cleanCaseTitle(finding.traceReference)}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">No close precedent</span>
                          )}
                        </TableCell>
                        <TableCell>{clickable && <ChevronRight className="size-4 text-muted-foreground" />}</TableCell>
                      </TableRow>
                    );
                  })}
                  {rowsToShow.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground py-6 text-center">Nothing to report for this filter.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {filter !== "low" && lowRows.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLow((v) => !v)}
                  className="w-full text-left px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted/40 border-t inline-flex items-center gap-2"
                >
                  <ChevronDown className={cn("size-4 transition-transform", showLow && "rotate-180")} />
                  {showLow ? "Hide" : "Show"} {lowRows.length} low-risk {lowRows.length === 1 ? "category" : "categories"} — aligned with policy, no historical red-flag pattern
                </button>
              )}
            </div>
          </Section>

          {/* 3. Suggested mitigations */}
          <Section id="mitigations" n={3} title="Suggested mitigations" sub="against each material risk identified">
            {concerns.some((c) => (c.finding?.mitigations?.length ?? 0) > 0) ? (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-[11rem]">Risk</TableHead>
                      <TableHead>Mitigation</TableHead>
                      <TableHead className="w-[11rem]">Basis</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {concerns.flatMap(({ key, label, finding }) =>
                      (finding?.mitigations ?? []).map((mi, i) => (
                        <TableRow key={`${key}-${i}`} className="align-top cursor-pointer" onClick={() => openEvidence(label, finding)}>
                          <TableCell className="text-sm">
                            {i === 0 && (
                              <span className="inline-flex items-center gap-1.5 font-semibold">
                                <span className={cn("size-1.5 rounded-full", IND_META[finding!.indicator].dot)} />
                                {label}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm leading-snug">{mi.action}</TableCell>
                          <TableCell><MitigationTag source={mi.source} reference={mi.reference} /></TableCell>
                        </TableRow>
                      )),
                    )}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <Empty>No material risks requiring mitigation.</Empty>
            )}
          </Section>

          {/* 4. Financial analysis */}
          <Section id="financial" n={4} title="Financial analysis" sub="ratios and trends, then anomalies in the statements">
            {analysis.financialRatios?.length ? (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead>Metric</TableHead>
                      <TableHead className="text-right w-[7rem]">Current</TableHead>
                      <TableHead className="text-right w-[7rem]">Prior</TableHead>
                      <TableHead className="text-right w-[6rem]">Movement</TableHead>
                      <TableHead className="w-[7.5rem]">Flag</TableHead>
                      <TableHead>Reading</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysis.financialRatios.map((r, i) => {
                      const f = RATIO_FLAG[r.flag] ?? RATIO_FLAG.none;
                      return (
                        <TableRow key={i} className="align-top">
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
              </div>
            ) : (
              <Empty>Ratio table not yet generated for this report.</Empty>
            )}
            {analysis.financialAnomalies?.length ? (
              <div className="rounded-lg border overflow-hidden">
                <div className="px-4 py-2 bg-muted/40 text-sm font-semibold">Anomalies and inconsistencies</div>
                <Table>
                  <TableBody>
                    {analysis.financialAnomalies.map((a, i) => {
                      const sv = FIN_SEV[a.severity] ?? FIN_SEV.medium;
                      return (
                        <TableRow key={i} className="align-top">
                          <TableCell className="w-[6rem]"><Badge variant="outline" className={cn("text-xs font-semibold", sv.classes)}>{sv.label}</Badge></TableCell>
                          <TableCell className="w-[13rem] text-sm font-medium">{a.label}<div className="text-xs text-muted-foreground capitalize">{a.category}</div></TableCell>
                          <TableCell className="text-sm leading-snug">{a.detail}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No inconsistencies found in the financial statements.</p>
            )}
          </Section>

          {/* 5. Policy check */}
          <Section id="policy" n={5} title="Policy check" sub="each policy point marked fail, probe or compliant, with the clause">
            {analysis.policyAlerts.length ? (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-[7.5rem]">Status</TableHead>
                      <TableHead className="w-[14rem]">Clause</TableHead>
                      <TableHead>What was found</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...analysis.policyAlerts]
                      .sort((a, b) => ({ fail: 0, probe: 1, pass: 2 })[a.status] - ({ fail: 0, probe: 1, pass: 2 })[b.status])
                      .map((a, i) => {
                        const am = ALERT_META[a.status] ?? ALERT_META.probe;
                        const AmIcon = am.icon;
                        return (
                          <TableRow key={i} className="align-top">
                            <TableCell>
                              <Badge variant="outline" className={cn("font-bold text-xs", am.classes)}><AmIcon className="size-3 mr-1" />{am.label}</Badge>
                            </TableCell>
                            <TableCell className="text-sm font-medium">{a.reference || "—"}</TableCell>
                            <TableCell className="text-sm leading-snug">{a.description}</TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <Empty>No policy points were raised against this application.</Empty>
            )}
          </Section>

          {/* 6. Industry assessment */}
          <Section id="industry" n={6} title="Industry assessment" sub="sector conditions — internal and external sources labelled">
            {analysis.industryAssessment ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <OutlookBadge outlook={analysis.industryAssessment.outlook} />
                  <p className="text-sm leading-relaxed max-w-3xl">{analysis.industryAssessment.summary || "—"}</p>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <SourceList icon={Building2} title="Internal · from the application and knowledge base" items={analysis.industryAssessment.internal.map((t) => ({ text: t }))} />
                  <SourceList icon={Globe} title="External · web sources, each attributed" items={analysis.industryAssessment.external} emptyText="Nothing material found from external sources." />
                </div>
              </div>
            ) : (
              <Empty>Industry assessment not yet generated for this report.</Empty>
            )}
          </Section>

          {/* 7. Adverse news */}
          <Section id="adverse" n={7} title="Adverse news screening" sub="external negative coverage against the applicant name">
            {analysis.adverseNews && (analysis.adverseNews.summary || analysis.adverseNews.sources?.length) ? (
              <div className="space-y-3">
                <div className="text-sm leading-relaxed max-w-3xl">
                  <Markdown components={NARRATIVE_MD}>{analysis.adverseNews.summary}</Markdown>
                </div>
                {analysis.adverseNews.sources?.length ? (
                  <SourceList icon={Globe} title="Sources" items={analysis.adverseNews.sources.slice(0, 8).map((s) => ({ text: s.title, uri: s.uri }))} />
                ) : null}
              </div>
            ) : (
              <Empty>Nothing was found. The applicant name was screened and no material adverse coverage surfaced.</Empty>
            )}
          </Section>

          {/* 8. Questions for probe */}
          <Section id="probes" n={8} title="Questions for probe" sub="for the credit manager to raise with the relationship team or the borrower">
            {analysis.probeQuestions.length ? (
              <ol className="space-y-2.5 max-w-3xl">
                {analysis.probeQuestions.map((q, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm leading-snug">
                    <span className="shrink-0 size-6 rounded-full bg-red-100 text-red-700 grid place-items-center text-xs font-bold mt-px">{i + 1}</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No probe questions were generated.</Empty>
            )}
          </Section>

          {/* 9. Overall recap */}
          <Section id="recap" n={9} title="Overall recap">
            {analysis.riskNarrative ? (
              <div className="space-y-4 max-w-3xl">
                {narrative.lead && (
                  <div className="text-sm leading-relaxed">
                    <Markdown components={NARRATIVE_MD}>{narrative.lead}</Markdown>
                  </div>
                )}
                {narrative.concerns.length > 0 && (
                  <ul className="space-y-2">
                    {narrative.concerns.slice(0, 5).map((c, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm leading-snug">
                        <span className="size-1.5 rounded-full bg-rose-500 mt-2 shrink-0" />
                        <span><Markdown components={INLINE_MD}>{c}</Markdown></span>
                      </li>
                    ))}
                  </ul>
                )}
                {narrative.mitigants.length > 0 && (
                  <ul className="space-y-2">
                    {narrative.mitigants.slice(0, 4).map((c, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm leading-snug">
                        <CheckCircle2 className="size-4 text-emerald-600 mt-px shrink-0" />
                        <span><Markdown components={INLINE_MD}>{c}</Markdown></span>
                      </li>
                    ))}
                  </ul>
                )}
                <Disclosure open={fullRecap} onToggle={() => setFullRecap((v) => !v)} label="Read the full narrative">
                  <div className="text-sm leading-relaxed">
                    <Markdown components={NARRATIVE_MD}>{analysis.riskNarrative}</Markdown>
                  </div>
                </Disclosure>
              </div>
            ) : (
              <Empty>No recap was generated.</Empty>
            )}
          </Section>

          {/* 10. References */}
          <Section id="references" n={10} title="References" sub="every knowledge base document and external source cited">
            {analysis.referencesUsed.length ? (
              <ul className="space-y-1.5">
                {analysis.referencesUsed.map((r, i) => {
                  const hit = ordered.find((o) => o.finding?.traceReference === r);
                  return (
                    <li key={i} className="text-sm">
                      <button type="button" onClick={() => hit && openEvidence(hit.label, hit.finding)} className={cn("inline-flex items-center gap-2", hit ? "text-blue-800 hover:underline" : "text-foreground cursor-default")}>
                        <BookOpen className="size-3.5 shrink-0" /> {cleanCaseTitle(r)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty>No knowledge base documents were cited.</Empty>
            )}
            {analysis.adverseNews?.sources?.length ? (
              <ul className="space-y-1.5">
                {analysis.adverseNews.sources.slice(0, 8).map((s, i) => (
                  <li key={i} className="text-sm">
                    <a href={s.uri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-blue-800 hover:underline">
                      <ExternalLink className="size-3.5 shrink-0" /> {s.title} <span className="text-xs text-muted-foreground">external</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </Section>

          <p className="text-xs text-muted-foreground italic max-w-3xl">
            Decision support only — this assessment does not approve, decline or score the facility. Credit authority
            remains with the credit manager. Verify every finding against the cited source before acting.
          </p>
        </main>

        {/* ── right-hand slot: evidence or chat, one at a time ── */}
        {wide && panel && (
          <aside className="border-l bg-card sticky top-[4.5rem] self-start h-[calc(100vh-4.5rem)] min-h-0 overflow-hidden">
            {panelNode}
          </aside>
        )}
      </div>

      {!wide && (
        <Sheet open={!!panel} onOpenChange={(o) => !o && setPanel(null)}>
          <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
            <SheetTitle className="sr-only">{panel?.kind === "chat" ? "Ask AI" : "Evidence"}</SheetTitle>
            <div className="flex-1 min-h-0">{panelNode}</div>
          </SheetContent>
        </Sheet>
      )}
    </AppShell>
  );
}

// ── sub-components ───────────────────────────────────────────────────────────

function Section({
  id,
  n,
  title,
  sub,
  aside,
  children,
}: {
  id: SectionId;
  n: number;
  title: string;
  sub?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={`sec-${id}`} className="scroll-mt-24 space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="font-bold text-base tracking-tight flex items-center gap-2">
          <span className="text-muted-foreground/60 tabular-nums text-sm">{n}.</span>
          {title}
        </h2>
        {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground rounded-lg border border-dashed px-4 py-3">{children}</p>;
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className={cn("text-sm mt-0.5", strong && "font-semibold text-base", !value && "text-muted-foreground")}>{value || "Not stated"}</div>
    </div>
  );
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
    <button
      type="button"
      onClick={onClick}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-semibold transition-colors", m.classes, active && "ring-2 ring-offset-1 ring-current")}
      title={`${n} ${m.label.toLowerCase()} — click to filter`}
    >
      <span className="tabular-nums">{n}</span> {m.short}
    </button>
  );
}

function OutlookBadge({ outlook }: { outlook: "positive" | "neutral" | "negative" | "unknown" }) {
  const map = {
    positive: "bg-emerald-100 text-emerald-800 border-emerald-200",
    neutral: "bg-slate-100 text-slate-700 border-slate-200",
    negative: "bg-rose-100 text-rose-800 border-rose-200",
    unknown: "bg-muted text-muted-foreground border-transparent",
  } as const;
  return <Badge variant="outline" className={cn("text-xs font-semibold shrink-0 capitalize mt-0.5", map[outlook])}>{outlook === "unknown" ? "Outlook unclear" : `${outlook} outlook`}</Badge>;
}

function SourceList({
  icon: Icon,
  title,
  items,
  emptyText,
}: {
  icon: typeof Globe;
  title: string;
  items: { text: string; source?: string; uri?: string }[];
  emptyText?: string;
}) {
  return (
    <div className="rounded-lg border p-3.5 space-y-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold inline-flex items-center gap-1.5"><Icon className="size-3.5" /> {title}</div>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="text-sm leading-snug flex items-start gap-2">
              <span className="size-1.5 rounded-full bg-muted-foreground/50 mt-2 shrink-0" />
              <span>
                {it.text}
                {(it.source || it.uri) && (
                  <>
                    {" "}
                    {it.uri ? (
                      <a href={it.uri} target="_blank" rel="noopener noreferrer" className="text-blue-800 hover:underline inline-flex items-center gap-1 text-xs">
                        <ExternalLink className="size-3" /> {it.source || "source"}
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">— {it.source}</span>
                    )}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText ?? "Nothing recorded."}</p>
      )}
    </div>
  );
}

/** Small inline tag showing where a mitigation comes from. */
function MitigationTag({ source, reference }: { source: "case" | "policy" | "best_practice"; reference?: string }) {
  const cls =
    source === "case"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : source === "policy"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : "bg-slate-50 text-slate-600 border-slate-200";
  const label = source === "case" ? (reference ? cleanCaseTitle(reference) : "case") : source === "policy" ? reference || "policy" : "best practice";
  return <Badge variant="outline" className={cn("text-xs font-medium", cls)}>{label}</Badge>;
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
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="truncate">{label}</span>
      <span className="font-medium text-foreground tabular-nums shrink-0">{value}</span>
    </div>
  );
}

/**
 * The evidence panel: the finding, why it matters, the application passage
 * beside the case passage it mirrors (kept side by side — that comparison is
 * the point, FR-5.04), then one PDF at a time below, full height, with page
 * navigation and zoom (FR-7.03).
 */
function EvidencePanel({
  finding,
  label,
  borrower,
  onClose,
}: {
  finding: CreditRiskFinding;
  label: string;
  borrower: string;
  onClose: () => void;
}) {
  const m = IND_META[finding.indicator];
  const ev = finding.evidence ?? {};
  const { line, why } = findingLines(finding);
  const appQuote = finding.applicationQuote || splitFinding(finding.finding).observation;
  const hasKb = !!finding.traceReference;
  const [tab, setTab] = useState<"app" | "kb">("app");
  useEffect(() => { setTab("app"); }, [finding]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b shrink-0 space-y-1.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm">{label}</span>
              <Badge variant="outline" className={cn("font-bold text-xs", m.classes)}>{m.label}</Badge>
              <span className="text-xs text-muted-foreground truncate">· {borrower}</span>
            </div>
            <p className="text-sm font-medium leading-snug mt-1">{line}</p>
          </div>
          <button type="button" onClick={onClose} className="size-8 grid place-items-center rounded-md hover:bg-muted text-muted-foreground shrink-0" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {why && (
          <p className="text-sm text-muted-foreground leading-snug">
            <span className="font-semibold text-foreground/70">Why it matters: </span>{why}
          </p>
        )}
      </div>

      {/* paired passages — application beside the case it mirrors */}
      <div className={cn("grid gap-px bg-border border-b shrink-0", hasKb ? "grid-cols-2" : "grid-cols-1")}>
        <button type="button" onClick={() => setTab("app")} className={cn("text-left bg-card p-3 space-y-1 hover:bg-muted/30", tab === "app" && "bg-amber-50/40")}>
          <div className="text-xs uppercase tracking-wide font-semibold text-muted-foreground inline-flex items-center gap-1.5">
            <FileText className="size-3.5" /> Application{ev.applicationPage ? ` · p.${ev.applicationPage}` : ""}
          </div>
          <p className="text-sm leading-snug line-clamp-5"><Highlighted text={appQuote} terms={finding.matchTerms} /></p>
        </button>
        {hasKb && (
          <button type="button" onClick={() => setTab("kb")} className={cn("text-left bg-card p-3 space-y-1 hover:bg-muted/30", tab === "kb" && "bg-blue-50/40")}>
            <div className="text-xs uppercase tracking-wide font-semibold text-blue-800 inline-flex items-center gap-1.5">
              <BookOpen className="size-3.5" /> {cleanCaseTitle(finding.traceReference)}{ev.casePage ? ` · p.${ev.casePage}` : ""}
            </div>
            <p className="text-sm leading-snug line-clamp-5 italic text-blue-950/80">“<Highlighted text={finding.traceExcerpt} terms={finding.matchTerms} />”</p>
          </button>
        )}
      </div>

      {/* the source, one document at a time, full height */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as "app" | "kb")} className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 pt-2 shrink-0 flex items-center gap-2">
          <TabsList className="h-8">
            <TabsTrigger value="app" className="text-xs h-7">Application PDF</TabsTrigger>
            {hasKb && <TabsTrigger value="kb" className="text-xs h-7">Knowledge base PDF</TabsTrigger>}
          </TabsList>
          {(tab === "app" ? ev.applicationFileUrl : ev.caseFileUrl) && (
            <a href={tab === "app" ? ev.applicationFileUrl : ev.caseFileUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <ExternalLink className="size-3" /> Open in new tab
            </a>
          )}
        </div>
        <TabsContent value="app" className="flex-1 min-h-0 mt-2 border-t">
          {ev.applicationFileUrl ? (
            <PdfHighlight url={ev.applicationFileUrl} page={ev.applicationPage} quote={appQuote} controls fill />
          ) : (
            <NoSource />
          )}
        </TabsContent>
        {hasKb && (
          <TabsContent value="kb" className="flex-1 min-h-0 mt-2 border-t">
            {ev.caseFileUrl ? (
              <PdfHighlight url={ev.caseFileUrl} page={ev.casePage} quote={finding.traceExcerpt} controls fill />
            ) : (
              <NoSource />
            )}
          </TabsContent>
        )}
      </Tabs>

      {(finding.mitigations?.length ?? 0) > 0 && (
        <div className="border-t px-4 py-3 shrink-0 max-h-40 overflow-y-auto bg-emerald-50/40">
          <div className="text-xs uppercase tracking-wide font-semibold text-emerald-800 inline-flex items-center gap-1.5 mb-1.5"><ShieldCheck className="size-3.5" /> Suggested mitigations</div>
          <ul className="space-y-1.5">
            {finding.mitigations!.map((mi, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-snug">
                <CheckCircle2 className="size-3.5 text-emerald-600 mt-0.5 shrink-0" />
                <span>{mi.action} <MitigationTag source={mi.source} reference={mi.reference} /></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NoSource() {
  return (
    <div className="h-full grid place-items-center text-center px-6 text-sm text-muted-foreground">
      Source file not available for inline preview — the cited passage is shown above.
    </div>
  );
}

function CreditAnalyzingView({ borrower, failed, error, onRetry }: { borrower: string; failed: boolean; error: string | null; onRetry: () => void }) {
  return (
    <div className="grid place-items-center p-8" style={{ minHeight: "calc(100vh - 3.5rem)" }}>
      <div className="w-full max-w-md text-center space-y-6">
        <Link to="/reports" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-3" /> All credit analyses
        </Link>
        {failed ? (
          <>
            <div className="size-14 mx-auto rounded-2xl bg-rose-100 text-rose-600 grid place-items-center"><AlertTriangle className="size-7" /></div>
            <div className="space-y-1">
              <h2 className="font-bold text-lg">Analysis didn't finish</h2>
              <p className="text-sm text-muted-foreground">
                The risk screening for <span className="font-medium text-foreground">{borrower}</span> didn't complete. The application is saved — you can try again.
              </p>
              {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-2">{error}</p>}
            </div>
            <Button onClick={onRetry} className="gap-2 bg-red-600 hover:bg-red-700 text-white"><RefreshCw className="size-4" /> Retry</Button>
          </>
        ) : (
          <>
            <div className="relative mx-auto w-fit">
              <div className="absolute inset-0 bg-red-500/20 rounded-full blur-2xl animate-pulse" />
              <div className="relative size-16 rounded-2xl border bg-card grid place-items-center shadow-sm"><Loader2 className="size-8 text-red-600 animate-spin" strokeWidth={1.75} /></div>
            </div>
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
