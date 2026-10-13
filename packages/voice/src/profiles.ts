import type { Vault } from "@steward/vault";
import type { VoiceCandidate } from "./engine.js";

/**
 * Voice profiles & settings, stored in the Context Vault as owner
 * preferences with provenance (assertedBy "principal" -> confirmed,
 * source "owner-stated:voice-picker"). Settings are versioned: every save
 * asserts a new memory; loading takes the most recent. A profile is a named
 * bundle of per-context assignments + delivery controls.
 *
 * Delivery controls map ONLY to parameters the engines genuinely expose:
 * rate (piper length_scale / kokoro speed) and quiet hours (the console
 * renders visual-only and the spoken-brief renderer refuses to synthesize
 * during quiet hours when asked to). Verbosity selects how much of the
 * brief is spoken.
 */
export type VoiceContextName = "brief" | "alert" | "interview";

export interface VoiceAssignment { engine: string; voiceId: string; label: string }

export interface VoiceSettings {
  assignments: Record<VoiceContextName, VoiceAssignment | null>;
  rate: number;                    // 0.5 (slow) .. 1.5 (fast), 1.0 = engine default
  verbosity: "headlines" | "full";
  quietHoursStart: string | null;  // "21:00" local — after this, visual only
  quietHoursEnd: string | null;    // "07:00"
  profileName: string;
}

export const DEFAULT_SETTINGS: VoiceSettings = {
  assignments: { brief: null, alert: null, interview: null },
  rate: 1.0,
  verbosity: "full",
  quietHoursStart: null,
  quietHoursEnd: null,
  profileName: "Default",
};

const SUBJECT = "voice:settings";

export function loadVoiceSettings(vault: Vault): VoiceSettings {
  const rows = vault.listFor("principal", { subjectPrefix: SUBJECT });
  const latest = rows[rows.length - 1];
  if (!latest?.data) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(latest.data as unknown as VoiceSettings) };
}

export function saveVoiceSettings(vault: Vault, settings: VoiceSettings, actor = "principal"): void {
  if (actor !== "principal") throw new Error("only the principal may change voice settings");
  vault.assertMemory({
    kind: "preference",
    subject: SUBJECT,
    content: `Voice profile "${settings.profileName}": brief=${settings.assignments.brief?.voiceId ?? "unset"}, alert=${settings.assignments.alert?.voiceId ?? "unset"}, interview=${settings.assignments.interview?.voiceId ?? "unset"}, rate=${settings.rate}, verbosity=${settings.verbosity}, quiet=${settings.quietHoursStart ?? "off"}-${settings.quietHoursEnd ?? ""}`,
    data: { ...(settings as unknown as Record<string, unknown>) },
    consentScope: ["*"],
    assertedBy: "principal",
    source: "owner-stated:voice-picker",
  });
}

/** Fill unset assignments with sensible defaults from what's installed. */
export function withDefaults(settings: VoiceSettings, candidates: VoiceCandidate[]): VoiceSettings {
  if (candidates.length === 0) return settings;
  const pick = (i: number): VoiceAssignment => {
    const c = candidates[Math.min(i, candidates.length - 1)]!;
    return { engine: c.engine, voiceId: c.voiceId, label: c.label };
  };
  return {
    ...settings,
    assignments: {
      brief: settings.assignments.brief ?? pick(0),
      alert: settings.assignments.alert ?? pick(1),
      interview: settings.assignments.interview ?? pick(0),
    },
  };
}

/** The three canonical lines every candidate reads at audition (same lines, every voice). */
export const CANONICAL_LINES: Record<"brief" | "approval" | "alert", string> = {
  brief: "Good morning. Yesterday your agents completed four actions, all verified. Two approvals are waiting for you.",
  approval: "Approval needed: the Ops Agent wants to send the gala summary to Marisol Vega.",
  alert: "Attention. An unverified action was blocked: an agent tried to spend two hundred fifty dollars, over the two hundred dollar line you set.",
};

/** Strip markdown and (optionally) compress a brief to headline lines for speaking. */
export function speakableBrief(briefText: string, verbosity: "headlines" | "full"): string {
  const clean = (s: string) => s.replace(/[#*`>]/g, "").replace(/\s+/g, " ").trim();
  const lines = briefText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (verbosity === "full") return lines.map(clean).filter(Boolean).join(" ");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("#")) { out.push(clean(line)); continue; }
    if (line.startsWith("-") && (i === 0 || lines[i - 1]!.startsWith("#"))) out.push(clean(line));
  }
  return out.join(" ");
}

/** Is `now` inside the quiet-hours window? (Window may wrap past midnight.) */
export function inQuietHours(settings: VoiceSettings, now: Date): boolean {
  if (!settings.quietHoursStart || !settings.quietHoursEnd) return false;
  const mins = (s: string) => { const [h, m] = s.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = mins(settings.quietHoursStart);
  const end = mins(settings.quietHoursEnd);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}
