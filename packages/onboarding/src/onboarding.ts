import type { Memory, MemoryKind, Spec } from "@steward/contracts";
import type { Vault } from "@steward/vault";
import { InterviewSession } from "@steward/intent";
import type { HardLine, StewardCore } from "@steward/core";
import { detectPack, type DomainPack } from "./packs.js";

/**
 * Owner onboarding — "Getting to know the owner", Tiers 0 and 1 (this build).
 *
 * A deterministic dialogue manager (same discipline as Intent Studio: no LLM
 * in the path; an LLM provider interface could sit behind it later). Every
 * answer lands in the Context Vault the moment it is given, with
 * provenance owner-stated (assertedBy "principal" -> state confirmed).
 *
 * Tier 0 hard lines are not just stored — they are COMPILED into the Policy
 * & Mediation Core's deny rules (core.addHardLine) in the same answer.
 * Tier 1's keystone answer ("If you trusted it completely, what would you
 * hand off first?") seeds the owner's first mission spec.
 *
 * Question discipline (from the design): delegation-value ordering (Tier 0
 * first because it unlocks safe action), the tomorrow test (every question
 * declares what it unlocks; nothing is asked that wouldn't change tomorrow's
 * behavior), recognition-over-recall where the format allows.
 */

export interface OnboardingStep {
  id: string;
  tier: "tier0" | "tier1" | "pack";
  question: string;
  unlocks: string;
  memoryKind: MemoryKind;
  subject: string;
}

const TIER0: OnboardingStep[] = [
  {
    id: "never-do", tier: "tier0",
    question: "What should agents never do, even if asked? (e.g. \"never send email to chair@example.org\", \"never spend over $500\", \"never delete anything\")",
    unlocks: "Compiled immediately into hard deny rules in the Policy Core — the lines no approval can cross.",
    memoryKind: "rule", subject: "tier0:hard-lines",
  },
  {
    id: "interrupts", tier: "tier0",
    question: "What is worth interrupting you for — and what must always wait for the morning brief?",
    unlocks: "Sets the interruption threshold that keeps supervision load low from day one.",
    memoryKind: "preference", subject: "tier0:interrupt-threshold",
  },
  {
    id: "people", tier: "tier0",
    question: "Who are your people? Names and roles — one per line or separated by semicolons.",
    unlocks: "The seed of the people map: agents stop confusing your board chair with your brother.",
    memoryKind: "person", subject: "tier0:people",
  },
  {
    id: "emergency", tier: "tier0",
    question: "If something goes wrong at 2 a.m., what should happen — and who, if anyone, gets contacted?",
    unlocks: "The emergency protocol agents follow instead of improvising at the worst moment.",
    memoryKind: "commitment", subject: "tier0:emergency-protocol",
  },
  {
    id: "what-you-run", tier: "tier0",
    question: "What do you run — the businesses, projects, and responsibilities Steward is stewarding?",
    unlocks: "Scopes everything else: which domains exist, and which question pack fits your work.",
    memoryKind: "project", subject: "tier0:responsibilities",
  },
];

const TIER1: OnboardingStep[] = [
  {
    id: "time-eaters", tier: "tier1",
    question: "What are the three to five things eating most of your time right now?",
    unlocks: "Points the first missions at real pain instead of plausible busywork.",
    memoryKind: "fact", subject: "tier1:time-eaters",
  },
  {
    id: "week-shape", tier: "tier1",
    question: "What does a good week look like? A bad one?",
    unlocks: "The brief learns what to surface: drift toward the bad week gets flagged early.",
    memoryKind: "preference", subject: "tier1:week-shape",
  },
  {
    id: "deadlines", tier: "tier1",
    question: "Which deadlines rule your life — the ones that cannot slip?",
    unlocks: "Deadline tracking starts with the dates that actually matter.",
    memoryKind: "commitment", subject: "tier1:deadlines",
  },
  {
    id: "keystone", tier: "tier1",
    question: "If you trusted it completely, what would you hand off first?",
    unlocks: "The keystone: it reveals the pain and the trust frontier in one answer — and it becomes your first mission.",
    memoryKind: "fact", subject: "tier1:keystone",
  },
  {
    id: "tools", tier: "tier1",
    question: "What tools and accounts does your work live in today?",
    unlocks: "Agents plan around your real stack instead of assuming one.",
    memoryKind: "fact", subject: "tier1:tools",
  },
];

