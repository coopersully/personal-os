# Reicon Icon System Design

## Summary

ilo will draw every interface glyph from one icon pack, `reicon-react`, reached through one
reviewed registry module. Today the web application imports 90 identifiers from `lucide-react`
and 18 from `@phosphor-icons/react` across 30 files, and the application mark inlines Lucide's
volleyball path data into a checked-in SVG asset. Two packs, two visual grammars, and duplicate
glyphs for the same meaning contradict the design book's requirement to prefer one coherent
grammar.

The registry collapses 108 vendor identifiers into 87 semantic exports, one glyph per meaning. A
lint contract makes every other icon package unimportable, and a TypeScript narrowing makes the
raw-color prop a compile error rather than a review comment. The application mark changes from the
Lucide volleyball to reicon's `SideProfile` glyph inside the existing rounded-square frame, and is
regenerated across web, PWA, and desktop surfaces from a single checked-in script.

This is a presentation-layer change. No API, database, connector, or domain contract moves.

## Goals

- Make `reicon-react` the only icon source in the repository, enforced by `pnpm lint`.
- Replace two packs and their duplicate glyphs with one reviewed vocabulary of 87 semantic names.
- Express navigation and selection state through icon weight, which the design book already
  requires and Lucide cannot provide.
- Keep icon color bound to semantic tokens and icon size bound to CSS, by type where possible.
- Replace the application mark with `SideProfile` on every web, PWA, desktop, and MCP surface.
- Record the icon contract in the design book so future work and agents inherit it.

## Non-goals

- Redesigning the mark's frame, wordmark, clear space, or minimum size. Only the glyph changes.
- Introducing an icon component wrapper, sprite sheet, or runtime icon lookup by string key.
- Changing `packages/ui`, which contains no icons.
- Changing which glyph any given control shows, beyond the substitutions this document names.
- Adopting reicon's Vue, Svelte, JavaScript, Figma, or MCP packages.

## Package assessment

`reicon-react@1.2.0` is MIT licensed, has zero runtime dependencies, peers on `react >=16.8`,
ships its own type declarations, is marked `"sideEffects": false`, and exposes per-icon subpaths at
`reicon-react/icons/<Name>`. It contains 2,674 icons and every one of them carries both an Outline
and a Filled weight.

Several published claims do not survive reading `createIcon.js`, and the contract below is written
against the source rather than the README.

| Documented behavior | Actual behavior in 1.2.0 |
| --- | --- |
| Icons resemble Lucide | Icons are fill-based. Paths carry `fill="currentColor"` and the root `<svg>` carries `fill="none"`. "Outline" is usually a traced outline, not a stroke. |
| `strokeWidth` overrides stroke width | Implemented as a string replacement of `stroke-width="…"` in the raw path markup. Only 1,111 of 2,674 icons contain that attribute; on the other 1,563 the prop silently does nothing. |
| `secondaryColor` sets an accent color | Destructured from props and then never used. The prop has no effect. |
| — | Icons render through `dangerouslySetInnerHTML`, so they accept no children. A `<title>` element cannot be nested inside an icon. |
| — | `className` is always emitted with a leading `reicon ` class. |
| — | `size` is emitted as `width`/`height` attributes, so any CSS rule overrides it. |

The last two points are what make the migration mechanically safe. The shadcn primitives in
`apps/web/src/components/ui` size icons with
`[&_svg:not([class*='size-'])]:size-4`, and `.logo-mark svg` sets `height: 100%; width: 100%`.
CSS declarations beat presentation attributes, so reicon's default `width="24"` yields to both. The
always-present `reicon` class does not contain the substring `size-`, so the `:not()` guard that
lets call sites opt out of the default size continues to behave exactly as it does with Lucide.

Because `strokeWidth` and `secondaryColor` are unreliable, and because `color` accepts a raw color
value that the frontend theme contract already forbids, the registry removes all three from the
public prop surface.

## Dependency risk

Making one young package the sole permitted icon source concentrates risk. `reicon-react` reached
1.0.0 within the last year, is at 1.2.0, is maintained by one author, and unpacks to 34 MB. The
registry module is the mitigation and is a deliberate part of this design: a future migration away
from reicon edits 87 lines in one file instead of 108 identifiers spread across 30 files. This
trade is accepted knowingly, not overlooked.

## Architecture and ownership

- `apps/web/src/components/icons.ts` owns the entire icon vocabulary and the narrowed `Icon` type.
  It is the only module in the repository permitted to import from `reicon-react`.
