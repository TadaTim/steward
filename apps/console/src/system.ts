import type { Receipt } from "@steward/contracts";
import { Vault } from "@steward/vault";
import { StewardCore } from "@steward/core";
import { SpecStore, InterviewSession } from "@steward/intent";
import { OpsAgent, ResearchAgent } from "@steward/agents";
import { LedgerStore, generateBrief, ledgerVerifiers, type Brief } from "@steward/ledger";
import { DecisionEchoes, OnboardingSession } from "@steward/onboarding";
import {
  createVoiceEngine, loadVoiceSettings, saveVoiceSettings, withDefaults,
  type VoiceEngine, type VoiceSettings,
} from "@steward/voice";

/** Composition root: wires vault + specs + core + ledger + echoes + voice. */
export interface StewardSystem {
  vault: Vault;
  specs: SpecStore;
  core: StewardCore;
  ledger: LedgerStore;
  echoes: DecisionEchoes;
  voice: VoiceEngine;
  voiceSettings(): VoiceSettings;
  saveVoiceSettings(s: VoiceSettings): void;
  onboarding: OnboardingSession | null;
  interview: InterviewSession | null;
  /** Console skin: "clean" (Clean Command, default) or "signal" (Signal Industrial). */
  theme(): "clean" | "signal";
  saveTheme(t: "clean" | "signal"): void;
  receipts(): Receipt[];
  brief(): Brief;
}

export function createSteward(dbPath = ":memory:"): StewardSystem {
  const vault = new Vault(dbPath);
  const specs = new SpecStore();
  const ledger = new LedgerStore(dbPath);
  const core = new StewardCore({ specs, vault, sink: ledger, verifier: ledgerVerifiers });
  // Deletion proofs scan the ledger too: no memory content may survive there.
  vault.externalScanner = {
    scannedCount: () => ledger.count(),
    residueCount: (sample) => ledger.countContentReferences(sample),
  };
  core.registerAgent({ id: ResearchAgent.ID, name: "Research Agent", capabilities: ResearchAgent.CAPABILITIES });
  core.registerAgent({ id: OpsAgent.ID, name: "Ops Agent", capabilities: OpsAgent.CAPABILITIES });
  // Principal's initial trust configuration (Authority Ladder): known agents
  // start where the principal has placed them; brand-new pairs start at Observe.
  for (const d of ["communications", "spending", "calendar", "tasks"]) core.grantRung(OpsAgent.ID, d, "act_within_budget", "principal");
  core.grantRung(OpsAgent.ID, "memory", "act_with_approval", "principal");
  core.grantRung(ResearchAgent.ID, "memory", "draft", "principal");
  core.world.corpus.push(
    { id: "doc-solar", title: "Community solar basics", text: "Community solar programs let renters subscribe to a shared solar array and save on bills." },
    { id: "doc-solar2", title: "Solar co-op guide", text: "A solar co-op negotiates group discounts on rooftop installations for members." },
  );
  // Decision echoes learn from every principal decision in the console too.
  const echoes = new DecisionEchoes({ vault, core });
  core.onApprovalDecided = (approval, decision) => { echoes.observeDecision(approval, decision); };
  const voice = createVoiceEngine();
  const sys: StewardSystem = {
    vault, specs, core, ledger, echoes, voice,
    onboarding: null,
    interview: null,
    theme: () => {
      const rows = vault.listFor("principal", { subjectPrefix: "ui:theme" });
      const t = rows[rows.length - 1]?.data?.theme;
      return t === "signal" ? "signal" : "clean";
    },
    saveTheme: (t) => {
      vault.assertMemory({
        kind: "preference", subject: "ui:theme",
        content: `Mission Control skin: ${t === "signal" ? "Signal Industrial" : "Clean Command"}`,
        data: { theme: t }, consentScope: ["*"],
        assertedBy: "principal", source: "owner-stated:console-settings",
      });
    },
    voiceSettings: () => withDefaults(loadVoiceSettings(vault), voice.candidates()),
    saveVoiceSettings: (s) => saveVoiceSettings(vault, s),
    receipts: () => ledger.all(),
    brief: () => generateBrief({
      ledger, vault,
      pendingApprovals: core.listApprovals("pending").map((a) => ({ id: a.id, actionKind: a.actionKind, reason: a.reason })),
      deniedAttempts: core.traces.filter((t) => t.decision === "denied").map((t) => ({ actionKind: t.actionKind, detail: t.detail, at: t.at })),
      commitments: vault.listFor("principal", { kind: "commitment" }),
      now: new Date(),
    }),
  };
  return sys;
}

/** Seed a small, real demo life so the console shows genuine mediated activity. */
export function seedDemo(sys: StewardSystem): void {
  const { vault, specs, core } = sys;
  vault.assertMemory({ kind: "person", subject: "person:marisol-vega", content: "Marisol Vega — colleague, gala co-chair (marisol@example.com)", consentScope: ["ops", "research"], assertedBy: "principal", source: "seed" });
  vault.assertMemory({ kind: "person", subject: "person:sam", content: "Sam — partner. Door code 4417 (ops only).", consentScope: ["ops"], assertedBy: "principal", source: "seed" });
  vault.assertMemory({ kind: "commitment", subject: "commitment:dentist", content: "Dentist appointment with Dr. Patel", data: { due: new Date(Date.now() + 26 * 3600_000).toISOString() }, consentScope: ["*"], assertedBy: "principal", source: "seed" });

  const spec = specs.save({
    id: "spec_demo", version: 1, goal: "Send Marisol the gala summary", objective: "Send Marisol the gala summary",
    constraints: [], acceptanceCriteria: [], uncheckableCriteria: [],
    createdAt: new Date().toISOString(), status: "active",
    authority: { spendLimit: 100, maySendWithoutApproval: false, mayDeleteWithoutApproval: false, allowedRecipients: [] },
  });
  void spec;
  const mission = core.createMission({ specId: "spec_demo", agentId: OpsAgent.ID, title: "Gala summary to Marisol" });
  core.beginMission(mission.id);
  const agent = new OpsAgent(core);
  const first = agent.runSteps(mission.id, [
    { kind: "calendar.create", args: { title: "Gala planning call", when: new Date(Date.now() + 48 * 3600_000).toISOString(), attendees: ["marisol@example.com"] }, consequential: true },
    { kind: "email.send", args: { to: "marisol@example.com", subject: "Gala summary", body: "Ticket sales are on track." }, consequential: true },
    { kind: "email.send", args: { to: "marisol@example.com", subject: "Gala budget update", body: "Second update, still awaiting your decision." }, consequential: true },
  ]);
  // Approve only the first send; the second stays pending so the queue has work.
  if (first.pendingApprovalIds[0]) {
    core.decideApproval(first.pendingApprovalIds[0], "approved", "principal");
    agent.resume(mission.id);
  }
}
