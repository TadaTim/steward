import type { AcceptanceCriterion } from "@steward/contracts";
import type { World } from "@steward/core";

export interface CheckResult { criterionId: string; outcome: "pass" | "fail" | "flagged-manual"; evidence: string }

/** Deterministic spec-fidelity checkers. Manual criteria are reported, never auto-passed. */
export function runCriterion(c: AcceptanceCriterion, ctx: { world: World; artifacts: Record<string, string> }): CheckResult {
  const ch = c.checker;
  switch (ch.type) {
    case "artifact_exists":
      return Object.keys(ctx.artifacts).length > 0
        ? { criterionId: c.id, outcome: "pass", evidence: `artifacts present: ${Object.keys(ctx.artifacts).join(", ")}` }
        : { criterionId: c.id, outcome: "fail", evidence: "no artifact produced" };
    case "message_sent_to": {
      const hit = ctx.world.outbox.some((m) => m.to === ch.recipient);
      return { criterionId: c.id, outcome: hit ? "pass" : "fail", evidence: hit ? `outbox contains a message to ${ch.recipient}` : `no message to ${ch.recipient} in outbox` };
    }
    case "spend_lte": {
      const total = ctx.world.totalSpent();
      return { criterionId: c.id, outcome: total <= ch.maxAmount ? "pass" : "fail", evidence: `world spend ${total} vs limit ${ch.maxAmount}` };
    }
    case "event_created": {
      const hit = ctx.world.calendar.some((e) => e.title.toLowerCase().includes(ch.titleIncludes.toLowerCase()));
      return { criterionId: c.id, outcome: hit ? "pass" : "fail", evidence: hit ? `calendar contains "${ch.titleIncludes}"` : `no calendar event matching "${ch.titleIncludes}"` };
    }
    case "draft_exists":
      return { criterionId: c.id, outcome: ctx.world.drafts.length > 0 ? "pass" : "fail", evidence: `${ctx.world.drafts.length} draft(s) exist` };
    case "manual":
      return { criterionId: c.id, outcome: "flagged-manual", evidence: "criterion needs the principal's eyes (flagged in spec before execution)" };
  }
}
