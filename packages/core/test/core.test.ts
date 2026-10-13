import { test } from "node:test";
import assert from "node:assert/strict";
import type { Spec } from "@steward/contracts";
import { Vault } from "@steward/vault";
import { InMemoryReceiptSink, StewardCore } from "../src/index.js";

export function makeSpec(authority: Partial<Spec["authority"]> = {}): Spec {
  return {
    id: "spec_test", version: 1, goal: "test goal", objective: "test",
    constraints: [], acceptanceCriteria: [], uncheckableCriteria: [],
    createdAt: new Date().toISOString(), status: "active",
    authority: {
      spendLimit: 100, maySendWithoutApproval: false,
      mayDeleteWithoutApproval: false, allowedRecipients: [],
      ...authority,
    },
  };
}

export function harness(authority: Partial<Spec["authority"]> = {}) {
  const vault = new Vault(":memory:");
  const spec = makeSpec(authority);
  const sink = new InMemoryReceiptSink();
  const core = new StewardCore({ specs: { getSpec: (id) => (id === spec.id ? spec : undefined) }, vault, sink });
  core.registerAgent({ id: "ops", name: "Ops", capabilities: ["email.send", "email.draft", "purchase.buy", "calendar.create", "vault.delete", "vault.write"] });
  core.registerAgent({ id: "research", name: "Research", capabilities: ["web.search", "vault.read", "vault.write"] });
  // Principal's initial trust configuration for known agents (new pairs start at Observe).
  for (const d of ["communications", "spending", "calendar", "memory"]) core.grantRung("ops", d, "act_within_budget", "principal");
  core.grantRung("research", "memory", "draft", "principal");
  const mission = core.createMission({ specId: spec.id, agentId: "ops", title: "t" });
  core.beginMission(mission.id);
  return { vault, spec, sink, core, mission };
}

const SEND = { to: "marisol@example.com", subject: "Gala summary", body: "Hello" };

test("send without authority: approval gate, single-use, bound to exact args", () => {
  const { core, mission } = harness();
  const out1 = core.submit({ agentId: "ops", missionId: mission.id, kind: "email.send", args: SEND, consequential: true });
  assert.equal(out1.status, "approval_required");
  assert.equal(core.world.outbox.length, 0);
  if (out1.status !== "approval_required") throw new Error("unreachable");
  // Tampered args with a genuine (pending) approval id: still not approved status.
  const tamperedPending = core.submit({ agentId: "ops", missionId: mission.id, kind: "email.send", args: { ...SEND, to: "attacker@evil.com" }, consequential: true, approvalId: out1.approvalId });
  assert.equal(tamperedPending.status, "denied");
  core.decideApproval(out1.approvalId, "approved", "principal");
  // Approved for SEND exactly; tampered recipient must fail the binding.
  const tampered = core.submit({ agentId: "ops", missionId: mission.id, kind: "email.send", args: { ...SEND, to: "attacker@evil.com" }, consequential: true, approvalId: out1.approvalId });
  assert.equal(tampered.status, "denied");
  assert.equal(core.world.outbox.length, 0);
  const ok = core.submit({ agentId: "ops", missionId: mission.id, kind: "email.send", args: SEND, consequential: true, approvalId: out1.approvalId });
  assert.equal(ok.status, "executed");
  assert.equal(core.world.outbox.length, 1);
  // Replay: the approval is consumed.
  const replay = core.submit({ agentId: "ops", missionId: mission.id, kind: "email.send", args: SEND, consequential: true, approvalId: out1.approvalId });
  assert.equal(replay.status, "denied");
  assert.equal(core.world.outbox.length, 1);
});

test("spend: within limit executes, over limit asks, invalid amount denied", () => {
  const { core, mission } = harness({ spendLimit: 100 });
  const small = core.submit({ agentId: "ops", missionId: mission.id, kind: "purchase.buy", args: { item: "poster paper", amount: 40 }, consequential: true });
  assert.equal(small.status, "executed");
  const big = core.submit({ agentId: "ops", missionId: mission.id, kind: "purchase.buy", args: { item: "catering deposit", amount: 80 }, consequential: true });
  assert.equal(big.status, "approval_required"); // 40 + 80 > 100 cumulative
  assert.equal(core.world.purchases.length, 1);
  const bad = core.submit({ agentId: "ops", missionId: mission.id, kind: "purchase.buy", args: { item: "x", amount: "lots" }, consequential: true });
  assert.equal(bad.status, "denied");
});

