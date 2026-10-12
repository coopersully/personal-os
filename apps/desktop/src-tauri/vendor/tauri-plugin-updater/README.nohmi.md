# nohmi updater patch

This is the crates.io `tauri-plugin-updater` 2.12.0 source, under its original
Apache-2.0/MIT licenses. Upstream package checksum:
`7a5cad8ed5948d988e1018ecd31e27cacedbf72ce3fb972940c3e4bf51639e4b`.

Nohmi adds two private modules:

- `manifest` replaces the unbounded `Response::json()` call in `Updater::check()`.
  It rejects a declared or streamed body exceeding 1 MiB before JSON parsing.
  HTTP tests cover exact-limit bodies, missing Content-Length, oversized declared
  and streamed bodies, and malformed JSON.
- `macos_install` replaces the upstream backup/delete/move sequence with macOS
  `renamex_np(RENAME_SWAP)`. Extraction occurs beside the installed bundle, on the
  same filesystem. Both bundle names exchange atomically; only after success is
  the old bundle removed from the temporary path. Permission, filesystem and
  exchange failures leave the installed app untouched. There is no privileged
  delete fallback; use the DMG if the containing directory is not writable or the
  filesystem does not support atomic exchange. Real filesystem tests prove the
  success and failure paths. This addresses upstream issue
  https://github.com/tauri-apps/plugins-workspace/issues/3505.

Timeouts, version checks, URL checks and signature verification are unchanged.
Native CI runs these tests alongside the upstream signed-version tests.

The app directly pins this local dependency, so an ordinary Cargo update cannot
silently remove the cap. When upgrading, reconcile the upstream source and retain
the cap, atomic replacement and tests until an upstream equivalent is available. Registry bookkeeping,
the standalone lockfile and changelog are omitted; required source, build inputs,
permissions, original README and licenses are retained.
