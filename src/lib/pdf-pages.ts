/**
 * Deterministic per-page text extraction for PDF buffers.
 * Used to anchor chunker output to real page numbers instead of letting
 * the LLM guess. Returns one entry per page in document order.
 *
 * Uses `unpdf` — a serverless-safe PDF library that ships its own pdfjs build
 * with the browser globals (DOMMatrix etc.) polyfilled, so it runs in the
 * Vercel Node runtime where bare pdfjs-dist crashes ("DOMMatrix is not
 * defined"). Imported lazily to keep the pdf chain out of cold-start.
 */
export async function extractPdfPages(
  buffer: Buffer
): Promise<Array<{ page: number; text: string }>> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages.map((t, i) => ({ page: i + 1, text: String(t ?? "").trim() }));
}

/**
 * Build a single text blob with explicit page markers the LLM can use
 * as ground truth when emitting per-chunk page numbers.
 */
export function pagesToMarkedText(
  pages: Array<{ page: number; text: string }>
): string {
  return pages
    .filter((p) => p.text.length > 0)
    .map((p) => `=== PAGE ${p.page} ===\n${p.text}`)
    .join("\n\n");
}

/** A page holding fewer characters than this is treated as having no text
 *  layer — a scanned image. Signature pages are the common case: a report is
 *  typed, then the signed sheets are scanned back in, so a document can be
 *  95% text and still hide its dates inside four pictures. */
export const IMAGE_ONLY_PAGE_MIN_CHARS = 80;

/** Page numbers whose text layer is absent or too thin to be real content. */
export function imageOnlyPages(
  pages: Array<{ page: number; text: string }>,
  min: number = IMAGE_ONLY_PAGE_MIN_CHARS
): number[] {
  return pages.filter((p) => p.text.trim().length < min).map((p) => p.page);
}

/**
 * Like `pagesToMarkedText`, but leaves a marker where a page has no text layer
 * instead of dropping it. `pagesToMarkedText` filters empty pages out entirely,
 * which makes an image-only page invisible — the model sees page 7 followed by
 * page 11 and reports, correctly, that the pages were never provided. The
 * marker tells it the page exists and where to go and read it.
 */
export function pagesToMarkedTextWithGaps(
  pages: Array<{ page: number; text: string }>,
  min: number = IMAGE_ONLY_PAGE_MIN_CHARS
): string {
  return pages
    .map((p) =>
      p.text.trim().length < min
        ? `=== PAGE ${p.page} ===\n[This page has no text layer — it is a scanned image. Read it from the attached PDF.]`
        : `=== PAGE ${p.page} ===\n${p.text}`
    )
    .join("\n\n");
}
