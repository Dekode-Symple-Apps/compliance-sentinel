import { useEffect, useRef, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
// Vite resolves ?url to the emitted asset URL (same pattern as styles.css?url in
// __root.tsx). Just a string — safe at module load / SSR; pdf.js itself is
// dynamically imported below so its code never runs on the server.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// ============================================================================
// PdfHighlight — renders one page of a PDF to a canvas and draws highlight
// boxes over the text that matches `quote`, located via the pdf.js text layer.
// pdf.js is dynamically imported (client-only) so it never runs during SSR.
// Falls back to the browser's native PDF viewer (iframe) if anything fails.
// ============================================================================

type Rect = { left: number; top: number; width: number; height: number };

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchItems(items: any[], quote: string): number[] {
  let joined = "";
  const spans: { start: number; end: number; i: number }[] = [];
  items.forEach((it, i) => {
    const n = norm(it.str);
    if (!n) return;
    const start = joined.length;
    joined += n + " ";
    spans.push({ start, end: joined.length, i });
  });
  const nq = norm(quote);
  if (nq.length < 8) return [];
  const needle = nq.slice(0, 60);
  const at = joined.indexOf(needle);
  if (at >= 0) {
    const end = at + nq.length;
    return spans.filter((s) => s.start < end && s.end > at).map((s) => s.i);
  }
  // token fallback — items sharing ≥1 long token with the quote
  const toks = [...new Set(nq.split(" ").filter((t) => t.length > 4))];
  if (!toks.length) return [];
  return items
    .map((_, i) => i)
    .filter((i) => {
      const n = norm(items[i].str);
      return toks.some((t) => n.includes(t));
    });
}

const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5];