- Every feature and UI primitive imports glyphs from `@/components/icons` and never from a vendor
  package.
- `scripts/check-icon-contract.mjs` owns enforcement and runs inside `pnpm lint`.
- `apps/web/public/icon.svg` is the authored master mark. All raster mark assets derive from it.
- `scripts/generate-app-mark.mjs` owns raster generation for web, PWA, and desktop.
- `docs/design/system.md` owns the normative icon contract; `docs/design/foundations.md` owns the
  mark and the visual role of icon weight; `docs/design/governance.md` owns the process for adding
  a glyph.

## The registry module

`apps/web/src/components/icons.ts` re-exports icons from per-icon subpaths. It contains no
component wrappers and no runtime logic, so it adds no bundle cost and stays fully tree-shakeable.

```ts
import type { ForwardRefExoticComponent, RefAttributes } from "react";
import type { IconProps } from "reicon-react";

/**
 * Icon color comes from semantic `text-*` tokens, never a prop. `strokeWidth` applies to only
 * 1,111 of reicon's 2,674 icons and `secondaryColor` has no effect in 1.2.0; both are removed
 * rather than left as props that silently do nothing.
 */
export type Icon = ForwardRefExoticComponent<
  Omit<IconProps, "color" | "secondaryColor" | "strokeWidth"> & RefAttributes<SVGSVGElement>
>;

export { default as ChevronDownIcon } from "reicon-react/icons/ChevronDown";
export { default as MailIcon } from "reicon-react/icons/Envelope";
// …
```

Subpath imports rather than the barrel are deliberate: the barrel re-exports 2,674 modules, and
importing it forces every bundler and every cold Vite dev start to walk the whole graph.

The `Icon` type is a type-level narrowing with no runtime component. It makes `color="#d97757"` a
`tsc` failure at the call site. The frontend theme contract already forbids raw color, so this
moves an existing rule from lint-time regex to compile-time type checking, for free.

The 13 sites currently annotated `LucideIcon` become `Icon`.

## Icon vocabulary

87 exports replace 108 vendor identifiers. Every reicon source name below was verified to exist in
`reicon-react@1.2.0`, and every current identifier is covered.

### Consolidations

These merges are the substance of the change. Each pair or triple currently renders a different
glyph for the same meaning, split across packs or across Lucide's own aliases.

| Registry export | reicon source | Replaces |
| --- | --- | --- |
| `AgentIcon` | `Cpu` | `lucide:Bot`, `phosphor:Robot` |
| `AlertTriangleIcon` | `AlertTriangle` | `lucide:AlertTriangle`, `lucide:TriangleAlertIcon` |
| `BankIcon` | `Bank` | `lucide:Landmark`, `phosphor:Bank` |
| `CalendarIcon` | `Calendar` | `lucide:CalendarDays`, `phosphor:Calendar` |
| `CheckIcon` | `Check` | `lucide:Check`, `lucide:CheckIcon` |
| `ChevronDownIcon` | `ChevronDown` | `lucide:ChevronDown`, `lucide:ChevronDownIcon` |
| `ChevronRightIcon` | `ChevronRight` | `lucide:ChevronRight`, `lucide:ChevronRightIcon` |
| `CircleCheckIcon` | `CheckCircle` | `lucide:CheckCircle2`, `lucide:CircleCheck`, `lucide:CircleCheckIcon` |
| `CloudIcon` | `Cloud` | `lucide:Cloud`, `phosphor:Cloud` |
| `CompassIcon` | `Compass` | `lucide:Compass`, `phosphor:Compass` |
| `ImageIcon` | `Image` | `lucide:Image`, `phosphor:Image` |
| `KeyIcon` | `Key` | `lucide:KeyRound`, `phosphor:Key` |
| `ListChecksIcon` | `ListCheck` | `lucide:ListChecks`, `phosphor:ListChecks` |
| `LoaderIcon` | `Loader` | `lucide:LoaderCircle`, `lucide:Loader2Icon` |
| `LockIcon` | `Lock` | `lucide:LockKeyhole`, `phosphor:LockKey` |
| `MailIcon` | `Envelope` | `lucide:Mail`, `phosphor:EnvelopeSimple` |
| `PaintBrushIcon` | `Paintbrush` | `lucide:Paintbrush`, `phosphor:PaintBrush` |
| `SettingsIcon` | `Settings` | `lucide:Settings`, `phosphor:Gear` |
| `TargetIcon` | `Target` | `lucide:Target`, `phosphor:Target` |
| `XIcon` | `X` | `lucide:X`, `lucide:XIcon` |

