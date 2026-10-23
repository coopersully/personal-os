# Audio authoring with Earshot

Earshot is an optional **development tool**, not an app dependency. Upstream:
https://github.com/Leonxlnx/earshot (MIT). Version 0.4.0 is pinned to commit
`591fa3e028032e6dce56620a20e932e35667e8d8` in `requirements.in`; the complete resolved
Python dependency set is checked in as `requirements.lock`. Installation and rendering have
been verified on macOS arm64 with Python 3.12. Other platforms have not been validated.

```sh
pnpm audio:setup
pnpm audio:render
# Optional model-free inspection:
.tools/earshot/bin/earshot sfx check apps/web/public/sounds/active-cards/complete.wav
```

Setup requires uv and downloads the pinned Python packages from their normal registries and
upstream GitHub over HTTPS. The environment lives in ignored `.tools/earshot`. It does not
modify global Python or agent/MCP configuration. To update, explicitly change the upstream
revision, regenerate the lock with `uv pip compile tools/audio/requirements.in --python
.tools/earshot/bin/python -o tools/audio/requirements.lock`, review changes and re-render.

Rendering uses the upstream deterministic sound-bank Python API with offline mode and two
CPU threads. It needs no models, keys, uploads, or network access. Earshot's optional semantic
listening models are not downloaded; `doctor` reports them as missing, and model-based
commands will require a separate setup. Do not claim model-based or human listening evidence
from a passing signal audit.

The committed outputs in `apps/web/public/sounds/active-cards/` are 44.1 kHz PCM WAV files,
plus a manifest containing recipe IDs, seeds, gains, SHA-256s and Earshot's measured audit.
The generator fails if an audit is not clean. These selections are procedural bank recipes,
not the fitted-recording bank. The upstream MIT notice travels with the assets.
Regeneration overwrites only these named outputs. Playback uses these local static assets,
so an unavailable development tool does not affect the app. The browser playground currently
consumes them; native integration remains a later step in the active-card iteration.

## Sound language

- Arrival: a rounded short pop; gather: a slightly wider pop from the same family.
- Grab and release/resize: restrained tactile taps. Grab starts only after the drag threshold.
- Nearby slot: a very faint tick, throttled to 180 ms; snap: a firmer thock on release.
- Lock/unlock: related short switch sounds, one cue for a whole Shift action.
- Completion: a warm pluck only after acknowledgement. Error: a descending soft pop.
- Menus: a quiet tap. Hover, elapsed-time ticks and background refresh are silent.

Playback preloads and caches buffers, fades an interrupted voice, and never queues delayed
feedback. Master mute/volume apply to each action. Feedback cannot block completion; an
unavailable sound is skipped. Signal audit establishes clean waveforms, not subjective
satisfaction: use the live playground's sound and volume controls for listening review.

Browser interaction and local audio loading checks: `pnpm test:active-cards`.
The check starts and stops its own loopback preview server.
