# Loading and motion

This is the shared presentation contract. It does not change page content, request
ownership, authorization, or the meaning of missing evidence.

## Region ownership

Keep the workspace header and navigation mounted. Each independently fetched region
owns its initial skeleton, successful content/empty state, and read recovery. Start
independent reads together; reveal each useful region when its real data arrives.
Do not add waits, minimum skeleton durations, random progress, or serial animation
staging. Data delivered by one atomic read may reveal together; animation alone is
not a reason to split an API or fetch the same material twice.

Use `ContentSkeleton` for lists, compact settings rows, and summaries. Compose the
existing shadcn `Skeleton` for genuinely spatial content such as Calendar and Mail;
`WorkspaceSkeleton` owns those route geometries. Match the final content width,
row height, inset, and responsive columns. Use a bounded number of placeholders,
not one for every possible record. The owning region has one labelled `status`
and `aria-busy`; decorative skeleton descendants are hidden from accessibility.

Keep valid same-owner cached material visible during refresh. Mark refreshing
regions busy without replacing their controls or moving focus. Access denial or
owner changes must clear private material immediately, without an exit animation.
Successful absence uses `DataViewEmpty` and its centered icon, with no nested card
or dashed boundary. Initial failure uses the shared recovery component; transient
refresh and action failures use the existing Sonner contract. Never turn pending,
failed, or partial reads into an empty result.

## Shared motion

Use the existing theme tokens: 140 ms for material reveal and feedback, 220 ms for
spatial navigation, and `--motion-ease-spatial` for settling. Route movement is a
four-pixel translation with opacity; content regions fade without a second positional
animation. Shared Card, ItemGroup and Empty surfaces inherit a single outer-region
reveal. Nested surfaces do not accumulate reveals. Controls stay interactive as soon
as they mount, and a refresh of existing content does not replay entrance motion.

Skeletons use the existing shared pulse. Reduced motion disables the pulse and
material entrance, and preserves immediate usable layout. Animate opacity and
transform rather than page height, padding, or margins. Do not measure every card,
keep permanent `will-change` layers, add timers, or introduce a second animation
library. Existing Motion surfaces retain their interaction-specific layout behavior
and the global `MotionConfig reducedMotion="user"` policy.

A skeleton becomes content in the same owning region; this means stable approximate
geometry and a brief reveal, not stretching text or delaying content to simulate a
literal shape morph. Cached content and available siblings stay usable.

## Evidence and verification

Check cold load, cached refresh, empty, failed read/retry, and access loss. Inspect
mobile/desktop geometry, keyboard focus, reduced motion, and lower content clearance.
Native-only and permission-gated surfaces need their actual host for acceptance;
browser screenshots cannot establish those results. Initial migration reuses the
existing workspace skeletons and shared data-view consumers. Independent data owners
retain their query boundaries; this is not a claim that every request is streamed.

The implementation is based on primary guidance reviewed October 25, 2026:

- [React Suspense](https://react.dev/reference/react/Suspense): reveal meaningful
  boundaries independently and retain already visible content during transitions.
  Ordinary query hooks do not become Suspense-enabled simply by adding a boundary.
- [shadcn Skeleton](https://ui.shadcn.com/docs/components/radix/skeleton): compose
  placeholders from the installed primitive to match the material being loaded.
- [web.dev animation guide](https://web.dev/articles/animations-guide): prefer
  compositor-friendly transform/opacity and measure before adding rendering hints.
- [W3C animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions):
  nonessential motion must be suppressible. Information cannot rely on motion alone.
