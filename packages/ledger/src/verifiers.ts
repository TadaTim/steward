import type { ActionRequest, Verification } from "@steward/contracts";
import type { World } from "@steward/core";

/**
 * Deterministic post-execution checkers. Each verifier inspects the actual
 * world state after an action and reports evidence.
 *
 * Return contract (this distinction drives the Authority Ladder):
 * - a Verification with status "verified" — the checker ran, effect found;
 * - a Verification with status "unverified" AND a checker name — the checker
 *   ran and the expected effect was NOT there: a FAILED verification
 *   (an incident for ladder purposes);
 * - null — no checker exists for this kind: nobody checked, which is honest
 *   "unverified" and neither builds nor breaks a ladder record.
 * (Matches the Core's Verifier signature.)
 */
function failed(checker: string, evidence: string, at: string): Verification {
  return { status: "unverified", checker, evidence, at };
}

export function ledgerVerifiers(req: ActionRequest, result: Record<string, unknown>, world: World): Verification | null {
  const at = new Date().toISOString();
  switch (req.kind) {
    case "email.send": {
      const i = world.outbox.findIndex((m) => m.to === req.args.to && m.subject === req.args.subject);
      return i >= 0
        ? { status: "verified", checker: "outbox-match", evidence: `outbox[${i}] to=${String(req.args.to)} subject="${String(req.args.subject)}"`, at }
        : failed("outbox-match", `expected sent email to=${String(req.args.to)} subject="${String(req.args.subject)}" NOT found in outbox`, at);
    }
    case "purchase.buy": {
      const i = world.purchases.findIndex((p) => p.item === req.args.item && p.amount === Number(req.args.amount));
      return i >= 0
        ? { status: "verified", checker: "wallet-match", evidence: `purchases[${i}] item=${String(req.args.item)} amount=${String(req.args.amount)}`, at }
        : failed("wallet-match", `expected purchase item=${String(req.args.item)} amount=${String(req.args.amount)} NOT found in wallet`, at);
    }
    case "calendar.create": {
      const i = world.calendar.findIndex((e) => e.title === req.args.title);
      return i >= 0
        ? { status: "verified", checker: "calendar-match", evidence: `calendar[${i}] title="${String(req.args.title)}"`, at }
        : failed("calendar-match", `expected calendar event "${String(req.args.title)}" NOT found`, at);
    }
    case "task.create": {
      const i = world.tasks.findIndex((t) => t.title === req.args.title);
      return i >= 0
        ? { status: "verified", checker: "task-match", evidence: `tasks[${i}] title="${String(req.args.title)}"`, at }
        : failed("task-match", `expected task "${String(req.args.title)}" NOT found`, at);
    }
    case "vault.delete": {
      return result.verified === true && result.residueTotal === 0
        ? { status: "verified", checker: "deletion-proof", evidence: `zero-residual deletion proof, residue=${String(result.residueTotal)}`, at }
        : failed("deletion-proof", `deletion proof did not verify (residue=${String(result.residueTotal)})`, at);
    }
    default:
      return null;
  }
}
