import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ActionButton as Button } from "./action-button";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  ClockIcon,
  FilterIcon,
  type Icon,
  PlusIcon,
  SearchIcon,
  SortIcon,
  XIcon,
} from "./icons";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "./responsive-dialog";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./ui/input-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

const SettingsFilterControls = createContext(false);
const GroupedControls = createContext(false);
/** Append dataset actions to a search InputGroup without a second toolbar surface. */
export function SearchDataControls({ children }: { children: ReactNode }) {
  return (
    <InputGroupAddon
      align="inline-end"
      className="search-data-controls h-full shrink-0 gap-0 self-stretch p-0"
    >
      <GroupedControls.Provider value={true}>{children}</GroupedControls.Provider>
    </InputGroupAddon>
  );
}
function DataControlButton({
  grouped,
  tooltip,
  size,
  badgeCount,
  ...props
}: ComponentProps<typeof Button> & { grouped: boolean }) {
  if (!grouped)
    return (
      <Button
        {...props}
        size={size ?? "sm"}
        {...(badgeCount ? { badgeCount } : {})}
        {...(tooltip ? { tooltip } : {})}
      />
    );
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <InputGroupButton
            {...props}
            size="icon-sm"
            variant="ghost"
            className={cn(
              props.className,
              "search-data-control action-count-trigger relative h-8 min-w-10 rounded-none border-0",
            )}
          >
            {props.children}
            {badgeCount ? (
              <Badge className="action-count-badge" aria-hidden="true">
                {badgeCount}
              </Badge>
            ) : null}
          </InputGroupButton>
        </TooltipTrigger>
        <TooltipContent>{tooltip ?? props["aria-label"]}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type TriggerProps = Omit<ComponentProps<typeof Button>, "children" | "variant"> & {
  label: ReactNode;
  active?: boolean;
  compact?: boolean;
  count?: number;
};
/** All filter surfaces share state, glyph, hit area, and truncation semantics. */
export function FilterTrigger({
  label,
  active = false,
  compact = false,
  count,
  className,
  ...props
}: TriggerProps) {
  const grouped = useContext(GroupedControls);
  compact = compact || grouped;
  return (
    <DataControlButton
      grouped={grouped}
      {...props}
      size={props.size ?? (compact ? "icon-sm" : "sm")}
      tooltip={props.tooltip ?? (compact ? (props["aria-label"] ?? "") : "")}
      variant={active && !compact ? "secondary" : "ghost"}
      data-filter-active={active}
      badgeCount={active ? (count ?? 0) : 0}
      className={cn(
        "max-w-full",
        !active && !grouped && !compact && "border-dashed border-border text-muted-foreground",
        className,
      )}
    >
      <FilterIcon aria-hidden="true" />
      <span className={compact ? "sr-only" : "max-w-48 truncate"}>{label}</span>
      {!active && !grouped && !compact ? <PlusIcon aria-hidden="true" /> : null}
    </DataControlButton>
  );
}
export function SortTrigger({
  label,
  compact = false,
  direction,
  selected = false,
  className,
  ...props
}: Omit<TriggerProps, "active" | "count"> & {
  direction?: "asc" | "desc" | undefined;
  selected?: boolean;
}) {
  const grouped = useContext(GroupedControls);
  compact = compact || grouped;
  const Icon = direction === "asc" ? ArrowUpIcon : direction === "desc" ? ArrowDownIcon : SortIcon;
  return (
    <DataControlButton
      grouped={grouped}
      {...props}
      size={props.size ?? (compact ? "icon-sm" : "sm")}
      tooltip={props.tooltip ?? (compact ? (props["aria-label"] ?? "") : "")}
      variant={selected ? "secondary" : "ghost"}
      badgeCount={selected ? 1 : 0}
      className={cn("max-w-full", className)}
    >
      <Icon aria-hidden="true" />
      <span className={compact ? "sr-only" : "max-w-48 truncate"}>{label}</span>
    </DataControlButton>
  );
}
export function FilterChip({
  label,
  onRemove,
  ...props
}: Omit<TriggerProps, "active" | "compact" | "count"> & { onRemove: () => void }) {
  return (
    <Button
      {...props}
      size={props.size ?? "sm"}
      tooltip={props.tooltip ?? ""}
      variant="secondary"
      onClick={onRemove}
      aria-label={props["aria-label"] ?? `Remove ${label}`}
      data-filter-active="true"
      className={cn("max-w-full", props.className)}
    >
      <FilterIcon aria-hidden="true" />
      <span className="max-w-48 truncate">{label}</span>
      <XIcon aria-hidden="true" />
    </Button>
  );
}
/** Every sorting choice has an orientation or field glyph. */
export function SortOptionIcon({ value }: { value: string }) {
  const Icon =
    value === "oldest" || value.endsWith(":asc")
      ? ArrowUpIcon
      : value === "newest" || value.endsWith(":desc")
        ? ArrowDownIcon
        : value === "date" || value === "target"
          ? CalendarIcon
          : ["reserved", "estimate", "updated"].includes(value)
            ? ClockIcon
            : SortIcon;
  return <Icon aria-hidden="true" />;
}

export function DataChoice({
  label,
  value,
  choices,
  onChange,
  active = true,
  sorting = false,
  compact = false,
  ariaLabel,
  choiceIcons,
}: {
  label: string;
  value: string;
  choices: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  active?: boolean;
  sorting?: boolean;
  compact?: boolean;
  ariaLabel?: string | undefined;
  choiceIcons?: Readonly<Record<string, Icon>>;
}) {
  const settingsRow = useContext(SettingsFilterControls);
  const selected = choices.find(([key]) => key === value)?.[1] ?? label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {settingsRow ? (
          <Button
            variant="ghost"
            className="h-8 max-w-full justify-end px-2.5 font-normal text-muted-foreground"
            aria-label={ariaLabel ?? `${label}: ${selected}`}
          >
            {selected}
          </Button>
        ) : sorting ? (
          <SortTrigger
            selected={value !== choices[0]?.[0]}
            compact={compact}
            label={selected}
            aria-label={ariaLabel ?? `${label}: ${selected}`}
          />
        ) : (
          <FilterTrigger
            active={active}
            compact={compact}
            label={selected}
            aria-label={ariaLabel ?? `${label}: ${selected}`}
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {choices.map(([key, text]) => {
            const ChoiceIcon = choiceIcons?.[key];
            return (
              <DropdownMenuRadioItem key={key} value={key}>
                {sorting ? (
                  <SortOptionIcon value={key} />
                ) : ChoiceIcon ? (
                  <ChoiceIcon aria-hidden="true" />
                ) : null}
                {text}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export type FilterControl = { id: string; label: string; active: boolean; control: ReactNode };
/** Bound the toolbar; all additional filters remain searchable in a drawer/dialog. */
export function FilterBar({
  filters,
  children,
  collapsed = false,
}: {
  filters: FilterControl[];
  collapsed?: boolean;
  children?: ReactNode;
}) {
  const mobile = useIsMobile();
  const grouped = useContext(GroupedControls);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const ordered = [...filters].sort((a, b) => Number(b.active) - Number(a.active));
  const limit = collapsed ? 0 : mobile ? 2 : 5;
  const hidden = ordered.slice(limit);
  return (
    <fieldset
      className={cn(
        "flex min-w-0 items-center",
        grouped ? "gap-0" : "gap-2",
        !collapsed && "flex-wrap",
      )}
      aria-label="Filters and sorting"
    >
      {ordered.slice(0, limit).map((filter) => (
        <div className="min-w-0 max-w-full" key={filter.id}>
          {filter.control}
        </div>
      ))}
      {hidden.length ? (
        <ResponsiveDialog
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            if (!value) setSearch("");
          }}
        >
          <ResponsiveDialogTrigger asChild>
            <FilterTrigger
              label={collapsed ? "Filters" : `More filters (${hidden.length})`}
              count={collapsed ? hidden.filter((item) => item.active).length : 0}
              active={hidden.some((item) => item.active)}
              aria-label={collapsed ? "Filters" : "More filters"}
            />
          </ResponsiveDialogTrigger>
          <ResponsiveDialogContent>
            <GroupedControls.Provider value={false}>
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>Filters</ResponsiveDialogTitle>
              </ResponsiveDialogHeader>
              <ResponsiveDialogBody className="flex min-w-0 flex-col gap-3 overflow-x-hidden">
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Find a filter"
                    placeholder="Search filters…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </InputGroup>
                <SettingsFilterControls.Provider value={true}>
                  <Card className="settings-panel gap-0 py-0">
                    <CardContent className="p-0">
                      <FieldGroup>
                        {ordered
                          .filter((item) =>
                            item.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                          )
                          .map((item) => (
                            <Field
                              orientation="horizontal"
                              data-settings-row=""
                              className="px-4"
                              key={item.id}
                            >
                              <FieldLabel>{item.label}</FieldLabel>
                              {item.control}
                            </Field>
                          ))}
                      </FieldGroup>
                    </CardContent>
                  </Card>
                </SettingsFilterControls.Provider>
                {!ordered.some((item) =>
                  item.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                ) ? (
                  <p className="text-sm text-muted-foreground">No matching filters.</p>
                ) : null}
              </ResponsiveDialogBody>
              <ResponsiveDialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </ResponsiveDialogFooter>
            </GroupedControls.Provider>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      ) : null}
      <div
        className={cn(
          "ml-auto flex min-w-0 max-w-full items-center",
          grouped ? "gap-0" : "flex-wrap gap-2",
        )}
      >
        {children}
      </div>
    </fieldset>
  );
}
