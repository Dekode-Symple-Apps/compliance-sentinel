import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { BrandHeader, RuleSource, VERDICT_TONE } from "@/components/brand-widgets";
import { BRAND_RULES, CATEGORIES, CATEGORY_LABEL, GUIDELINE, OFFICIAL_FACTS, PALETTE, SOURCES, TYPEFACES, type RuleSeverity } from "@/lib/brand-guideline";
import { VERDICT_LABEL, type Verdict } from "@/lib/brand";
import { Download, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/brand/guide")({
  component: BrandGuide,
  head: () => ({ meta: [{ title: "Branding Compliance · Brand guide" }] }),
});

const CARD = "rounded-lg border border-gray-200 bg-white";
/** What missing each rule means, in the same words as a check result. */
const IF_MISSED: Record<RuleSeverity, [string, string]> = {
  critical: ["Must fix", "border-red-200 bg-red-50 text-red-800"],
  major: ["Should fix", "border-amber-200 bg-amber-50 text-amber-800"],
  minor: ["Tip", "border-sky-200 bg-sky-50 text-sky-800"],
};
const RESULTS: [Verdict, string][] = [
  ["compliant", "Nothing important is missing. It can go to the brand officer for approval."],
  ["caution", "A few things should change. The brand officer may still approve it."],
  ["red_flag", "Something important is wrong, such as the crest or an official title. Fix it before it goes out."],
];
const DOC_URL = "/templates/brand/UKAS-BG-01-Sarawak-Government-Brand-Guide-Draft-v0.2.docx";

function BrandGuide() {
  const official = BRAND_RULES.filter((r) => r.source.kind === "official").length;
  return (
    <AppShell>
      <BrandHeader title={`The ${GUIDELINE.shortName}`} subtitle="The rules every design is checked against"
        action={<a href={DOC_URL} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:border-gray-500"><Download className="size-4" /> Download as Word</a>} />
      <div className="min-h-full bg-white p-6">
        <div className="mx-auto max-w-4xl space-y-5">
          <section className={CARD + " p-4 text-sm text-gray-700 space-y-2"}>
            <p>Every design is checked against the {BRAND_RULES.length} rules below. It takes about a minute.</p>
            <p><b>{official} rules are official.</b> They come from the State Secretary's circulars. The rest are good practice until UKAS publishes a full brand guide.</p>
          </section>

          <section className={CARD}>
            <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">What the result means</h2>
            <ul className="divide-y divide-gray-100">
              {RESULTS.map(([v, text]) => (
                <li key={v} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className={cn("w-56 shrink-0 rounded-full border px-2 py-0.5 text-center text-xs font-semibold", VERDICT_TONE[v])}>{VERDICT_LABEL[v]}</span>
                  <span className="text-gray-700">{text}</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <section className={CARD}>
              <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Colours</h2>
              <div className="grid grid-cols-3 gap-3 p-4">
                {PALETTE.map((p) => (
                  <div key={p.name} className="text-sm">
                    <div className="h-10 rounded-md border border-gray-200" style={{ background: p.hex }} />
                    <div className="mt-1 font-medium text-gray-900">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.role === "primary" ? "Main colour" : "Support"} · {p.hex}</div>
                  </div>
                ))}
              </div>
              <p className="px-4 pb-3 text-xs text-gray-500">No official colour codes are published. These come from the state flag.</p>
            </section>
            <section className={CARD}>
              <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Fonts</h2>
              <dl className="space-y-2 p-4 text-sm">
                <div><dt className="text-gray-500">Headings</dt><dd className="font-medium text-gray-900">{TYPEFACES.headings}</dd></div>
                <div><dt className="text-gray-500">Text</dt><dd className="font-medium text-gray-900">{TYPEFACES.body}</dd></div>
                <div><dt className="text-gray-500">If you don't have them</dt><dd className="font-medium text-gray-900">{TYPEFACES.fallback}</dd></div>
              </dl>
              <p className="px-4 pb-3 text-xs text-gray-500">No official fonts are published. These are placeholders.</p>
            </section>
          </div>

          <section className={CARD}>
            <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Good to know</h2>
            <ul className="divide-y divide-gray-100">
              {OFFICIAL_FACTS.map((f) => (
                <li key={f.text} className="px-4 py-2.5 text-sm"><span className="text-gray-900">{f.text}</span> <span className="text-xs text-gray-500">({f.ref})</span></li>
              ))}
            </ul>
          </section>

          {CATEGORIES.map((cat) => (
            <section key={cat} className={CARD}>
              <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">{CATEGORY_LABEL[cat] ?? cat}</h2>
              <ul className="divide-y divide-gray-100">
                {BRAND_RULES.filter((r) => r.category === cat).map((r) => {
                  const [word, tone] = IF_MISSED[r.severity];
                  return (
                    <li key={r.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900">{r.title}</div>
                        <div className="text-gray-700">{r.plain}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2"><RuleSource rule={r} />{r.source.note && <span className="text-xs text-gray-500">{r.source.note}</span>}</div>
                      </div>
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold", tone)} title="If this is missed">{word}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <section className={CARD}>
            <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Where the official rules come from</h2>
            <ul className="divide-y divide-gray-100">
              {SOURCES.map((s) => (
                <li key={s.id} className="px-4 py-2.5 text-sm">
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline">{s.ref} <ExternalLink className="size-3.5" /></a>
                  <div className="text-gray-700">{s.title}</div>
                  <div className="text-xs text-gray-500">{s.issuer} · {s.date}</div>
                </li>
              ))}
            </ul>
            <p className="px-4 pb-3 text-xs text-gray-500">Circulars are public on eCircular, the Sarawak Government's circular portal (ecircular.sarawak.gov.my).</p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