`AgentIcon` deserves a note. Reicon contains no robot glyph, so the agent is represented by `Cpu`.
This is consistent with `foundations.md`, which requires ilo to be "capable, not theatrical" and to
avoid mascots and AI spectacle; a machine component reads as infrastructure rather than as a
character.

### Renames

Reicon's vendor names are frequently opaque at a call site, which is the second reason the registry
exists. `Record` means an empty circle; `Task` means a to-do list; `Gps` means a fixed location
crosshair. The registry name states the meaning and the source column records the lookup.

| Registry export | reicon source | Replaces |
| --- | --- | --- |
| `CalendarPlusIcon` | `CalendarAdd` | `lucide:CalendarPlus` |
| `CircleAlertIcon` | `AlertCircle` | `lucide:CircleAlert` |
| `CircleHelpIcon` | `HelpCircle` | `lucide:CircleHelp` |
| `CircleIcon` | `Record` | `lucide:Circle` |
| `ClockIcon` | `Clock` | `lucide:Clock3` |
| `ColumnsIcon` | `Grid3` | `lucide:Columns3` |
| `CopyPlusIcon` | `DocumentCopy` | `lucide:CopyPlus` |
| `DollarIcon` | `Dollar` | `lucide:BadgeDollarSign` |
| `EditIcon` | `Edit` | `lucide:Edit3` |
| `ExternalLinkIcon` | `ArrowUpRightSquare` | `lucide:ExternalLink` |
| `EyeOffIcon` | `EyeSlash` | `lucide:EyeOff` |
| `GridIcon` | `Grid` | `lucide:Grid3X3` |
| `HouseIcon` | `Home` | `phosphor:House` |
| `InfoIcon` | `InfoCircle` | `lucide:InfoIcon` |
| `LayersIcon` | `Layers` | `lucide:Layers3` |
| `ListTodoIcon` | `Task` | `lucide:ListTodo` |
| `LocationFixedIcon` | `Gps` | `lucide:LocateFixed` |
| `LogOutIcon` | `Logout` | `lucide:LogOut` |
| `MapPinIcon` | `Location` | `lucide:MapPin` |
| `MoreHorizontalIcon` | `MoreH` | `lucide:MoreHorizontal` |
| `PanelLeftIcon` | `Sidebar` | `lucide:PanelLeftIcon` |
| `PanelTopIcon` | `SidebarTop` | `lucide:PanelTop` |
| `ReceiptIcon` | `Receipt` | `lucide:ReceiptText` |
| `RefreshIcon` | `Refresh` | `lucide:RefreshCw` |
| `SliderHorizontalIcon` | `SliderHorizontal` | `lucide:SlidersHorizontal` |
| `SortIcon` | `Sort` | `lucide:ArrowUpDown` |
| `StopIcon` | `StopCircle` | `lucide:OctagonXIcon` |
| `TrashIcon` | `Trash` | `lucide:Trash2` |
| `UserIcon` | `User` | `lucide:UserRound` |
| `WalletIcon` | `Wallet` | `lucide:WalletCards` |

`SideProfileIcon` maps to reicon `SideProfile` and replaces `lucide:Volleyball` at the two
application-mark call sites.

### Direct equivalents

The remaining 36 exports keep their current meaning against an identically or near-identically
named reicon glyph: `ActivityIcon`, `ArchiveIcon`, `ArrowDownIcon`, `ArrowLeftIcon`,
`ArrowRightIcon`, `ArrowUpIcon`, `BanknoteIcon`, `CheckSquareIcon`, `ChevronLeftIcon`,
`ChevronUpIcon`, `ClipboardIcon`, `CloudRainIcon`, `CommandIcon`, `CopyIcon`, `DownloadIcon`,
`EyeIcon`, `FileTextIcon`, `InboxIcon`, `MenuIcon`, `MinusIcon`, `MonitorIcon`, `MoonIcon`,
`PinIcon`, `PlugIcon`, `PlusIcon`, `PulseIcon`, `ReplyIcon`, `ScissorsIcon`, `SearchIcon`,
`ShieldCheckIcon`, `SparklesIcon`, `StarIcon`, `SunIcon`, `UserCircleIcon`, `UsersIcon`,
`WifiOffIcon`.

## Weight and state

