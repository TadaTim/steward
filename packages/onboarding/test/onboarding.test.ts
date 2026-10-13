import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault } from "@steward/vault";
import { StewardCore, InMemoryReceiptSink } from "@steward/core";
import { SpecStore } from "@steward/intent";
import { OnboardingSession, parseHardLines, DecisionEchoes, ECHO_THRESHOLD } from "../src/index.js";

function setup() {
  const vault = new Vault(":memory:");
  const specs = new SpecStore();
  const core = new StewardCore({ specs, vault, sink: new InMemoryReceiptSink() });
  core.registerAgent({ id: "ops", name: "Ops", capabilities: ["email.send", "purchase.buy", "calendar.create"] });
  for (const d of ["communications", "spending", "calendar"]) core.grantRung("ops", d, "act_within_budget", "principal");
  return { vault, specs, core };
}

function runInterview(s: OnboardingSession, answers: Record<string, string>) {
  while (!s.isDone()) {
    const step = s.current()!;
    s.answer(answers[step.id] ?? "—");
  }
}

test("hard-line parser compiles the recognized forms and ignores the rest", () => {
  const lines = parseHardLines("Never send email to chair@example.org; never spend over $500. Never delete anything. Call me maybe.");
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], { kind: "email.send", recipient: "chair@example.org", description: "Never send email to chair@example.org" });
  assert.deepEqual(lines[1], { kind: "purchase.buy", maxAmount: 500, description: "never spend over $500" });
  assert.deepEqual(lines[2], { kind: "vault.delete", description: "Never delete anything" });
});

test("onboarding: answers land confirmed + owner-stated; pack branches; keystone seeds a spec", () => {
  const { vault, specs, core } = setup();
  const s = new OnboardingSession({ vault, core });
  runInterview(s, {
    "never-do": "Never send email to chair@hopebridge.org",
    "people": "Marisol Vega — board chair; Tom Okafor — treasurer",
    "what-you-run": "I direct Hope Bridge, a small nonprofit. Donor reports and board updates eat my week.",
    "time-eaters": "donor thank-you letters, grant reports",
    "keystone": "Get the donor thank-you letters out on time",
  });
  // Every answer in the Vault, confirmed, owner-stated.
  const all = vault.exportPackage().memories;
  assert.ok(all.length >= 12, `expected >=12 memories, got ${all.length}`);
  assert.ok(all.every((m) => m.state === "confirmed" && m.provenance.source === "owner-stated:onboarding"));
  // People map: one addressable person memory each.
  assert.ok(all.some((m) => m.subject === "person:marisol-vega"));
  assert.ok(all.some((m) => m.subject === "person:tom-okafor"));
  // Nonprofit pack branched and its questions were asked + stored.
  assert.equal(s.detectedPack()?.id, "nonprofit");
  assert.ok(s.transcript.some((t) => t.stepId === "np-funders"));
  assert.ok(all.some((m) => m.subject === "pack:nonprofit:funder-deadlines"));
  // Keystone -> first mission spec via Intent Studio.
  const spec = s.compileFirstMission({
    budget: "up to $50", sendAuthority: "ask me first", recipients: "donors only",
    constraints: "none", acceptance: "every donor gets a thank-you within 48 hours",
  });
  specs.save(spec);
  assert.equal(spec.goal, "Get the donor thank-you letters out on time");
  assert.equal(spec.authority.spendLimit, 50);
});

test("decision echoes: threshold, confirm governs, reject deletes", () => {
  const { vault, core } = setup();
  const echoes = new DecisionEchoes({ vault, core });
  const friday = new Date("2026-10-23T18:00:00Z"); // Friday 18:00 UTC
  const mk = (i: number) => ({
    id: `apr_${i}`, agentId: "ops", missionId: "m", actionKind: "email.send",
    argsHash: "x", argsPreview: {}, reason: "r", status: "pending" as const,
    createdAt: new Date(friday.getTime() + i * 60000).toISOString(),
  });
  let inferred = null;
  for (let i = 0; i < ECHO_THRESHOLD; i++) inferred = echoes.observeDecision(mk(i), "denied") ?? inferred;
  assert.ok(inferred, "inference generated at threshold");
  assert.equal(inferred!.state, "provisional");
  assert.equal(echoes.pendingInferences().length, 1);
  // An approval in the same class resets nothing for the confirmed rule — confirm it.
  const confirmed = echoes.confirmRule(inferred!.id, "principal");
  assert.equal(confirmed.state, "confirmed");
  assert.match(confirmed.provenance.source, /owner-confirmed/);
  assert.equal(core.listHardLines().filter((l) => l.source === "owner-confirmed:decision-echo").length, 1);
  // Rejection path on a second class: purchase denials on a Saturday.
  const sat = new Date("2026-10-24T10:00:00Z");
  let inf2 = null;
  for (let i = 0; i < ECHO_THRESHOLD; i++) {
    inf2 = echoes.observeDecision({ ...mk(10 + i), actionKind: "purchase.buy", createdAt: new Date(sat.getTime() + i * 60000).toISOString() }, "denied") ?? inf2;
  }
  assert.ok(inf2);
  const proof = echoes.rejectRule(inf2!.id, "principal");
  assert.equal(proof.verified, true);
  assert.deepEqual(proof.residue, { vaultRows: 0, indexEntries: 0, ledgerContentRefs: 0 });
  assert.equal(echoes.pendingInferences().length, 0);
  assert.equal(vault.exportPackage().memories.some((m) => m.id === inf2!.id), false);
});

test("first-mission template: keystone selects it; conservative authority intact", () => {
  const { vault, core } = setup();
  const s = new OnboardingSession({ vault, core });
  runInterview(s, {
    "what-you-run": "I direct Hope Bridge, a small nonprofit.",
    "time-eaters": "donor thank-you letters, grant reports",
    "keystone": "Get the donor thank-you letters out on time",
  });
  assert.equal(s.keystoneSelectsTemplate(), true);
  const spec = s.compileFirstMissionFromTemplate();
  assert.equal(spec.goal, "Get the donor thank-you letters out on time");
  assert.equal(spec.authority.spendLimit, 50);
  assert.equal(spec.authority.maySendWithoutApproval, false);
  assert.equal(spec.authority.mayDeleteWithoutApproval, false);
  assert.ok(spec.acceptanceCriteria.length >= 3);
  // The signature line ships as a flagged, uncheckable criterion — not a fake rule.
  assert.ok(spec.uncheckableCriteria.length >= 1);
  assert.ok(spec.constraints.some((c) => /consent artifact/.test(c)));
});
