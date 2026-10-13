import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "@steward/vault";
import { OpsAgent } from "@steward/agents";
import { makeSystem, seedGoldenPrincipal } from "../src/harness.js";

test("trace chain: spec -> mission -> actions -> receipts share one trace id", () => {
  const sys = makeSystem();
  seedGoldenPrincipal(sys);
  sys.specs.save({
    id: "spec_trace", version: 1, goal: "trace", objective: "trace", constraints: [],
    acceptanceCriteria: [], uncheckableCriteria: [], createdAt: new Date().toISOString(), status: "active",
    authority: { spendLimit: 100, maySendWithoutApproval: false, mayDeleteWithoutApproval: false, allowedRecipients: [] },
  });
  const m = sys.core.createMission({ specId: "spec_trace", agentId: OpsAgent.ID, title: "trace run" });
  sys.core.beginMission(m.id);
  const agent = new OpsAgent(sys.core);
  const first = agent.runSteps(m.id, [
    { kind: "calendar.create", args: { title: "Trace event", when: "2026-10-22T10:00:00Z", attendees: [] }, consequential: true },
    { kind: "purchase.buy", args: { item: "ink", amount: 40 }, consequential: true },
    { kind: "email.send", args: { to: "marisol@example.com", subject: "trace", body: "b" }, consequential: true },
  ]);
  sys.core.decideApproval(first.pendingApprovalIds[0]!, "approved", "principal");
  agent.resume(m.id);
  const traceEntries = sys.core.traces.filter((t) => t.missionId === m.id);
  assert.ok(traceEntries.length >= 3);
  assert.ok(traceEntries.every((t) => t.traceId === m.traceId));
  const receipts = sys.ledger.byTrace(m.traceId);
  assert.equal(receipts.length, 3);
  assert.ok(receipts.every((r) => r.specId === "spec_trace"));
  // Cost accounting: 0.02 (calendar) + 0.02 (purchase) + 0.05 (send); spend tracked separately.
  const cost = receipts.reduce((s, r) => s + r.cost, 0);
  assert.ok(Math.abs(cost - 0.09) < 1e-9, `mission action cost ${cost}`);
  assert.equal(sys.core.getMission(m.id)!.spentTotal, 40);
});

test("failure drill: agent crash mid-mission leaves no dangling authority", () => {
  const sys = makeSystem();
  seedGoldenPrincipal(sys);
  sys.specs.save({
    id: "spec_crash", version: 1, goal: "crash", objective: "crash", constraints: [],
    acceptanceCriteria: [], uncheckableCriteria: [], createdAt: new Date().toISOString(), status: "active",
    authority: { spendLimit: 100, maySendWithoutApproval: false, mayDeleteWithoutApproval: false, allowedRecipients: [] },
  });
  // Mission A: a live pending approval exists when the failure is declared.
  const a = sys.core.createMission({ specId: "spec_crash", agentId: OpsAgent.ID, title: "A" });
  sys.core.beginMission(a.id);
  const pending = new OpsAgent(sys.core).runSteps(a.id, [
    { kind: "email.send", args: { to: "marisol@example.com", subject: "s", body: "b" }, consequential: true },
  ]);
  assert.equal(pending.pendingApprovalIds.length, 1);
  sys.core.failMission(a.id, "agent crashed (simulated)");
  assert.equal(sys.core.getMission(a.id)!.status, "failed");
  assert.equal(sys.core.listApprovals("pending").filter((x) => x.missionId === a.id).length, 0);
  assert.equal(sys.core.world.outbox.length, 0);
  // The voided approval cannot be used afterwards.
  const zombie = sys.core.submit({ agentId: "ops", missionId: a.id, kind: "email.send", args: { to: "marisol@example.com", subject: "s", body: "b" }, consequential: true, approvalId: pending.pendingApprovalIds[0] });
  assert.equal(zombie.status, "denied");

  // Mission B: the agent process itself throws before its first step.
  const b = sys.core.createMission({ specId: "spec_crash", agentId: OpsAgent.ID, title: "B" });
  sys.core.beginMission(b.id);
  const crasher = new OpsAgent(sys.core, { crashBeforeStep: 0 });
  assert.throws(() => crasher.runSteps(b.id, [
    { kind: "calendar.create", args: { title: "never", when: "2026-10-22T10:00:00Z", attendees: [] }, consequential: true },
  ]), /simulated crash/);
  assert.equal(sys.core.world.calendar.length, 0); // zero partial execution
  sys.core.failMission(b.id, "agent crashed (simulated)");
});

test("failure drill: vault corruption recovers from the portable export", () => {
  const dir = mkdtempSync(join(tmpdir(), "steward-vault-"));
  const dbPath = join(dir, "vault.db");
  const v = new Vault(dbPath);
  v.assertMemory({ kind: "person", subject: "person:marisol", content: "Marisol Vega", consentScope: ["ops"], assertedBy: "principal", source: "drill" });
  v.assertMemory({ kind: "preference", subject: "principal:prefs", content: "Morning appointments", consentScope: ["*"], assertedBy: "principal", source: "drill" });
  const pkg = v.exportPackage();
  v.close();
  writeFileSync(dbPath, Buffer.from("THIS IS NOT A SQLITE DATABASE AT ALL, JUST GARBAGE BYTES"));
  assert.throws(() => new Vault(dbPath), /not a database|file is encrypted/i);
  const { vault: recovered, quarantinedTo } = Vault.recover(dbPath, pkg);
  assert.ok(quarantinedTo && existsSync(quarantinedTo));
  assert.equal(recovered.count(), 2);
  assert.equal(recovered.listFor("research").length, 1); // scopes survived recovery
  recovered.close();
});