`system.md` already requires that "ordinary destinations use solid/outline icon weight for state."
Lucide cannot express this, which is why `@phosphor-icons/react` was imported into `app.tsx` for
exactly 18 navigation glyphs. Because all 2,674 reicon icons carry both weights, this consolidation
removes the second pack rather than trading one for another.

- Outline is the default and applies to every icon that is not expressing an active or selected
  state.
- Filled marks the active navigation destination and the selected item in an icon-labelled control
  family.
- Weight never carries a meaning on its own. Selection remains conveyed by the navigation surface,
  `aria-current`, and the visible label; weight is supplemental, consistent with the existing rule
  that geometry must not move between states.
- Framed workspace icons keep stable geometry and continue to rely on the navigation surface for
  selection, unchanged from today.

## Enforcement

`scripts/check-icon-contract.mjs` follows the established pattern of the seven existing
`check-*-contract.mjs` scripts and is appended to the `lint` script in the root `package.json`. It
fails the build on:

- any import of `lucide-react`, `@phosphor-icons/react`, `@tabler/icons-react`, `react-icons`,
  `@radix-ui/react-icons`, or `@heroicons/react` anywhere in the repository;
- any import of `reicon-react` from a file other than `apps/web/src/components/icons.ts`;
- any inline `<svg>` element in `apps/web/src` outside the registry, which would otherwise be an
  easy way to smuggle in foreign artwork.

`lucide-react` and `@phosphor-icons/react` are removed from `apps/web/package.json`, so the ban
cannot be defeated by an unchecked import path.

The `color`, `strokeWidth`, and `secondaryColor` props need no lint rule; the `Icon` type rejects
them at compile time.

## Application mark

`apps/web/public/icon.svg` currently inlines Lucide's volleyball path data and describes itself in
its own `<desc>` as "A black Lucide volleyball inside a rounded-square frame." Removing Lucide
therefore requires this asset to change regardless of the brand decision.

The frame is retained exactly as it is: a black rounded square, a white inner rounded square, and a
black glyph. Only the glyph changes, to reicon's `SideProfile` — a head in profile, apt for a
personal workspace. The `<title>` and `<desc>` are rewritten to describe the new mark and to stop
naming a pack the repository no longer uses.

The mark uses the **Filled** weight at every size. `SideProfile`'s Outline weight is a genuine
1.5px stroke on a 24-unit grid, which resolves to roughly 2px at the 32px favicon and roughly 1px
at the 16px browser tab, where it disintegrates. Filled holds at every size and keeps one mark with
one appearance.

In-application, `.logo-mark` already draws its own frame with `box-shadow: inset 0 0 0 2px
currentColor`, so the two call sites render a bare glyph inside a CSS frame. That structure does not
change; only the glyph inside it does. The duplicated inline mark in
`apps/web/src/features/setup/page.tsx` is replaced by the shared `LogoMark` component from
`app.tsx`, removing a copy that would otherwise drift.

### Mark surfaces

| Surface | Files |
| --- | --- |
| Web master | `apps/web/public/icon.svg` |
| Web raster | `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` |
| Desktop | `apps/desktop/src-tauri/icons/` — `icon.icns`, `icon.ico`, `icon.png`, four sized PNGs, ten `Square*Logo.png`, plus `android/` and `ios/`, about 34 files |
| In-app | `LogoMark` in `apps/web/src/app.tsx`, inline duplicate in `features/setup/page.tsx` |
| Manifests | `apps/web/index.html`, PWA manifest in `apps/web/vite.config.ts` |
| MCP | `apps/mcp/src/server.ts` and `src/tool-surface.ts` both reference `/icon-192.png` by URL and need no code change |

### PWA maskable icon correction

The manifest currently declares `icon-512.png` with `purpose: "any maskable"`. Android crops
maskable icons to a circle and requires content to stay within a 40% safe zone, so the present
full-bleed framed mark has its corners cut. This design splits the declaration:

- `icon-512.png` keeps `purpose: "any"` and remains the full-bleed framed mark.
- A new `icon-512-maskable.png` carries `purpose: "maskable"` with the framed mark scaled down
  inside a solid background so the entire frame survives the circular crop.

### Raster generation

Neither `rsvg-convert`, ImageMagick, nor Inkscape is available in this environment, but
`@playwright/test` is already a devDependency and its Chromium is cached locally. A checked-in
`scripts/generate-app-mark.mjs` therefore rasterizes `icon.svg` through headless Chromium, which
has the additional benefit of rendering the asset with the same engine that will serve it.

