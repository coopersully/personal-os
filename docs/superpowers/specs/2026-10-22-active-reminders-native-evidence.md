# Active reminders native probe evidence

Date: 2026-10-22. Local macOS 27.0.1 arm64, Swift 6.4. Ad-hoc signed disposable app;
no Developer ID signing identity is installed. This establishes local boundary behavior, not
release-signature equivalence or coverage of every supported macOS version.

## Observed

- Recent keyboard/pointer input timing was readable while ListenEvent access was false.
- A non-activating floating NSPanel appeared while Codex remained the foreground application.
  Receipt persistence completed; querying pending OS requests then showed only the separate control
  request. The ordinary control notification was subsequently delivered by macOS.
- Replacing the same pending request at due-minus-two seconds with a due-plus-five-second request
  succeeded. Exiting the process immediately after replacement acceptance left the fallback alive:
  usernoted recorded its banner at the expected fallback time after process exit.
- Notification authorization initially returned denied. Cooper reported seeing no prompt. The OS
  recorded a permission request and denial; System Settings showed the probe disabled. Only the
  disposable probe's notification toggle was enabled for testing; restore it after the final smoke.
- Cooper manually locked and unlocked the Mac. During lock, recent input, on-console and login-done
  remained true. NSWorkspace session/sleep observers did not report this lock. The foreground app
  changed to `com.apple.loginwindow`, the session dictionary acquired lock-state metadata, and both
  changed back after unlock. Never infer unlocked state from input/on-console alone.
- The panel was also exposed as an accessible system dialog with readable text. A full-screen
  Settings attempt did not establish which application/Space was foreground at presentation;
  therefore this is not counted as a passed full-screen delivery test.

## Implementation ruling

Proceed with implementation using elapsed input plus session/display state and explicit exclusion
of loginwindow/locked-session metadata. Unknown or inconsistent state means away. Use only public
framework calls; do not add input capture or accessibility prompts. Preserve ordinary OS delivery
when activity or presentation is unavailable. The real implementation must repeat background,
lock, crash and privacy tests before release. Full-screen/Spaces, actual display sleep, placement,
permissions on the release-signed app, and minimum-supported-macOS smoke remain acceptance work;
none is claimed passed here.

The throwaway probe ran under `work/active-reminders-native-probe/` and is not product code.
Its source was archived in the ignored execution workspace after the smoke; raw activity/session
observations were deleted. No raw session metadata or user activity history is committed.


## Implemented renderer smoke

The same disposable app was rebuilt against the actual product Swift sources, with synthetic local
items and a simulated completion acknowledgement (no production API or user items). Observed:

- The real compact stack renders accessible source/title/due context, Open, Mark complete and
  Previous/Next. Mark complete displayed a disabled Completing state before the fixture response;
  only acknowledgement retired the card and exposed the next item.
- Native header dragging initially failed. An explicit native drag view, expanded header hit area,
  and first-mouse acceptance fixed the boundary. The running widget subsequently saved normalized
  placement against the persistent display UUID. Unit coverage also verifies movement/release and
  the 24-point geometry rule.
- A second disposable app entered actual macOS full-screen mode and closed itself after eight
  seconds. During that interval it was the foreground application and the product panel reported
  visibility on the active Space. This replaces the earlier unverified Settings attempt.
- Source tests cover stale return after lock, quiet-policy changes during preparation, fallback
  acceptance before cancellation, persisted receipts/storage failure, acknowledgement and owner
  fences. Local fixture acknowledgement is not evidence of an installed release's API transport.

Physical display-sleep behavior, the release-signed application, and minimum-supported-macOS
hardware remain release smoke limits; they are not claimed verified on this development host.

The disposable probe’s notification setting was restored to Off in System Settings and its process
was stopped after the smoke. The installed nohmi application and its notification setting were not
used as the test fixture.
