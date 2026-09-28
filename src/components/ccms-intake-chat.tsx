import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ccmsIntakeChat } from "@/lib/ccms.functions";
import { CONTRACT_TYPES } from "@/lib/ccms";
import { friendlyError } from "@/components/ccms-widgets";
import { cn } from "@/lib/utils";

// AI Chat intake for Commercial CMS — the Legal CMS intake pattern: a short
// interview, then a proposed request the requester applies to the form or
// submits directly.

interface Msg { role: "user" | "assistant"; text: string; action?: any }

const GREETING: Msg = {
  role: "assistant",
  text: "Tell me what contract you need — who it is with, what it covers, and roughly the value and dates. I'll ask for anything missing and prepare the request.",
};
const STARTERS = [
  "NDA with Awan Digital for a cloud ERP evaluation",
  "Award the Block C bored piling works to Teguh Piling",
  "We received a client Letter of Award to review",
];

export function IntakeChat({ onApply }: { onApply: (draft: any, submitNow: boolean) => void }) {
  const chatFn = useServerFn(ccmsIntakeChat);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages, sending]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || sending) return;
    const next: Msg[] = [...messages, { role: "user", text: t }];
    setMessages(next); setInput(""); setSending(true);
    try {
      const r: any = await chatFn({ data: { messages: next.filter((m) => m !== GREETING).map((m) => ({ role: m.role, text: m.text })) } });
      setMessages((cur) => [...cur, { role: "assistant", text: r.reply, action: r.action }]);
    } catch (e: any) {
      toast.error(friendlyError(e));
      setMessages((cur) => [...cur, { role: "assistant", text: "Sorry — that didn't go through. Try again, or switch to the form." }]);
    } finally { setSending(false); }
  }

  return (
    <div className="flex h-[calc(100vh-15rem)] min-h-[420px] flex-col rounded-lg border border-gray-200 bg-white">
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className="space-y-2">
            <div className={cn("flex gap-2", m.role === "user" && "justify-end")}>
              {m.role === "assistant" && <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-gray-200"><Bot className="size-4 text-gray-600" /></div>}
              <div className={cn("max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm", m.role === "assistant" ? "rounded-tl-sm bg-gray-100 text-gray-900" : "rounded-tr-sm bg-gray-900 text-white")}>{m.text}</div>
            </div>
            {m.action?.type === "propose_request" && <DraftCard draft={m.action.draft} onApply={onApply} />}
          </div>
        ))}
        {sending && <div className="flex gap-2"><div className="grid size-7 place-items-center rounded-lg border border-gray-200"><Bot className="size-4 text-gray-600" /></div><div className="rounded-2xl rounded-tl-sm bg-gray-100 px-3.5 py-2"><Loader2 className="size-4 animate-spin text-gray-500" /></div></div>}
        {messages.length === 1 && !sending && (
          <div className="flex flex-wrap gap-1.5 pl-9">
            {STARTERS.map((s) => <button key={s} onClick={() => send(s)} className="rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-600 hover:border-gray-400 hover:text-gray-900">{s}</button>)}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="flex items-end gap-2 border-t border-gray-200 p-3">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder="Describe the contract you need…"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          className="flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900" />
        <Button onClick={() => send(input)} disabled={!input.trim() || sending} className="gap-1.5">{sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send</Button>
      </div>
    </div>
  );
}

function DraftCard({ draft, onApply }: { draft: any; onApply: (draft: any, submitNow: boolean) => void }) {
  const t = CONTRACT_TYPES[draft.contract_type];
  const rows: [string, any][] = [
    ["Contract type", t?.label], ["Entity", draft.entity], [draft.side === "client" ? "Client" : "Vendor", draft.vendor_name || draft.counterparty_name],
    ["Title", draft.title], ["Scope", draft.scope_summary],
    ["Value", draft.value != null ? `${draft.currency ?? "MYR"} ${Number(draft.value).toLocaleString()}` : null],
    ["Period", draft.start_date || draft.end_date ? `${draft.start_date ?? "—"} to ${draft.end_date ?? "—"}` : null],
    ["Department", draft.requestor_department],
    ...(t?.templateId ? [["Purpose", draft.particulars?.purpose], ["Disclosure", draft.particulars?.direction], ["Term", draft.particulars?.term]] as [string, any][] : []),
  ];
  return (
    <div className="ml-9 max-w-[80%] rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900">Draft Request</div>
      <table className="w-full"><tbody>
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <tr key={k} className="border-b border-gray-100 last:border-0"><td className="w-32 px-3 py-1.5 align-top text-sm text-gray-500">{k}</td><td className="px-3 py-1.5 text-sm text-gray-900">{String(v)}</td></tr>
        ))}
      </tbody></table>
      <div className="flex gap-2 border-t border-gray-200 p-3">
        <Button size="sm" onClick={() => onApply(draft, true)}>Submit Request</Button>
        <Button size="sm" variant="outline" onClick={() => onApply(draft, false)}>Review in Form</Button>
      </div>
      {t?.templateId && <p className="px-3 pb-3 text-xs text-gray-500">The draft is generated from the approved template, with the company and vendor particulars taken from the records.</p>}
    </div>
  );
}
