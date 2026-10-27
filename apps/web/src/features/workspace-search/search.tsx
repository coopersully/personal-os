import { localDateToIso, type SearchableWorkspace } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import { ActionButton as Button } from "@/components/action-button";
import { FilterTrigger } from "@/components/data-view-controls";
import {
  ApprovalHandIcon,
  ArrowRightIcon,
  CalendarIcon,
  FileTextIcon,
  FilterIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import {
  Combobox,
  ComboboxContent,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";
import { parseCalendarDateQuery } from "../calendar/search-date";
import { useWorkspacePreferences } from "../workspace-settings/preferences";
import { type SearchAction, type SearchOption, workspaceCatalog } from "./catalog";

/** Workspace discovery is separate from the current page's URL filters. */
export function WorkspaceFinder({
  workspace,
  onAction,
  timeZone = "UTC",
}: {
  workspace: SearchableWorkspace;
  onAction?: (action: SearchAction) => void;
  timeZone?: string;
}) {
  const [activation, setActivation] = useState(0);
  useEffect(() => {
    const focusSearch = () => {
      setActivation((current) => current + 1);
    };
    window.addEventListener("nohmi:workspace-search", focusSearch);
    return () => window.removeEventListener("nohmi:workspace-search", focusSearch);
  }, []);
  const label = `Search ${workspace[0]?.toUpperCase()}${workspace.slice(1)}`;
  return (
    <div className="workspace-finder" data-search-workspace={workspace}>
      <FinderInput
        workspace={workspace}
        label={label}
        timeZone={timeZone}
        {...(onAction ? { onAction } : {})}
        activation={activation}
      />
    </div>
  );
}
function FinderInput({
  workspace,
  label,
  timeZone,
  onAction,
  activation = 0,
}: {
  workspace: SearchableWorkspace;
  label: string;
  timeZone: string;
  onAction?: (action: SearchAction) => void;
  activation?: number;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activation) {
      inputRef.current?.focus();
      setOpen(true);
    }
  }, [activation]);
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState("");
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("all");
  const [choosingType, setChoosingType] = useState(false);
  const needsRecords = ["all", "content", "reviews"].includes(filter);
  const recordKind = filter === "content" ? "content" : filter === "reviews" ? "reviews" : "all";
  const [open, setOpen] = useState(false);
  const preferences = useWorkspacePreferences(workspace);
  const [archiveOverride, setArchiveOverride] = useState<boolean | null>(null);
  const includeArchived =
    archiveOverride ?? preferences.data?.preferences.includeArchivedInSearch ?? true;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(query.trim());
      setOffset(0);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);
  const records = useQuery({
    queryKey: ["workspace-search", workspace, settled, offset, includeArchived, recordKind],
    queryFn: ({ signal }) =>
      api.searchWorkspace(
        workspace,
        { q: settled, offset, includeArchived, kind: recordKind },
        signal,
      ),
    enabled: open && settled.length > 0 && needsRecords,
  });
  const current = query.trim() === settled;
  const shortcuts = workspaceCatalog(workspace, query).filter(
    (option) =>
      filter === "all" ||
      (filter === "settings" && option.kind === "Settings") ||
      (filter === "actions" && ["Navigation", "Action"].includes(option.kind)) ||
      (filter === "reviews" && option.kind === "Review"),
  );
  const date = workspace === "calendar" ? parseCalendarDateQuery(query, timeZone) : undefined;
  const options: SearchOption[] = [
    ...(date && ["all", "content"].includes(filter)
      ? [
          {
            id: date.key,
            kind: "Date",
            title: `Go to ${date.detail}`,
            preview: "Show this day in Calendar",
            state: null,
            href: `/calendar?view=day&follow=0&date=${localDateToIso(date.date)}`,
          },
        ]
      : []),
    ...(current && needsRecords ? (records.data?.items ?? []) : []),
    ...shortcuts,
  ];
  const groupLabel = (option: SearchOption) =>
    ["Date", "Settings", "Review", "Action", "Navigation"].includes(option.kind)
      ? option.kind
      : "Content";
  const groups = ["Date", "Content", "Review", "Settings", "Navigation", "Action"]
    .map((label) => ({ label, items: options.filter((option) => groupLabel(option) === label) }))
    .filter((group) => group.items.length);
  const orderedOptions = groups.flatMap((group) => group.items);
  const select = (option: SearchOption) => {
    setOpen(false);
    setQuery("");
    if (option.action) onAction?.(option.action);
    else navigate(option.href);
  };
  const results = (
    <>
      <div className="workspace-finder-toolbar">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Search result type"
          aria-expanded={choosingType}
          onClick={() => setChoosingType(!choosingType)}
        >
          <FilterIcon aria-hidden="true" />
          {
            {
              all: "All results",
              content: "Content",
              settings: "Settings",
              actions: "Navigation and actions",
              reviews: "Reviews",
            }[filter as "all"]
          }
        </Button>
        <FilterTrigger
          compact
          label="Include archive"
          aria-label="Include archive"
          active={includeArchived}
          count={includeArchived ? 1 : 0}
          aria-pressed={includeArchived}
          onClick={() => {
            setArchiveOverride(!includeArchived);
            setOffset(0);
          }}
        />
      </div>
      {choosingType ? (
        <fieldset className="workspace-finder-types" aria-label="Result type">
          {[
            ["all", "All results"],
            ["content", "Content"],
            ["settings", "Settings"],
            ["actions", "Navigation and actions"],
            ["reviews", "Reviews"],
          ].map(([value, title]) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "secondary" : "ghost"}
              aria-pressed={filter === value}
              onClick={() => {
                if (!value) return;
                setFilter(value);
                setOffset(0);
                setChoosingType(false);
              }}
            >
              {title}
            </Button>
          ))}
        </fieldset>
      ) : null}
      <div role="status" className="px-2 text-xs text-muted-foreground">
        {query.trim() && needsRecords && (!current || records.isPending)
          ? "Searching…"
          : needsRecords && records.isError
            ? "Content search is unavailable. Settings and shortcuts still work."
            : needsRecords && records.data?.unavailable?.length
              ? "Some review results are unavailable."
              : query.trim() && !options.length
                ? "No matches found."
                : ""}
      </div>
      {needsRecords && records.isError ? (
        <Button variant="ghost" size="sm" onClick={() => void records.refetch()}>
          Retry search
        </Button>
      ) : null}
      <ComboboxList aria-label={`${label} results`}>
        {groups.map((group) => (
          <ComboboxGroup key={group.label} className="workspace-finder-group">
            <ComboboxGroupLabel className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              {group.label}
            </ComboboxGroupLabel>
            {group.items.map((option) => (
              <ComboboxItem value={option} key={`${option.kind}:${option.id}`}>
                {(() => {
                  const Icon =
                    option.kind === "Settings"
                      ? SettingsIcon
                      : option.kind === "Review"
                        ? ApprovalHandIcon
                        : option.kind === "Action"
                          ? PlusIcon
                          : option.kind === "Navigation"
                            ? ArrowRightIcon
                            : option.kind === "Date"
                              ? CalendarIcon
                              : FileTextIcon;
                  return <Icon aria-hidden="true" />;
                })()}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      data-user-content={
                        !["Settings", "Review", "Action", "Navigation", "Date"].includes(
                          option.kind,
                        ) || undefined
                      }
                      className="truncate font-medium"
                    >
                      {option.title}
                    </span>
                    {option.state ? <Badge variant="secondary">{option.state}</Badge> : null}
                  </div>
                  <span data-user-content className="line-clamp-2 text-xs text-muted-foreground">
                    {option.preview}
                  </span>
                </div>
              </ComboboxItem>
            ))}
          </ComboboxGroup>
        ))}
      </ComboboxList>
      {(offset > 0 ||
        (records.data?.nextOffset !== null && records.data?.nextOffset !== undefined)) &&
      current &&
      needsRecords ? (
        <div className="flex justify-between gap-2 p-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            Previous results
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={records.data?.nextOffset == null}
            onClick={() => setOffset(records.data?.nextOffset ?? 0)}
          >
            More results
          </Button>
        </div>
      ) : null}
    </>
  );
  return (
    <div className="min-w-0" ref={anchorRef}>
      <Combobox<SearchOption>
        items={orderedOptions}
        filter={null}
        value={null}
        inputValue={query}
        onInputValueChange={(value, details) => {
          setQuery(value);
          if (details.reason === "input-change") setOpen(true);
        }}
        itemToStringLabel={(item) => item?.title ?? ""}
        itemToStringValue={(item) => (item ? `${item.kind}:${item.id}` : "")}
        onValueChange={(item) => {
          if (item) select(item);
        }}
        open={open}
        onOpenChange={setOpen}
        autoHighlight
      >
        <ComboboxInput
          ref={inputRef}
          aria-label={label}
          placeholder=""
          showTrigger={false}
          className="workspace-finder-input w-full rounded-full"
          onClick={() => setOpen(true)}
          maxLength={200}
        >
          <InputGroupAddon align="inline-start">
            <SearchIcon />
          </InputGroupAddon>
        </ComboboxInput>
        <ComboboxContent
          anchor={anchorRef}
          collisionPadding={16}
          align="center"
          className="workspace-finder-results max-h-[65dvh] overflow-y-auto"
        >
          {results}
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
