# Expo web migration

nohmi's web UI and its iPhone app are moving into one Expo project (`apps/mobile`), so both
platforms build from one routing tree and one set of shared modules. This document is the plan and
the record of what has landed. Code, tests and the implementation log remain the authority for
what ships; this page does not change any deployment.

Tracking issue: COO-277 in the Nohmi Linear project.

## Current state (phase 1)

The Expo project's web target renders the complete existing web UI from `apps/web/src`:

- `apps/mobile/src/app/_layout.web.tsx` renders `ExpoWebHost` from `@personal-os/web/expo-host`.
  Native keeps `_layout.tsx` and every native screen unchanged. `+not-found.web.tsx` leaves
  unknown paths to the web UI's own router; `+not-found.tsx` keeps Expo Router's default on iOS.
- `apps/web/src/web-root.tsx` owns the host-independent provider tree (motion, query client,
  router, desktop overlays). The Vite entry (`main.tsx`) and the Expo host both render it, so the
  two bundles cannot drift. Only `main.tsx` registers the PWA service worker.
- `apps/web/types/expo-host.d.ts` is the typed boundary: the Expo project type-checks against the
  declaration instead of compiling web sources with mobile compiler options.
- `apps/mobile/web-host/` teaches Metro what Vite already does: the `@/` alias and NodeNext `.js`
  specifiers (`resolve.cjs`), one React copy per bundle, `import.meta.env` mapped to Expo values
  (`import-meta-env.cjs`), Tailwind through PostCSS (`postcss.config.mjs`), Geist font URLs
  (`font-urls.mjs`) and the same-origin `/v1`, `/health` and `/mcp` proxy in development
  (`dev-proxy.cjs`). Native platforms resolve the web host to an empty module, so the DOM UI
  never enters the iOS bundle.
- `apps/mobile/scripts/sync-web-public.mjs` copies `apps/web/public` assets and the Geist font
  files into the ignored `apps/mobile/public/`; `public/index.html` mirrors the web document
  without Expo's react-native-web scroll reset.

Environment mapping: `import.meta.env.DEV`/`PROD`/`MODE` follow `NODE_ENV`; `VITE_<KEY>` becomes
`EXPO_PUBLIC_<KEY>` (for example `EXPO_PUBLIC_API_BASE_URL`). An unmapped key fails the build.

Vite remains the production builder for the PWA, the Tauri desktop shell, Docker images and
Playwright acceptance. Nothing in deployment reads the Expo web export yet.

### Running it

```sh
pnpm --filter @personal-os/mobile web          # Expo dev server; proxies /v1 to 127.0.0.1:8788
pnpm --filter @personal-os/mobile export:web   # static export in apps/mobile/dist
```

`PERSONAL_OS_WEB_API_PROXY_TARGET` (or the existing `VITE_PROXY_API_TARGET`) points the dev proxy
at another API; `PERSONAL_OS_WEB_MCP_PROXY_TARGET` does the same for MCP. A static host for the
export must serve `index.html` for unknown paths, as nginx already does for the Vite build.

## Remaining phases

Each phase is its own PR and keeps Vite working until the cutover phase.

1. **Routes onto Expo Router.** Replace the React Router tree in `app.tsx` one workspace at a time
   (Today, Calendar, Tasks/Reminders, Mail, Finances, Messages, Settings, public pages) with Expo
   Router web routes that render the existing feature pages, and move `Link`/`useNavigate`/
   `useLocation`/`useSearchParams` callers onto an adapter over Expo Router. Exit: no
   `react-router-dom` import remains and deep links, redirects and search parameters behave the
   same in the Playwright suite.
2. **Shared modules.** Move host-neutral view models, query hooks and formatting from
   `apps/web/src/features` and `apps/mobile/src/features` into shared ownership where both
   platforms encode the same rule, per `code-placement.md`. Presentation stays per platform
   (DOM/Tailwind on web, native components on iOS) unless a component is genuinely shared.
3. **Web platform features on Expo.** Service worker and manifest (replacing `vite-plugin-pwa`),
   the generated public documentation pages and agent-skill files that `vite.config.ts` emits,
   and the Tauri desktop shell's dev server and `frontendDist`.
4. **Acceptance on the Expo export.** Run the Playwright suite (`e2e/serve.ts`) against the Expo
   web build, including production style checks, and compare bundle size and load time with Vite.
5. **Cutover.** Point the Docker web image, deploy workflow, desktop release workflows and CI at the
   Expo export, then remove Vite and its plugins. This phase changes production and needs explicit
   approval.

## Known differences in phase 1

- The Expo web bundle also contains the native screens' lazy route chunks; they are never rendered
  on web. Phase 1 makes route ownership explicit before trimming them.
- The web UI runs on the Expo project's React version (19.3) in this target and on the web app's
  (19.2) under Vite until the cutover aligns them.
- No service worker or offline shell on the Expo target yet (phase 3).
