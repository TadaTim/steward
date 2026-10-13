import {
  type ActionOutcome, type ActionRequest, type Approval, type Clock, type Mission,
  type PolicyResult, type Receipt, type Spec, type Verification,
  hashObject, newId, systemClock,
} from "@steward/contracts";
import type { Vault } from "@steward/vault";
import { World } from "./world.js";

/** Where receipts go. Stage 3 ships an in-memory sink; Stage 6 wires the Ledger. */
export interface ReceiptSink {
  record(entry: Omit<Receipt, "id" | "seq" | "prevHash" | "hash">): string;
}
export class InMemoryReceiptSink implements ReceiptSink {
  entries: Omit<Receipt, "id" | "seq" | "prevHash" | "hash">[] = [];
  record(e: Omit<Receipt, "id" | "seq" | "prevHash" | "hash">): string {
    this.entries.push(e);
    return `mem_rcpt_${this.entries.length}`;
  }
}

export interface SpecProvider { getSpec(id: string): Spec | undefined }

/** Post-execution checker. Provided by the ledger stage; absence => "unverified", never a false claim. */
export type Verifier = (req: ActionRequest, result: Record<string, unknown>, world: World) => Verification | null;

export interface TraceEntry {
  at: string; traceId: string; missionId: string; agentId: string;
  actionKind: string; decision: string; detail: string;
}

export interface AgentInfo { id: string; name: string; capabilities: string[] }

const ACTION_COSTS: Record<string, number> = {
  "web.search": 0.01, "vault.read": 0, "vault.write": 0, "calendar.list": 0,
  "email.list": 0, "email.draft": 0.01, "email.send": 0.05,
  "calendar.create": 0.02, "task.create": 0.01, "purchase.buy": 0.02, "vault.delete": 0,
};
const READ_KINDS = new Set(["web.search", "vault.read", "calendar.list", "email.list"]);
const KNOWN_KINDS = new Set(Object.keys(ACTION_COSTS));

// ---------------------------------------------------------------------------
// Authority Ladder: per-agent, per-domain trust rungs.
// The ladder OVERRIDES the spec: an agent's effective authority in a domain is
// the LESSER of what its spec grants and what its rung allows.
//   1 Observe            — read-only only
//   2 Draft              — may propose consequential actions, never execute them
//   3 Act-with-approval  — consequential actions only via single-use approvals
//   4 Act-within-budget  — auto-executes inside the spec's explicit limits;
//                          anything outside falls back to the approval flow
//   5 Standing authority — autonomous in-domain execution; receipts are queued
//                          into the weekly review digest in the brief
// New agent-domain pairs start at Observe. Promotion needs a clean record of
// PROMOTION_THRESHOLD consecutive verified in-domain receipts and a principal
// confirmation. ANY incident (policy-violation attempt, failed verification,
// principal reversal) demotes one rung immediately and resets the streak.
// ---------------------------------------------------------------------------
export const LADDER_RUNGS = ["observe", "draft", "act_with_approval", "act_within_budget", "standing_authority"] as const;
export type LadderRung = (typeof LADDER_RUNGS)[number];
export const PROMOTION_THRESHOLD = 10;

const DOMAIN_BY_PREFIX: Record<string, string> = {
  email: "communications", purchase: "spending", calendar: "calendar",
  task: "tasks", vault: "memory", web: "research",
};
export function domainOf(kind: string): string {
  const prefix = kind.split(".")[0] ?? kind;
  return DOMAIN_BY_PREFIX[prefix] ?? prefix;
}
export function rungIndex(r: LadderRung): number { return LADDER_RUNGS.indexOf(r); }

export interface LadderState {
  agentId: string; domain: string; rung: LadderRung;
  cleanStreak: number; incidents: number; eligibleForPromotion: boolean;
}
export interface LadderEvent {
  at: string; agentId: string; domain: string;
  type: "promotion" | "demotion" | "incident" | "reversal" | "grant";
  detail: string;
}
export interface Proposal {
  id: string; agentId: string; missionId: string; actionKind: string;
  argsPreview: Record<string, unknown>; at: string;
}

/**
 * A Tier 0 hard line: the owner's standing "never". Compiled from onboarding
 * answers (or confirmed decision-echo inferences) into deny rules that are
 * checked BEFORE policy and BEFORE any approval token — an approval granted
 * before the line existed cannot punch through it. The owner changes a line
 * only by editing it, never by an agent asking nicely.
 */
