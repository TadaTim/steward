import type { AuthorityLimits, CriterionChecker, MemoryKind } from "@steward/contracts";

/**
 * A per-audience FIRST MISSION template (design: "Usefulness by audience").
 * Audience difference ships as configuration: each pack carries one seed
 * mission — a pre-built spec skeleton with CONSERVATIVE authority (sending
 * and deleting always approval-gated; small spend caps) — plus its signature
 * hard line, represented honestly by enforcement mode:
 *  - "spec-authority": the line IS expressible as authority limits (nothing
 *    sends / nothing above the cap without approval) — enforced by policy;
 *  - "flagged-constraint": the line needs judgment (consent artifacts,
 *    topic safety), so it ships as a spec constraint AND an uncheckable
 *    acceptance criterion, flagged for the principal's eyes before execution.
 *    It is never dressed up as a machine rule it isn't.
 */
export interface FirstMissionTemplate {
  title: string;
  objective: string;
  constraints: string[];
  authority: AuthorityLimits;
  acceptanceCriteria: { description: string; checker: CriterionChecker; needsPrincipalEyes?: boolean }[];
  signatureHardLine: { text: string; mode: "spec-authority" | "flagged-constraint" };
  /** Keystone-answer keywords that select this template. */
  matchKeywords: string[];
}

/**
 * Domain question packs — CONFIGURATION, not code paths.
 *
 * Each pack is data: detection keywords (matched against the owner's Tier 1
 * answers) and a list of questions, each declaring which Vault memory it
 * produces. Adding a pack or editing a question never touches the interview
 * engine. (Design: "Getting to know the owner", Tier 3 — domain packs are
 * asked just-in-time, when the owner's work first touches the domain; in this
 * build the branch happens at the end of the first onboarding session.)
 */
export interface PackQuestion {
  id: string;
  text: string;
  unlocks: string;
  memoryKind: MemoryKind;
  subject: string;
}
export interface DomainPack {
  id: string;
  label: string;
  detectKeywords: string[];
  questions: PackQuestion[];
  firstMission: FirstMissionTemplate;
}

