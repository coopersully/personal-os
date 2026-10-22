# Public documentation

Status: required public access; shared shadcn public layout.

## User job and hierarchy

A visitor or messaging reviewer must understand what nohmi does, who operates it, how information
is handled, and what optional texting consent means before creating an account or giving consent.
Every page uses one shared product header and tonal footer. The landing page uses workspace
cards; documents use a navigation card and one reading card with a heading, summary, and prose sections.

## Access and rendering

The browser root `/` is the public product landing page, including for signed-in visitors. It
introduces the workspaces, user control, mission, and public documents without loading a session.
`/login`, `/signup`, and `/forgot-password` are separate, directly addressable authentication
pages. Protected deep links preserve a safe local return destination through authentication;
ordinary login opens `/today`. Existing emailed verification and reset URLs remain supported.
The installed PWA starts at `/today`; the native desktop root retains its application entry point.
Landing and authentication use the shared React design system; the static documents below do not
require that application bundle. Both landing and authentication footers expose the public pages.

`features/public-site/layout.tsx` owns the shared header, shadcn NavigationMenu, Button links,
and subtle-tone footer. All public sections align to the same `max-w-6xl`
container with `px-6 sm:px-8` gutters, 24px grid gaps, and `py-12 sm:py-16` section spacing.
Workspace cards use the existing Card composition and workspace identities. Document pages reuse
that shell with a responsive navigation/reading layout and a consistent prose rhythm.

`apps/web/content/public/*.html` owns reviewed document content. `public:generate` renders that
content through `PublicDocument` and the shared shadcn components into complete
`apps/web/public/{about,docs,privacy,terms,data-use,sms,support}/index.html` documents. Both web dev
and build regenerate them. Do not edit generated document shells. Policies remain readable without
JavaScript, session state, API availability, or application setup. Vite serves the shared stylesheet
in development and publishes its compiled asset link in production. Static pages derive their
system dark theme directly from the application's dark tokens without client scripting. Fonts are
bundled first-party assets; there are no third-party scripts. Skip links and keyboard focus remain
required. Document-only reading and print rules live in `features/public-site/documents.css`.

Sign-in links and enrollment links use document navigation. Enrollment policy links open separately
so reading a policy does not discard the number or checkbox state; the new-tab behavior is disclosed.
The app's PWA navigation fallback must not replace these documents with its authenticated shell.

The `/sms/` page explains the actual authenticated opt-in flow; it is not an enrollment form and
must never claim that viewing it constitutes consent. The checkbox remains unchecked for every new
number enrollment. Public consent copy and the authenticated form must match. See
[public documentation and submission evidence](../../engineering/public-documentation.md).

## Verification

Desktop and mobile browser tests cover every document with JavaScript disabled, directory URLs,
keyboard skip navigation, public contact/policy links, and sign-in navigation. Check narrow-screen
layout and preserve legible light/dark contrast. Static assets must also be present in the production
build. A production deployment and Twilio approval require separate evidence.

## Exterior brand and composition

The brand category and line are **“a personal harness.”** Explain it through the person's
context, tools, and controls. The hero introduces that category alongside a square light-blue
instrument panel; four equally weighted workspace cards describe familiar work. A control section
explains access, review, and revocation. Signup remains an invitation-based alpha.

Use lowercase authored copy, including accessible names. Preserve user content, external names,
quoted consent, and policy commitments. The about page explains the category; the guide supports
getting started. Legal documents remain complete, readable, and linked from every public surface.

External light blue is scoped to `.public-site` and `.auth-shell` brand tokens. Hero, footer,
and the desktop authentication panel use the blue/ink pair, including in dark mode. No brand token
changes signed-in product chrome. Other surfaces use the shared neutral theme tokens.

Use 16px gaps between equal workspace cards, 32px square icon slots with 14–16px glyphs, one layer
of card padding, and 16px outer radii. Desktop hero and control sections use two columns;
narrow screens stack them and workspace cards reduce from four to two to one column. The square
brand panel scales with its column, growing beyond square when narrow text requires it. Preserve
text at zoom rather than clipping to a fixed height. Invitation code slots share available form
width at 320px; coarse-pointer primary actions and public navigation retain at least 44px targets without enlarging glyphs.

The desktop public header uses the existing scroll-driven docking treatment, with reduced-motion
and older-browser fallbacks. Narrow screens keep a stable flat header. The light-blue footer groups
links under product, account, and legal, with the current-year operator copyright and a quiet
background wordmark. Authentication keeps its functional form and policy links; the decorative
pattern is replaced by a static, readable brand panel on wide screens.

Public copy is direct and restrained. Name the capability, action, or consequence; remove slogans,
repeated assurances, and unsupported comparisons. Keep the master-plan vision distinguishable
from available behavior, and retain consent, permission, and recovery details where they matter.