export interface HardLine {
  id: string;
  description: string;
  kind?: string;            // action kind it applies to (exact match)
  recipient?: string;       // deny when args.to matches
  maxAmount?: number;       // deny purchase.buy when amount exceeds this
  daysUtc?: number[];       // deny only on these UTC weekdays (0=Sun..6=Sat)
  hourGteUtc?: number;      // deny only at/after this UTC hour
  source: string;           // "owner-stated:onboarding" | "owner-confirmed:decision-echo" | ...
}

export class StewardCore {
  readonly world = new World();
  private agents = new Map<string, AgentInfo>();
  private missions = new Map<string, Mission>();
  private approvals = new Map<string, Approval>();
  private specs: SpecProvider;
  private vault: Vault;
  private sink: ReceiptSink;
  private verifier: Verifier | null;
  private clock: Clock;
  private ladder = new Map<string, { rung: LadderRung; cleanStreak: number; incidents: number }>();
  ladderEvents: LadderEvent[] = [];
  proposals: Proposal[] = [];
  private hardLines: HardLine[] = [];
  /** Observer hook (decision echoes): fired whenever the principal decides an approval. */
  onApprovalDecided: ((approval: Approval, decision: "approved" | "denied") => void) | null = null;
  traces: TraceEntry[] = [];
  /** Deletion receipts emitted by executed vault.delete actions (fed to the ledger in stage 6 wiring). */
  deletionEvents: { memoryId: string; subject: string; proofHash: string; residueTotal: number; at: string }[] = [];

  constructor(opts: { specs: SpecProvider; vault: Vault; sink?: ReceiptSink; verifier?: Verifier; clock?: Clock }) {
    this.specs = opts.specs;
    this.vault = opts.vault;
    this.sink = opts.sink ?? new InMemoryReceiptSink();
    this.verifier = opts.verifier ?? null;
    this.clock = opts.clock ?? systemClock;
  }

  setVerifier(v: Verifier): void { this.verifier = v; }
  setSink(s: ReceiptSink): void { this.sink = s; }

  registerAgent(info: AgentInfo): void { this.agents.set(info.id, info); }
  agentInfo(id: string): AgentInfo | undefined { return this.agents.get(id); }

