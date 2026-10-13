import type { Spec } from "@steward/contracts";

/** Versioned spec store. getSpec returns the latest ACTIVE version. */
export class SpecStore {
  private versions = new Map<string, Spec[]>();

  save(spec: Spec): Spec {
    const list = this.versions.get(spec.id) ?? [];
    list.push(spec);
    this.versions.set(spec.id, list);
    return spec;
  }

  getSpec(id: string): Spec | undefined {
    const list = this.versions.get(id);
    if (!list) return undefined;
    return [...list].reverse().find((s) => s.status === "active") ?? list[list.length - 1];
  }

  history(id: string): Spec[] {
    return this.versions.get(id) ?? [];
  }

  /** Revise: the old version is superseded, the new one becomes active at version+1. */
  revise(id: string, patch: Partial<Omit<Spec, "id" | "version" | "status">>): Spec {
    const current = this.getSpec(id);
    if (!current) throw new Error(`spec not found: ${id}`);
    current.status = "superseded";
    const next: Spec = {
      ...current, ...patch, id, version: current.version + 1, status: "active",
      uncheckableCriteria: (patch.acceptanceCriteria ?? current.acceptanceCriteria)
        .filter((c) => c.needsPrincipalEyes).map((c) => c.id),
    };
    return this.save(next);
  }
}

/** Spec -> mission planner: picks the reference agent and titles the mission. */
export function planMission(spec: Spec): { agentId: string; title: string; checklist: string[] } {
  const g = spec.goal.toLowerCase();
  const agentId = /(research|find out|investigate|look into|compare)/.test(g) ? "research" : "ops";
  return {
    agentId,
    title: spec.goal.length > 60 ? spec.goal.slice(0, 57) + "..." : spec.goal,
    checklist: spec.acceptanceCriteria.map((c) => `${c.needsPrincipalEyes ? "[needs your eyes] " : ""}${c.description}`),
  };
}
