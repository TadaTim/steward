#!/bin/bash
# Steward voice runtime setup: local TTS (Kokoro attempt + Piper floor) and
# faster-whisper for the intelligibility eval. Everything lives under
# tools/voice/ (gitignored — models and venvs are downloads, not source).
set -x
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q piper-tts faster-whisper kokoro-onnx soundfile numpy
echo "--- pip done ---"
# Piper voices: lessac reuses the voice-agent build's proven copy; amy + alan are new downloads.
cp ~/workspace/voice-agent/models/piper/en_US-lessac-medium.onnx models/ 2>/dev/null
cp ~/workspace/voice-agent/models/piper/en_US-lessac-medium.onnx.json models/ 2>/dev/null
base=https://huggingface.co/rhasspy/piper-voices/resolve/main
curl -sL --fail -o models/en_US-amy-medium.onnx      $base/en/en_US/amy/medium/en_US-amy-medium.onnx
curl -sL --fail -o models/en_US-amy-medium.onnx.json $base/en/en_US/amy/medium/en_US-amy-medium.onnx.json
curl -sL --fail -o models/en_GB-alan-medium.onnx      $base/en/en_GB/alan/medium/en_GB-alan-medium.onnx
curl -sL --fail -o models/en_GB-alan-medium.onnx.json $base/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json
echo "--- piper voices done ---"
# Kokoro (ONNX build): model + voice pack from the kokoro-onnx release.
krel=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
curl -sL --fail -o models/kokoro-v1.0.onnx  $krel/kokoro-v1.0.onnx
curl -sL --fail -o models/voices-v1.0.bin  $krel/voices-v1.0.bin
echo "--- kokoro download done ---"
ls -la models/
.venv/bin/python -c "import piper, faster_whisper, kokoro_onnx; print('imports OK')"
