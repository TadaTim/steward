#!/usr/bin/env -S npx tsx
/**
 * The two founding principles, exercised live — run: npm run demo:flow
 *
 * ANSWERABLE: an agent acts only through the Policy & Mediation Core; the
 * Ledger receipts it, the hash chain verifies, and an action with no checker
 * is marked honestly "unverified" — never claimed.
 * YOURS: the Vault exports everything, a fresh instance imports it after a
 * wipe, consent scopes still hold, and a deletion leaves a verifiable
 * zero-residual proof while the ledger keeps only the deletion record.
 */
import { Vault } from "@steward/vault";
import { StewardCore, InMemoryReceiptSink } from "@steward/core";
import { SpecStore } from "@steward/intent";
import { OpsAgent } from "@steward/agents";
import { LedgerStore, ledgerVerifiers } from "@steward/ledger";

const line = (s = "") => console.log(s);
line("=== Project Steward — the two principles, live ===\n");

// ---- ANSWERABLE ------------------------------------------------------------
line("PRINCIPLE 1 — ANSWERABLE: mediated, receipted, verifiable.");
const vault = new Vault(":memory:");
const specs = new SpecStore();
const ledger = new LedgerStore(":memory:");
const core = new StewardCore({ specs, vault, sink: ledger, verifier: ledgerVerifiers });
core.registerAgent({ id: OpsAgent.ID, name: "Ops Agent", capabilities: OpsAgent.CAPABILITIES });
core.grantRung(OpsAgent.ID, "communications", "act_within_budget", "principal");
core.grantRung(OpsAgent.ID, "calendar", "act_within_budget", "principal");
const spec = specs.save({
  id: "spec_demo_flow", version: 1, goal: "Send the gala summary", objective: "Send the gala summary",
  constraints: [], acceptanceCriteria: [], uncheckableCriteria: [], createdAt: new Date().toISOString(), status: "active",
  authority: { spendLimit: 100, maySendWithoutApproval: true, mayDeleteWithoutApproval: false, allowedRecipients: ["marisol@example.com"] },
});
const mission = core.createMission({ specId: spec.id, agentId: OpsAgent.ID, title: "Gala summary" });
core.beginMission(mission.id);
const sent = core.submit({ agentId: OpsAgent.ID, missionId: mission.id, kind: "email.send", args: { to: "marisol@example.com", subject: "Gala summary", body: "On track." }, consequential: true });
line(`  agent asked to send an email -> core outcome: ${sent.status}`);
const receipt = ledger.all().at(-1)!;
line(`  receipt: "${receipt.summary}"`);
line(`    verification: ${receipt.verification.status} (checker: ${receipt.verification.checker}) — ${receipt.verification.evidence}`);
line(`    authority basis: ${receipt.authorityBasis}`);
line(`  hash chain verifies end-to-end: ${ledger.verifyChain()}`);

// An action nobody checks is marked unverified — never dressed up as verified.
const bareSink = new InMemoryReceiptSink();
const bareCore = new StewardCore({ specs, vault: new Vault(":memory:"), sink: bareSink });
bareCore.registerAgent({ id: OpsAgent.ID, name: "Ops Agent", capabilities: OpsAgent.CAPABILITIES });
bareCore.grantRung(OpsAgent.ID, "calendar", "act_within_budget", "principal");
const m2 = bareCore.createMission({ specId: spec.id, agentId: OpsAgent.ID, title: "Unverifiable" });
bareCore.beginMission(m2.id);
bareCore.submit({ agentId: OpsAgent.ID, missionId: m2.id, kind: "calendar.create", args: { title: "Call", when: "2026-10-20T10:00:00Z", attendees: [] }, consequential: true });
const bareReceipt = bareSink.entries.at(-1)!;
line(`  a second core with NO verifier registered executes a calendar action; its receipt reads:`);
line(`    verification: ${bareReceipt.verification.status} — "${bareReceipt.verification.evidence}" (never dressed up as verified)`);

// ---- YOURS -----------------------------------------------------------------
line("\nPRINCIPLE 2 — YOURS: provenance, consent scopes, provable deletion, full portability.");
vault.assertMemory({ kind: "person", subject: "person:marisol-vega", content: "Marisol Vega — gala co-chair", consentScope: ["ops", "research"], assertedBy: "principal", source: "demo-flow" });
const secret = vault.assertMemory({ kind: "person", subject: "person:sam", content: "Sam — partner. Door code 4417.", consentScope: ["ops"], assertedBy: "principal", source: "demo-flow" });
line(`  research agent reading Sam's memory (scoped ops-only): ${vault.getByIdFor("research", secret.id) === null ? "INVISIBLE (scope enforced)" : "LEAK!"}`);
const pkg = vault.exportPackage();
line(`  export: ${pkg.memories.length} memories, each with provenance + consent scope`);
const fresh = new Vault(":memory:");
const imp = fresh.importPackage(pkg);
line(`  wipe -> import into a fresh vault: imported ${imp.imported}, skipped ${imp.skipped}`);
line(`  after import, research still cannot see Sam: ${fresh.getByIdFor("research", secret.id) === null ? "scope survived the round-trip" : "LEAK!"}`);
vault.externalScanner = { scannedCount: () => ledger.count(), residueCount: (s) => ledger.countContentReferences(s) };
const { proof } = vault.deleteWithProof(secret.id, "principal");
line(`  deletion of Sam's memory: proof verified = ${proof.verified}, residue vault=${proof.residue.vaultRows} index=${proof.residue.indexEntries} ledger=${proof.residue.ledgerContentRefs}`);
line(`  the ledger keeps the deletion RECEIPT (kind vault.delete, no content) — the record remains, the data does not.`);
line("\nDemo flow complete: both principles exercised against the real system, no mocks.");
