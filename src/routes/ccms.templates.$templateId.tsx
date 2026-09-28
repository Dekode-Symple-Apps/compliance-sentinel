import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { CcmsHeader, CARD, TH, TD, Section } from "@/components/ccms-widgets";
import { CONTRACT_TYPES, templateById, templateFile, templateStatus } from "@/lib/ccms";
import { ArrowLeft, Download, Lock, ChevronDown, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/ccms/templates/$templateId")({
  component: TemplateDetail,
  head: () => ({ meta: [{ title: "Commercial CMS · Template" }] }),
});

function TemplateDetail() {
  const { templateId } = Route.useParams();
  const t = templateById(templateId);
  const [open, setOpen] = useState<string | null>(null);
  if (!t) return <AppShell><div className="p-10 text-sm text-red-700">Template not found.</div></AppShell>;
  const st = templateStatus(t.status);
  const locked = t.clauses.filter((c) => c.locked).length;
  const mandatory = t.clauses.filter((c) => c.mandatory && !c.locked).length;
  return (
    <AppShell>
      <CcmsHeader title={`${t.code} · ${t.title}`} subtitle={`v${t.version} · effective ${t.effectiveDate} · ${t.owner}`}
        action={<Button asChild variant="outline" className="gap-1.5"><a href={templateFile(t)} download><Download className="size-4" /> Download .docx</a></Button>} />
      <div className="p-6 bg-white min-h-full">
        <div className="mx-auto max-w-6xl space-y-4">
          <Link to="/ccms/templates" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:underline"><ArrowLeft className="size-4" /> Templates</Link>

          <section className={CARD + " p-4"}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span><span className="text-gray-500">Status</span> <span className={`ml-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span></span>
              <span><span className="text-gray-500">Contract type</span> <span className="ml-1 text-gray-900">{t.contractTypes.map((k) => CONTRACT_TYPES[k]?.label).join(", ")}</span></span>
              <span><span className="text-gray-500">Clauses</span> <span className="ml-1 text-gray-900">{t.clauses.length} · {locked} locked · {mandatory} mandatory</span></span>
            </div>
            <p className="mt-2 text-sm text-gray-700">{t.usageNote}</p>
          </section>

          <section className={CARD}>
            <table className="w-full">
              <thead><tr className="border-b border-gray-200"><th className={TH}>Clause</th><th className={TH}>Status</th><th className={TH}>Approved Position</th></tr></thead>
              <tbody>
                {t.clauses.map((c) => (
                  <Fragment key={c.id}>
                    <tr className="border-b border-gray-100 cursor-pointer hover:bg-gray-50/60" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <td className={TD + " w-72"}><span className="inline-flex items-center gap-1 font-medium">{open === c.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}{c.number}. {c.title}</span></td>
                      <td className={TD + " w-32"}>{c.locked ? <span className="inline-flex items-center gap-1 font-semibold text-red-800"><Lock className="size-3.5" /> Locked</span> : c.mandatory ? "Mandatory" : <span className="text-gray-500">Optional</span>}</td>
                      <td className={TD + " text-gray-700"}>{c.keyPosition}</td>
                    </tr>
                    {open === c.id && (
                      <tr className="border-b border-gray-100">
                        <td colSpan={3} className="px-10 py-3 space-y-2">{c.paragraphs.map((p, i) => <p key={i} className="text-sm text-gray-800">{p}</p>)}</td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </section>

          {t.assumptions.length > 0 && (
            <Section title="Pending Confirmation" summary={`${t.assumptions.length} item${t.assumptions.length === 1 ? "" : "s"} before adoption`}>
              <ul className="list-disc px-8 py-3 text-sm text-gray-700 space-y-0.5">{t.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </Section>
          )}
        </div>
      </div>
    </AppShell>
  );
}
