import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VoiceEngine } from "./engine.js";

/**
 * Round-trip intelligibility eval.
 *
 * The failure this guards against is real and observed (in the voice-agent
 * build, faster-whisper misheard a spoken phone number): a voice that sounds
 * pleasant but garbles names, numbers, dates, or amounts must not become the
 * default voice for reading receipts aloud. Method: render critical-token
 * lines through a voice, transcribe them back with faster-whisper, and score
 * EXACT matches per token class after normalization (case/punctuation folded;
 * English number words converted to digits, so "one thousand two hundred
 * fifty" and "1250" are the same token).
 *
 * This is a REPORTED metric, not a hard gate — engine quality varies by
 * machine and model, and the honest output is the table, not a threshold.
 */

export type TokenClass = "names" | "digits" | "amounts" | "dates";

export interface TokenCase {
  cls: TokenClass;
  line: string;        // what the voice reads
  expect: string;      // normalized token(s) that must appear, in order, in the transcript
}

export const TOKEN_CASES: TokenCase[] = [
  { cls: "names", line: "Marisol Vega confirmed the booking.", expect: "marisol vega" },
  { cls: "names", line: "Tom Okafor will bring the documents.", expect: "tom okafor" },
  { cls: "names", line: "Doctor Patel's office called twice.", expect: "patel" },
  { cls: "names", line: "Eleanor Rivera sent her thanks.", expect: "eleanor rivera" },
  { cls: "digits", line: "Your verification code is 4 4 1 7.", expect: "4417" },
  { cls: "digits", line: "The door code is 9 0 2 1.", expect: "9021" },
  { cls: "digits", line: "Call the office at 5 5 5 0 1 4 2.", expect: "5550142" },
  { cls: "amounts", line: "The total is $1,250.", expect: "1250" },
  { cls: "amounts", line: "The gala raised $8,400.", expect: "8400" },
  { cls: "amounts", line: "That purchase was $49.99.", expect: "4999" },
  { cls: "dates", line: "The gala is on October 24, 2026.", expect: "october 24 2026" },
  { cls: "dates", line: "Your appointment is March 3, 2027.", expect: "march 3 2027" },
  { cls: "dates", line: "The deadline is January 15.", expect: "january 15" },
];

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const DIGIT_WORDS = new Set(["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]);

/** Convert runs of English number words into digits ("eight thousand four hundred" -> "8400"). */
export function numberWordsToDigits(text: string): string {
  const words = text.split(" ");
  const out: string[] = [];
  let i = 0;
  const isNum = (w: string) => w in UNITS || w in TENS || w === "hundred" || w === "thousand";
  while (i < words.length) {
    if (!isNum(words[i]!)) { out.push(words[i]!); i++; continue; }
    // Collect the whole number-word run first: its shape decides the reading.
    const run: string[] = [];
    while (i < words.length && (isNum(words[i]!) || words[i] === "and")) { run.push(words[i]!); i++; }
    const content = run.filter((w) => w !== "and");
    if (content.length >= 2 && content.every((w) => DIGIT_WORDS.has(w))) {
      // Digit-by-digit speech ("four four one seven") concatenates, never sums.
      out.push(content.map((w) => String(UNITS[w])).join(""));
      continue;
    }
    let total = 0; let current = 0;
    for (const w of content) {
      if (w in UNITS) current += UNITS[w]!;
      else if (w in TENS) current += TENS[w]!;
      else if (w === "hundred") current = (current || 1) * 100;
      else if (w === "thousand") { total += (current || 1) * 1000; current = 0; }
    }
    out.push(String(total + current));
  }
  return out.join(" ");
}

/** Fold a transcript (or an expectation) into comparable form. */
export function normalizeTranscript(text: string): string {
  let t = text.toLowerCase().replace(/[$,]/g, "").replace(/[^a-z0-9 ]+/g, " ");
  t = numberWordsToDigits(t.replace(/\s+/g, " ").trim());
  // A digit sequence spoken digit-by-digit may come back spaced ("4 4 1 7"):
  // also produce the collapsed form so exact matching can check both.
  return t.replace(/\s+/g, " ").trim();
}

function matches(expect: string, transcript: string): boolean {
  const e = normalizeTranscript(expect);
  const t = normalizeTranscript(transcript);
  if (t.includes(e)) return true;
  // Collapsed-digits comparison (handles spaced digit readback).
  return t.replace(/ /g, "").includes(e.replace(/ /g, ""));
}

export interface IntelligibilityLineResult {
  cls: TokenClass; line: string; expect: string; heard: string; matched: boolean;
}
export interface IntelligibilityReport {
  engine: string; voiceId: string;
  perClass: Record<TokenClass, { matched: number; total: number; rate: number }>;
  overall: { matched: number; total: number; rate: number };
  lines: IntelligibilityLineResult[];
}

export async function runIntelligibility(engine: VoiceEngine, voiceId: string): Promise<IntelligibilityReport> {
  const dir = mkdtempSync(join(tmpdir(), "steward-intel-"));
  const lines: IntelligibilityLineResult[] = [];
  try {
    for (const c of TOKEN_CASES) {
      const wav = await engine.synthesize(c.line, voiceId, 1.0);
      const path = join(dir, `${c.cls}-${lines.length}.wav`);
      writeFileSync(path, wav);
      const heard = await engine.transcribe(path);
      lines.push({ cls: c.cls, line: c.line, expect: c.expect, heard, matched: matches(c.expect, heard) });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const perClass = {} as IntelligibilityReport["perClass"];
  for (const cls of ["names", "digits", "amounts", "dates"] as TokenClass[]) {
    const rows = lines.filter((l) => l.cls === cls);
    const matched = rows.filter((l) => l.matched).length;
    perClass[cls] = { matched, total: rows.length, rate: rows.length ? matched / rows.length : 0 };
  }
  const matched = lines.filter((l) => l.matched).length;
  return {
    engine: engine.id, voiceId, perClass,
    overall: { matched, total: lines.length, rate: lines.length ? matched / lines.length : 0 },
    lines,
  };
}
