import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault } from "../src/index.js";

function freshVault(): Vault {
  return new Vault(":memory:");
}

test("agents assert provisional memories; principal asserts confirmed", () => {
  const v = freshVault();
  const a = v.assertMemory({ kind: "fact", subject: "project:kitchen", content: "Budget is $8,000", consentScope: ["ops"], assertedBy: "ops", source: "mission" });
  assert.equal(a.state, "provisional");
  const p = v.assertMemory({ kind: "preference", subject: "principal", content: "Prefers morning appointments", consentScope: ["*"], assertedBy: "principal", source: "interview" });
  assert.equal(p.state, "confirmed");
});

test("consent scope: cross-scope reads are architecturally invisible + logged", () => {
  const v = freshVault();
  const secret = v.assertMemory({ kind: "fact", subject: "person:sam", content: "Sam's door code is 4417", consentScope: ["ops"], assertedBy: "principal", source: "interview" });
  assert.equal(v.getByIdFor("research", secret.id), null);
  assert.equal(v.listFor("research").find((m) => m.id === secret.id), undefined);
  assert.equal(v.searchFor("research", "door code").find((x) => x.memory.id === secret.id), undefined);
  const denial = v.accessLog.find((e) => e.memoryId === secret.id && !e.granted);
  assert.ok(denial, "denial must be logged");
  assert.ok(v.getByIdFor("ops", secret.id));
});

test("state machine: only principal transitions, illegal transitions throw", () => {
  const v = freshVault();
  const m = v.assertMemory({ kind: "fact", subject: "project:x", content: "c", consentScope: ["*"], assertedBy: "ops", source: "s" });
  assert.throws(() => v.transitionState(m.id, "confirmed", "ops"));
  assert.equal(v.transitionState(m.id, "contested", "principal").state, "contested");
  assert.equal(v.transitionState(m.id, "confirmed", "principal").state, "confirmed");
});

test("deletion proof: residue is zero everywhere after delete", () => {
  const v = freshVault();
  const m = v.assertMemory({ kind: "fact", subject: "person:sam", content: "UNIQUE_TOKEN_xyzzy_123", consentScope: ["*"], assertedBy: "principal", source: "s" });
  const { proof } = v.deleteWithProof(m.id, "principal");
  assert.equal(proof.verified, true);
  assert.deepEqual(proof.residue, { vaultRows: 0, indexEntries: 0, ledgerContentRefs: 0 });
  assert.equal(v.count(), 0);
});

test("export -> import round trip preserves memories and scopes", () => {
  const v1 = freshVault();
  v1.assertMemory({ kind: "person", subject: "person:marisol", content: "Marisol Vega, colleague", consentScope: ["ops"], assertedBy: "principal", source: "seed" });
  v1.assertMemory({ kind: "commitment", subject: "commitment:dentist", content: "Dentist Tue 9am", data: { due: "2026-10-20T09:00:00Z" }, consentScope: ["*"], assertedBy: "principal", source: "seed" });
  const pkg = v1.exportPackage();
  const v2 = freshVault();
  const res = v2.importPackage(pkg);
  assert.equal(res.imported, 2);
  assert.equal(v2.count(), 2);
  assert.equal(v2.listFor("research").length, 1); // only the *-scoped one
});
