import { useMutation } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { client } from "../api.ts";
import { currency } from "../format.ts";
import { Button, EmptyState, Label, Panel } from "../ui.tsx";

export function AnalystPage({
  scenario,
  compareScenario,
}: {
  scenario: string;
  compareScenario: string;
}) {
  const [question, setQuestion] = useState("What is driving gross margin in GPU Cloud?");
  const ask = useMutation({ mutationFn: () => client.ask(question, scenario, compareScenario) });
  return (
    <div className="grid two">
      <Panel>
        <div className="panel-heading">
          <h2>Grounded analyst</h2>
          <Bot size={18} />
        </div>
        <p className="muted">
          Answers are generated from approved aggregate tools over the imported cube.
        </p>
        <label className="analyst-question">
          <Label>Question</Label>
          <textarea
            aria-label="Ask a grounded planning question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        <Button onClick={() => ask.mutate()} disabled={ask.isPending}>
          {ask.isPending ? "Asking..." : "Ask analyst"}
        </Button>
      </Panel>
      <Panel>
        <div className="panel-heading">
          <h2>Answer</h2>
          <span>{ask.data?.provider ?? "tool-only"}</span>
        </div>
        {ask.data ? (
          <>
            <div className="answer"><ReactMarkdown>{ask.data.answer}</ReactMarkdown></div>
            <div className="citations">
              {ask.data.citations.map((citation) => (
                <span key={citation.label}>
                  {citation.tool}: {citation.label} ={" "}
                  {typeof citation.value === "number" ? currency(citation.value) : citation.value}
                </span>
              ))}
            </div>
          </>
        ) : (
          <EmptyState
            title="Ask a finance question"
            body="Try questions about revenue, gross margin, OpEx, or scenario differences."
          />
        )}
      </Panel>
    </div>
  );
}
