#!/usr/bin/env -S npx tsx
/**
 * Steward voice CLI.
 *   probe                     — list engines/voices actually installed here
 *   samples <outDir>          — render the 3 canonical lines for every installed voice
 *   speak <text> <outWav> [--voice ID] [--rate R]
 *   speak-brief <briefFile> <outWav> [--voice ID] [--rate R] [--verbosity headlines|full]
 * Rendering is local-only; nothing leaves this machine.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createVoiceEngine, ALL_CANDIDATES } from "./engine.js";
import { CANONICAL_LINES, speakableBrief } from "./profiles.js";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1]! : dflt;
};
const engine = createVoiceEngine();

if (cmd === "probe") {
  console.log(JSON.stringify({ installed: engine.candidates(), all: ALL_CANDIDATES }, null, 1));
} else if (cmd === "samples") {
  const outDir = rest[0] ?? "samples";
  mkdirSync(outDir, { recursive: true });
  for (const c of engine.candidates()) {
    for (const ctx of Object.keys(CANONICAL_LINES) as (keyof typeof CANONICAL_LINES)[]) {
      const wav = await engine.synthesize(CANONICAL_LINES[ctx], c.voiceId, 1.0);
      const file = join(outDir, `${c.voiceId}__${ctx}.wav`);
      writeFileSync(file, wav);
      console.log(`${file} (${wav.length} bytes)`);
    }
  }
} else if (cmd === "speak" || cmd === "speak-brief") {
  const src = rest[0]!; const out = rest[1]!;
  const voiceId = flag("voice", engine.candidates()[0]?.voiceId ?? "");
  const rate = Number(flag("rate", "1.0"));
  const raw = cmd === "speak" ? src : readFileSync(src, "utf8");
  const text = cmd === "speak" ? raw : speakableBrief(raw, flag("verbosity", "full") as "headlines" | "full");
  const wav = await engine.synthesize(text, voiceId, rate);
  writeFileSync(out, wav);
  console.log(`${out} (${wav.length} bytes) via ${voiceId} @ rate ${rate}`);
} else {
  console.error("usage: probe | samples <outDir> | speak <text> <out.wav> | speak-brief <file> <out.wav>");
  process.exit(2);
}
