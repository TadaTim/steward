#!/usr/bin/env python3
"""Steward voice bridge: synthesize one utterance to a WAV file.
Usage: synth.py --engine piper|kokoro --voice VOICE --rate 1.0 --models DIR --text TEXT --out FILE
Piper: --voice is the model basename (en_US-lessac-medium).
Kokoro: --voice is a kokoro voice id (af_sarah). Rate maps to each engine's
genuine speed control (piper length_scale = 1/rate; kokoro speed = rate)."""
import argparse, sys, wave

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", required=True)
    ap.add_argument("--voice", required=True)
    ap.add_argument("--rate", type=float, default=1.0)
    ap.add_argument("--models", required=True)
    ap.add_argument("--text", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    if a.engine == "piper":
        from piper import PiperVoice
        from piper.config import SynthesisConfig
        voice = PiperVoice.load(f"{a.models}/{a.voice}.onnx")
        syn = SynthesisConfig(length_scale=1.0 / a.rate)
        with wave.open(a.out, "wb") as w:
            voice.synthesize_wav(a.text, w, syn_config=syn)
    elif a.engine == "kokoro":
        import soundfile as sf
        from kokoro_onnx import Kokoro
        k = Kokoro(f"{a.models}/kokoro-v1.0.onnx", f"{a.models}/voices-v1.0.bin")
        samples, sr = k.create(a.text, voice=a.voice, speed=a.rate, lang="en-us")
        sf.write(a.out, samples, sr)
    else:
        print(f"unknown engine {a.engine}", file=sys.stderr)
        return 2
    return 0

if __name__ == "__main__":
    sys.exit(main())
