import { test } from "node:test";
import assert from "node:assert/strict";
import { InterviewSession, SpecStore, classifyCriterion, planMission } from "../src/index.js";

function runInterview(answers: string[], goal = "Organize the nonprofit gala"): Spec {
  const s = new InterviewSession(goal);
  s.currentQuestion();
  for (const a of answers) { if (s.answer(a).done) break; }
  return s.compile("spec_gala");
}

test("interview compiles a full spec: spend limit, send authority, recipients", () => {
  const spec = runInterview([
    "Up to $250 is fine",
    "Always ask first",
    "marisol@example.com may be contacted freely",
    "Never book anything on a Sunday",
    "The summary email is sent to marisol@example.com; total spend stays under $250",
  ]);
  assert.equal(spec.authority.spendLimit, 250);
  assert.equal(spec.authority.maySendWithoutApproval, false);
  assert.deepEqual(spec.authority.allowedRecipients, ["marisol@example.com"]);
  assert.deepEqual(spec.constraints, ["Never book anything on a Sunday"]);
  const kinds = spec.acceptanceCriteria.map((c) => c.checker.type);
  assert.deepEqual(kinds, ["message_sent_to", "spend_lte"]);
  assert.deepEqual(spec.uncheckableCriteria, []);
});

test("uncheckable acceptance criteria are flagged in the spec BEFORE execution", () => {
  const spec = runInterview([
    "always ask", "always ask", "none", "nothing special",
    "I'll know it when I see it — it should feel right",
  ]);
  assert.equal(spec.acceptanceCriteria.length, 1);
  assert.equal(spec.acceptanceCriteria[0]!.needsPrincipalEyes, true);
  assert.deepEqual(spec.uncheckableCriteria, ["crit_1"]);
});

test("criterion classifier maps plain language to deterministic checkers", () => {
  assert.equal(classifyCriterion("A draft of the letter exists", "c").checker.type, "draft_exists");
  assert.equal(classifyCriterion("The appointment is on the calendar", "c").checker.type, "event_created");
  assert.equal(classifyCriterion("A written brief exists summarizing options", "c").checker.type, "artifact_exists");
  assert.equal(classifyCriterion("It should spark joy", "c").checker.type, "manual");
});

test("spec versioning: revise supersedes and bumps version", () => {
  const store = new SpecStore();
  const v1 = runInterview(["$100", "always ask", "none", "none", "A draft exists"]);
  store.save(v1);
  const v2 = store.revise("spec_gala", { objective: "Organize the gala (revised)" });
  assert.equal(v2.version, 2);
  assert.equal(store.getSpec("spec_gala")!.version, 2);
  assert.equal(store.history("spec_gala").length, 2);
  assert.equal(store.history("spec_gala")[0]!.status, "superseded");
});

test("planner routes research goals to the research agent", () => {
  const spec = runInterview(["always ask", "always ask", "none", "none", "A written brief exists"], "Research community solar programs for the co-op");
  assert.equal(planMission(spec).agentId, "research");
});
