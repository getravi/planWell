import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Bot } from "lucide-react";
import { client } from "../api.ts";
import { currency } from "../format.ts";
import { Button, Panel } from "../ui.tsx";

type Citation = { tool: string; label: string; value: number | string };
type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; citations: Citation[]; provider: string };

export function AnalystPage({
  scenario,
  compareScenario,
  selectedYear,
}: {
  scenario: string;
  compareScenario: string;
  selectedYear: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    setError("");

    const yearContext = selectedYear !== "__all__" ? `[Year filter: ${selectedYear}] ` : "";
    const questionWithContext = yearContext + question;

    const userMsg: Message = { role: "user", content: question };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    try {
      const result = await client.ask(questionWithContext, scenario, compareScenario, history);
      setMessages([
        ...nextMessages,
        {
          role: "assistant",
          content: result.answer,
          citations: result.citations,
          provider: result.provider,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages(nextMessages); // keep user message, drop optimistic assistant
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel className="span-two">
      <div className="panel-heading">
        <h2>Grounded analyst</h2>
        <Bot size={18} />
      </div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Answers grounded in approved aggregate tools over the imported cube. Ask follow-up questions
        to dig deeper.
      </p>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minHeight: 200,
          maxHeight: 480,
          padding: "8px 0",
        }}
      >
        {messages.length === 0 && !loading && (
          <p className="muted" style={{ fontSize: 13 }}>
            Try: "What is driving gross margin in GPU Cloud?" or "Compare OpEx across scenarios."
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
              gap: 4,
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 13,
                background:
                  msg.role === "user" ? "var(--accent, #1d4ed8)" : "var(--surface-raised, #f1f5f9)",
                color: msg.role === "user" ? "#fff" : "var(--fg)",
              }}
            >
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
            {msg.role === "assistant" && msg.citations.length > 0 && (
              <div className="citations" style={{ maxWidth: "80%" }}>
                {msg.citations.map((c) => (
                  <span key={c.label}>
                    {c.tool}: {c.label} ={" "}
                    {typeof c.value === "number" ? currency(c.value) : c.value}
                  </span>
                ))}
              </div>
            )}
            {msg.role === "assistant" && (
              <span style={{ fontSize: 10, color: "var(--muted)" }}>{msg.provider}</span>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: "flex-start" }}>
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 13,
                background: "var(--surface-raised, #f1f5f9)",
                color: "var(--muted)",
              }}
            >
              Thinking…
            </div>
          </div>
        )}
        {error && (
          <p className="error" style={{ fontSize: 13 }}>
            {error}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-end" }}>
        <textarea
          aria-label="Ask a follow-up question"
          value={input}
          rows={2}
          style={{ flex: 1, resize: "vertical" }}
          placeholder="Ask a question…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button type="button" disabled={!input.trim() || loading} onClick={() => void send()}>
          Send
        </Button>
      </div>
      {messages.length > 0 && (
        <button
          type="button"
          style={{
            alignSelf: "flex-start",
            marginTop: 6,
            fontSize: 11,
            color: "var(--muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
          onClick={() => {
            setMessages([]);
            setError("");
          }}
        >
          Clear conversation
        </button>
      )}
    </Panel>
  );
}
