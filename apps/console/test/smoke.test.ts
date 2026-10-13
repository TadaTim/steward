import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createSteward, seedDemo } from "../src/system.js";
import { createConsoleServer } from "../src/server.js";

async function boot() {
  const sys = createSteward(":memory:");
  seedDemo(sys);
  const server = createConsoleServer(sys);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  return { sys, server, base: `http://127.0.0.1:${port}` };
}

test("console serves every view and the seeded data is real", async () => {
  const { server, base } = await boot();
  try {
    for (const p of ["/", "/approvals", "/missions", "/vault", "/ledger", "/brief"]) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
      const body = await res.text();
      assert.match(body, /Steward/);
    }
    const approvals = await (await fetch(base + "/approvals")).text();
    assert.match(approvals, /Gala budget update/); // the still-pending second send
    const vault = await (await fetch(base + "/vault")).text();
    assert.match(vault, /Marisol Vega/);
    const ledger = await (await fetch(base + "/ledger")).text();
    assert.match(ledger, /email\.send/);
  } finally {
    server.close();
  }
});

test("principal can decide an approval and delete a memory via HTTP", async () => {
  const { sys, server, base } = await boot();
  try {
    const pending = sys.core.listApprovals("pending");
    assert.equal(pending.length, 1);
    const res = await fetch(`${base}/approvals/${pending[0]!.id}/decide`, {
      method: "POST", body: new URLSearchParams({ decision: "denied" }), redirect: "manual",
    });
    assert.equal(res.status, 303);
    assert.equal(sys.core.listApprovals("pending").length, 0);
    const mem = sys.vault.listFor("principal")[0]!;
    const del = await fetch(`${base}/vault/${mem.id}/delete`, { method: "POST" });
    const html = await del.text();
    assert.match(html, /VERIFIED — zero residue/);
  } finally {
    server.close();
  }
});

test("ladder page renders granted rungs", async () => {
  const { server, base } = await boot();
  try {
    const res = await fetch(base + "/ladder");
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /Authority Ladder/);
    assert.match(body, /data-rung="act_within_budget"/); // chip row shows the granted rung as current
    assert.match(body, /chip/);
  } finally {
    server.close();
  }
});

test("Clean Command chrome: masthead, voice bar with mic modes, card stack", async () => {
  const { server, base } = await boot();
  try {
    const home = await (await fetch(base + "/")).text();
    assert.match(home, /Morning Brief/);            // bold sans masthead
    assert.match(home, /decision/);                 // one-line attention summary
    assert.match(home, /id="pttDisc"/);             // big push-to-talk disc
    assert.match(home, /id="hfBtn"/);               // hands-free secondary control
    assert.match(home, /data-mode="off"/);          // unmistakable mic-off default
    assert.match(home, /SpeechRecognition/);        // Web Speech API path present
    assert.match(home, /setMicMode/);               // mode toggle logic served
    const approvals = await (await fetch(base + "/approvals")).text();
    assert.match(approvals, /APPROVAL NEEDED/i);
    assert.match(approvals, /decision-card/);       // card stack, not a table
    const brief = await (await fetch(base + "/brief")).text();
    assert.match(brief, /Morning Brief/);
  } finally {
    server.close();
  }
});

test("voice page, onboarding flow, and intent flow work over HTTP", async () => {
  const { sys, server, base } = await boot();
  try {
    const voice = await fetch(base + "/voice");
    assert.equal(voice.status, 200);
    const voiceHtml = await voice.text();
    assert.match(voiceHtml, /local-first/i);
    if (sys.voice.candidates().length > 0) {
      assert.match(voiceHtml, /Audition/);
      const save = await fetch(base + "/voice/settings", {
        method: "POST", redirect: "manual",
        body: new URLSearchParams({ profileName: "Smoke", briefVoice: sys.voice.candidates()[0]!.voiceId, alertVoice: sys.voice.candidates()[0]!.voiceId, interviewVoice: sys.voice.candidates()[0]!.voiceId, rate: "1.1", verbosity: "headlines", quietStart: "21:00", quietEnd: "07:00" }),
      });
      assert.equal(save.status, 303);
      assert.equal(sys.voiceSettings().profileName, "Smoke");
      const sample = await fetch(base + "/voice/sample?voice=" + encodeURIComponent(sys.voice.candidates()[0]!.voiceId) + "&line=brief");
      assert.equal(sample.status, 200);
      assert.match(sample.headers.get("content-type") ?? "", /audio\/wav/);
    }
    // Onboarding over HTTP: answer every question, land on the completion view.
    for (let i = 0; i < 20 && !(sys.onboarding?.isDone() ?? false); i++) {
      const page = await (await fetch(base + "/onboarding")).text();
      assert.match(page, /Getting to know you/);
      const step = sys.onboarding!.current()!;
      const answer = step.id === "never-do" ? "Never spend over $25" : step.id === "what-you-run" ? "A small nonprofit" : "—";
      await fetch(base + "/onboarding/answer", { method: "POST", body: new URLSearchParams({ answer }), redirect: "manual" });
    }
    assert.equal(sys.onboarding!.isDone(), true);
    assert.ok(sys.core.listHardLines().some((l) => l.maxAmount === 25));
    // Intent Studio over HTTP: goal + five answers -> compiled spec + mission.
    await fetch(base + "/intent/start", { method: "POST", body: new URLSearchParams({ goal: "Send the weekly update" }), redirect: "manual" });
    for (const a of ["up to $40", "ask me first", "team only", "none", "update sent every Friday"]) {
      await fetch(base + "/intent/answer", { method: "POST", body: new URLSearchParams({ answer: a }), redirect: "manual" });
    }
    const intentPage = await (await fetch(base + "/intent")).text();
    assert.match(intentPage, /Spec compiled/);
  } finally {
    server.close();
  }
});

test("Signal Industrial skin: switchable, persisted in the Vault, same functions", async () => {
  const { sys, server, base } = await boot();
  try {
    const homeClean = await (await fetch(base + "/")).text();
    assert.match(homeClean, /data-theme="clean"/); // Clean Command is the default
    const sw = await fetch(base + "/settings/theme", {
      method: "POST", redirect: "manual",
      headers: { referer: base + "/approvals" },
      body: new URLSearchParams({ theme: "signal" }),
    });
    assert.equal(sw.status, 303);
    assert.equal(sys.theme(), "signal");
    const mem = sys.vault.listFor("principal", { subjectPrefix: "ui:theme" }).at(-1)!;
    assert.equal(mem.provenance.source, "owner-stated:console-settings");
    // With Signal active, every page renders dark-skin markup and still works.
    for (const p of ["/", "/approvals", "/ladder", "/ledger", "/brief", "/voice"]) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
      assert.match(await res.text(), /data-theme="signal"/, p);
    }
    const approvals = await (await fetch(base + "/approvals")).text();
    assert.match(approvals, /APPROVAL NEEDED/i); // same function, new skin
    const home = await (await fetch(base + "/")).text();
    assert.match(home, /--accent:#ff6f1f/); // safety-orange accent served in the Signal theme
    await fetch(base + "/settings/theme", { method: "POST", body: new URLSearchParams({ theme: "clean" }), redirect: "manual" });
    assert.equal(sys.theme(), "clean");
  } finally {
    server.close();
  }
});
