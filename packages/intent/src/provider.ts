/**
 * The interview engine is a deterministic dialogue manager. An LLM, when one
 * is available, improves phrasing and parsing — it sits behind THIS interface.
 * The bundled FakeLlmProvider is a rule-based implementation, clearly labeled:
 * no model is involved, and the spec schema + gates never depend on one.
 */
export interface InterviewTurn { role: "steward" | "principal"; text: string }

export interface LlmProvider {
  readonly name: string;
  /** Parse a free-text budget answer into a spend limit (whole units). */
  parseSpendLimit(answer: string): number;
  /** Parse whether the principal grants send-without-approval. Conservative: unclear => false. */
  parseSendAuthority(answer: string): boolean;
  parseRecipients(answer: string): string[];
}

export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake-rule-based-provider (no LLM)";
  parseSpendLimit(answer: string): number {
    const a = answer.toLowerCase();
    if (/(nothing|zero|none|always ask|ask first)/.test(a)) return 0;
    const m = a.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)/);
    return m ? Math.floor(Number(m[1])) : 0;
  }
  parseSendAuthority(answer: string): boolean {
    const a = answer.toLowerCase();
    if (/(always ask|ask first|never|no\b)/.test(a)) return false;
    return /(yes|may send|can send|allowed|sure|ok)/.test(a);
  }
  parseRecipients(answer: string): string[] {
    return answer.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  }
}
