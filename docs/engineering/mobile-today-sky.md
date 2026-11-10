# Native Today atmospheric sky

Local implementation for COO-32 — Deliver the native Today workspace and connection health.
The selected Atmospheric wash design uses smooth sky gradients and soft weather-dependent haze,
without dithering, celestial illustrations, particles, or a continuous animation loop. The opaque
briefing drawer follows the app theme; the sky follows local solar time, independently of light/dark mode.

## Boundary and lifecycle

- **Owner/capability:** Today reads the authenticated weather endpoint through the API client.
  `packages/domain/src/weather-sky.ts` owns shared desktop/mobile solar and weather interpretation;
  the mobile renderer supplies the quieter palette and native SVG gradients.
- **Authority/configuration:** `expo-location` requests When In Use permission only after tapping
  the hero weather caption. Opening Today never prompts. A granted permission enables a coarse,
  short-lived foreground fix; coordinates are rounded to two decimal places for the weather request.
  No Always, background-location, temporary precise-location purpose string, or background mode is
  configured. Coordinates/snapshots are transient, not persisted in app storage or logged.
- **Fallbacks:** absent permission, services, native module, or fix uses the user's saved location
  through the same API. A failed weather read clears the observation and uses a device-local-time
  sky. No simulated weather is presented as real. The caption distinguishes a weather observation
  from a time-based scene; stale observations older than 30 minutes are not treated as current.
- **Transport/time:** location watch stops at the first fix, error, or five-second deadline, including
  a subscription returned after timeout. Weather reads have a 12-second UI deadline. The authenticated
  API owns provider configuration, reverse geocoding and saved-location selection. An HTTP read may
  settle after the UI deadline, but its result cannot replace the fallback or a newer owner's state.
- **Lifecycle:** reads run only on Today, refresh on foreground entry and every ten active minutes;
  the scene clock updates each active minute. No work is scheduled while in the background. Owner,
  route and background generation fences discard late reads. Permission-dialog inactivity does not
  invalidate the user's in-flight request. Location watches remain bounded even if permission is lost.
- **Recovery/feedback:** the hero caption is the explicit retry/location action. User-triggered reads
  use one Sonner loading/outcome ID. Automatic decorative fallback is silent and never blocks the
  Tasks/Finance briefing. A denied OS permission can be changed in system Settings.
- **Observation/limits:** native builds must include ExpoLocation and the purpose string. Fresh API
  success, native authorization, and actual simulator coordinates are separate acceptance checks.
  Simulated coordinates verify the native path, not GPS accuracy or physical-iPhone acceptance.
  Weather-provider outages, OS location restrictions and unavailable saved locations can still force
  the honest time-only fallback in production.

## Visual behavior

Dawn uses lavender/peach, daytime pale blue, sunset violet/coral, twilight blue/lavender and night
navy. Sunrise/sunset come from fresh weather when available; approximate local-time boundaries
are only a fallback. Cloud cover changes haze opacity; rain, fog, snow and storms mute the palette.
No lightning flashes or scrolling particles compete with content. This static low-motion rendering
also respects Reduce Motion without an additional animation mode. Header/status-bar contrast follows
the sky, while menus and briefing cards keep the standard app theme.

## Local verification — 2026-11-09

- 130 focused desktop resolver/mobile presentation/provider/navigation/Finance-and-Today tests
  passed; a subsequent location-abort regression brought the location/provider suite to nine
  passing cases. Mobile, domain and web type checks passed; changed-file Biome and diff checks passed.
- An ad-hoc signed Debug simulator build succeeded with ExpoLocation and only the When In Use
  purpose string. Simulator signing is necessary for the existing SecureStore session to restore.
- On iPhone 18 Pro / iOS 27, verified the real foreground permission prompt, retained demo session,
  and native simulated San Francisco coordinates against the running API: 66°F, partly cloudy,
  fresh sunset scene. Also inspected the saved-location New York nighttime scene. The native
  status bar and search chrome switch contrast with the sky; the drawer retains the app theme.
- Screenshot: `.context/finance-refinements/today-sky-sunset.png`. The simulator is left on Today
  with its explicitly simulated San Francisco location for visual iteration. This is not a claim
  of physical-device GPS, TestFlight, production deployment, or personal-account verification.

## Preview and scroll refinement — 2026-11-09

Development builds accept `personal-os:///?skyPreview=morning` (also `daytime`, `night`, `cloudy`,
`rainy`). These deterministic observations run through the real shared sky resolver and are visibly
labeled Preview. Unknown values and all production builds ignore the override. Remove the query to
return to real weather. The preview does not change location, device time, or account records.

Captured all five states in the native simulator under `.context/finance-refinements/sky-*.png`.
Rain has a cooler slate tint distinct from overcast. The sky is confined to the hero; the scroll
surface and bottom safe area use page canvas, and Today has no elastic overscroll. Verified native
Tasks, Finance, Mail and Calendar header spacing; Finance's final rows clear its native tab bar.
Search remains fixed with no full-width backing. Contrast reporting is isolated from the navigator
and the glass material uses stable system appearance, preserving scroll position.
