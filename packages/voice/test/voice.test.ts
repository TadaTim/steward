import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault } from "@steward/vault";
import {
  createVoiceEngine, loadVoiceSettings, saveVoiceSettings, withDefaults,
  speakableBrief, inQuietHours, normalizeTranscript, numberWordsToDigits,
  DEFAULT_SETTINGS,
} from "../src/index.js";

test("voice settings persist to the Vault as confirmed owner preferences", () => {
  const vault = new Vault(":memory:");
  const settings = {
    ...DEFAULT_SETTINGS, profileName: "Morning", rate: 0.9,
    assignments: {
      brief: { engine: "piper", voiceId: "en_US-lessac-medium", label: "Lessac" },
      alert: { engine: "piper", voiceId: "en_GB-alan-medium", label: "Alan" },
      interview: { engine: "piper", voiceId: "en_US-lessac-medium", label: "Lessac" },
    },
    quietHoursStart: "21:00", quietHoursEnd: "07:00",
  };
  saveVoiceSettings(vault, settings);
  const loaded = loadVoiceSettings(vault);
  assert.equal(loaded.profileName, "Morning");
  assert.equal(loaded.assignments.alert?.voiceId, "en_GB-alan-medium");
  assert.equal(loaded.rate, 0.9);
  const mem = vault.listFor("principal", { subjectPrefix: "voice:settings" })[0]!;
  assert.equal(mem.state, "confirmed");
  assert.equal(mem.provenance.source, "owner-stated:voice-picker");
  assert.throws(() => saveVoiceSettings(vault, settings, "ops"), /only the principal/);
});

test("speakable brief: markdown stripped; headlines mode is shorter", () => {
  const brief = "# Morning brief — 2026-10-13\n\n## What your agents did (2 actions)\n- Sent the summary — *verified*\n- Bought stamps\n\n## Money\n- Total: 3.50";
  const full = speakableBrief(brief, "full");
  assert.ok(!full.includes("#") && !full.includes("*"));
  assert.ok(full.includes("Bought stamps"));
  const head = speakableBrief(brief, "headlines");
  assert.ok(head.length < full.length);
  assert.ok(head.includes("Morning brief"));
});

test("quiet hours window, including wrap past midnight", () => {
  const s = { ...DEFAULT_SETTINGS, quietHoursStart: "21:00", quietHoursEnd: "07:00" };
  assert.equal(inQuietHours(s, new Date("2026-10-13T22:30:00")), true);
  assert.equal(inQuietHours(s, new Date("2026-10-13T06:30:00")), true);
  assert.equal(inQuietHours(s, new Date("2026-10-13T12:00:00")), false);
  assert.equal(inQuietHours(DEFAULT_SETTINGS, new Date("2026-10-13T23:00:00")), false);
});

test("transcript normalization: number words and digit spacing", () => {
  assert.equal(numberWordsToDigits("one thousand two hundred fifty"), "1250");
  assert.equal(numberWordsToDigits("eight thousand four hundred"), "8400");
  assert.equal(normalizeTranscript("The total is $1,250."), "the total is 1250");
  assert.equal(normalizeTranscript("code is four four one seven"), "code is 4417");
});

test("real engine render (skips honestly when no engine is installed)", async (t) => {
  const engine = createVoiceEngine();
  const candidates = engine.candidates();
  if (candidates.length === 0) { t.skip("no local TTS engine installed in this environment"); return; }
  const wav = await engine.synthesize("Good morning. This is a voice check.", candidates[0]!.voiceId, 1.0);
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.ok(wav.length > 10_000, `wav suspiciously small: ${wav.length}`);
});
