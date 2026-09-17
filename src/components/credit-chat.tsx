import { useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import Markdown from "react-markdown";
import { askCreditRisk } from "@/lib/compliance.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Send, Sparkles, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Why is this an overall high risk?",
  "What's the single biggest concern, and what should I probe first?",
  "Which policy clauses does this application fall outside?",
  "What does the cited case warn about, and how does it apply here?",
  "Are the proposed mitigations enough?",
];

/**
 * Turn "Case 18" mentions in an answer into buttons that open the case in the
 * evidence panel (FR-8.06). Applied to string children only; nested elements
 * are rendered by their own components and get the same treatment there.
 */
function withCaseLinks(children: ReactNode, onCite?: (caseRef: string) => void): ReactNode {
  if (!onCite) return children;
  const walk = (node: ReactNode, key: string): ReactNode => {
    if (typeof node === "string") {
      const parts = node.split(/(Case\s+\d+[A-Za-z]?)/g);
      if (parts.length === 1) return node;
      return parts.map((p, i) =>
        /^Case\s+\d+/i.test(p) ? (
          <button
            key={`${key}-${i}`}
            type="button"
            onClick={() => onCite(p)}
            className="text-blue-700 underline decoration-dotted underline-offset-2 hover:decoration-solid font-medium"
          >
            {p}
          </button>
        ) : (
          <span key={`${key}-${i}`}>{p}</span>
        ),
      );
    }
    if (Array.isArray(node)) return node.map((n, i) => walk(n, `${key}-${i}`));
    return node;
  };
  return walk(children, "c");
}

/* Markdown styling for assistant bubbles — 14px body, nothing smaller than 12px. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mdComponents = (onCite?: (caseRef: string) => void): any => ({
  p: ({ children }: any) => <p className="mb-2 last:mb-0">{withCaseLinks(children, onCite)}</p>,
  ul: ({ children }: any) => <ul className="list-disc pl-4 mb-2 last:mb-0 space-y-1">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal pl-4 mb-2 last:mb-0 space-y-1">{children}</ol>,
  li: ({ children }: any) => <li className="leading-snug">{withCaseLinks(children, onCite)}</li>,
  strong: ({ children }: any) => <strong className="font-semibold">{withCaseLinks(children, onCite)}</strong>,
  em: ({ children }: any) => <em className="italic">{children}</em>,
  h1: ({ children }: any) => <p className="font-semibold mb-1">{children}</p>,
  h2: ({ children }: any) => <p className="font-semibold mb-1">{children}</p>,
  h3: ({ children }: any) => <p className="font-semibold mb-1">{children}</p>,
  code: ({ children }: any) => (
    <code className="text-xs bg-black/5 dark:bg-white/10 rounded px-1 py-0.5">{children}</code>
  ),
});

/** The conversation itself — shared by the docked panel and the dialog. */
function ChatBody({
  reportId,
  borrower,
  onCite,
}: {
  reportId: string;
  borrower: string;
  onCite?: (caseRef: string) => void;
}) {
  const ask = useServerFn(askCreditRisk);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const MD = mdComponents(onCite);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setBusy(true);
    try {
      const { answer } = await ask({ data: { reportId, question, history } });
      setMessages((m) => [...m, { role: "assistant", content: answer || "(no answer returned)" }]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Sorry — ${e?.message ?? "something went wrong"}.` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground py-4">
            <MessageSquare className="size-7 mb-2 opacity-40" />
            <p>
              Ask about {borrower}'s assessment — the findings, the figures, or the cases it mirrors.
              Answers cite the application and the knowledge base.
            </p>
            <div className="flex flex-col items-stretch gap-2 mt-4">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-sm border rounded-lg px-3 py-2 hover:bg-muted/50 hover:border-red-200 text-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "user" ? (
              <div className="max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-red-600 text-white">
                {m.content}
              </div>
            ) : (
              <div className="max-w-[94%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed bg-muted/60 text-foreground">
                <Markdown components={MD}>{m.content}</Markdown>
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="bg-muted/60 rounded-2xl px-3.5 py-2.5 text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </div>
          </div>
        )}
      </div>

      <div className="border-t p-3 flex items-center gap-2 shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask about the risk or a case…"
          disabled={busy}
          className="flex-1 text-sm px-3 py-2 rounded-lg border bg-card focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-60"
        />
        <Button
          onClick={() => send(input)}
          disabled={busy || !input.trim()}
          className="bg-red-600 hover:bg-red-700 text-white gap-1.5 shrink-0"
          aria-label="Send"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </>
  );
}

/**
 * Docked chat panel for the report screen: sits beside the assessment so the
 * reader keeps their place while asking (FR-8.01). "Case NN" in an answer
 * opens that case in the evidence panel.
 */
export function CreditChatPanel({
  reportId,
  borrower,
  onClose,
  onCite,
}: {
  reportId: string;
  borrower: string;
  onClose: () => void;
  onCite?: (caseRef: string) => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 border-b flex items-center gap-2 shrink-0">
        <Sparkles className="size-4 text-red-600 shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">Ask about this assessment</div>
          <div className="text-xs text-muted-foreground truncate">{borrower}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto size-8 grid place-items-center rounded-md hover:bg-muted text-muted-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>
      <ChatBody reportId={reportId} borrower={borrower} onCite={onCite} />
    </div>
  );
}

/** Dialog variant — kept for any caller that wants the chat as a modal. */
export function CreditChat({
  open,
  onOpenChange,
  reportId,
  borrower,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reportId: string;
  borrower: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 flex flex-col h-[80vh]">
        <DialogHeader className="px-5 py-3.5 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-red-600" /> Ask about {borrower}'s risk
          </DialogTitle>
          <DialogDescription className="text-sm">
            Answers draw only from this report's analysis and the case knowledge base.
          </DialogDescription>
        </DialogHeader>
        <ChatBody reportId={reportId} borrower={borrower} />
      </DialogContent>
    </Dialog>
  );
}
