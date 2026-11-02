# Ritual cloud interaction audit — 2026-10-21

Tested the localhost development app in the in-app browser on the current Mac.
The display delivered approximately 120 animation callbacks per second. No CPU
throttling was applied. This is a local sample, not a cross-device performance guarantee.

Measured requestAnimationFrame intervals and CPU work in the renderer using temporary
instrumentation, removed afterward. Exercised morning/evening thumbnails and the shared
full-screen ritual renderer in preview mode, dragging in both directions and releasing
with momentum. Did not complete or skip a real ritual. Dragging a thumbnail did not open
the preview; a subsequent ordinary click did.

| Surface | Drag frames sampled | Momentum frames sampled | Drag-window p95 interval |
| --- | ---: | ---: | ---: |
| Morning thumbnail | 9 | 909 | 9.3 ms |
| Evening thumbnail | 19 | 926 | 8.5 ms |
| Morning full screen | 19 | 748 | 9.3 ms |
| Evening full screen | 18 | 757 | 9.3 ms |

Full-screen steady drag/momentum samples had no intervals over 33.4 ms. Cloud CPU
work averaged about 0.10–0.12 ms/frame, with sampled peaks up to 4.5 ms. Thumbnail
work averaged below 0.04 ms/frame. Opening a full preview caused outliers around
333–359 ms, also visible to the thumbnails behind it.

Changed full-size field generation to yield in approximately 4 ms batches, with
cancellation on resize/unmount. Follow-up opening samples peaked at 99.9 ms
(evening) and 108.7 ms (morning); subsequent p95 intervals were 8.8–9.3 ms with
no intervals over 33.4 ms. An opening hitch remains, so do not describe startup
as entirely hitch-free. These are whole-frame intervals, not proof that every
remaining opening cost comes from clouds.

No visible straight tile seam was observed in inspected morning/evening states
after bidirectional drags and momentum. The renderer uses one repeating fill,
display-resolution composition, and a tile width aligned to the Bayer period.
Screenshots cannot prove the absence of every transient artifact. Native desktop
host and lower-powered devices were not benchmarked separately.
