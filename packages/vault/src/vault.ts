import { DatabaseSync } from "node:sqlite";
import { existsSync, renameSync } from "node:fs";
import {
  type Clock, type DeletionProof, type Memory, type MemoryKind, type MemoryState,
  newId, sha256, systemClock,
} from "@steward/contracts";
import { HashEmbedder, cosine, type Embedder } from "./embed.js";

export interface AccessLogEntry {
  requester: string;
  memoryId: string | null;
  subject: string | null;
  granted: boolean;
  at: string;
}

/** External residue scanner (e.g. the ledger) plugged in by the composition root. */
export interface ExternalResidueScanner {
  scannedCount(sampleContent: string): number;
  residueCount(sampleContent: string): number;
}

const TRANSITIONS: Record<MemoryState, MemoryState[]> = {
  provisional: ["confirmed", "contested"],
  contested: ["confirmed"],
  confirmed: ["contested"],
};

export class Vault {
  private db: DatabaseSync;
  private embedder: Embedder;
  private clock: Clock;
  /** Default external residue scanner (e.g. the ledger), set by the composition root. */
  externalScanner?: ExternalResidueScanner;
  accessLog: AccessLogEntry[] = [];

  constructor(dbPath: string, opts: { embedder?: Embedder; clock?: Clock } = {}) {
    this.db = new DatabaseSync(dbPath);
    this.embedder = opts.embedder ?? new HashEmbedder();
    this.clock = opts.clock ?? systemClock;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL,
        content TEXT NOT NULL, data TEXT, state TEXT NOT NULL,
        consent_scope TEXT NOT NULL, provenance TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vector_index (
        memory_id TEXT PRIMARY KEY, vector TEXT NOT NULL
      );
    `);
  }

  close(): void { this.db.close(); }

  private rowToMemory(r: Record<string, unknown>): Memory {
    return {
      id: String(r.id), kind: String(r.kind) as MemoryKind, subject: String(r.subject),
      content: String(r.content),
      data: r.data ? (JSON.parse(String(r.data)) as Record<string, unknown>) : undefined,
      state: String(r.state) as MemoryState,
      consentScope: JSON.parse(String(r.consent_scope)) as string[],
      provenance: JSON.parse(String(r.provenance)) as Memory["provenance"],
      createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    };
  }

  private canRead(requester: string, m: Memory): boolean {
    if (requester === "principal") return true;
    return m.consentScope.includes("*") || m.consentScope.includes(requester);
  }

  /**
   * Assert a new memory. Agents may only create PROVISIONAL memories;
   * the principal creates confirmed ones. Governance is enforced here,
   * in the store, not by caller politeness.
   */
  assertMemory(input: {
    kind: MemoryKind; subject: string; content: string;
    data?: Record<string, unknown>; consentScope: string[];
    assertedBy: string; source: string;
  }): Memory {
    const now = this.clock.now().toISOString();
    const state: MemoryState = input.assertedBy === "principal" ? "confirmed" : "provisional";
    const m: Memory = {
      id: newId("mem"), kind: input.kind, subject: input.subject, content: input.content,
      data: input.data, state, consentScope: input.consentScope,
      provenance: { assertedBy: input.assertedBy, source: input.source, at: now },
      createdAt: now, updatedAt: now,
    };
    this.db.prepare(
      `INSERT INTO memories (id, kind, subject, content, data, state, consent_scope, provenance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(m.id, m.kind, m.subject, m.content, m.data ? JSON.stringify(m.data) : null,
      m.state, JSON.stringify(m.consentScope), JSON.stringify(m.provenance), m.createdAt, m.updatedAt);
    const vec = this.embedder.embed(`${m.subject} ${m.content}`);
    this.db.prepare(`INSERT INTO vector_index (memory_id, vector) VALUES (?, ?)`)
      .run(m.id, JSON.stringify(vec));
    return m;
  }

  /** Scope-filtered list read. Out-of-scope memories are architecturally invisible. */
  listFor(requester: string, filter: { kind?: MemoryKind; subjectPrefix?: string } = {}): Memory[] {
    const rows = this.db.prepare(`SELECT * FROM memories ORDER BY created_at`).all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToMemory(r))
      .filter((m) => this.canRead(requester, m))
      .filter((m) => (filter.kind ? m.kind === filter.kind : true))
      .filter((m) => (filter.subjectPrefix ? m.subject.startsWith(filter.subjectPrefix) : true));
  }

