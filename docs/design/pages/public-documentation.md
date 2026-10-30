# Public documentation

Status: required public access; shared shadcn public layout.

## User job and hierarchy

A visitor or messaging reviewer must understand what nohmi does, who operates it, how information
is handled, and what optional texting consent means before creating an account or giving consent.
Every page uses one shared product header and tonal footer. The landing page uses workspace
cards. Editorial articles and workspace guides use a campaign hero and open reading layout; guides add a responsive sidebar and inline visual walkthroughs. Legal documents retain the plain navigation and reading cards.

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
seven legacy `apps/web/public/{about,docs,privacy,terms,data-use,sms,support}/index.html` documents
and six nested `apps/web/public/docs/{today,mail,tasks,calendar,finances,agents}/index.html` guides. Both web dev
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
context, tools, and controls. The landing hero says “your digital exoskeleton.” Its bounded
760–900px desktop composition places live text above a smaller central chest-angle figure,
crops the torso at its lower boundary, and fades into the white content below. Mobile uses a
790px minimum composition with readable text clearance. Decorative images have empty alternative
text. Four equally weighted workspace cards describe familiar work; the control section explains
access, review, and revocation. Signup remains an invitation-based alpha.

Use lowercase authored copy, including accessible names. Preserve user content, external names,
quoted consent, and policy commitments. The about page explains the category; the guide supports
getting started. Legal documents remain complete, readable, and linked from every public surface.

The photographic landing composition stays light in either system theme so its opaque white
foreground joins the page without a seam. Documentation and authenticated screens retain their
existing theme behavior.

External light blue is available only to company branding; signed-in product chrome has no favored hue. Authentication presentation remains with the Account presentation owner and retains current-main forms and decoration.
The public footer has no border and inverts the page’s body tokens: foreground for its surface and background for its text. This follows the page theme, including the light landing page inside a dark system theme. The landing hero scenery extends behind the floating nav pill. No brand token
changes signed-in product chrome. Other surfaces use the shared neutral theme tokens.

Use 16px gaps between equal workspace cards, 32px square icon slots with 14–16px glyphs, one layer
of card padding, and 16px outer radii. Control sections use two columns;
narrow screens stack them and workspace cards reduce from four to two to one column. Preserve
text at zoom rather than clipping to a fixed height. Invitation code slots share available form
width at 320px; coarse-pointer primary actions and public navigation retain at least 44px targets without enlarging glyphs.

Landing and editorial document headers use a stable translucent pill at every breakpoint.
Legal pages retain the scroll-driven docking treatment with reduced-motion and older-browser fallbacks. The inverse-tone footer groups
links under product, account, and legal, with the current-year operator copyright and a quiet
background wordmark. Authentication keeps its current functional form, policy links and decoration; this integration does not restyle it.

Public copy is direct and restrained. Name the capability, action, or consequence; remove slogans,
repeated assurances, and unsupported comparisons. Keep the master-plan vision distinguishable
from available behavior, and retain consent, permission, and recovery details where they matter.

The hero uses nine locally hosted nature scenes supplied by the user behind the nav, copy, and
figure. Provenance is recorded in `apps/web/public/brand/SOURCES.md`. Remove embedded collage
separators before export; retain proportions and use responsive 960/1920-pixel WebP files.
Scenery is static without JavaScript; animation starts only once its pause control is available. Scenes repeat at a smaller scale with alternating horizontal and vertical reflection so adjacent edges match with an eight-pixel blur and a light irregular noise layer, revealing more of each image rather than cropping it to cover the banner. Nine scenes crossfade on a 4.5-second cycle (one scene every half second);
a compact pause/play button in the lower corner freezes the sequence, and reduced motion shows the first still. A stable
dark scrim protects white text contrast, while the lower edge fades into the white page.

## Product previews

Below the workspace introduction, four editorial sections show actual local demo screens:
Tasks on a phone, Mail on a laptop, Calendar on a monitor, and Finances on a landscape tablet.
The opt-in premiere fixture tells one fictional story: Alex finishes a short film, confirms the
screening, prepares the final week, and settles production expenses. Use fictional demo records,
never personal or production data. Screenshots show real recorded state, not invented agent actions.
Provide a full-size screenshot link for closer inspection. Keep fixture provenance in this specification rather than repeating demo captions below the devices.

`product-previews.tsx` owns the composition. Device bodies, screenshots and figures remain three
independent layers. Each device has a different pose: an open palm supporting the phone, a
figure leaning in to type on the laptop, an inverted figure peeking around the monitor, and a
reclining figure behind the tablet. Keep authored text and screen content clear. Fingers may
sit above the keyboard; other figures sit behind devices. Cropped limbs must fade, pass behind a device, or exit at a viewport
edge rather than ending inside the composition. The laptop and tablet use distinct soft neutral
backgrounds. Center every device within its full-width section and stack copy above it at every breakpoint. Keep device size capped and anchor the surrounding figures to the device geometry.

