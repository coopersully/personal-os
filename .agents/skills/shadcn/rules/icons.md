# Icons

**Always use the project's configured `iconLibrary` for imports.** Check the `iconLibrary` field from project context: `lucide` → `lucide-react`, `tabler` → `@tabler/icons-react`, etc. Never assume `lucide-react`.

## In this repository: reicon, through the registry

`iconLibrary` is `reicon-react`. The shadcn CLI has no transform for it, so registry components arrive with `lucide-react` imports that you must convert during the mandatory post-add review.

- Import every glyph from `@/components/icons`, never from `reicon-react` or any other icon package. Only `apps/web/src/components/icons.ts` may import `reicon-react`.
- If the glyph you need is not exported yet, add an entry to that registry under a semantic name (`MailIcon`, not reicon's `Envelope`) rather than importing it locally.
- Never pass `color`, `strokeWidth`, or `secondaryColor`; the registry's `Icon` type rejects them. Color comes from `text-*` tokens, size from `size-*` classes.
- Use `weight="Filled"` only for active/selected state; Outline is the default.
- `pnpm lint` runs `scripts/check-icon-contract.mjs`, which fails on any other icon package, a direct `reicon-react` import, or hand-written inline `<svg>`.
- Provider and product logos are **brand marks, not icons**. Compose `BrandMark` from `@/components/brand-marks`; only that module may contain inline `<svg>` or import `simple-icons`. If a brand has no entry it renders a monogram — never hand-draw a trademark to close the gap.

See `docs/design/system.md` for the full contract.

---

## Icons in Button use data-icon attribute

Add `data-icon="inline-start"` (prefix) or `data-icon="inline-end"` (suffix) to the icon. No sizing classes on the icon.

**Incorrect:**

```tsx
<Button>
  <SearchIcon className="mr-2 size-4" />
  Search
</Button>
```

**Correct:**

```tsx
<Button>
  <SearchIcon data-icon="inline-start"/>
  Search
</Button>

<Button>
  Next
  <ArrowRightIcon data-icon="inline-end"/>
</Button>
```

---

## No sizing classes on icons inside components

Components handle icon sizing via CSS. Don't add `size-4`, `w-4 h-4`, or other sizing classes to icons inside `Button`, `DropdownMenuItem`, `Alert`, `Sidebar*`, or other shadcn components. Unless the user explicitly asks for custom icon sizes.

**Incorrect:**

```tsx
<Button>
  <SearchIcon className="size-4" data-icon="inline-start" />
  Search
</Button>

<DropdownMenuItem>
  <SettingsIcon className="mr-2 size-4" />
  Settings
</DropdownMenuItem>
```

**Correct:**

```tsx
<Button>
  <SearchIcon data-icon="inline-start" />
  Search
</Button>

<DropdownMenuItem>
  <SettingsIcon />
  Settings
</DropdownMenuItem>
```

---

## Pass icons as component objects, not string keys

Use `icon={CheckIcon}`, not a string key to a lookup map.

**Incorrect:**

```tsx
const iconMap = {
  check: CheckIcon,
  alert: AlertIcon,
}

function StatusBadge({ icon }: { icon: string }) {
  const Icon = iconMap[icon]
  return <Icon />
}

<StatusBadge icon="check" />
```

**Correct:**

```tsx
import { CheckIcon } from "@/components/icons"

function StatusBadge({ icon: Icon }: { icon: React.ComponentType }) {
  return <Icon />
}

<StatusBadge icon={CheckIcon} />
```