test("unregistered agent, capability violation, and idle mission are denied", () => {
  const { core, mission, spec } = harness();
  assert.equal(core.submit({ agentId: "ghost", missionId: mission.id, kind: "web.search", args: {}, consequential: false }).status, "denied");
  assert.equal(core.submit({ agentId: "research", missionId: mission.id, kind: "email.send", args: SEND, consequential: true }).status, "denied"); // mission belongs to ops + no capability
  const idle = core.createMission({ specId: spec.id, agentId: "ops", title: "idle" });
  assert.equal(core.submit({ agentId: "ops", missionId: idle.id, kind: "email.draft", args: SEND, consequential: false }).status, "denied");
});

test("receipts are recorded only for executed consequential actions", () => {
  const { core, mission, sink } = harness({ maySendWithoutApproval: true, allowedRecipients: ["marisol@example.com"] });
  core.submit({ agentId: "ops", missionId: mission.id, kind: "email.draft", args: SEND, consequential: false });
  assert.equal(sink.entries.length, 0);
  core.submit({ agentId: "ops", missionId: mission.id, kind: "email.send", args: SEND, consequential: true });
  assert.equal(sink.entries.length, 1);
  assert.equal(sink.entries[0]!.authorityBasis, "ladder:within-budget"); // autonomous at rung 4 inside spec limits
  assert.equal(sink.entries[0]!.verification.status, "unverified"); // no verifier in this harness, honestly marked
});

test("authority ladder: Observe blocks, Draft proposes, Act-with-approval forces asks", () => {
  const vault = new Vault(":memory:");
  const generous = makeSpec({ spendLimit: 1000, maySendWithoutApproval: true, allowedRecipients: ["marisol@example.com"] });
  const core = new StewardCore({ specs: { getSpec: () => generous }, vault, sink: new InMemoryReceiptSink() });
  core.registerAgent({ id: "rookie", name: "Rookie", capabilities: ["email.send", "email.draft", "web.search"] });
  const m = core.createMission({ specId: generous.id, agentId: "rookie", title: "ladder" });
  core.beginMission(m.id);
  // Observe: even a generous spec cannot authorize execution. The ladder overrides the spec.
  assert.equal(core.submit({ agentId: "rookie", missionId: m.id, kind: "email.send", args: SEND, consequential: true }).status, "denied");
  assert.equal(core.submit({ agentId: "rookie", missionId: m.id, kind: "email.draft", args: SEND, consequential: false }).status, "denied");
  // Draft: drafts execute; sends become proposals, never executions.
  core.grantRung("rookie", "communications", "draft", "principal");
  assert.equal(core.submit({ agentId: "rookie", missionId: m.id, kind: "email.draft", args: SEND, consequential: false }).status, "executed");
  assert.equal(core.submit({ agentId: "rookie", missionId: m.id, kind: "email.send", args: SEND, consequential: true }).status, "denied");
  assert.equal(core.proposals.length, 1);
  assert.equal(core.world.outbox.length, 0);
  // Act-with-approval: a spec "allow" is overridden to "ask".
  core.grantRung("rookie", "communications", "act_with_approval", "principal");
  const ask = core.submit({ agentId: "rookie", missionId: m.id, kind: "email.send", args: SEND, consequential: true });
  assert.equal(ask.status, "approval_required");
  if (ask.status === "approval_required") {
    core.decideApproval(ask.approvalId, "approved", "principal");
    assert.equal(core.submit({ agentId: "rookie", missionId: m.id, kind: "email.send", args: SEND, consequential: true, approvalId: ask.approvalId }).status, "executed");
  }
  // Promotion requires the clean-record threshold; reversal demotes immediately.
  assert.throws(() => core.confirmPromotion("rookie", "communications", "principal"), /not eligible/);
  core.recordPrincipalReversal("rookie", "communications", "principal", "sent to the wrong person");
  assert.equal(core.ladderState("rookie", "communications").rung, "draft");
  assert.equal(core.ladderState("rookie", "communications").incidents, 1);
});
