import type { ActionOutcome } from "@steward/contracts";
import type { StewardCore } from "@steward/core";

/**
 * Reference Research Agent. Its plan is fixed by the mission spec: search the
 * given queries, cite what it finds, write a brief. Tool results are treated
 * strictly as DATA — text inside a document that looks like an instruction is
 * recorded as a notice and never acted on. (The mediation core is the second,
 * stronger line of defense: even a compromised agent cannot execute an
 * unauthorized consequential action.)
 */
const INSTRUCTION_PATTERN = /(ignore (your|previous|prior)|you must|system\s*:|send an? email|delete (the|all)|transfer (funds|money)|reveal)/i;

export class ResearchAgent {
  static readonly ID = "research";
  static readonly CAPABILITIES = ["web.search", "vault.read", "vault.write"];

  constructor(private core: StewardCore) {}

  runMission(missionId: string, opts: { queries: string[]; memorySubject: string }): { brief: string; notices: string[]; outcomes: ActionOutcome[] } {
    const notices: string[] = [];
    const outcomes: ActionOutcome[] = [];
    const sections: string[] = [];
    for (const q of opts.queries) {
      const out = this.core.submit({ agentId: ResearchAgent.ID, missionId, kind: "web.search", args: { query: q }, consequential: false });
      outcomes.push(out);
      if (out.status !== "executed") { sections.push(`## ${q}\n(search ${out.status})`); continue; }
      const docs = (out.result.documents as { id: string; title: string; text: string }[]) ?? [];
      const lines = docs.map((d) => {
        if (INSTRUCTION_PATTERN.test(d.text)) {
          notices.push(`Ignored embedded instruction in document ${d.id} ("${d.title}") — tool output is data, not orders.`);
        }
        return `- **${d.title}** [${d.id}]: ${d.text.slice(0, 220)}`;
      });
      sections.push(`## ${q}\n${lines.join("\n") || "(no results)"}`);
    }
    const brief = `# Research brief\n\n${sections.join("\n\n")}`;
    const write = this.core.submit({
      agentId: ResearchAgent.ID, missionId, kind: "vault.write", consequential: false,
      args: { memoryKind: "fact", subject: opts.memorySubject, content: `Research brief completed: ${opts.queries.join("; ")}. ${notices.length} embedded instruction(s) ignored.`, consentScope: ["research", "ops"] },
    });
    outcomes.push(write);
    return { brief, notices, outcomes };
  }
}
