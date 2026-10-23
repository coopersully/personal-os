"""Deterministic Earshot bank renders; no models, API keys, or runtime network."""
import hashlib
import json
import os
from pathlib import Path
os.environ.setdefault("EARSHOT_OFFLINE", "1")
os.environ.setdefault("EARSHOT_THREADS", "2")
from earshot.forge.sfx import sfx_render

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps/web/public/sounds/active-cards"
RECIPES = {
    "arrive": ("ui_pop/soft", -18),
    "grab": ("tap/soft", -30),
    "slot": ("pro_click/soft", -34),
    "snap": ("click/thock", -24),
    "lock": ("toggle/micro", -24),
    "unlock": ("toggle/off", -25),
    "gather": ("ui_pop/wide", -22),
    "complete": ("mallet/pluck", -16),
    "error": ("ui_pop/fall", -23),
    "resize": ("pro_click/soft", -29),
}
OUT.mkdir(parents=True, exist_ok=True)
report = {"earshot": "0.4.0", "revision": "591fa3e028032e6dce56620a20e932e35667e8d8", "sounds": {}}
for event, (sound, peak) in RECIPES.items():
    path = OUT / f"{event}.wav"
    result = sfx_render(sound, out=str(path), peak_db=peak, sr=44100)
    meta = result["meta"]
    print(result["summary"], flush=True)
    if not meta["checks"]["ok"]:
        raise SystemExit(f"Earshot audit failed for {event}")
    report["sounds"][event] = {"bank_id": sound, "peak_db": peak, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "audit": meta}
(OUT / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
