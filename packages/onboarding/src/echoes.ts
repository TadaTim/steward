import type { Approval, DeletionProof, Memory } from "@steward/contracts";
import type { Vault } from "@steward/vault";
import type { StewardCore } from "@steward/core";

/**
 * Decision echoes (minimal real version).
 *
 * Every approval decision the principal makes is data. This tracker watches
 * decisions (wired to the Core's onApprovalDecided hook), groups them into
 * rule classes, and when a DENIAL pattern crosses the threshold —
 * ECHO_THRESHOLD = 3 consistent denials in one class — it writes a
 * PROVISIONAL inferred rule into the Vault (provenance: inferred /
 * decision-echo, assertedBy "steward-inference", so it is born provisional)
 * and surfaces it in the brief and Mission Control.
 *
 * The principal then decides the inference's fate:
 *  - confirm -> Vault promotes it to confirmed with owner-confirmed
 *    provenance AND it is compiled into a Policy Core hard line, so it
 *    actually governs subsequent decisions;
 *  - reject  -> the inference is deleted from the Vault with the standard
 *    zero-residual deletion proof, and the class is never re-inferred.
 *
 * Rule classes are deliberately simple and legible (the owner must be able
 * to read the rule and know exactly what it will do):
 *   "<kind>:weekend"  — decided on a Saturday/Sunday (UTC)
 *   "<kind>:evening"  — decided at/after 17:00 UTC on a weekday
 *   "<kind>:any"      — everything else
 */
export const ECHO_THRESHOLD = 3;

export function classKeyFor(actionKind: string, atIso: string): string {
  const at = new Date(atIso);
  const day = at.getUTCDay();
  if (day === 0 || day === 6) return `${actionKind}:weekend`;
  if (at.getUTCHours() >= 17) return `${actionKind}:evening`;
  return `${actionKind}:any`;
}

export function ruleTextFor(classKey: string): string {
  const [kind, when] = classKey.split(":");
  const what =
    kind === "email.send" ? "Email sends" :
    kind === "purchase.buy" ? "Purchases" :
    kind === "vault.delete" ? "Memory deletions" :
    `${kind} actions`;
  const timing =
    when === "weekend" ? "on weekends" :
    when === "evening" ? "in the evening (at/after 17:00 UTC)" :
    "at any time";
  return `${what} ${timing} are denied — inferred from ${ECHO_THRESHOLD} consistent denials. If confirmed, this becomes a hard line: such actions are denied outright (the agent can still ask you to lift the line, but cannot execute).`;
}

function subjectFor(classKey: string): string {
  return `rule:inferred:${classKey}`;
}

interface ClassState {
  lastDecision: "approved" | "denied" | null;
  streak: number;
  inferenceId: string | null;
  confirmed: boolean;
  rejected: boolean;
}

export class DecisionEchoes {
  private classes = new Map<string, ClassState>();

  constructor(private deps: { vault: Vault; core: StewardCore }) {}

  /** Feed every principal approval decision here (the Core hook does this). */
  observeDecision(approval: Approval, decision: "approved" | "denied"): Memory | null {
    if (approval.actionKind.startsWith("ladder.")) return null;
    const key = classKeyFor(approval.actionKind, approval.createdAt);
    const st = this.classes.get(key) ?? { lastDecision: null, streak: 0, inferenceId: null, confirmed: false, rejected: false };
    if (st.lastDecision === decision) st.streak += 1;
    else { st.lastDecision = decision; st.streak = 1; }
    this.classes.set(key, st);
    if (decision !== "denied" || st.streak < ECHO_THRESHOLD || st.inferenceId || st.confirmed || st.rejected) return null;
    const memory = this.deps.vault.assertMemory({
      kind: "rule",
      subject: subjectFor(key),
      content: ruleTextFor(key),
      consentScope: ["*"],
      assertedBy: "steward-inference", source: "inferred:decision-echo",
    });
    st.inferenceId = memory.id;
    return memory;
  }

  /** Provisional inferred rules awaiting the principal's verdict. */
  pendingInferences(): Memory[] {
    return this.deps.vault.exportPackage().memories
      .filter((m) => m.state === "provisional" && m.provenance.source.includes("decision-echo"));
  }

  private classOf(memory: Memory): string {
    return memory.subject.replace(/^rule:inferred:/, "");
  }

  /**
   * Principal confirms: the inference becomes owner-confirmed in the Vault
   * AND compiles into a Policy Core hard line, so it governs from now on.
   */
  confirmRule(memoryId: string, actor: string): Memory {
    const memory = this.deps.vault.confirmInferred(memoryId, actor);
    const key = this.classOf(memory);
    const [kind, when] = key.split(":");
    this.deps.core.addHardLine({
      kind,
      ...(when === "weekend" ? { daysUtc: [0, 6] } : {}),
      ...(when === "evening" ? { hourGteUtc: 17 } : {}),
      description: memory.content,
      source: "owner-confirmed:decision-echo",
    });
    const st = this.classes.get(key);
    if (st) st.confirmed = true;
    return memory;
  }

  /**
   * Principal rejects: the inference is deleted (with zero-residual proof)
   * and the class is never inferred again. Rejected inferences are not kept.
   */
  rejectRule(memoryId: string, actor: string): DeletionProof {
    const memory = this.deps.vault.getByIdFor("principal", memoryId);
    const { proof } = this.deps.vault.deleteWithProof(memoryId, actor);
    if (memory) {
      const st = this.classes.get(this.classOf(memory));
      if (st) { st.rejected = true; st.inferenceId = null; }
    }
    return proof;
  }
}