export function PdfHighlight({
  url,
  page,
  quote,
  className,
  height = 360,
  controls = false,
  fill = false,
}: {
  url: string;
  page?: number;
  quote: string;
  className?: string;
  height?: number;
  /** Show page navigation and zoom. Off by default — the compact evidence
   *  cards elsewhere render one fixed page and need no chrome. */
  controls?: boolean;
  /** Fill the parent's height (parent must size itself) instead of `height`. */
  fill?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [rects, setRects] = useState<Rect[]>([]);
  const citedPage = Math.max(1, page || 1);
  // The page on screen. Seeded from the citation and re-seeded whenever a new
  // citation arrives, but free to move once the reader starts paging.
  const [pageNum, setPageNum] = useState(citedPage);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  useEffect(() => { setPageNum(citedPage); }, [citedPage, url]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderTask: any;
    // Held outside the IIFE so it can be destroyed on unmount. Each pdf.js
    // document owns a worker transport; the credit report renders one of these
    // per evidence card, so leaking them accumulates workers until the tab dies.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let doc: any = null;
    const releaseDoc = () => {
      try { doc?.destroy?.(); } catch { /* noop */ }
      doc = null;
    };
    (async () => {
      try {
        setStatus("loading");
        setRects([]);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

        doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;
        setNumPages(doc.numPages);
        const pg = await doc.getPage(Math.min(pageNum, doc.numPages));
        const base = pg.getViewport({ scale: 1 });
        const fitWidth = scrollRef.current?.clientWidth || 480;
        const cssWidth = Math.floor(fitWidth * zoom);
        const scale = cssWidth / base.width;
        const dpr = window.devicePixelRatio || 1;
        const vp = pg.getViewport({ scale });

        const canvas = canvasRef.current!;
        const stage = stageRef.current!;
        canvas.width = Math.floor(vp.width * dpr);
        canvas.height = Math.floor(vp.height * dpr);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${vp.height}px`;
        stage.style.width = `${cssWidth}px`;
        stage.style.height = `${vp.height}px`;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(dpr, dpr);
        renderTask = pg.render({ canvasContext: ctx, viewport: vp });
        await renderTask.promise;
        if (cancelled) return;

        const tc = await pg.getTextContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items = (tc.items as any[]).filter((it) => typeof it.str === "string" && it.str.trim());
        // The quote lives on the cited page; paging away shows the page clean.
        const idx = pageNum === citedPage ? matchItems(items, quote) : [];
        const rs: Rect[] = idx.map((i) => {
          const it = items[i];
          const tx = pdfjs.Util.transform(vp.transform, it.transform);
          const fontHeight = Math.hypot(tx[2], tx[3]) || 10;
          return { left: tx[4], top: tx[5] - fontHeight - 1, width: (it.width || 0) * scale, height: fontHeight + 3 };
        });
        if (cancelled) return;
        setRects(rs);
        setStatus("ready");
        if (rs.length && scrollRef.current) {
          scrollRef.current.scrollTo({ top: Math.max(0, rs[0].top - 70), behavior: "smooth" });
        }
      } catch {
        if (!cancelled) setStatus("error");
      } finally {
        // Unmounted mid-load: cleanup already ran and saw `doc` still null, so
        // release it here instead of leaking the just-resolved document.
        if (cancelled) releaseDoc();
      }
    })();
    return () => {
      cancelled = true;
      releaseDoc();
      try {
        renderTask?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [url, pageNum, quote, zoom, citedPage]);

  const sizeStyle = fill ? undefined : { height };
  const sizeClass = fill ? "h-full min-h-0" : "";

  if (status === "error") {
    return (
      <iframe
        src={`${url}#page=${pageNum}`}
        title="source document"
        className={cn("w-full bg-muted/20", sizeClass, className)}
        style={{ ...sizeStyle, border: 0 }}
      />
    );
  }

  const zi = ZOOM_STEPS.indexOf(zoom);
  const bar = controls ? (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-card text-xs shrink-0">
      <button type="button" onClick={() => setPageNum((n) => Math.max(1, n - 1))} disabled={pageNum <= 1}
        className="size-7 grid place-items-center rounded hover:bg-muted disabled:opacity-40" aria-label="Previous page">
        <ChevronLeft className="size-4" />
      </button>
      <span className="tabular-nums px-1">
        Page {pageNum}{numPages ? ` of ${numPages}` : ""}
        {pageNum !== citedPage && (
          <button type="button" onClick={() => setPageNum(citedPage)} className="ml-2 text-blue-600 hover:underline">
            back to p.{citedPage}
          </button>
        )}
      </span>
      <button type="button" onClick={() => setPageNum((n) => (numPages ? Math.min(numPages, n + 1) : n + 1))}
        disabled={!!numPages && pageNum >= numPages}
        className="size-7 grid place-items-center rounded hover:bg-muted disabled:opacity-40" aria-label="Next page">
        <ChevronRight className="size-4" />
      </button>
      <span className="ml-auto" />
      <button type="button" onClick={() => setZoom(ZOOM_STEPS[Math.max(0, zi - 1)])} disabled={zi <= 0}
        className="size-7 grid place-items-center rounded hover:bg-muted disabled:opacity-40" aria-label="Zoom out">
        <ZoomOut className="size-4" />
      </button>
      <span className="tabular-nums w-11 text-center">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zi + 1)])}
        disabled={zi >= ZOOM_STEPS.length - 1}
        className="size-7 grid place-items-center rounded hover:bg-muted disabled:opacity-40" aria-label="Zoom in">
        <ZoomIn className="size-4" />
      </button>
      <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1}
        className="size-7 grid place-items-center rounded hover:bg-muted disabled:opacity-40" aria-label="Fit to width">
        <Maximize2 className="size-4" />
      </button>
    </div>
  ) : null;

  return (
    <div className={cn("relative flex flex-col bg-muted/10", sizeClass, className)} style={sizeStyle}>
      {bar}
      <div ref={scrollRef} className="relative flex-1 min-h-0 overflow-auto">
      <div ref={stageRef} className="relative mx-auto">
        <canvas ref={canvasRef} className="block" />
        {rects.map((r, i) => (
          <div
            key={i}
            className="absolute rounded-[2px] pointer-events-none"
            style={{
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
              background: "rgba(250, 204, 21, 0.42)",
              mixBlendMode: "multiply",
            }}
          />
        ))}
      </div>
      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center bg-card/60 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading source page…
          </span>
        </div>
      )}
      </div>
    </div>
  );
}
