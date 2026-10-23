# Public documentation

Status: required public access; shared shadcn public layout.

## User job and hierarchy

A visitor or messaging reviewer must understand what nohmi does, who operates it, how information
is handled, and what optional texting consent means before creating an account or giving consent.
Every page uses one shared product header and tonal footer. The landing page uses workspace
cards; documents use a navigation card and one reading card with a heading, summary, and prose sections.

## Access and rendering

The browser root `/` checks the session: visitors see the product landing page, while signed-in
users redirect to `/today`. The landing page introduces the workspaces, user control, mission,
and public documents. Public document pages remain readable with or without authentication.
`/login`, `/signup`, and `/forgot-password` are separate, directly addressable authentication
pages; existing authenticated sessions redirect from these routes to `/today`. Protected deep links preserve a safe local return destination through authentication;
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

The public header is transparent at the top and uses a scroll-driven CSS animation over the first
96px to narrow into a translucent sticky pill. The header contains Guide and Login; sign-up stays
in the landing hero. Reduced-motion and older-browser fallbacks retain a stable sticky pill.
The footer stays in the current theme using the subtle surface, includes only the current-year
Cooper Sullivan copyright, and places a decorative, low-opacity nohmi wordmark behind the content.
Operator identity and contact information remain in the relevant document bodies.

Footer links are grouped under Product, Account, and Legal subheaders. Account includes Login and
Create an Account. The copyright sits flush against the bottom-left edge outside the padded menu
container, without a divider. The decorative wordmark offsets the font’s sidebearing and baseline
space so its visible lettering reaches the footer’s left and bottom edges, with no visual inset. It uses 2.5% opacity
so it remains behind the readable content.

The landing workspace section describes the master-plan vision in two-column cards, including
unified Mail, capacity-aware Tasks, coordinated Calendar availability, and contextual Finances.
Source-linked handoffs and recurring agent routines explain how they work together. The section
is framed as the product vision; it is not evidence that each target capability has shipped.

Public copy is direct and restrained. Name the capability, action, or consequence; remove slogans,
repeated assurances, and unsupported comparisons. Keep the master-plan vision distinguishable
from available behavior, and retain consent, permission, and recovery details where they matter.
