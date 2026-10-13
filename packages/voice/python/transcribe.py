#!/usr/bin/env python3
"""Transcribe a WAV file with faster-whisper; prints JSON {"text": ...}.

The WAV is decoded with the stdlib `wave` module and resampled to 16 kHz
with numpy, then passed to Whisper as an array — deliberately bypassing
faster-whisper's PyAV decode path (its av.open kwargs vary by PyAV build).
"""
import argparse, json, sys, wave

import numpy as np


def load_wav_16k(path: str) -> np.ndarray:
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        ch = w.getnchannels()
        n = w.getnframes()
        raw = w.readframes(n)
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        audio = audio.reshape(-1, ch).mean(axis=1)
    if sr != 16000:
        idx = np.linspace(0, len(audio) - 1, int(len(audio) * 16000 / sr))
        audio = np.interp(idx, np.arange(len(audio)), audio).astype(np.float32)
    return audio


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="tiny")
    ap.add_argument("--file", required=True)
    a = ap.parse_args()
    from faster_whisper import WhisperModel
    m = WhisperModel(a.model, device="cpu", compute_type="int8")
    segments, _info = m.transcribe(load_wav_16k(a.file), beam_size=1, language="en")
    text = " ".join(s.text for s in segments).strip()
    print(json.dumps({"text": text}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