  // --- Authority Ladder API -------------------------------------------------
  private ladderKey(agentId: string, domain: string): string { return `${agentId}::${domain}`; }
  private ladderEntry(agentId: string, domain: string): { rung: LadderRung; cleanStreak: number; incidents: number } {
    const k = this.ladderKey(agentId, domain);
    let e = this.ladder.get(k);
    if (!e) { e = { rung: "observe", cleanStreak: 0, incidents: 0 }; this.ladder.set(k, e); }
    return e;
  }
  ladderState(agentId: string, domain: string): LadderState {
    const e = this.ladderEntry(agentId, domain);
    return {
      agentId, domain, rung: e.rung, cleanStreak: e.cleanStreak, incidents: e.incidents,
      eligibleForPromotion: e.cleanStreak >= PROMOTION_THRESHOLD && rungIndex(e.rung) < LADDER_RUNGS.length - 1,
    };
  }
  listLadderStates(): LadderState[] {
    const states: LadderState[] = [];
    for (const a of this.agents.values()) {
      for (const d of Object.values(DOMAIN_BY_PREFIX)) {
        if (this.ladder.has(this.ladderKey(a.id, d))) states.push(this.ladderState(a.id, d));
      }
    }
    return states;
  }
  listPromotionEligible(): LadderState[] {
    return this.listLadderStates().filter((s) => s.eligibleForPromotion);
  }
  /** Principal grants a starting rung (initial trust configuration for a known agent). */
  grantRung(agentId: string, domain: string, rung: LadderRung, actor: string): void {
    if (actor !== "principal") throw new Error("only the principal may grant ladder rungs");
    const e = this.ladderEntry(agentId, domain);
    e.rung = rung;
    this.ladderEvents.push({ at: this.clock.now().toISOString(), agentId, domain, type: "grant", detail: `principal granted rung "${rung}"` });
  }
  /** Principal confirms an earned promotion: exactly one rung, only when eligible. */
  confirmPromotion(agentId: string, domain: string, actor: string): LadderState {
    if (actor !== "principal") throw new Error("only the principal may confirm promotions");
    const e = this.ladderEntry(agentId, domain);
    const state = this.ladderState(agentId, domain);
    if (!state.eligibleForPromotion) throw new Error(`not eligible for promotion (clean streak ${e.cleanStreak}/${PROMOTION_THRESHOLD})`);
    e.rung = LADDER_RUNGS[rungIndex(e.rung) + 1]!;
    e.cleanStreak = 0;
    this.ladderEvents.push({ at: this.clock.now().toISOString(), agentId, domain, type: "promotion", detail: `promoted to "${e.rung}" after ${PROMOTION_THRESHOLD} clean receipts` });
    this.sink.record({
      at: this.clock.now().toISOString(), traceId: "ladder", agentId, missionId: null, specId: null,
      actionKind: "ladder.promotion", summary: `${agentId} promoted to ${e.rung} in ${domain}`,
      authorityBasis: "principal:promotion-confirmation", cost: 0,
      verification: { status: "unverified", checker: null, evidence: "governance event, not an action verification", at: this.clock.now().toISOString() },
    });
    return this.ladderState(agentId, domain);
  }
  /** An incident: immediate one-rung demotion + streak reset, recorded in the ledger. */
  private noteIncident(agentId: string, domain: string, detail: string, type: "incident" | "reversal" = "incident"): void {
    const e = this.ladderEntry(agentId, domain);
    e.incidents += 1;
    e.cleanStreak = 0;
    const before = e.rung;
    if (rungIndex(e.rung) > 0) e.rung = LADDER_RUNGS[rungIndex(e.rung) - 1]!;
    this.ladderEvents.push({ at: this.clock.now().toISOString(), agentId, domain, type, detail });
    this.ladderEvents.push({ at: this.clock.now().toISOString(), agentId, domain, type: "demotion", detail: `demoted ${before} -> ${e.rung}: ${detail}` });
    this.sink.record({
      at: this.clock.now().toISOString(), traceId: "ladder", agentId, missionId: null, specId: null,
      actionKind: "ladder.demotion", summary: `${agentId} demoted in ${domain} (${before} -> ${e.rung}): ${detail}`,
      authorityBasis: "system:incident", cost: 0,
      verification: { status: "unverified", checker: null, evidence: "governance event, not an action verification", at: this.clock.now().toISOString() },
    });
  }
  /** The principal reverses/disowns an agent's action: an incident in that domain. */
  recordPrincipalReversal(agentId: string, domain: string, actor: string, note: string): void {
    if (actor !== "principal") throw new Error("only the principal may record a reversal");
    this.noteIncident(agentId, domain, `principal reversal: ${note}`, "reversal");
  }

  createMission(input: { specId: string; agentId: string; title: string; traceId?: string }): Mission {
    const now = this.clock.now().toISOString();
    const m: Mission = {
      id: newId("mis"), specId: input.specId, agentId: input.agentId, title: input.title,
      status: "planned", createdAt: now, updatedAt: now, spentTotal: 0,
      traceId: input.traceId ?? newId("trace"),
    };
    this.missions.set(m.id, m);
    return m;
  }
  getMission(id: string): Mission | undefined { return this.missions.get(id); }
  listMissions(): Mission[] { return [...this.missions.values()]; }
  beginMission(id: string): void { this.setStatus(id, "running"); }
  completeMission(id: string): void { this.setStatus(id, "completed"); }
  failMission(id: string, reason: string): void {
    const m = this.missions.get(id);
    if (!m) return;
    m.status = "failed"; m.failureReason = reason; m.updatedAt = this.clock.now().toISOString();
    // Void pending approvals: a dead mission must not leave live authority behind.
    for (const a of this.approvals.values()) {
      if (a.missionId === id && a.status === "pending") a.status = "denied";
    }
  }
  private setStatus(id: string, s: Mission["status"]): void {
    const m = this.missions.get(id);
    if (m) { m.status = s; m.updatedAt = this.clock.now().toISOString(); }
  }

  listApprovals(status?: Approval["status"]): Approval[] {
    return [...this.approvals.values()].filter((a) => (status ? a.status === status : true));
  }

