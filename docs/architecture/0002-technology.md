# ADR 0002: Technology choices

- Status: Accepted
- Date: 2026-07-13

## Decision

- pnpm workspaces for package management.
- TypeScript in strict mode for product logic.
- Hono and Zod for the HTTP API and validation.
- Drizzle ORM with PostgreSQL for persistence.
- React, Vite, React Router, and TanStack Query for the PWA.
- Tauri 2 for the macOS and Windows desktop shell.
- The official TypeScript MCP SDK for stdio and Streamable HTTP transports.
- Vitest, Testing Library, and Playwright for automated tests.
- OpenTelemetry-compatible structured instrumentation boundaries, with JSON logs
  enabled by default and optional trace export in production.

## Rationale

These choices keep the core runtime small, make domain packages reusable in all
surfaces, support deterministic in-process API tests, and preserve a path to
native platform capabilities without duplicating the web interface.
