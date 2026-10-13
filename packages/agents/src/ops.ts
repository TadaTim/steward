import type { ActionOutcome } from "@steward/contracts";
import type { StewardCore } from "@steward/core";

export interface OpsStep {
  kind: string;
  args: Record<string, unknown>;
  consequential: boolean;
}

interface MissionProgress {
  steps: OpsStep[];
  nextIndex: number;
  outcomes: ActionOutcome[];
}

/**
 * Reference Ops Agent: calendar / email / tasks / purchases, executed as an
 * explicit step plan through the mediation core. When a step needs approval,
 * the agent pauses; after the principal decides, `resume` picks up exactly
 * where it stopped, resubmitting the approved step with its approval token.
 */
export class OpsAgent {
  static readonly ID = "ops";
  static readonly CAPABILITIES = [
    "calendar.list", "calendar.create", "email.list", "email.draft", "email.send",
    "task.create", "purchase.buy", "vault.read", "vault.write", "vault.delete",
  ];

  private progress = new Map<string, MissionProgress>();

  constructor(private core: StewardCore, private opts: { crashBeforeStep?: number } = {}) {}

  runSteps(missionId: string, steps: OpsStep[]): { outcomes: ActionOutcome[]; pendingApprovalIds: string[] } {
    this.progress.set(missionId, { steps, nextIndex: 0, outcomes: [] });
    return this.advance(missionId);
  }

  resume(missionId: string): { outcomes: ActionOutcome[]; pendingApprovalIds: string[] } {
    return this.advance(missionId);
  }

  private advance(missionId: string): { outcomes: ActionOutcome[]; pendingApprovalIds: string[] } {
    const p = this.progress.get(missionId);
    if (!p) throw new Error(`no progress recorded for mission ${missionId}`);
    const pending: string[] = [];
    while (p.nextIndex < p.steps.length) {
      const idx = p.nextIndex;
      if (this.opts.crashBeforeStep === idx) {
        throw new Error(`agent crashed before step ${idx} (simulated crash)`);
      }
      const step = p.steps[idx]!;
      // If the principal has approved this exact step, submit with the token.
      const approved = this.core.findApprovedApproval(OpsAgent.ID, missionId, step.kind, step.args);
      const out = this.core.submit({
        agentId: OpsAgent.ID, missionId, kind: step.kind, args: step.args,
        consequential: step.consequential, approvalId: approved?.id,
      });
      p.outcomes.push(out);
      if (out.status === "approval_required") {
        pending.push(out.approvalId);
        return { outcomes: p.outcomes, pendingApprovalIds: pending };
      }
      p.nextIndex += 1;
    }
    return { outcomes: p.outcomes, pendingApprovalIds: pending };
  }
}