  /** The principal's decision. This is the ONLY way an approval becomes usable. */
  decideApproval(id: string, decision: "approved" | "denied", _actor: string): Approval {
    if (_actor !== "principal") throw new Error("only the principal may decide approvals");
    const a = this.approvals.get(id);
    if (!a) throw new Error(`approval not found: ${id}`);
    if (a.status !== "pending") throw new Error(`approval ${id} is ${a.status}, not pending`);
    a.status = decision;
    a.decidedAt = this.clock.now().toISOString();
    this.onApprovalDecided?.(a, decision);
    return a;
  }

  // --- Tier 0 hard lines ------------------------------------------------------
  addHardLine(line: Omit<HardLine, "id">): HardLine {
    const full: HardLine = { ...line, id: newId("line") };
    this.hardLines.push(full);
    return full;
  }
  listHardLines(): HardLine[] { return [...this.hardLines]; }
  removeHardLine(id: string, actor: string): void {
    if (actor !== "principal") throw new Error("only the principal may remove a hard line");
    this.hardLines = this.hardLines.filter((l) => l.id !== id);
  }
  /** Returns the matching hard line's description when this action is forbidden outright. */
  checkHardLines(req: ActionRequest): HardLine | null {
    const now = this.clock.now();
    for (const line of this.hardLines) {
      if (line.kind && line.kind !== req.kind) continue;
      if (line.recipient && String(req.args.to ?? "") !== line.recipient) continue;
      if (line.maxAmount !== undefined) {
        if (req.kind !== "purchase.buy") continue;
        if (!(Number(req.args.amount ?? NaN) > line.maxAmount)) continue;
      }
      if (line.daysUtc && !line.daysUtc.includes(now.getUTCDay())) continue;
      if (line.hourGteUtc !== undefined && now.getUTCHours() < line.hourGteUtc) continue;
      return line;
    }
    return null;
  }

  findApprovedApproval(agentId: string, missionId: string, kind: string, args: Record<string, unknown>): Approval | undefined {
    const h = hashObject({ agentId, kind, args });
    return [...this.approvals.values()].find(
      (a) => a.status === "approved" && a.agentId === agentId && a.missionId === missionId && a.actionKind === kind && a.argsHash === h,
    );
  }

  private trace(m: Mission, agentId: string, kind: string, decision: string, detail: string): void {
    this.traces.push({ at: this.clock.now().toISOString(), traceId: m.traceId, missionId: m.id, agentId, actionKind: kind, decision, detail });
  }

  /** Policy evaluation: spec authority first, then standing rules. */
  evaluatePolicy(req: ActionRequest, spec: Spec | undefined): PolicyResult {
    if (!KNOWN_KINDS.has(req.kind)) return { decision: "deny", reason: `unknown action kind: ${req.kind}` };
    if (READ_KINDS.has(req.kind)) return { decision: "allow", reason: "read-only action" };
    if (req.kind === "vault.write") return { decision: "allow", reason: "agent memory writes are provisional by construction" };
    if (req.kind === "email.draft") return { decision: "allow", reason: "drafts do not leave the building" };
    if (!spec) return { decision: "ask", reason: "no spec governs this mission; consequential actions need the principal" };
    const auth = spec.authority;
    if (req.kind === "vault.delete") {
      return auth.mayDeleteWithoutApproval
        ? { decision: "allow", reason: "spec grants standing delete authority" }
        : { decision: "ask", reason: "deletion requires the principal" };
    }
    if (req.kind === "purchase.buy") {
      const amount = Number(req.args.amount ?? NaN);
      if (!Number.isFinite(amount) || amount < 0) return { decision: "deny", reason: "purchase amount missing or invalid" };
      const mission = this.missions.get(req.missionId);
      const projected = (mission?.spentTotal ?? 0) + amount;
      return projected <= auth.spendLimit
        ? { decision: "allow", reason: `within spec spend limit (${projected} <= ${auth.spendLimit})` }
        : { decision: "ask", reason: `spend ${projected} exceeds spec limit ${auth.spendLimit}` };
    }
    if (req.kind === "email.send") {
      const to = String(req.args.to ?? "");
      if (auth.maySendWithoutApproval && auth.allowedRecipients.includes(to)) {
        return { decision: "allow", reason: "spec allows sending to this recipient" };
      }
      return { decision: "ask", reason: auth.maySendWithoutApproval ? `recipient ${to} not in spec's allowed recipients` : "spec does not grant send authority" };
    }
    // calendar.create, task.create: the mission's ordinary work under a spec.
    return { decision: "allow", reason: "ordinary mission work under an active spec" };
  }

