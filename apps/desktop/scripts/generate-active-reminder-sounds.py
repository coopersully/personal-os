"""Generate nohmi's original quiet desktop interaction plucks (mono PCM WAV)."""
from pathlib import Path
import math
import struct
import wave

DESTINATION = Path(__file__).resolve().parent.parent / "src-tauri" / "sounds"
RATE = 44100
# Event: duration, frequencies, note spacing, amplitude.
SOUNDS = {
    "complete": (0.23, (740, 988), 0.065, 0.17),
    "snap": (0.12, (920, 1380), 0.035, 0.13),
    "detach": (0.11, (740, 490), 0.035, 0.12),
    "resize": (0.08, (580,), 0, 0.10),
    "slot": (0.05, (1040,), 0, 0.08),
    "error": (0.16, (240, 200), 0.045, 0.13),
}

for event, (duration, frequencies, spacing, amplitude) in SOUNDS.items():
    samples = bytearray()
    for index in range(int(RATE * duration)):
        time = index / RATE
        value = 0.0
        for note, frequency in enumerate(frequencies):
            elapsed = time - spacing * note
            if elapsed >= 0:
                envelope = (1 - math.exp(-elapsed / 0.002)) * math.exp(-elapsed / 0.035)
                value += amplitude * envelope * (
                    math.sin(2 * math.pi * frequency * elapsed)
                    + 0.13 * math.sin(4 * math.pi * frequency * elapsed)
                )
        value *= min(1, (duration - time) / 0.015)
        samples.extend(struct.pack("<h", int(max(-1, min(1, value)) * 32767)))
    with wave.open(str(DESTINATION / f"active-reminder-soft-{event}.wav"), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(samples)
