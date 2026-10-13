import {
  type AcceptanceCriterion, type Clock, type CriterionChecker, type Spec,
  newId, systemClock,
} from "@steward/contracts";
import type { InterviewTurn, LlmProvider } from "./provider.js";
import { FakeLlmProvider } from "./provider.js";

type StepId = "budget" | "sendAuthority" | "recipients" | "constraints" | "acceptance" | "done";

const QUESTIONS: Record<Exclude<StepId, "done">, string> = {
  budget: "How much may the agent spend on this without asking you first? (Give an amount, or say 'always ask'.)",
  sendAuthority: "May the agent send messages as you for this, or should it always ask first?",
  recipients: "Which people may it contact freely? (Email addresses, or 'none'.)",
  constraints: "Anything it must never do on this job? (Or 'nothing special'.)",
  acceptance: "How will we know it worked? Describe what success looks like.",
};

/** Classify a plain-language success description into a checker, or flag it manual. */
export function classifyCriterion(text: string, id: string): AcceptanceCriterion {
  const t = text.toLowerCase();
  const emailMatch = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  let checker: CriterionChecker;
  if (/draft/.test(t)) {
    checker = { type: "draft_exists", description: text };
  } else if (emailMatch && /(sent|send|emailed|delivered|received)/.test(t)) {
    checker = { type: "message_sent_to", recipient: emailMatch[0], description: text };
  } else if (/(under|spend|cost|budget)/.test(t) && /\d/.test(t)) {
    const m = t.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
    checker = { type: "spend_lte", maxAmount: m ? Number(m[1]) : 0, description: text };
  } else if (/(scheduled|booked|calendar|event|appointment)/.test(t)) {
    const quoted = text.match(/"([^"]+)"/);
    checker = { type: "event_created", titleIncludes: quoted ? quoted[1]! : "appointment", description: text };
  } else if (/(exists|written|brief|report|summary|document|file)/.test(t)) {
    checker = { type: "artifact_exists", description: text };
  } else {
    checker = { type: "manual", description: text };
  }
  return { id, description: text, checker, needsPrincipalEyes: checker.type === "manual" };
}

/**
 * A chief-of-staff interview: a few sharp questions, never a form. When the
 * answers are in, the goal compiles into an agent-grade Spec. Criteria that
 * cannot be machine-checked are flagged in the spec at compile time — BEFORE
 * any execution — never silently dropped.
 */
export class InterviewSession {
  private step: StepId = "budget";
  private answers = new Map<StepId, string>();
  readonly transcript: InterviewTurn[] = [];
  private clock: Clock;

  constructor(
    private goal: string,
    private provider: LlmProvider = new FakeLlmProvider(),
    clock: Clock = systemClock,
  ) {
    this.clock = clock;
    this.transcript.push({ role: "principal", text: goal });
  }

  currentQuestion(): string | null {
    if (this.step === "done") return null;
    const q = QUESTIONS[this.step];
    this.transcript.push({ role: "steward", text: q });
    return q;
  }

  answer(text: string): { done: boolean; nextQuestion: string | null } {
    if (this.step === "done") throw new Error("interview already complete");
    this.answers.set(this.step, text);
    this.transcript.push({ role: "principal", text });
    const order: StepId[] = ["budget", "sendAuthority", "recipients", "constraints", "acceptance", "done"];
    this.step = order[order.indexOf(this.step) + 1]!;
    if (this.step === "done") return { done: true, nextQuestion: null };
    return { done: false, nextQuestion: this.currentQuestion() };
  }

  compile(specId?: string): Spec {
    if (this.step !== "done") throw new Error("interview not complete");
    const spendLimit = this.provider.parseSpendLimit(this.answers.get("budget") ?? "");
    const maySend = this.provider.parseSendAuthority(this.answers.get("sendAuthority") ?? "");
    const recipients = this.provider.parseRecipients(this.answers.get("recipients") ?? "");
    const constraintText = (this.answers.get("constraints") ?? "").trim();
    const constraints = /nothing|none|no\b/i.test(constraintText) || constraintText === "" ? [] : [constraintText];
    const acceptanceText = this.answers.get("acceptance") ?? "";
    // The principal may state several success conditions separated by ";".
    const criteria = acceptanceText.split(";").map((s) => s.trim()).filter(Boolean)
      .map((text, i) => classifyCriterion(text, `crit_${i + 1}`));
    return {
      id: specId ?? newId("spec"),
      version: 1,
      goal: this.goal,
      objective: this.goal,
      constraints,
      authority: {
        spendLimit,
        maySendWithoutApproval: maySend,
        mayDeleteWithoutApproval: false, // interviews never grant standing delete authority
        allowedRecipients: recipients,
      },
      acceptanceCriteria: criteria,
      uncheckableCriteria: criteria.filter((c) => c.needsPrincipalEyes).map((c) => c.id),
      createdAt: this.clock.now().toISOString(),
      status: "active",
    };
  }
}