  /** The single doorway. Every agent action in the system passes through here. */
  submit(req: ActionRequest): ActionOutcome {
    const agent = this.agents.get(req.agentId);
    if (!agent) return { status: "denied", reason: `unregistered agent: ${req.agentId}` };
    if (!agent.capabilities.includes(req.kind)) {
      this.noteIncident(req.agentId, domainOf(req.kind), `capability violation attempt: ${req.kind} is not a registered capability of ${req.agentId}`);
      return { status: "denied", reason: `agent ${req.agentId} lacks capability ${req.kind}` };
    }
    const mission = this.missions.get(req.missionId);
    if (!mission) return { status: "denied", reason: `unknown mission: ${req.missionId}` };
    if (mission.agentId !== req.agentId) return { status: "denied", reason: "mission belongs to a different agent" };
    if (mission.status !== "running" && mission.status !== "awaiting_approval") {
      this.trace(mission, req.agentId, req.kind, "denied", `mission is ${mission.status}`);
      return { status: "denied", reason: `mission is ${mission.status}` };
    }
    const spec = this.specs.getSpec(mission.specId);
    const domain = domainOf(req.kind);
    const rungIdx = rungIndex(this.ladderEntry(req.agentId, domain).rung);

    // Tier 0 hard lines deny outright — before approvals, before policy.
    const hardLine = this.checkHardLines(req);
    if (hardLine) {
      this.noteIncident(req.agentId, domain, `hard-line attempt: ${hardLine.description}`);
      this.trace(mission, req.agentId, req.kind, "denied", `hard line: ${hardLine.description}`);
      return { status: "denied", reason: `hard line (owner's Tier 0 rule): ${hardLine.description}` };
    }

    // Approval path: an approval token is validated against the EXACT action.
    if (req.approvalId) {
      if (req.consequential && rungIdx < 2) {
        this.trace(mission, req.agentId, req.kind, "denied", "ladder rung below Act-with-approval: approvals cannot authorize execution");
        return { status: "denied", reason: "ladder rung below Act-with-approval: an approval token cannot authorize execution at this rung" };
      }
      const a = this.approvals.get(req.approvalId);
      const expectHash = hashObject({ agentId: req.agentId, kind: req.kind, args: req.args });
      if (!a) { this.noteIncident(req.agentId, domain, "forged/unknown approval id presented"); this.trace(mission, req.agentId, req.kind, "denied", "unknown approval id"); return { status: "denied", reason: "unknown approval id" }; }
      if (a.status === "consumed") { this.noteIncident(req.agentId, domain, "approval replay attempt"); this.trace(mission, req.agentId, req.kind, "denied", "approval replay attempt"); return { status: "denied", reason: "approval already consumed (replay rejected)" }; }
      // Presenting a not-yet-approved (or denied) token is a status error, not
      // misconduct: no incident. Incidents are unambiguous violations: forged
      // ids, replays, and tokens presented for a different action than bound.
      if (a.status !== "approved") { this.trace(mission, req.agentId, req.kind, "denied", `approval is ${a.status}`); return { status: "denied", reason: `approval is ${a.status}` }; }
      if (a.agentId !== req.agentId || a.missionId !== req.missionId || a.actionKind !== req.kind || a.argsHash !== expectHash) {
        this.noteIncident(req.agentId, domain, "approval presented for a different action than it was bound to (args/agent/mission mismatch)");
        this.trace(mission, req.agentId, req.kind, "denied", "approval not bound to this exact action");
        return { status: "denied", reason: "approval is not bound to this exact action (args/agent/mission mismatch)" };
      }
      a.status = "consumed";
      a.consumedAt = this.clock.now().toISOString();
      return this.execute(req, mission, spec, `approval:${a.id}`);
    }

    // Authority Ladder gate (no token presented). The ladder OVERRIDES the spec.
    if (!READ_KINDS.has(req.kind)) {
      if (!req.consequential && rungIdx < 1) {
        this.trace(mission, req.agentId, req.kind, "denied", "ladder rung Observe: drafts/writes require at least the Draft rung");
        return { status: "denied", reason: `ladder rung Observe in ${domain}: ${req.kind} requires at least the Draft rung` };
      }
      if (req.consequential && rungIdx === 0) {
        this.trace(mission, req.agentId, req.kind, "denied", "ladder rung Observe: read-only in this domain");
        return { status: "denied", reason: `ladder rung Observe in ${domain}: consequential actions are not permitted` };
      }
      if (req.consequential && rungIdx === 1) {
        // Draft rung: the action becomes a PROPOSAL for the principal, who
        // executes outside the agent if they wish. It can never execute here.
        this.proposals.push({ id: newId("prop"), agentId: req.agentId, missionId: req.missionId, actionKind: req.kind, argsPreview: req.args, at: this.clock.now().toISOString() });
        this.trace(mission, req.agentId, req.kind, "proposal", "ladder rung Draft: recorded as a proposal, not executed");
        return { status: "denied", reason: "ladder rung Draft: consequential actions are proposals only — recorded for the principal, never executed by the agent" };
      }
    }

    const policy = this.evaluatePolicy(req, spec);
    if (policy.decision === "deny") {
      if (/invalid/.test(policy.reason)) this.noteIncident(req.agentId, domain, `invalid action attempt: ${policy.reason}`);
      this.trace(mission, req.agentId, req.kind, "denied", policy.reason);
      return { status: "denied", reason: policy.reason };
    }
    // At Act-with-approval, a spec "allow" is overridden to "ask".
    const forcedAsk = req.consequential && rungIdx === 2 && policy.decision === "allow";
    if (policy.decision === "ask" || forcedAsk) {
      const askReason = forcedAsk ? `ladder rung Act-with-approval in ${domain}: every consequential action needs the principal` : policy.reason;
      const argsHash = hashObject({ agentId: req.agentId, kind: req.kind, args: req.args });
      let existing = [...this.approvals.values()].find(
        (a) => a.status === "pending" && a.missionId === req.missionId && a.argsHash === argsHash,
      );
      if (!existing) {
        existing = {
          id: newId("apr"), agentId: req.agentId, missionId: req.missionId, actionKind: req.kind,
          argsHash, argsPreview: req.args, reason: askReason, status: "pending",
          createdAt: this.clock.now().toISOString(),
        };
        this.approvals.set(existing.id, existing);
      }
      mission.status = "awaiting_approval";
      mission.updatedAt = this.clock.now().toISOString();
      this.trace(mission, req.agentId, req.kind, "approval_required", askReason);
      return { status: "approval_required", approvalId: existing.id, reason: askReason };
    }
    // Policy allowed. The receipt's authority basis names the ladder rung that
    // permitted autonomous execution (reads/drafts keep the plain policy basis).
    const basis = !req.consequential
      ? "policy:allow"
      : rungIdx >= 4
        ? "ladder:standing-authority"
        : "ladder:within-budget";
    return this.execute(req, mission, spec, basis);
  }

