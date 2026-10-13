import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Voice engines behind one interface (the portfolio's provider discipline).
 * LOCAL-FIRST: engines run on this machine via the tools/voice runtime
 * (a Python venv with piper-tts / kokoro-onnx / faster-whisper, provisioned
 * by tools/voice/setup.sh — models and venvs are downloads, never committed).
 * Availability is probed from the filesystem, never assumed: an engine that
 * is not installed simply does not appear. There is no silent cloud fallback.
 */

export interface VoiceCandidate {
  engine: string;
  voiceId: string;
  label: string;
}

export const ALL_CANDIDATES: VoiceCandidate[] = [
  { engine: "kokoro", voiceId: "af_sarah", label: "Sarah — Kokoro (US, female)" },
  { engine: "kokoro", voiceId: "am_michael", label: "Michael — Kokoro (US, male)" },
  { engine: "kokoro", voiceId: "bf_emma", label: "Emma — Kokoro (UK, female)" },
  { engine: "piper", voiceId: "en_US-lessac-medium", label: "Lessac — Piper (US, female)" },
  { engine: "piper", voiceId: "en_US-amy-medium", label: "Amy — Piper (US, female)" },
  { engine: "piper", voiceId: "en_GB-alan-medium", label: "Alan — Piper (UK, male)" },
];

/** Where the voice runtime lives (venv + models). Override with STEWARD_VOICE_HOME. */
export function voiceHome(): string {
  return process.env.STEWARD_VOICE_HOME ?? join(here, "..", "..", "..", "tools", "voice");
}

export function pythonBin(): string {
  return join(voiceHome(), ".venv", "bin", "python");
}

export function modelsDir(): string {
  return join(voiceHome(), "models");
}

function engineInstalled(engine: string): boolean {
  if (!existsSync(pythonBin())) return false;
  if (engine === "piper") return true; // per-voice model check happens in candidates()
  if (engine === "kokoro") return existsSync(join(modelsDir(), "kokoro-v1.0.onnx")) && existsSync(join(modelsDir(), "voices-v1.0.bin"));
  return false;
}

export interface VoiceEngine {
  id: string;
  /** Candidates whose engine AND model files are actually installed. */
  candidates(): VoiceCandidate[];
  synthesize(text: string, voiceId: string, rate?: number): Promise<Buffer>;
  transcribe(wavPath: string): Promise<string>;
}

class LocalEngine implements VoiceEngine {
  id = "local";

  candidates(): VoiceCandidate[] {
    return ALL_CANDIDATES.filter((c) => {
      if (!engineInstalled(c.engine)) return false;
      if (c.engine === "piper") return existsSync(join(modelsDir(), `${c.voiceId}.onnx`));
      return true;
    });
  }

  async synthesize(text: string, voiceId: string, rate = 1.0): Promise<Buffer> {
    const candidate = ALL_CANDIDATES.find((c) => c.voiceId === voiceId);
    if (!candidate) throw new Error(`unknown voice: ${voiceId}`);
    if (!this.candidates().some((c) => c.voiceId === voiceId)) {
      throw new Error(`voice ${voiceId} is not installed in this environment`);
    }
    const dir = mkdtempSync(join(tmpdir(), "steward-tts-"));
    const out = join(dir, "out.wav");
    try {
      await exec(pythonBin(), [
        join(here, "..", "python", "synth.py"),
        "--engine", candidate.engine, "--voice", voiceId,
        "--rate", String(rate), "--models", modelsDir(),
        "--text", text, "--out", out,
      ], { timeout: 120_000, env: { ...process.env, HF_HOME: join(voiceHome(), "hf-cache") } });
      return readFileSync(out);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async transcribe(wavPath: string): Promise<string> {
    // Prefer a LOCAL model directory (provisioned by setup) — no hub download,
    // no network, no proxy surprises. Falls back to the hub name "tiny".
    const local = join(modelsDir(), "whisper-tiny");
    const model = process.env.STEWARD_WHISPER_MODEL ?? (existsSync(local) ? local : "tiny");
    const { stdout } = await exec(pythonBin(), [
      join(here, "..", "python", "transcribe.py"), "--file", wavPath, "--model", model,
    ], { timeout: 300_000, env: { ...process.env, HF_HOME: join(voiceHome(), "hf-cache"), HF_HUB_OFFLINE: model === "tiny" ? "0" : "1" } });
    return (JSON.parse(stdout) as { text: string }).text;
  }
}

export function createVoiceEngine(): VoiceEngine {
  return new LocalEngine();
}