  /** Direct read by id. Out-of-scope => null, and the denial is logged. */
  getByIdFor(requester: string, id: string): Memory | null {
    const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const m = this.rowToMemory(row);
    const granted = this.canRead(requester, m);
    this.accessLog.push({ requester, memoryId: id, subject: m.subject, granted, at: this.clock.now().toISOString() });
    return granted ? m : null;
  }

  /** Scope-filtered semantic search over the vector index. */
  searchFor(requester: string, query: string, limit = 5): { memory: Memory; score: number }[] {
    const q = this.embedder.embed(query);
    const rows = this.db.prepare(
      `SELECT m.*, v.vector FROM memories m JOIN vector_index v ON v.memory_id = m.id`,
    ).all() as Record<string, unknown>[];
    return rows
      .map((r) => ({ memory: this.rowToMemory(r), score: cosine(q, JSON.parse(String(r.vector)) as number[]) }))
      .filter((x) => this.canRead(requester, x.memory))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Only the principal may move a memory between states. */
  transitionState(id: string, to: MemoryState, actor: string): Memory {
    if (actor !== "principal") throw new Error(`only the principal may change memory state (actor: ${actor})`);
    const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`memory not found: ${id}`);
    const m = this.rowToMemory(row);
    if (!TRANSITIONS[m.state].includes(to)) throw new Error(`illegal memory state transition ${m.state} -> ${to}`);
    const now = this.clock.now().toISOString();
    this.db.prepare(`UPDATE memories SET state = ?, updated_at = ? WHERE id = ?`).run(to, now, id);
    return { ...m, state: to, updatedAt: now };
  }