The script produces a 1024px master PNG, then the web set at 32, 180, 192, and 512 pixels plus the
padded maskable variant. The desktop set is regenerated by the Tauri CLI, already a devDependency
of `apps/desktop`, which derives `.icns`, `.ico`, the Windows `Square*Logo` sizes, and the Android
and iOS sets from the 1024px master. Regeneration is reproducible and re-runnable whenever the mark
changes; no new dependency is added.

## Documentation

Design documentation is a product contract in this repository, so the contract lands in the book in
the same change as the code.

| File | Change |
| --- | --- |
| `docs/design/system.md` | Replace the single-line **Icons** row with a normative Icons contract: `reicon-react` is the only permitted pack; all glyphs come from `@/components/icons`; Outline is default and Filled marks active state; size comes from `size-*` classes and never the `size` prop; color comes from semantic `text-*` tokens and the `color` prop does not exist; icons accept no children, so an icon-only control is named with `aria-label` and a tooltip and a decorative icon takes `aria-hidden` |
| `docs/design/foundations.md` | Rewrite *Product mark and name* to describe the `SideProfile` mark, and name icon weight as part of the visual language in *Visual expression* |
| `docs/design/governance.md` | Adding a glyph is a reviewed registry change, not a local import; a new glyph must represent a new meaning |
| `docs/engineering/settings-ui-standards.md` | Point its icon guidance at the `system.md` contract |
| `.agents/skills/shadcn/rules/icons.md` and `SKILL.md` | Record that this project's `iconLibrary` is reicon and that registry-supplied Lucide imports must be swapped to `@/components/icons` during the mandatory post-add review |
| `apps/web/components.json` | `"iconLibrary": "reicon-react"` |
| `AGENTS.md` | One line pointing at the icon contract |

The shadcn CLI has no built-in transform for reicon, and `iconLibrary` is an unconstrained string
in the shadcn schema. Setting it to `reicon-react` is therefore a signal to human and agent
contributors rather than an instruction the CLI acts on; components added from a registry will
still arrive with Lucide imports and must be converted during the review step the skill already
mandates. The lint contract catches any that are missed.

## Migration scope

30 files import icons. `apps/web/src/app.tsx` (8,104 lines) and
`apps/web/src/features/finances/page.tsx` (3,196 lines) hold the bulk. Two tests,
`components/event-card.test.tsx` and `components/readiness-panel.test.tsx`, import icons directly
and move to the registry. `packages/ui`, `apps/api`, `apps/mcp`, and `e2e` contain no icon imports.

## Verification

- `pnpm lint` passes, including the new icon contract, and fails when a `lucide-react` import or an
  import of `reicon-react` from outside the registry is reintroduced.
- `pnpm typecheck` passes, and fails when a `color`, `strokeWidth`, or `secondaryColor` prop is
  passed to a registry icon.
- `pnpm test:coverage` holds the existing thresholds.
- `pnpm build` and `pnpm test:e2e` pass.
- `grep` over the repository returns no reference to `lucide-react` or `@phosphor-icons/react`
  outside this design document, and neither package appears in `apps/web/package.json` or the
  lockfile.
- Icons render at their prior sizes in Button, DropdownMenu, Sidebar, Tabs, Combobox, and Toggle,
  confirming that the `[&_svg:not([class*='size-'])]:size-4` pattern still applies over reicon's
  `width`/`height` attributes.
- Active navigation renders Filled and inactive renders Outline, in both light and dark themes.
- Icon-only controls keep their accessible names, verified by the existing Testing Library
  assertions that query by accessible name.
- The mark is correct in the browser tab, the iOS home screen, the installed PWA, and the built
  desktop application, and the maskable variant survives a circular crop.
- The rendered application is reviewed in both themes after conversion, since reicon's traced
  outlines read slightly heavier than Lucide's 2px strokes at 16px.

## Risks

- **Optical weight shift.** Reicon outlines are traced fills rather than strokes, so icons read
  differently at small sizes. Accepted deliberately; reviewed in-app after conversion.
- **Sole-source dependency.** Discussed under *Dependency risk*. The registry bounds the cost of
  reversing this decision.
- **Large mechanical diff in `app.tsx`.** Concentrated in import statements and JSX element names.
  The lint contract and `tsc` together make an incomplete conversion a build failure rather than a
  silent gap.
- **Glyph-meaning drift.** Several substitutions are approximations rather than exact matches, most
  notably `Cpu` for the agent and `ArrowUpRightSquare` for an external link. These are recorded in
  the mapping tables above so a reviewer can disagree with a specific choice without relitigating
  the whole change.
