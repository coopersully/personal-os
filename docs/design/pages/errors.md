# Full-page errors

Help the person understand what failed and choose a useful next action.

- Use the shared `ErrorPage` for not found (404), access denied (403), server
  errors (500), service unavailable (503), and connection failures.
- Use the default page canvas, with no app chrome, wordmark header, raised card,
  or empty-state border. This full-page error composition is an explicit exception
  to the dashed-border contract for in-page empty states.
- Center a secondary status label, a short large error title, a short
  description, and one or two shared Button actions. Never expose raw server
  messages or stack traces in the page copy. No logo appears in the content.
- Reuse the auth `BrandPattern` as a full-background layer, below the content,
  at 20% layer opacity for readability, without changing auth tiles. It is noninteractive and hidden from assistive
  technology. Slow independent pulses stop with reduced motion, including mobile.
- Retry is an explicit user action, never an automatic refresh loop. The action
  slot allows a caller to provide more contextual recovery controls.
- Only development connection failures mention starting the local environment.
- Preview at `/dev/errors?state=404`, selecting `403`, `500`, `503`, or `offline`.
  This route and its selector are development-only and require no session/backend.
  Changing a preview never deliberately breaks the app or changes server state.

Current integration: startup API failures and the existing offline screen use
this composition. The remaining presets are available to route/feature owners;
the existing unknown-route redirect is unchanged.
