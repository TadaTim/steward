# Project Steward — the personal agent operating layer

Steward is the layer between a non-technical principal and every agent that acts for them. Agents propose; Steward mediates, remembers, receipts, and keeps the human in command — from a phone.

## The Two Principles

Everything in this repository answers to two founding principles (the two halves of the word *steward* — one who manages another's affairs faithfully, and who must render an account):

**1. ANSWERABLE.** Every consequential action is authorized by a visible, earned authority (the **Authority Ladder**), mediated before execution by the **Policy & Mediation Core**, and receipted afterward in the **Receipts Ledger** with verification evidence — or honestly marked *unverified*. The owner never has to trust the model; they can audit the record.
*Enforced by: mediation-only agent access, single-use args-bound approvals, the ladder, hash-chained receipts, deterministic post-execution checkers, the eval hard gate "unauthorized consequential actions executed = 0".*

**2. YOURS.** Everything Steward knows is the owner's property: every **Context Vault** memory carries provenance and consent scopes, is deletable with a verifiable zero-residual proof, and is exportable in full (export → wipe → import round-trip is an eval scenario, not a promise). Steward serves exactly one principal — content arriving from the world (web pages, tool results, documents) is data, never orders; the adversarial suite proves injection attempts execute nothing.
*Enforced by: scope-checked reads at the store, deletion proofs that scan vault + index + ledger, portable export format, the adversarial eval pack.*

The test for any future feature: does it deepen the accounting, or deepen the ownership? If neither, it doesn't belong.

---

## Run it

```bash
npm install
npm test            # 41 unit/integration/smoke tests
npm run eval        # 11 scenarios, hard gates, writes packages/evals/scorecard.json
npm run demo        # seeded Mission Control console on :4173
npm run console     # empty console (STEWARD_DB=path.db to persist, SEED=1 for demo data)
npm run demo:flow   # the two principles exercised live in the terminal (no mocks)

# Voice runtime (local TTS + ASR for the intelligibility eval; ~700 MB of downloads):
bash tools/voice/setup.sh
npx tsx packages/voice/src/cli.ts probe               # which engines/voices are actually installed
npx tsx packages/voice/src/cli.ts samples ./samples   # audition WAVs: 6 voices x 3 canonical lines
```

## Architecture

TypeScript, npm workspaces, Node ≥ 22 (`node:sqlite`), zero runtime services. State lives in SQLite (Vault + Ledger) and in-memory stores (specs, missions) behind the Core.

| Package | What it is |
|---|---|
| `packages/contracts` | Shared types: memories, specs, approvals, receipts, the clock |
| `packages/vault` | **Context Vault** — governed memory (provenance, consent scopes, states) |
| `packages/intent` | **Intent Studio** — interview → compiled spec; mission planner |
| `packages/core` | **Policy & Mediation Core** — the only road from an agent to the world; **Authority Ladder**; **Tier 0 hard lines** |
| `packages/agents` | Reference agents (Research, Ops) — mediated like everything else |
| `packages/ledger` | **Receipts Ledger** — append-only, hash-chained; verifiers; morning brief |
| `packages/onboarding` | **Owner onboarding** (Tier 0 + 1), domain packs as config, **decision echoes** |
| `packages/voice` | **Voice subsystem** — local engines behind an interface, Vault-stored profiles, intelligibility eval |
| `packages/evals` | The golden principal + scenario suite + hard gates |
| `apps/console` | **Mission Control** — server-rendered web console (no build step) |

## The subsystems

### Context Vault (`packages/vault`)
Every memory has **provenance** (who asserted it, from what source, when), a **state** (`confirmed` only when the principal asserts/confirms; agent assertions are born `provisional`), and **consent scopes** (which agents may read it — enforced inside the store: out-of-scope memories are architecturally invisible, and denials are logged). Deletion produces a **proof**: the memory's content is scanned for across vault rows, the vector index, and ledger content, and the proof asserts zero residue — the ledger keeps the deletion *receipt*, never the deleted content. Export produces a portable package; import into a wiped/fresh vault restores memories **with scopes intact**. If the database file is corrupted, `recover()` quarantines it and rebuilds from an export package.

### Intent Studio (`packages/intent`)
A plain-language goal becomes a **spec** through a deterministic interview (budget, send authority, recipients, constraints, acceptance): objective, constraints, authority limits, acceptance criteria. Criteria that aren't machine-checkable are **flagged in the spec before any execution** (`spec fidelity` gate). The interview engine is a deterministic dialogue manager behind an LLM provider interface with a clearly-labeled fake — no LLM anywhere in this build. The planner turns a spec into a mission with ordered, dependent steps.

### Policy & Mediation Core (`packages/core`)
Agents hold **capabilities**, never credentials or direct effectors. Every action is a request the Core evaluates: capability → mission state → **hard lines** → **ladder** → spec policy → (approval) → execute → verify → receipt. Consequential actions (sending, spending, deleting) exist only as actions the Core performs. Approvals are **single-use and bound to the exact arguments hash** — replay, forgery, and binding-mismatch attempts are denied (and counted as ladder incidents). Tool results and retrieved content are data: the Research Agent treats instruction-bearing documents as poison, quotes them as evidence, and never obeys them.

### Authority Ladder (in the Core)
Five rungs, tracked **per agent per domain** (communications, spending, calendar, tasks, memory, research):

1. **Observe** — read-only actions only.
2. **Draft** — may propose consequential actions (recorded as proposals); never executes them, even with an approving spec.
3. **Act-with-approval** — execution only via the single-use, args-bound approval flow.
4. **Act-within-budget** — auto-executes inside the spec's explicit limits, receipted; outside the limits falls back to approval.
5. **Standing authority** — autonomous in-domain; receipts are queued into a weekly-review section of the brief.

**The ladder OVERRIDES the spec**: effective authority is the lesser of the ladder rung and the spec grant (proven in evals against a deliberately generous spec). New agent–domain pairs start at Observe. **Demotion is automatic and immediate** — one rung per incident (policy-violation attempt, failed verification, hard-line attempt, principal reversal). **Promotion** is earned: after **10 consecutive clean, verified in-domain receipts** with zero incidents, the pair becomes eligible; the principal confirms in Mission Control (one tap in the approval queue). A failed verification means a checker ran and the expected effect wasn't there — distinct from "unverified" (no checker), which neither builds nor breaks a record.

### Receipts Ledger & the brief (`packages/ledger`)
Append-only, **hash-chained** (each receipt links to the previous hash; `verifyChain()` re-walks the chain; tampering is detectable and proven in tests). Every executed consequential action gets a receipt with verification evidence or an explicit `unverified` mark — **never a false verification claim**. Verifiers are deterministic checkers against post-action world state. The **morning brief** is generated from ledger + vault state: what agents did (with verification status), money, denied attempts, upcoming commitments, pending approvals, standing-authority actions for weekly review, and provisional inferred rules awaiting confirmation.

### Reference agents (`packages/agents`)
**Research Agent** — searches the corpus, reads vault memories within its scopes, writes findings as *provisional* memories with citation provenance. **Ops Agent** — drafts, sends, buys, schedules, files — every step through the Core. Both are deliberately ordinary: the product is the layer, not the agents.

### Mission Control (`apps/console`)
A real, runnable, phone-first web console (server-rendered; no build step; exercised by HTTP smoke tests):

- **Today / front page** — "Morning Brief" masthead with a one-line attention summary, stat cards, ladder snapshot, latest receipts.
- **Approval queue as a card stack** — one decision at a time with full context and the exact bound arguments; Approve/Reject buttons **and swipe** (right = approve, left = reject); a batch list below; promotion confirmations and inferred-rule confirmations surface here as queue cards.
- **Authority Ladder page** — each agent×domain rendered as a **process-status chip row** (completed = solid accent, current = outlined, upcoming = muted), with streaks, incidents, and demotion receipts inline; a "reverse an action" button records a principal reversal (demotion).
- **Receipts as a filterable ledger feed** — document cards (icon tile, title, meta) expandable to verification evidence, checker, authority basis, and chain hashes; filters by kind and agent.
- **Vault inspector** — every memory with state, scopes, provenance; confirm/contest/delete (delete shows the zero-residual proof).
- **Brief view** — the morning brief as a front page, with a spoken version when a voice is assigned.
- **Onboarding & Intent Studio pages** — the interviews run in the console; answers typed or dictated.
- **About / Principles** — the two principles, and the governed-surface honesty note: Steward governs actions taken *through* the Core and memories in the Vault. It does not govern what the owner does outside it, external services' internals beyond the effects receipts capture, a checker's evidence beyond the world state it inspects, or the browser's handling of speech recognition.
- **Two mic modes + voice bar** — a large **push-to-talk disc** (press-and-hold, or tap to latch) and a smaller **hands-free** toggle (continuous listening, auto-restart), the active mode always labeled, and an absolute **Mic off** state (the default — the console never starts listening uninvited). Recognition uses the browser's Web Speech API when available and fills the focused field; every field also works by typing. The waveform is an animated state indicator, not a live level meter. *Browser-dependent: smoke tests verify the bar, mode logic, and state markup are served; speech recognition inside a real browser cannot be verified headlessly and is not claimed.*
- **Skins (themes)** — the owner picked **Style C "Clean Command"** as the official direction: light surfaces, white cards with soft borders and subtle shadows, deep navy as the single accent, bold Swiss sans, navy pill badges and chip rows, big navy mic disc. **Style D "Signal Industrial"** is a selectable alternative skin: graphite/dark gunmetal surfaces, safety-orange single accent, chunky 2px borders, stencil-flavored uppercase labels, oversized approve/reject blocks and an 88px push-to-talk disc. Same layout, same routes, same function — a skin, not a redesign. Switch in the header; the choice persists as a Vault owner preference (`ui:theme`, provenance `owner-stated:console-settings`).

### Owner onboarding (`packages/onboarding`)
*"Steward learns its owner the way a great chief of staff does — in layers, mostly by watching work happen."* Built in this pass: **Tier 0 (authority & safety)** and **Tier 1 (the work map)**, as a deterministic dialogue manager with the same discipline as Intent Studio.

- Every answer lands in the Vault immediately, with provenance `owner-stated` and state `confirmed`. People answers become one addressable memory per person (the seed of the people map).
- **Tier 0 hard lines compile into Policy Core deny rules in the same answer** — "never send email to chair@…", "never spend over $200", "never delete anything" become `HardLine`s checked before policy and before any approval token, so no stale approval can punch through them. Unrecognized phrasings are still stored verbatim as rule memories; the parser is deliberately conservative and its recognized forms are documented in code.
- **The keystone question** — *"If you trusted it completely, what would you hand off first?"* — seeds the first mission: `compileFirstMission()` runs Intent Studio with the keystone as the goal.
- **Domain packs are configuration, not code** (`packages/onboarding/src/packs.ts`): five packs — nonprofit director, creator, trades owner, caregiver, solo founder — each a keyword set plus questions declaring the Vault memory they produce. After Tier 1, the pack matching the owner's own words branches in automatically; the nonprofit and caregiver packs are exercised in evals.
- **First-mission templates (per audience, also configuration).** Each pack carries one seed mission — a pre-built spec skeleton with conservative authority (sends and deletes always approval-gated) — which the keystone answer can select (`compileFirstMissionFromTemplate()`): **Nonprofit:** *Grant & funder radar* (cap 50; signature line — no client story publicly without a recorded consent artifact — ships as a constraint + flagged uncheckable criterion, since consent needs judgment, not a regex). **Solo founder:** *Inbox & calendar defense* (cap 100; nothing signs/sends/spends above the cap without approval — enforced as spec authority). **Creator:** *Sponsor deliverables, tracked* (cap 0; off-limits topics flagged on drafts). **Trades:** *After-hours intake & quotes inside the rules* (cap 300; no quote above threshold or new-customer commitment without the owner's tap — spec authority). **Caregiver:** *The care cadence* (cap 50; medical details never leave their scope — spec authority + the discretion map). Each signature line is represented by its honest enforcement mode — `spec-authority` where limits express it, `flagged-constraint` where it needs the principal's eyes — never dressed up as a machine rule it isn't. The nonprofit and caregiver templates are asserted in evals (selection + conservative limits intact); the other three are templates-as-data, which is the point.
- **Decision echoes (minimal real version).** Every principal approval decision feeds a pattern tracker (wired to the Core's decision hook). Rule classes are legible: `<kind>:weekend`, `<kind>:evening` (≥17:00 UTC), `<kind>:any`. At **ECHO_THRESHOLD = 3 consistent denials** in a class, a **provisional inferred rule** is written to the Vault (provenance `inferred:decision-echo`) and surfaced in the brief and the console. It governs **nothing** while provisional. Confirmation promotes it to owner-confirmed in the Vault **and** compiles it into a hard line, so it governs subsequent decisions; rejection deletes it with the standard zero-residual proof and the class is never re-inferred.

**Question discipline** (from the design, applied to the built tiers): *delegation-value ordering* — Tier 0 first because it unlocks safe action; *the tomorrow test* — every question declares the capability it unlocks ("Why we ask" is shown in the console), and nothing is asked that wouldn't change tomorrow's behavior; *recognition-over-recall* — applied where the format allows (the voice audition is its purest form: pick by listening, not by describing).

**Built vs roadmap for this section:** Tier 0 + Tier 1, pack branching (all five packs as data), and minimal decision echoes are **built**. Tier 2 (working style, woven into missions), Tier 3 asked just-in-time per mission (here: branched at onboarding), Tier 4 (values & voice profile), the quarterly "what I believe about you" review document, and ten-second debriefs are **documented roadmap** in the design doc, not built.

### Voice (`packages/voice`)
Steward speaks — briefs aloud, approval prompts, alerts — local-first, behind an engine interface:

- **Engines (both actually installed and rendering in this environment):** **Kokoro** (ONNX build, via `kokoro-onnx`) as the high-quality local engine, and **Piper** (`piper-tts`) as the proven floor. Six candidate voices: Kokoro Sarah / Michael / Emma, Piper Lessac / Amy / Alan. Availability is probed from the filesystem; an engine that isn't installed simply doesn't appear, and there is **no silent cloud fallback**. Provisioning: `tools/voice/setup.sh` (venv + models are downloads, gitignored).
- **Profiles live in the Vault** as owner preferences with provenance (subject `voice:settings`): per-context assignments (**brief / alert / interview**), speaking **rate** (mapped to each engine's genuine speed control — Piper `length_scale`, Kokoro `speed`), spoken-brief **verbosity** (full vs headlines), and **quiet hours** (the spoken brief is muted — visual only — inside the window; the console enforces it and says so). Only parameters the engines genuinely expose are offered.
- **Audition-first selection** (the owner's standing rule — never let the system choose a voice unilaterally): on the console Voice page every candidate reads **the same three canonical lines** (a brief headline, an approval prompt, an anomaly alert) with play buttons; assignment controls sit below the auditions. `cli.ts samples` renders the same set to WAV files (18 files, all rendered for real during this build).
- **Spoken brief:** the morning brief renders to audio through the assigned brief voice (`/voice/brief.wav` in the console, cached by content hash; `cli.ts speak-brief` offline).
- **Round-trip intelligibility eval** (in the eval suite; a *reported metric*, not a hard gate): critical-token lines are rendered through the default voice and transcribed back with **faster-whisper (tiny, local model)**; exact-match rates per token class after normalization (English number words folded to digits). Latest run in this environment, Kokoro **af_sarah**:

  | Token class | Exact match | What the misses were |
  |---|---|---|
  | Names | 1/4 (25%) | Whisper-tiny garbles proper names ("Viga", "Ocafer", "Alina … Center Thanks") |
  | Digits | 2/3 (67%) | One code merged: "4 4 1 7" heard as "41417" |
  | Amounts | 3/3 (100%) | All dollar amounts exact |
  | Dates | 1/3 (33%) | Day/month exact; the *year* misheard twice (2026/2027 → 2021) |
  | **Overall** | **7/13 (54%)** | |

  Read the table honestly: it measures the **round trip** (TTS → tiny ASR). Most misses are ASR-side — tiny Whisper is a weak listener, especially for names and years — which is precisely the class of failure this eval exists to surface before a voice is trusted with reading receipts aloud. Per-line transcripts live in `packages/evals/scorecard.json`.

- **Voice cloning is roadmap-only, and governed:** a clone would require a recorded consent artifact stored in the Vault, would be labeled wherever used, and would **never** be used to speak *as* the owner to third parties. Steward's voice speaks *to* its owner, never *as* its owner. That line is architectural, not a policy toggle. Cloud voice providers are likewise owner opt-in roadmap — never a silent default.

## Eval scorecard (latest run, this environment)

11 scenarios, **all passing**; full detail in `packages/evals/scorecard.json`.

| Hard gate | Result | Gate |
|---|---|---|
| Unauthorized consequential actions executed (adversarial + golden + ladder) | **0** | 0 |
| Receipt completeness | **100%** | 100% |
| Deletion residue (vault + index + ledger) | **0** | 0 |
| Cross-scope memory reads | **0** | 0 |
| Portability round-trip (export → wipe → import → fresh instance performs) | **PASS** | pass |
| Spec fidelity (uncheckable criteria flagged pre-execution) | **PASS** | pass |
| Authority ladder (observe/draft/budget/demotion/promotion) | **PASS** | pass |
| Onboarding (Tier 0 lines enforce / packs branch / keystone / echoes govern) | **PASS** | pass |
| Supervision load, golden week | **1.71 interruptions/day** (12 over 7 days) | ≤ 5/day |
| Voice intelligibility (reported metric, not a gate) | **7/13 exact (54%)**, Kokoro af_sarah | — |

Scenario list: golden research, golden ops, receipt completeness, adversarial suite (out-of-spec spend, unapproved sending, tool-result prompt injection, approval replay/tamper, capability violation), authority ladder, onboarding personas (nonprofit director + caregiver), decision echoes, memory governance, portability, golden-week supervision load, voice intelligibility. Plus hardening drills: full trace-chain completeness (spec → mission → receipts), a mission-crash drill (pending approvals voided, zero partial execution), a vault-corruption recovery drill, and a seeded week with a deadline, an anomaly, and an approval replay arriving while the principal is away.

**Tests executed:** 41 passing (unit + integration + HTTP smoke), 0 failing. CI (`.github/workflows/ci.yml`, YAML-validated locally) runs the same test + eval commands; in CI the voice render test skips honestly when no engine is installed and the intelligibility scenario reports "not measured" instead of inventing numbers.

## Honest limits

- **The world is simulated.** Agents act on an in-memory world (outbox, wallet, calendar, task list, document corpus). Verification proves the expected effect exists *in that world state* — the same shape a real integration would check against a provider API, but no real email is sent and no real money moves in this build.
- **No real LLM.** Intent Studio and onboarding are deterministic dialogue managers behind provider interfaces with a labeled fake implementation — by design (no API keys in this environment), and the evals pin their behavior exactly.
- **Speech recognition is the browser's.** The console's mic modes depend on the Web Speech API, which is browser- and vendor-dependent and routes recognition through the browser's own service under its privacy terms; it cannot be verified headlessly and is not claimed as verified. Local TTS/ASR (Kokoro, Piper, faster-whisper) *are* verified — they ran here.
- **Verification ≠ truth.** A "verified" receipt means the expected effect was found by a named checker. A failed verification is an incident (ladder demotion); an absent checker yields an honest `unverified`, which builds no trust and breaks none.
- **Hard-line parsing is conservative.** Only the documented "never …" forms compile to deny rules; everything else is stored as a rule memory for a human to see. The parser will miss creative phrasings rather than invent deny rules from them.
- **Decision echoes are minimal.** Denial patterns only, three time-based rule classes, one threshold (3). Streaks reset on a contrary decision; confirmed rules compile to hard lines of the same shape.
- **Ladder domains are coarse** — domain = action-kind family. Per-recipient or per-merchant rungs would be a finer model.
- **Single principal, single machine.** Multi-principal households, hosted deployment, and real provider integrations (email/calendar/banking APIs) are Phase 2 in the design doc, not this build.

## Executed vs written-but-unrun

| Capability | Status |
|---|---|
| All 41 tests (incl. console HTTP smoke, both skins) | **Executed** in this environment |
| Eval suite: 11 scenarios + all hard gates | **Executed** — `npm run eval` |
| Deletion + zero-residual proof, export → wipe → import | **Executed** (unit, eval, and `demo:flow`) |
| Console served + smoke-tested over HTTP (all routes, both themes) | **Executed** |
| Kokoro + Piper rendering; audition samples (18 WAVs) | **Executed** — real audio produced here |
| faster-whisper round-trip intelligibility | **Executed** — real numbers in the scorecard |
| Vault-corruption recovery, crash drill, trace-chain drill | **Executed** |
| CI workflow | **Written, YAML-validated locally; not run on GitHub** (no repo push in scope) |
| Web Speech API recognition in a live browser | **Written; NOT verifiable headlessly — not claimed** |
| Swipe gestures on a physical phone | **Written (pointer events); verified only as served markup/logic** |
| Docker / hosted deployment | **Not applicable** — none in the design for this build |

## Roadmap (from the design doc — documented, not built)

Tier 2–4 onboarding depth (working style, just-in-time packs, values & voice), the quarterly "what I believe about you" review, ten-second debriefs, hosted voice engines as owner opt-in, governed voice cloning (consent artifact in the Vault; never speaks *as* the owner), Household Steward (multiple principals), agent reputation portability, and a shared spec library.

## Design source

The authoritative design — including the two founding principles, the Authority Ladder, the interview architecture ("Getting to know the owner"), the voice design, and the Mission Control UI direction — lives in `~/workspace/steward-project-design.md` (kept outside this repo as the owner's working document).
