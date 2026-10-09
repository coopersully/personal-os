import { localDateToIso, type SearchableWorkspace } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api";
import { ActionButton as Button } from "@/components/action-button";
import { SearchIcon } from "@/components/icons";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Combobox,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { InputGroupAddon } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();
  useEffect(() => {
    const focusSearch = () => setMobileOpen(true);
    window.addEventListener("nohmi:workspace-search", focusSearch);
    return () => window.removeEventListener("nohmi:workspace-search", focusSearch);
  }, []);
  const label = `Search ${workspace[0]?.toUpperCase()}${workspace.slice(1)}`;
  return (
    <div className="workspace-finder" data-search-workspace={workspace}>
      {isMobile ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            onClick={() => setMobileOpen(true)}
          >
            <SearchIcon />
          </Button>
          <ResponsiveDialog open={mobileOpen} onOpenChange={setMobileOpen}>
            <ResponsiveDialogContent className="workspace-finder-dialog">
              <ResponsiveDialogHeader>
                <ResponsiveDialogTitle>{label}</ResponsiveDialogTitle>
              </ResponsiveDialogHeader>
              <ResponsiveDialogBody>
                <FinderInput
                  workspace={workspace}
                  label={label}
                  timeZone={timeZone}
                  {...(onAction ? { onAction } : {})}
                  onSelected={() => setMobileOpen(false)}
                  mobile
                />
              </ResponsiveDialogBody>
            </ResponsiveDialogContent>
          </ResponsiveDialog>
        </>
      ) : (
        <Popover open={mobileOpen} onOpenChange={setMobileOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={label}>
              <SearchIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="workspace-finder-results" aria-label={label}>
            <FinderInput
              workspace={workspace}
              label={label}
              timeZone={timeZone}
              {...(onAction ? { onAction } : {})}
              onSelected={() => setMobileOpen(false)}
              mobile
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
function FinderInput({
  workspace,
  label,
  timeZone,
  onAction,
  onSelected,
  mobile = false,
}: {
  workspace: SearchableWorkspace;
  label: string;
  timeZone: string;
  onAction?: (action: SearchAction) => void;
  onSelected?: () => void;
  mobile?: boolean;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState("");
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("all");
  const needsRecords = ["all", "content", "reviews"].includes(filter);
  const recordKind = filter === "content" ? "content" : filter === "reviews" ? "reviews" : "all";
  const [open, setOpen] = useState(mobile);
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
    onSelected?.();
    if (option.action) onAction?.(option.action);
    else navigate(option.href);
  };
  const results = (
    <>
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="text-xs text-muted-foreground">
          Entire workspace · Available synced content
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={includeArchived}
          onClick={() => {
            setArchiveOverride(!includeArchived);
            setOffset(0);
          }}
        >
          {includeArchived ? "Including archive" : "Excluding archive"}
        </Button>
      </div>
      <NativeSelect
        aria-label="Search result type"
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
          setOffset(0);
        }}
      >
        <NativeSelectOption value="all">All results</NativeSelectOption>
        <NativeSelectOption value="content">Content</NativeSelectOption>
        <NativeSelectOption value="settings">Settings</NativeSelectOption>
        <NativeSelectOption value="actions">Navigation and actions</NativeSelectOption>
        <NativeSelectOption value="reviews">Reviews</NativeSelectOption>
      </NativeSelect>
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
          <ComboboxGroup key={group.label}>
            <ComboboxGroupLabel className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              {group.label}
            </ComboboxGroupLabel>
            {group.items.map((option) => (
              <ComboboxItem value={option} key={`${option.kind}:${option.id}`}>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{option.title}</span>
                    {option.state ? <Badge variant="secondary">{option.state}</Badge> : null}
                  </div>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {option.preview}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{option.kind}</span>
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
    <div className="min-w-0">
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
        inline={mobile}
        open={mobile || open}
        onOpenChange={setOpen}
        autoHighlight
      >
        <ComboboxInput
          aria-label={label}
          placeholder={label}
          showTrigger={false}
          className="w-full"
          onClick={() => setOpen(true)}
          autoFocus={mobile}
          maxLength={200}
        >
          <InputGroupAddon align="inline-start">
            <SearchIcon />
          </InputGroupAddon>
        </ComboboxInput>
        <div className="pt-3">{results}</div>
      </Combobox>
    </div>
  );
}