type ParsedLine = Omit<HardLine, "id" | "source">;

const EMAIL_RE = /[^\s;,]+@[^\s;,]+\.[^\s;,]+/;
const NEGATION_RE = /\b(never|don't|do not|must not|no)\b/i;

/**
 * Compile plain-language "never" statements into Policy Core hard lines.
 * Recognized forms (deliberately conservative — anything unrecognized is
 * still stored verbatim in the Vault as a rule memory, just not compiled):
 *  - "never send/email ... <address>"     -> deny email.send to that recipient
 *  - "never send/email ..."               -> deny email.send entirely
 *  - "never spend/buy over $N"            -> deny purchase.buy above N
 *  - "never spend/buy ..."                -> deny purchase.buy entirely
 *  - "never delete ..."                   -> deny vault.delete
 *  - "never share ..."                    -> deny email.send (sharing = sending out)
 */
export function parseHardLines(answer: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  // Split into clauses on ; / newlines / sentence-ending periods — but NOT
  // the dots inside email addresses or amounts ("chair@example.org", "$5.50").
  const clauses = answer
    .split(/[;\n]+/)
    .flatMap((c) => c.split(/\.\s+/))
    .map((c) => c.trim().replace(/\.$/, ""))
    .filter(Boolean);
  for (const clause of clauses) {
    const low = clause.toLowerCase();
    if (!NEGATION_RE.test(low)) continue;
    const emailMatch = clause.match(EMAIL_RE);
    const amountMatch = clause.replace(/,/g, "").match(/\$\s?(\d+(?:\.\d+)?)/) ?? clause.match(/over\s+(\d+(?:\.\d+)?)/i);
    if (/\b(delete|deleting)\b/.test(low)) {
      lines.push({ kind: "vault.delete", description: clause });
    } else if (/\b(spend|spending|buy|buying|purchase|charge)\b/.test(low)) {
      if (amountMatch) lines.push({ kind: "purchase.buy", maxAmount: Number(amountMatch[1]), description: clause });
      else lines.push({ kind: "purchase.buy", description: clause });
    } else if (/\b(send|sending|email|emailing|message|contact|share|sharing)\b/.test(low)) {
      if (emailMatch) lines.push({ kind: "email.send", recipient: emailMatch[0], description: clause });
      else lines.push({ kind: "email.send", description: clause });
    }
  }
  return lines;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface OnboardingTranscriptEntry {
  stepId: string; question: string; answer: string; memoryIds: string[];
}

export class OnboardingSession {
  private queue: OnboardingStep[] = [...TIER0, ...TIER1];
  private idx = 0;
  private pack: DomainPack | null = null;
  private packBranched = false;
  private answers = new Map<string, string>();
  transcript: OnboardingTranscriptEntry[] = [];
  compiledHardLines: HardLine[] = [];

  constructor(private deps: { vault: Vault; core: StewardCore }) {}

  current(): OnboardingStep | null {
    return this.idx < this.queue.length ? this.queue[this.idx]! : null;
  }
  isDone(): boolean { return this.current() === null; }
  detectedPack(): DomainPack | null { return this.pack; }
  answerOf(stepId: string): string | undefined { return this.answers.get(stepId); }
  keystoneGoal(): string | undefined { return this.answers.get("keystone"); }

  /** Answer the current question: stores Vault memories; Tier 0 hard lines compile live. */
  answer(text: string): void {
    const step = this.current();
    if (!step) throw new Error("onboarding is already complete");
    const trimmed = text.trim();
    this.answers.set(step.id, trimmed);
    const memoryIds: string[] = [];
    if (trimmed.length > 0) {
      if (step.id === "people") {
        // One person memory per entry so the people map is addressable.
        const entries = trimmed.split(/[;\n]+/).map((e) => e.trim()).filter(Boolean);
        for (const entry of entries) {
          const name = entry.split(/—|–|-|,|:/)[0]!.trim();
          const m = this.store("person", `person:${slug(name)}`, entry);
          memoryIds.push(m.id);
        }
      } else {
        const m = this.store(step.memoryKind, step.subject, trimmed);
        memoryIds.push(m.id);
      }
      if (step.id === "never-do") {
        for (const parsed of parseHardLines(trimmed)) {
          this.compiledHardLines.push(this.deps.core.addHardLine({ ...parsed, source: "owner-stated:onboarding" }));
        }
      }
    }
    this.transcript.push({ stepId: step.id, question: step.question, answer: trimmed, memoryIds });
    this.idx += 1;
    // After Tier 1, branch into the domain pack the owner's own words select.
    if (!this.packBranched && this.idx >= TIER0.length + TIER1.length) {
      this.packBranched = true;
      this.pack = detectPack([
        this.answers.get("what-you-run") ?? "",
        this.answers.get("time-eaters") ?? "",
        this.answers.get("tools") ?? "",
      ]);
      if (this.pack) {
        for (const q of this.pack.questions) {
          this.queue.push({ id: q.id, tier: "pack", question: q.text, unlocks: q.unlocks, memoryKind: q.memoryKind, subject: q.subject });
        }
      }
    }
  }

  private store(kind: MemoryKind, subject: string, content: string): Memory {
    return this.deps.vault.assertMemory({
      kind, subject, content,
      consentScope: ["*"],
      assertedBy: "principal", source: "owner-stated:onboarding",
    });
  }

  /** The detected pack's first-mission template, if a pack branched in. */
  firstMissionTemplate() {
    return this.pack ? { pack: this.pack, template: this.pack.firstMission } : null;
  }

  /**
   * Does the keystone answer select this pack's template? (Keyword overlap
   * between what the owner said they'd hand off first and the template's
   * mission — the template is the system's prepared version of that pain.)
   */
  keystoneSelectsTemplate(): boolean {
    const found = this.firstMissionTemplate();
    const keystone = (this.keystoneGoal() ?? "").toLowerCase();
    if (!found || !keystone) return false;
    return found.template.matchKeywords.some((k) => keystone.includes(k));
  }

  /**
   * Compile the pack's first-mission TEMPLATE into a ready spec: the owner's
   * keystone becomes the goal; objective, constraints, conservative authority
   * limits, and acceptance criteria come from the template (configuration).
   * Criteria the template marks as needing the principal's eyes land in
   * uncheckableCriteria — flagged before execution, per spec discipline.
   */
  compileFirstMissionFromTemplate(): Spec {
    const found = this.firstMissionTemplate();
    if (!found) throw new Error("no domain pack was detected — no first-mission template to load");
    const { pack, template } = found;
    const criteria = template.acceptanceCriteria.map((c, i) => ({
      id: `crit_${pack.id}_${i + 1}`,
      description: c.description,
      checker: c.checker,
      needsPrincipalEyes: c.needsPrincipalEyes ?? false,
    }));
    return {
      id: `spec_first_${pack.id}`,
      version: 1,
      goal: this.keystoneGoal() ?? template.title,
      objective: template.objective,
      constraints: [...template.constraints],
      authority: { ...template.authority, allowedRecipients: [...template.authority.allowedRecipients] },
      acceptanceCriteria: criteria,
      uncheckableCriteria: criteria.filter((c) => c.needsPrincipalEyes).map((c) => c.id),
      createdAt: new Date().toISOString(),
      status: "active",
    };
  }

  /**
   * The keystone answer becomes the first mission: run Intent Studio with the
   * keystone as the goal. The owner (or a scripted persona) supplies the
   * interview answers — budget, send authority, recipients, constraints,
   * acceptance — in Intent Studio's fixed order.
   */
  compileFirstMission(answers: { budget: string; sendAuthority: string; recipients: string; constraints: string; acceptance: string }): Spec {
    const goal = this.keystoneGoal();
    if (!goal) throw new Error("no keystone answer recorded — the first mission has nothing to stand on");
    const interview = new InterviewSession(goal);
    interview.answer(answers.budget);
    interview.answer(answers.sendAuthority);
    interview.answer(answers.recipients);
    interview.answer(answers.constraints);
    interview.answer(answers.acceptance);
    return interview.compile();
  }
}