  /**
   * Confirm an INFERRED memory (e.g. a decision-echo rule): the principal's
   * confirmation promotes it to confirmed AND rewrites its provenance to
   * owner-confirmed, so the Vault never mislabels an inference as a statement.
   */
  confirmInferred(id: string, actor: string): Memory {
    if (actor !== "principal") throw new Error("only the principal may confirm an inference");
    const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`memory not found: ${id}`);
    const m = this.rowToMemory(row);
    if (m.state !== "provisional") throw new Error(`memory ${id} is ${m.state}, not provisional`);
    const now = this.clock.now().toISOString();
    const provenance = { ...m.provenance, source: `owner-confirmed (was: ${m.provenance.source})` };
    this.db.prepare(`UPDATE memories SET state = 'confirmed', provenance = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(provenance), now, id);
    return { ...m, state: "confirmed", provenance, updatedAt: now };
  }

  /** Principal correction: replaces content, marks confirmed, re-indexes. */
  correct(id: string, newContent: string, actor: string): Memory {
    if (actor !== "principal") throw new Error("only the principal may correct a memory");
    const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`memory not found: ${id}`);
    const m = this.rowToMemory(row);
    const now = this.clock.now().toISOString();
    this.db.prepare(`UPDATE memories SET content = ?, state = 'confirmed', updated_at = ? WHERE id = ?`)
      .run(newContent, now, id);
    const vec = this.embedder.embed(`${m.subject} ${newContent}`);
    this.db.prepare(`UPDATE vector_index SET vector = ? WHERE memory_id = ?`).run(JSON.stringify(vec), id);
    return { ...m, content: newContent, state: "confirmed", updatedAt: now };
  }

  /**
   * Delete a memory and PROVE it: after removal, scan the vault tables, the
   * vector index, and (via the injected scanner) external stores such as the
   * ledger for any residue of the memory's content. The proof's content sample
   * is hashed for the receipt — the content itself never enters the proof.
   */
  deleteWithProof(id: string, actor: string, external?: ExternalResidueScanner): { proof: DeletionProof; contentHash: string } {
    external = external ?? this.externalScanner;
    if (actor !== "principal") throw new Error("only the principal may delete a memory");
    const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`memory not found: ${id}`);
    const m = this.rowToMemory(row);
    const contentHash = sha256(m.content);
    this.db.prepare(`DELETE FROM vector_index WHERE memory_id = ?`).run(id);
    this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);

    const countLike = (table: string, col: string, needle: string) =>
      Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} LIKE ?`).get(`%${needle}%`) as { n: number }).n);
    const scannedVault = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM memories`).get() as { n: number }).n) + 1;
    const scannedIndex = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM vector_index`).get() as { n: number }).n) + 1;
    const residueVault = countLike("memories", "content", m.content) +
      Number((this.db.prepare(`SELECT COUNT(*) AS n FROM memories WHERE id = ?`).get(id) as { n: number }).n);
    const residueIndex = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM vector_index WHERE memory_id = ?`).get(id) as { n: number }).n);
    const scannedExt = external ? external.scannedCount(m.content) : 0;
    const residueExt = external ? external.residueCount(m.content) : 0;

    const proof: DeletionProof = {
      memoryId: id, subject: m.subject, deletedAt: this.clock.now().toISOString(),
      scanned: { vaultRows: scannedVault, indexEntries: scannedIndex, ledgerContentRefs: scannedExt },
      residue: { vaultRows: residueVault, indexEntries: residueIndex, ledgerContentRefs: residueExt },
      verified: residueVault === 0 && residueIndex === 0 && residueExt === 0,
    };
    return { proof, contentHash };
  }

  count(): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM memories`).get() as { n: number }).n);
  }

  /**
   * Disaster recovery: quarantine a (possibly corrupt) DB file and rebuild
   * the vault from a portable context package. The corrupt file is renamed,
   * never silently destroyed.
   */
  static recover(dbPath: string, pkg: { schemaVersion: number; memories: Memory[] }): { vault: Vault; quarantinedTo: string | null } {
    let quarantinedTo: string | null = null;
    if (dbPath !== ":memory:" && existsSync(dbPath)) {
      quarantinedTo = `${dbPath}.corrupt-${Date.now()}`;
      renameSync(dbPath, quarantinedTo);
    }
    const vault = new Vault(dbPath);
    vault.importPackage(pkg);
    return { vault, quarantinedTo };
  }

  /** Portable context package: versioned JSON, the principal's property. */
  exportPackage(): { schemaVersion: 1; exportedAt: string; memories: Memory[] } {
    const rows = this.db.prepare(`SELECT * FROM memories ORDER BY created_at`).all() as Record<string, unknown>[];
    return { schemaVersion: 1, exportedAt: this.clock.now().toISOString(), memories: rows.map((r) => this.rowToMemory(r)) };
  }

  importPackage(pkg: { schemaVersion: number; memories: Memory[] }): { imported: number; skipped: number } {
    if (pkg.schemaVersion !== 1) throw new Error(`unsupported context package schemaVersion: ${pkg.schemaVersion}`);
    let imported = 0, skipped = 0;
    for (const m of pkg.memories) {
      const exists = this.db.prepare(`SELECT id FROM memories WHERE id = ?`).get(m.id);
      if (exists) { skipped++; continue; }
      this.db.prepare(
        `INSERT INTO memories (id, kind, subject, content, data, state, consent_scope, provenance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(m.id, m.kind, m.subject, m.content, m.data ? JSON.stringify(m.data) : null,
        m.state, JSON.stringify(m.consentScope), JSON.stringify(m.provenance), m.createdAt, m.updatedAt);
      const vec = this.embedder.embed(`${m.subject} ${m.content}`);
      this.db.prepare(`INSERT INTO vector_index (memory_id, vector) VALUES (?, ?)`)
        .run(m.id, JSON.stringify(vec));
      imported++;
    }
    return { imported, skipped };
  }
}