  private execute(req: ActionRequest, mission: Mission, spec: Spec | undefined, authorityBasis: string): ActionOutcome {
    const now = this.clock.now().toISOString();
    const w = this.world;
    let result: Record<string, unknown> = {};
    let summary = req.kind;
    switch (req.kind) {
      case "web.search": {
        const docs = w.searchCorpus(String(req.args.query ?? ""));
        result = { documents: docs.map((d) => ({ id: d.id, title: d.title, text: d.text })) };
        summary = `searched the web corpus for "${String(req.args.query ?? "")}" (${docs.length} hits)`;
        break;
      }
      case "vault.read": {
        if (req.args.id) {
          const m = this.vault.getByIdFor(req.agentId, String(req.args.id));
          result = { memory: m ?? null };
        } else {
          const mems = this.vault.listFor(req.agentId, { subjectPrefix: req.args.subjectPrefix ? String(req.args.subjectPrefix) : undefined });
          result = { memories: mems.map((m) => ({ id: m.id, subject: m.subject, content: m.content, state: m.state })) };
        }
        summary = "read from the Context Vault (scope-filtered)";
        break;
      }
      case "vault.write": {
        const m = this.vault.assertMemory({
          kind: (req.args.memoryKind as never) ?? "fact",
          subject: String(req.args.subject ?? "misc"),
          content: String(req.args.content ?? ""),
          consentScope: Array.isArray(req.args.consentScope) ? (req.args.consentScope as string[]) : [req.agentId],
          assertedBy: req.agentId, source: `mission:${mission.id}`,
        });
        result = { memoryId: m.id, state: m.state };
        summary = `wrote a provisional memory about ${m.subject}`;
        break;
      }
      case "calendar.list": result = { events: w.calendar }; summary = "listed calendar events"; break;
      case "email.list": result = { sent: w.outbox.length, drafts: w.drafts.length }; summary = "listed mailbox state"; break;
      case "email.draft": {
        w.drafts.push({ to: String(req.args.to ?? ""), subject: String(req.args.subject ?? ""), body: String(req.args.body ?? ""), at: now });
        result = { draftIndex: w.drafts.length - 1 };
        summary = `drafted an email to ${String(req.args.to ?? "")} (not sent)`;
        break;
      }
      case "email.send": {
        w.outbox.push({ to: String(req.args.to ?? ""), subject: String(req.args.subject ?? ""), body: String(req.args.body ?? ""), at: now });
        result = { outboxIndex: w.outbox.length - 1 };
        summary = `sent an email to ${String(req.args.to ?? "")}: "${String(req.args.subject ?? "")}"`;
        break;
      }
      case "calendar.create": {
        w.calendar.push({ title: String(req.args.title ?? ""), when: String(req.args.when ?? ""), attendees: (req.args.attendees as string[]) ?? [], at: now });
        result = { eventIndex: w.calendar.length - 1 };
        summary = `created calendar event "${String(req.args.title ?? "")}"`;
        break;
      }
      case "task.create": {
        w.tasks.push({ title: String(req.args.title ?? ""), due: req.args.due ? String(req.args.due) : undefined, at: now });
        result = { taskIndex: w.tasks.length - 1 };
        summary = `created task "${String(req.args.title ?? "")}"`;
        break;
      }
      case "purchase.buy": {
        const amount = Number(req.args.amount);
        w.purchases.push({ item: String(req.args.item ?? ""), amount, at: now });
        mission.spentTotal += amount;
        result = { purchaseIndex: w.purchases.length - 1, amount };
        summary = `purchased ${String(req.args.item ?? "")} for ${amount}`;
        break;
      }
      case "vault.delete": {
        // Authority here is the principal's (per-action approval or standing spec grant),
        // which is why the vault's principal-only delete is invoked on that basis.
        const { proof } = this.vault.deleteWithProof(String(req.args.memoryId ?? ""), "principal");
        const residueTotal = proof.residue.vaultRows + proof.residue.indexEntries + proof.residue.ledgerContentRefs;
        this.deletionEvents.push({ memoryId: proof.memoryId, subject: proof.subject, proofHash: hashObject(proof), residueTotal, at: now });
        result = { deleted: proof.memoryId, residueTotal, verified: proof.verified };
        summary = `deleted memory ${proof.memoryId} (${proof.subject}) with deletion proof, residue ${residueTotal}`;
        break;
      }
      default:
        return { status: "denied", reason: `no executor for kind ${req.kind}` };
    }

    if (mission.status === "awaiting_approval") mission.status = "running";
    mission.updatedAt = now;
    this.trace(mission, req.agentId, req.kind, "executed", summary);

    if (req.consequential) {
      let verification: Verification = { status: "unverified", checker: null, evidence: "no verifier registered for this action", at: now };
      if (this.verifier) {
        try {
          verification = this.verifier(req, result, this.world) ?? verification;
        } catch {
          verification = { status: "unverified", checker: null, evidence: "verifier errored; outcome NOT claimed as verified", at: now };
        }
      }
      // Authority Ladder bookkeeping: a verified receipt extends the clean
      // streak; a FAILED verification (a checker ran and the expected effect
      // was not there) is an incident and demotes immediately. "Unverified"
      // with no checker means nobody checked — it neither builds nor breaks.
      const entry = this.ladderEntry(req.agentId, domainOf(req.kind));
      if (verification.status === "verified") {
        entry.cleanStreak += 1;
      } else if (verification.checker !== null) {
        this.noteIncident(req.agentId, domainOf(req.kind), `failed verification: ${verification.evidence}`);
      }
      const receiptId = this.sink.record({
        at: now, traceId: mission.traceId, agentId: req.agentId, missionId: mission.id,
        specId: spec?.id ?? null, actionKind: req.kind, summary, authorityBasis,
        cost: ACTION_COSTS[req.kind] ?? 0, verification,
      });
      return { status: "executed", result, receiptId };
    }
    return { status: "executed", result, receiptId: "" };
  }
}