export const DOMAIN_PACKS: DomainPack[] = [
  {
    id: "nonprofit",
    label: "Nonprofit director",
    detectKeywords: ["nonprofit", "501(c)(3)", "charity", "foundation", "donor", "fundraising", "board", "grant"],
    questions: [
      { id: "np-funders", text: "Which funders have reporting deadlines that cannot slip?", unlocks: "Steward can watch those dates and draft reports before they become emergencies.", memoryKind: "commitment", subject: "pack:nonprofit:funder-deadlines" },
      { id: "np-board", text: "Who is on your board, and what does each of them care about?", unlocks: "Board communications get drafted for the reader, not just the topic.", memoryKind: "person", subject: "pack:nonprofit:board" },
      { id: "np-compliance", text: "What compliance dates recur for the organization?", unlocks: "Recurring filings land on the calendar before they are due, not after.", memoryKind: "commitment", subject: "pack:nonprofit:compliance-dates" },
      { id: "np-client-privacy", text: "What can never be said publicly about clients?", unlocks: "A standing privacy rule every draft is checked against.", memoryKind: "rule", subject: "pack:nonprofit:client-privacy" },
    ],
    firstMission: {
      title: "Grant & funder radar",
      objective: "Track every funder deadline, report, and renewal as a mission; the brief leads with what cannot slip.",
      constraints: [
        "Donor thank-yous are drafted, never sent by the agent — the director always sends.",
        "No client story or name is used publicly without a recorded consent artifact.",
      ],
      authority: { spendLimit: 50, maySendWithoutApproval: false, mayDeleteWithoutApproval: false, allowedRecipients: [] },
      acceptanceCriteria: [
        { description: "Donor thank-you drafts exist for this week's donors", checker: { type: "draft_exists", description: "a draft exists" } },
        { description: "Mission spend stays within the template limit", checker: { type: "spend_lte", maxAmount: 50, description: "spend <= 50" } },
        { description: "A recorded consent artifact exists before any client story is used publicly", checker: { type: "manual", description: "consent artifact on record" }, needsPrincipalEyes: true },
      ],
      signatureHardLine: { text: "No client story or name is ever used publicly without a recorded consent artifact.", mode: "flagged-constraint" },
      matchKeywords: ["grant", "funder", "deadline", "donor", "report", "thank-you", "thank you", "board"],
    },
  },
  {
    id: "creator",
    label: "Creator",
    detectKeywords: ["youtube", "channel", "creator", "videos", "content", "sponsor", "stream", "audience"],
    questions: [
      { id: "cr-platforms", text: "Which platforms do you publish on, and at what cadence?", unlocks: "Production schedules and reminders matched to your real cadence.", memoryKind: "fact", subject: "pack:creator:platforms" },
      { id: "cr-sponsors", text: "Who are your sponsors, and what are their rules?", unlocks: "Sponsored content checked against sponsor rules before it ships.", memoryKind: "rule", subject: "pack:creator:sponsor-rules" },
      { id: "cr-off-limits", text: "What topics are off-limits for the channel?", unlocks: "Topic scouting that never wastes your time on dead ends.", memoryKind: "rule", subject: "pack:creator:off-limits" },
      { id: "cr-packaging", text: "What must a title or thumbnail never do?", unlocks: "Packaging drafts that respect your lines from the first version.", memoryKind: "rule", subject: "pack:creator:packaging-lines" },
    ],
    firstMission: {
      title: "Sponsor deliverables, tracked",
      objective: "Turn every sponsor commitment into a tracked mission with acceptance criteria; triage audience messages as drafts in the creator's voice.",
      constraints: [
        "Off-limits topics and brand-safety rules apply to every draft before the creator sees it.",
        "Replies are drafted, never sent by the agent, until the ladder earns more.",
      ],
      authority: { spendLimit: 0, maySendWithoutApproval: false, mayDeleteWithoutApproval: false, allowedRecipients: [] },
      acceptanceCriteria: [
        { description: "Every contracted deliverable has a calendar event", checker: { type: "event_created", titleIncludes: "deliverable", description: "deliverable event exists" } },
        { description: "No draft references an off-limits topic", checker: { type: "manual", description: "drafts checked against off-limits list" }, needsPrincipalEyes: true },
      ],
      signatureHardLine: { text: "Tier-0 off-limits topics and brand-safety rules are enforced on every draft.", mode: "flagged-constraint" },
      matchKeywords: ["sponsor", "video", "content", "audience", "deliverable", "channel", "upload"],
    },
  },
  {
    id: "trades",
    label: "Trades owner",
    detectKeywords: ["plumbing", "hvac", "electrical", "construction", "trades", "crew", "service area", "jobs"],
    questions: [
      { id: "tr-area", text: "What is your service area?", unlocks: "Job requests outside the area get flagged instead of booked.", memoryKind: "fact", subject: "pack:trades:service-area" },
      { id: "tr-personal", text: "Which jobs do you always approve personally?", unlocks: "Those jobs route to you; everything else can move.", memoryKind: "rule", subject: "pack:trades:personal-approval" },
      { id: "tr-pricing", text: "What are your pricing rules, and who can bend them?", unlocks: "Quotes drafted inside your rules, exceptions escalated.", memoryKind: "rule", subject: "pack:trades:pricing" },
      { id: "tr-backup", text: "Who answers when you can't?", unlocks: "A real escalation path instead of a missed call.", memoryKind: "person", subject: "pack:trades:backup-contact" },
    ],
    firstMission: {
      title: "After-hours intake & quotes inside the rules",
      objective: "Answer after-hours inquiries, book jobs with read-back confirmation, and draft quotes strictly inside the owner's pricing rules.",
      constraints: [
        "No quote above the materials threshold and no new-customer commitment without the owner's tap.",
        "Quotes are drafted from the owner's pricing rules only — never improvised.",
      ],
      authority: { spendLimit: 300, maySendWithoutApproval: false, mayDeleteWithoutApproval: false, allowedRecipients: [] },
      acceptanceCriteria: [
        { description: "Booked jobs have calendar events", checker: { type: "event_created", titleIncludes: "job", description: "job event exists" } },
        { description: "Materials spend stays within the auto-approve threshold", checker: { type: "spend_lte", maxAmount: 300, description: "spend <= 300" } },
      ],
      signatureHardLine: { text: "No quote above the owner's threshold and no new-customer commitment without the owner's tap.", mode: "spec-authority" },
      matchKeywords: ["quote", "job", "customer", "after-hours", "intake", "materials", "booking"],
    },
  },
  {
    id: "caregiver",
    label: "Caregiver",
    detectKeywords: ["care for", "caregiver", "caring for", "mom", "dad", "mother", "father", "parent", "medication", "care recipient"],
    questions: [
      { id: "cg-providers", text: "Who are the care providers, and what recurs — appointments, medications, refills?", unlocks: "Refills and appointments tracked before they lapse.", memoryKind: "fact", subject: "pack:caregiver:providers-recurring" },
      { id: "cg-discretion", text: "The discretion map: who in the family gets told what — and who is never told medical details?", unlocks: "Updates shared exactly as far as you intend, never further.", memoryKind: "rule", subject: "pack:caregiver:discretion-map" },
      { id: "cg-recipient-privacy", text: "What does the care recipient themselves want kept private?", unlocks: "Their privacy outranks everyone else's curiosity — including family.", memoryKind: "rule", subject: "pack:caregiver:recipient-privacy" },
    ],
    firstMission: {
      title: "The care cadence",
      objective: "Run medications, appointments, refills, and provider follow-ups as tracked missions; a missed check-in escalates in the brief, not in a panic at midnight.",
      constraints: [
        "Medical details never leave their consent scope; the care recipient's own privacy wishes outrank family convenience.",
        "Family updates are generated from the ledger — identical for everyone in scope.",
      ],
      authority: { spendLimit: 50, maySendWithoutApproval: false, mayDeleteWithoutApproval: false, allowedRecipients: [] },
      acceptanceCriteria: [
        { description: "Refills are requested before they run out (refill events exist)", checker: { type: "event_created", titleIncludes: "refill", description: "refill event exists" } },
        { description: "Mission spend stays within the template limit", checker: { type: "spend_lte", maxAmount: 50, description: "spend <= 50" } },
        { description: "Sensitive family disclosures are decided by the coordinator, never the agent", checker: { type: "manual", description: "discretion calls are the principal's" }, needsPrincipalEyes: true },
      ],
      signatureHardLine: { text: "Medical details never leave their scope; the care recipient's privacy wishes outrank family convenience.", mode: "spec-authority" },
      matchKeywords: ["refill", "medication", "mom", "dad", "parent", "appointment", "care", "pharmacy"],
    },
  },
  {
    id: "founder",
    label: "Solo founder",
    detectKeywords: ["startup", "founder", "runway", "saas", "customers", "my company", "product"],
    questions: [
      { id: "fo-runway", text: "What is your runway, and what does it mean for spending authority?", unlocks: "Spending limits calibrated to survival, not vibes.", memoryKind: "fact", subject: "pack:founder:runway" },
      { id: "fo-customers", text: "Who are your key customers, and what are their sensitivities?", unlocks: "Customer-facing drafts that know where the landmines are.", memoryKind: "fact", subject: "pack:founder:key-customers" },
      { id: "fo-reversible", text: "Which decisions are reversible, and which aren't?", unlocks: "Agents move fast on reversible calls and slow down on the rest.", memoryKind: "rule", subject: "pack:founder:reversibility" },
    ],
    firstMission: {
      title: "Inbox & calendar defense",
      objective: "Triage inbox and calendar so the founder's attention is rationed by the brief; chase invoices with polite, escalating follow-ups; keep tool spending under the cap.",
      constraints: [
        "Nothing signs, sends externally as the founder, or spends above the limit without approval.",
        "Contract red-lines are flagged before signature — never auto-signed.",
      ],
      authority: { spendLimit: 100, maySendWithoutApproval: false, mayDeleteWithoutApproval: false, allowedRecipients: [] },
      acceptanceCriteria: [
        { description: "Follow-up drafts exist for invoices older than 14 days", checker: { type: "draft_exists", description: "a follow-up draft exists" } },
        { description: "Mission spend stays within the template limit", checker: { type: "spend_lte", maxAmount: 100, description: "spend <= 100" } },
        { description: "Contract risk is judged by the founder, never the agent", checker: { type: "manual", description: "contract review is manual" }, needsPrincipalEyes: true },
      ],
      signatureHardLine: { text: "Nothing signs, sends externally as the founder, or spends above the budget rung without approval.", mode: "spec-authority" },
      matchKeywords: ["inbox", "invoice", "customer", "runway", "triage", "calendar", "email"],
    },
  },
];

/** Pick the pack whose keywords best match the owner's own words. */
export function detectPack(texts: string[]): DomainPack | null {
  const hay = texts.join(" \n ").toLowerCase();
  let best: DomainPack | null = null;
  let bestHits = 0;
  for (const pack of DOMAIN_PACKS) {
    const hits = pack.detectKeywords.filter((k) => hay.includes(k)).length;
    if (hits > bestHits) { best = pack; bestHits = hits; }
  }
  return best;
}