Device width and horizontal position are controlled by `--device-width` and `--device-left`;
figure scale and position derive from the same device dimensions. Preserve each PNG's existing
alpha instead of adding hand-traced masks. Screenshot dimensions match the visible aperture;
never stretch the UI. Keep descriptive alternative text, lazy loading, and optional subtle
animated dither confined to figure silhouettes. The dither uses a 4×4 Bayer threshold matrix and four quantized luminance levels within the original image alpha. Three matrix phases animate the ordered pattern for eight 600ms cycles, then settle on a still dithered silhouette without random TV-static noise. Do not add a periodic dot overlay. Devices and screenshots stay still. Reduced-motion mode disables both effects.

Keep the main hero bounded to 760–900px on desktop and 790px on mobile. The smaller central portrait fades into the page; it does not need full-width shoulders.

Published image URLs remain available when formats change so cached public pages keep working.

The closing campaign scene pairs the original arms-outstretched white figure with an illustrative agent-texting wrap-up of the premiere story. Keep devices out of this closing scene. Arrange the messages around the centered figure as one composition; crop the figure at the section boundary to show its upper half. Preserve message reading order and legibility on mobile. Calendar and Finances figures sit in front of their devices; Mail places the hand on the trackpad, while Tasks leaves a clear gap above the supporting hand. It connects the completed filmmaking goal, reconciled budget, follow-up email, and protected calendar time. Drafts remain subject to review. These are campaign story beats, not evidence of production actions. Workspace labels compose the existing shadcn Badge with the same scoped glass tokens as the public navigation.

The application cursor is adapted from Cooper’s portfolio worktree (`7399f03`, `src/lib/dot-cursor.ts`). Preserve native text/resize/action semantics, keyboard and touch fallbacks, forced-color/high-contrast opt-out, and reduced-motion behavior; remove all listeners and restore the native cursor on unmount.


### Document layout families

About, Guide, and Support use the company editorial layout: a quiet campaign hero,
large typography, the original figure, open prose, and compact product navigation.
Privacy, Terms, Data Use, and Texting Terms retain the plain policy reading layout.
New document types must explicitly opt into the editorial family; unknown types default to policy.
Agent-texting campaign messages always align left; only the person's replies align right,
including the compact composition on mobile.

Decorative article heroes use an upright upper-body mannequin holding the actual rounded-square app icon. Crop all artwork at the hero boundary. Mask the blank tablet face, overlay the exact square icon, and retain foreground fingers. Dither the figure while keeping the icon sharp; do not reserve space beneath the hero for artwork.

### Workspace guide coverage

The public guide describes Today and each workspace with purpose, direct workflows, authorized
agent operations, rationale, an example, and capability limits. Its October 23 content was checked
against `docs/product/workspaces.md` (target), `docs/engineering/workspace-agent-capabilities.md`
and `workspace-agent-execution.md` (source capabilities), and `docs/product/implementation-log.md`
(especially October 19 Finance approval boundaries, which supersede older agent-approval wording).
Keep availability conditional on deployed account/provider capabilities; do not promote local test
coverage into production certification. Retain explicit human approval for active Finance budgets,
Mail uncertain-send recovery, Tasks import ownership, and provider-specific Calendar limitations.

The guide is a static, independently addressable page family: `/docs/`, `/docs/today/`,
`/docs/mail/`, `/docs/tasks/`, `/docs/calendar/`, `/docs/finances/`, and `/docs/agents/`.
Use a shared sticky guide sidebar on desktop and compact wrapping navigation on mobile.
Workspace pages show actual product fixture screenshots with useful captions and full-size links.
Place screenshots with manual instructions and separate shadcn Card/ItemGroup examples beside manual and agent instructions; use muted Items and label each as an example,
keep it noninteractive, and preserve the distinction from product screenshots. Keep workspace icons
in the shared identity component. The generator and production/dev route lists share guide metadata.

Guide prose uses explicit build-time placement markers for screenshots and examples. Preserve the reading sequence: purpose, manual instructions and screenshot, manual example, agent instructions and example, then rationale. Do not collect all visuals above the guide.

### October 29 integration scope

The campaign and guide source integrates with current session routing, account controls and authentication forms. Earlier auth-form restyling is superseded by the current Account presentation owner. The optional premiere fixture overlay is retained only in historical commit `b397f08f`; it is excluded from this integration because current Finance fixtures expanded beyond its original assumptions. Campaign screenshots remain checked-in captures of the earlier disposable UI, not proof of current live provider behavior.
