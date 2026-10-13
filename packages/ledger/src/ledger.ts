import { DatabaseSync } from "node:sqlite";
import {
  type Receipt, canonicalJson, hashObject, newId, sha256,
} from "@steward/contracts";

export type ReceiptInput = Omit<Receipt, "id" | "seq" | "prevHash" | "hash">;

/**
 * Append-only, hash-chained receipts store. There is deliberately no update
 * or delete API: a receipt, once written, can only be read. verifyChain()
 * re-derives every hash so tampering with history is detectable.
 */
export class LedgerStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS receipts (
        seq INTEGER PRIMARY KEY, id TEXT NOT NULL, at TEXT NOT NULL, trace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL, mission_id TEXT, spec_id TEXT, action_kind TEXT NOT NULL,
        summary TEXT NOT NULL, authority_basis TEXT NOT NULL, cost REAL NOT NULL,
        verification TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
      );
    `);
  }

  close(): void { this.db.close(); }

  /** ReceiptSink implementation — the Core calls this for every executed consequential action. */
  record(entry: ReceiptInput): string {
    const last = this.db.prepare(`SELECT seq, hash FROM receipts ORDER BY seq DESC LIMIT 1`).get() as { seq: number; hash: string } | undefined;
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? "GENESIS";
    const id = newId("rcpt");
    const hash = sha256(canonicalJson({ seq, prevHash, id, ...entry, verification: entry.verification }));
    this.db.prepare(
      `INSERT INTO receipts (seq, id, at, trace_id, agent_id, mission_id, spec_id, action_kind, summary, authority_basis, cost, verification, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(seq, id, entry.at, entry.traceId, entry.agentId, entry.missionId, entry.specId,
      entry.actionKind, entry.summary, entry.authorityBasis, entry.cost,
      JSON.stringify(entry.verification), prevHash, hash);
    return id;
  }

  private row(r: Record<string, unknown>): Receipt {
    return {
      id: String(r.id), seq: Number(r.seq), prevHash: String(r.prev_hash), hash: String(r.hash),
      at: String(r.at), traceId: String(r.trace_id), agentId: String(r.agent_id),
      missionId: r.mission_id ? String(r.mission_id) : null, specId: r.spec_id ? String(r.spec_id) : null,
      actionKind: String(r.action_kind), summary: String(r.summary), authorityBasis: String(r.authority_basis),
      cost: Number(r.cost), verification: JSON.parse(String(r.verification)) as Receipt["verification"],
    };
  }

  all(): Receipt[] {
    return (this.db.prepare(`SELECT * FROM receipts ORDER BY seq`).all() as Record<string, unknown>[]).map((r) => this.row(r));
  }
  byKind(kind: string): Receipt[] { return this.all().filter((r) => r.actionKind === kind); }
  byMission(missionId: string): Receipt[] { return this.all().filter((r) => r.missionId === missionId); }
  byTrace(traceId: string): Receipt[] { return this.all().filter((r) => r.traceId === traceId); }
  since(iso: string): Receipt[] { return this.all().filter((r) => r.at >= iso); }
  count(): number { return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM receipts`).get() as { n: number }).n); }

  /** Residue scanning for deletion proofs: does any receipt text contain the sample? */
  countContentReferences(sample: string): number {
    if (!sample) return 0;
    const row = this.db.prepare(
      `SELECT COUNT(*) AS n FROM receipts WHERE summary LIKE ? OR authority_basis LIKE ?`,
    ).get(`%${sample}%`, `%${sample}%`) as { n: number };
    return Number(row.n);
  }

  verifyChain(): boolean {
    const rows = this.db.prepare(`SELECT * FROM receipts ORDER BY seq`).all() as Record<string, unknown>[];
    let prev = "GENESIS";
    for (const raw of rows) {
      const r = this.row(raw);
      if (r.prevHash !== prev) return false;
      const { id, seq, prevHash, hash, ...rest } = r as unknown as Record<string, unknown>;
      void id; void seq; void prevHash; void hash;
      const entry: ReceiptInput = {
        at: r.at, traceId: r.traceId, agentId: r.agentId, missionId: r.missionId, specId: r.specId,
        actionKind: r.actionKind, summary: r.summary, authorityBasis: r.authorityBasis, cost: r.cost,
        verification: r.verification,
      };
      void rest;
      const expect = sha256(canonicalJson({ seq: r.seq, prevHash: r.prevHash, id: r.id, ...entry, verification: r.verification }));
      if (expect !== r.hash) return false;
      prev = r.hash;
    }
    return true;
  }
}

export { hashObject };
