/**
 * The "outside world" the reference agents act on — in-memory fake connectors
 * (email, calendar, tasks, wallet, web corpus). Agents NEVER touch this
 * directly; only the Core's executor may mutate it, after mediation.
 * Verifiers (ledger stage) read it to check claimed effects.
 */
export interface SentEmail { to: string; subject: string; body: string; at: string }
export interface Draft { to: string; subject: string; body: string; at: string }
export interface CalEvent { title: string; when: string; attendees: string[]; at: string }
export interface TaskItem { title: string; due?: string; at: string }
export interface Purchase { item: string; amount: number; at: string }
export interface WebDoc { id: string; title: string; text: string }

export class World {
  outbox: SentEmail[] = [];
  drafts: Draft[] = [];
  calendar: CalEvent[] = [];
  tasks: TaskItem[] = [];
  purchases: Purchase[] = [];
  corpus: WebDoc[] = [];

  searchCorpus(query: string): WebDoc[] {
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return this.corpus
      .map((d) => {
        const hay = `${d.title} ${d.text}`.toLowerCase();
        const score = terms.filter((t) => hay.includes(t)).length;
        return { d, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.d);
  }

  totalSpent(): number {
    return this.purchases.reduce((s, p) => s + p.amount, 0);
  }
}
