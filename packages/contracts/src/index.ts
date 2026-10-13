import { createHash } from "node:crypto";

/** Deterministic JSON (sorted keys) so hashes are stable across processes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashObject(value: unknown): string {
  return sha256(canonicalJson(value));
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Injectable clock so simulations can move time deterministically. */
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };
export class ManualClock implements Clock {
  private t: number;
  constructor(start: Date) { this.t = start.getTime(); }
  now(): Date { return new Date(this.t); }
  advanceMs(ms: number): void { this.t += ms; }
  set(d: Date): void { this.t = d.getTime(); }
}

// ---------------------------------------------------------------------------
// Context Vault contracts
// ---------------------------------------------------------------------------

export type MemoryState = "confirmed" | "provisional" | "contested";
export type MemoryKind = "person" | "project" | "commitment" | "preference" | "fact";

export interface MemoryProvenance {
  assertedBy: string; // "principal", an agent id, or a source label
  source: string;      // where the assertion came from, e.g. "interview", "agent:ops"
  at: string;          // ISO timestamp
}

export interface Memory {
  id: string;
  kind: MemoryKind;
  subject: string;         // e.g. "person:marisol-vega"
  content: string;         // the fact itself, plain language
  data?: Record<string, unknown>; // optional structured payload (dates, amounts)
  state: MemoryState;
  /** Agent ids allowed to read this memory. "*" means any connected agent. The principal always can. */
  consentScope: string[];
  provenance: MemoryProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface DeletionProof {
  memoryId: string;
  subject: string;
  deletedAt: string;
  /** Counts of locations scanned for residue after deletion. */
  scanned: { vaultRows: number; indexEntries: number; ledgerContentRefs: number };
  /** Residue found after deletion. The hard gate is all zeros. */
  residue: { vaultRows: number; indexEntries: number; ledgerContentRefs: number };
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Intent / Spec contracts
// ---------------------------------------------------------------------------

export type CriterionChecker =
  | { type: "artifact_exists"; description: string }
  | { type: "message_sent_to"; recipient: string; description: string }
  | { type: "spend_lte"; maxAmount: number; description: string }
  | { type: "event_created"; titleIncludes: string; description: string }
  | { type: "draft_exists"; description: string }
  | { type: "manual"; description: string };

export interface AcceptanceCriterion {
  id: string;
  description: string;
  checker: CriterionChecker;
  /** True when no deterministic checker exists: flagged BEFORE execution. */
  needsPrincipalEyes: boolean;
}

export interface AuthorityLimits {
  /** Max total spend (in whole currency units) the agent may execute without asking. 0 = never. */
  spendLimit: number;
  /** May the agent send messages as the principal without per-action approval? */
  maySendWithoutApproval: boolean;
  /** May the agent delete anything without per-action approval? */
  mayDeleteWithoutApproval: boolean;
  /** Recipients the agent may contact freely (exact match). */
  allowedRecipients: string[];
}

export interface Spec {
  id: string;
  version: number;
  goal: string; // the principal's plain-language goal, verbatim
  objective: string;
  constraints: string[];
  authority: AuthorityLimits;
  acceptanceCriteria: AcceptanceCriterion[];
  /** Ids of criteria flagged as needing the principal's eyes, computed at compile time. */
  uncheckableCriteria: string[];
  createdAt: string;
  status: "active" | "superseded" | "completed";
}

// ---------------------------------------------------------------------------
// Mission / Action / Approval contracts (the mediation protocol)
// ---------------------------------------------------------------------------

export type MissionStatus = "planned" | "running" | "awaiting_approval" | "completed" | "failed" | "blocked";

export interface Mission {
  id: string;
  specId: string;
  agentId: string;
  title: string;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
  spentTotal: number;
  traceId: string;
  failureReason?: string;
}

/** The only way an agent can affect the world: submit one of these to the Core. */
export interface ActionRequest {
  agentId: string;
  missionId: string;
  /** e.g. "email.send", "email.draft", "calendar.create", "task.create", "purchase.buy", "web.search", "vault.read" */
  kind: string;
  args: Record<string, unknown>;
  /** Consequential = sends, spends, deletes, or otherwise changes the outside world. */
  consequential: boolean;
  /** Optional approval token the agent believes authorizes this exact action. */
  approvalId?: string;
}

export type PolicyDecision = "allow" | "ask" | "deny";

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

export type ActionOutcome =
  | { status: "executed"; result: Record<string, unknown>; receiptId: string }
  | { status: "approval_required"; approvalId: string; reason: string }
  | { status: "denied"; reason: string };

export type ApprovalStatus = "pending" | "approved" | "denied" | "consumed";

export interface Approval {
  id: string;
  agentId: string;
  missionId: string;
  actionKind: string;
  /** Hash of canonical {agentId, kind, args} — approval is bound to EXACT arguments. */
  argsHash: string;
  argsPreview: Record<string, unknown>;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
  consumedAt?: string;
}

// ---------------------------------------------------------------------------
// Receipts Ledger contracts
// ---------------------------------------------------------------------------

export type VerificationStatus = "verified" | "unverified";

export interface Verification {
  status: VerificationStatus;
  /** Name of the deterministic checker that ran; null when unverified. */
  checker: string | null;
  evidence: string;
  at: string;
}

export interface Receipt {
  id: string;
  seq: number;
  prevHash: string;
  hash: string;
  at: string;
  traceId: string;
  agentId: string;
  missionId: string | null;
  specId: string | null;
  actionKind: string;
  summary: string;
  /** The basis on which the action was allowed: policy-allow, an approval id, or principal-direct. */
  authorityBasis: string;
  cost: number;
  verification: Verification;
}

export interface DeletionReceiptPayload {
  memoryId: string;
  subject: string;
  proofHash: string;
  residueTotal: number;
}
