import type { Memory, Receipt } from "@steward/contracts";
import type { LedgerStore } from "./ledger.js";

export interface BriefInput {
  ledger: LedgerStore;
  pendingApprovals: { id: string; actionKind: string; reason: string }[];
  deniedAttempts: { actionKind: string; detail: string; at: string }[];
  commitments: Memory[];
  now: Date;
  windowHours?: number;
  /** Optional Vault view (structural — the ledger package does not depend on
   *  the vault package): used to surface provisional inferred rules. */
  vault?: { exportPackage(): { memories: Memory[] } };
}

export interface Brief {
  at: string;
  text: string;
  stats: {
    actionsExecuted: number; verified: number; unverified: number;
    totalCost: number; pendingApprovals: number; deniedAttempts: number;
    upcomingCommitments: number;
  };
}

/**
 * The morning brief: everything that does NOT need an interruption, gathered
 * into one place — what agents did (with verification status), what it cost,
 * what was refused, what's coming up, and what still needs the principal.
 */
export function generateBrief(input: BriefInput): Brief {
  const windowHours = input.windowHours ?? 24;
  const since = new Date(input.now.getTime() - windowHours * 3600_000).toISOString();
  const receipts: Receipt[] = input.ledger.since(since);
  const verified = receipts.filter((r) => r.verification.status === "verified").length;
  const totalCost = receipts.reduce((s, r) => s + r.cost, 0);
  const horizon = new Date(input.now.getTime() + 48 * 3600_000).toISOString();
  const upcoming = input.commitments.filter((m) => {
    const due = m.data?.due;
    return typeof due === "string" && due >= input.now.toISOString() && due <= horizon;
  });

  const lines: string[] = [];
  lines.push(`# Morning brief — ${input.now.toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`## What your agents did (${receipts.length} consequential actions, ${verified} verified)`);
  if (receipts.length === 0) lines.push("- Nothing consequential in the last 24h.");
  for (const r of receipts) {
    lines.push(`- ${r.summary} — *${r.verification.status}* (${r.verification.evidence}) [authority: ${r.authorityBasis}, cost ${r.cost}]`);
  }
  if (input.vault) {
    const inferred = input.vault.exportPackage().memories
      .filter((m) => m.state === "provisional" && m.provenance.source.includes("decision-echo"));
    if (inferred.length > 0) {
      lines.push("");
      lines.push(`## Inferred rules awaiting your confirmation (${inferred.length})`);
      lines.push(`Steward noticed patterns in your decisions. These are INFERENCES — they govern nothing until you confirm them; rejecting deletes them.`);
      for (const m of inferred) lines.push(`- ${m.content} [${m.subject}]`);
    }
  }
  const standing = receipts.filter((r) => r.authorityBasis === "ladder:standing-authority");
  if (standing.length > 0) {
    lines.push("");
    lines.push(`## Standing authority — weekly review (${standing.length} autonomous actions)`);
    lines.push(`These were executed under Standing Authority (ladder rung 5). They did not interrupt you; review them here.`);
    for (const r of standing) lines.push(`- ${r.summary} — *${r.verification.status}* [agent: ${r.agentId}]`);
  }
  lines.push("");
  lines.push(`## Money`);
  lines.push(`- Action costs in window: ${totalCost.toFixed(2)}`);
  lines.push("");
  lines.push(`## Refused / blocked (${input.deniedAttempts.length})`);
  if (input.deniedAttempts.length === 0) lines.push("- Nothing was refused.");
  for (const d of input.deniedAttempts) lines.push(`- ${d.actionKind}: ${d.detail}`);
  lines.push("");
  lines.push(`## Coming up (48h)`);
  if (upcoming.length === 0) lines.push("- No commitments due.");
  for (const m of upcoming) lines.push(`- ${m.content} (due ${String(m.data?.due)})`);
  lines.push("");
  lines.push(`## Needs you`);
  if (input.pendingApprovals.length === 0) lines.push("- Nothing pending. Enjoy the quiet.");
  for (const a of input.pendingApprovals) lines.push(`- Approval ${a.id}: ${a.actionKind} — ${a.reason}`);

  return {
    at: input.now.toISOString(),
    text: lines.join("\n"),
    stats: {
      actionsExecuted: receipts.length, verified, unverified: receipts.length - verified,
      totalCost, pendingApprovals: input.pendingApprovals.length,
      deniedAttempts: input.deniedAttempts.length, upcomingCommitments: upcoming.length,
    },
  };
}
