# Desktop sounds

Use lowercase kebab-case filenames: `<feature>-<variant>-<event>.<extension>`.

- `feature`: the owning experience, such as `ritual`.
- `variant`: the domain's stable name, such as `morning` or `night`.
- `event`: the playback trigger, such as `intro`.
- `extension`: the actual audio format in lowercase; these source recordings are WAV.

Current assets:

| File | Trigger | Source recording |
| --- | --- | --- |
| `ritual-morning-intro.wav` | Morning ritual opens | `nohmi morning ritual intro 002.wav` |
| `ritual-night-intro.wav` | Night ritual opens | `nohmi evening ritual intro 002.wav` |

The recordings are copied unchanged from Cooper's supplied audio. Use `night` to match
ritual settings and API terminology. Keep project names, spaces, take numbers, and
version suffixes out of shipped filenames; Git records revisions. Original session
files remain unchanged outside the repository.

Tauri bundles `sounds/*.wav`. The macOS companion plays the matching intro once when
a new checklist presentation animates in, including manual reopening and return after
snooze. Routine state refreshes and focus changes do not replay it. Dismissing the
ritual stops playback, and a new intro replaces any previous intro without overlap.
Playback uses the system's output volume and does not override mute.

## Notification soft click

`notification-soft-click.wav` is Sound CN’s `click-soft` by Kenney (CC0), decoded to
linear PCM WAV for macOS notifications. Source: [9ae2efbcf989](https://raw.githubusercontent.com/kapishdima/soundcn/9ae2efbcf9892c41606cf9833d3abdfa16cf149b/registry/soundcn/sounds/click-soft/click-soft.ts).
All notification types, including tests, use it when sounds are enabled. The native
companion copies the bundled asset into the user’s `Library/Sounds` directory, where
UserNotifications resolves named sounds. macOS sound settings and Focus still apply.
