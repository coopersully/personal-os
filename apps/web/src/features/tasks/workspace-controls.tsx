import type { TaskList, TaskProject } from "@personal-os/domain";
import { type FormEvent, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRightIcon, XIcon } from "@/components/icons";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatMaterialDateTime } from "../../lib/date-format";
import { dateTimeLocalToIso, toDateTimeLocal } from "./page";
import { type DatePreset, datePresets, identifyPreset, presetBounds } from "./task-filter-presets";
import { withWorkspaceOption, workspaceFilterKeys, workspacePath } from "./workspace-query";

export const sortOptions = [
  ["default", "Recommended"],
  ["date", "Relevant date"],
  ["reserved", "Reserved time"],
  ["priority", "Priority"],
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["title", "Title A–Z"],
  ["estimate", "Shortest estimate"],
] as const;
const groupOptions = [
  ["none", "No grouping"],
  ["date", "Date"],
  ["list", "List"],
  ["project", "Project"],
] as const;
export const detailOptions = [
  ["estimate", "Estimates"],
  ["tags", "Tags"],
  ["notes", "Notes"],
] as const;

export function WorkspaceSort({ params }: { params: URLSearchParams }) {
  const navigate = useNavigate();
  const value = params.get("sort") ?? "default";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost">
          Sort
          {value !== "default"
            ? `: ${sortOptions.find(([key]) => key === value)?.[1] ?? "Recommended"}`
            : ""}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => navigate(withWorkspaceOption(params, "sort", next, "default"))}
          >
            {sortOptions.map(([key, label]) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkspaceDisplay({ params }: { params: URLSearchParams }) {
  const navigate = useNavigate();
  const details = (params.get("details") ?? "estimate").split(",");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost">
          Display
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Group by</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={params.get("group") ?? "none"}
            onValueChange={(next) => navigate(withWorkspaceOption(params, "group", next, "none"))}
          >
            {groupOptions.map(([key, label]) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Row details</DropdownMenuLabel>
          {detailOptions.map(([key, label]) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={details.includes(key)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => {
                const next = checked
                  ? [...details.filter(Boolean), key]
                  : details.filter((value) => value !== key);
                navigate(
                  withWorkspaceOption(
                    params,
                    "details",
                    next.length ? next.join(",") : "none",
                    "estimate",
                  ),
                );
              }}
            >
              {label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([key, name]) => (
          <NativeSelectOption key={key} value={key}>
            {name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

export function WorkspaceFilters({
  params,
  timeZone,
  lists,
  projects,
}: {
  params: URLSearchParams;
  timeZone: string;
  lists: TaskList[];
  projects: TaskProject[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => new URLSearchParams(params));
  const [advanced, setAdvanced] = useState(false);
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const count = workspaceFilterKeys.filter((key) => params.has(key)).length;
  const global = Boolean(params.get("view"));
  const history = params.get("view") === "history";
  const set = (key: string, value: string) =>
    setDraft((old) => {
      const next = new URLSearchParams(old);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  const deadline =
    draft.get("due") === "none" || draft.get("due") === "overdue" || draft.get("due") === "dated"
      ? (draft.get("due") as string)
      : custom
        ? "custom"
        : identifyPreset(
            { after: draft.get("dueAfter") ?? "", before: draft.get("dueBefore") ?? "" },
            timeZone,
          );
  const apply = (event: FormEvent) => {
    event.preventDefault();
    for (const prefix of ["due", "scheduled"]) {
      const after = draft.get(`${prefix}After`);
      const before = draft.get(`${prefix}Before`);
      if (
        (after && !Number.isFinite(Date.parse(after))) ||
        (before && !Number.isFinite(Date.parse(before)))
      ) {
        setError("Enter a valid date and time, or clear the date filter.");
        return;
      }
      if (after && before && Date.parse(after) > Date.parse(before)) {
        setError("The start of a date range must be before its end.");
        return;
      }
    }
    const next = new URLSearchParams(params);
    for (const key of [...workspaceFilterKeys, ...(global ? ["list", "project"] : [])]) {
      const value = draft.get(key);
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("task");
    next.delete("reminder");
    navigate(workspacePath(next));
    setOpen(false);
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setDraft(new URLSearchParams(params));
          setError(null);
          setCustom(false);
          setAdvanced(false);
        }
      }}
    >
      <ResponsiveDialogTrigger asChild>
        <Button size="sm" variant="ghost">
          {count ? `Filters (${count})` : "Filters"}
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Task filters</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form id="workspace-filter-form" onSubmit={apply}>
            <FieldGroup className="gap-4">
              <FieldGroup className="grid gap-3 sm:grid-cols-2">
                <FilterSelect
                  label="Type"
                  disabled={!global}
                  value={global ? (draft.get("kind") ?? "all") : "task"}
                  onChange={(value) => {
                    set("kind", value === "all" ? "" : value);
                    if (value === "reminder") {
                      for (const key of [
                        "list",
                        "project",
                        "reserved",
                        "scheduledAfter",
                        "scheduledBefore",
                        "tag",
                      ])
                        set(key, "");
                    }
                  }}
                  options={[
                    ["all", "Tasks & reminders"],
                    ["task", "Tasks"],
                    ["reminder", "Reminders"],
                  ]}
                />
                <FilterSelect
                  label="Show"
                  value={
                    draft.get("status") ??
                    (history || params.get("view") === "trash" ? "all" : "open")
                  }
                  onChange={(value) => set("status", value)}
                  options={
                    history
                      ? [
                          ["all", "All history"],
                          ["completed", "Completed"],
                          ["cancelled", "Cancelled tasks"],
                          ["archived", "Archived context"],
                        ]
                      : [
                          ["open", "Open"],
                          ["all", "All statuses"],
                          ["completed", "Completed"],
                          ["cancelled", "Cancelled tasks"],
                        ]
                  }
                />
                <FilterSelect
                  label="Deadline"
                  value={deadline}
                  onChange={(value) => {
                    if (value === "custom") {
                      setCustom(true);
                      setAdvanced(true);
                      set("due", "");
                      return;
                    }
                    setCustom(false);
                    const special = ["none", "overdue", "dated"].includes(value);
                    set("due", special ? value : "");
                    const range = presetBounds(
                      special ? "any" : (value as Exclude<DatePreset, "custom">),
                      timeZone,
                    );
                    set("dueAfter", range.after);
                    set("dueBefore", range.before);
                  }}
                  options={[
                    ["any", "Any deadline"],
                    ["overdue", "Overdue"],
                    ["none", "No deadline"],
                    ["dated", "Has a deadline"],
                    ...datePresets
                      .filter((preset) => preset.value !== "any")
                      .map(({ value, label }) => [value, label] as const),
                  ]}
                />
                <FilterSelect
                  label="Reserved time"
                  disabled={draft.get("kind") === "reminder"}
                  value={draft.get("reserved") ?? "any"}
                  onChange={(value) => {
                    set("reserved", value === "any" ? "" : value);
                    if (value !== "scheduled") {
                      set("scheduledAfter", "");
                      set("scheduledBefore", "");
                    }
                  }}
                  options={[
                    ["any", "Any"],
                    ["scheduled", "Has reserved time"],
                    ["none", "Not reserved"],
                  ]}
                />
                <FilterSelect
                  label="Priority"
                  value={draft.get("priority") ?? "any"}
                  onChange={(value) => set("priority", value === "any" ? "" : value)}
                  options={[
                    ["any", "Any priority"],
                    ["high", "High"],
                    ["medium", "Medium"],
                    ["low", "Low"],
                  ]}
                />
                <Field data-disabled={draft.get("kind") === "reminder"}>
                  <FieldLabel htmlFor="workspace-tag">Tag</FieldLabel>
                  <Input
                    id="workspace-tag"
                    disabled={draft.get("kind") === "reminder"}
                    placeholder="e.g. errands"
                    value={draft.get("tag") ?? ""}
                    onChange={(event) => set("tag", event.target.value)}
                  />
                </Field>
                {global ? (
                  <>
                    <FilterSelect
                      label="List"
                      value={draft.get("list") ?? "any"}
                      disabled={draft.get("kind") === "reminder"}
                      onChange={(value) => {
                        set("list", value === "any" ? "" : value);
                        set("project", "");
                      }}
                      options={[
                        ["any", "Any list"],
                        ...lists.map((list) => [list.id, list.name] as const),
                      ]}
                    />
                    <FilterSelect
                      label="Project"
                      value={draft.get("project") ?? "any"}
                      disabled={draft.get("kind") === "reminder"}
                      onChange={(value) => set("project", value === "any" ? "" : value)}
                      options={[
                        ["any", "Any project"],
                        ...projects
                          .filter(
                            (project) => !draft.get("list") || project.listId === draft.get("list"),
                          )
                          .map((project) => [project.id, project.name] as const),
                      ]}
                    />
                  </>
                ) : null}
              </FieldGroup>
              <Collapsible open={advanced} onOpenChange={setAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button type="button" size="sm" variant="ghost">
                    <ChevronRightIcon aria-hidden="true" data-icon="inline-start" />
                    Advanced
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <FieldGroup className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        ["dueAfter", "Deadline after"],
                        ["dueBefore", "Deadline before"],
                        ["scheduledAfter", "Reserved after"],
                        ["scheduledBefore", "Reserved before"],
                      ] as const
                    ).map(([key, label]) => (
                      <Field key={key}>
                        <FieldLabel htmlFor={`workspace-${key}`}>{label}</FieldLabel>
                        <Input
                          id={`workspace-${key}`}
                          type="datetime-local"
                          disabled={key.startsWith("scheduled") && draft.get("kind") === "reminder"}
                          value={toDateTimeLocal(draft.get(key), timeZone)}
                          onChange={(event) => {
                            set(
                              key,
                              event.target.value
                                ? dateTimeLocalToIso(event.target.value, timeZone)
                                : "",
                            );
                            if (key.startsWith("due")) set("due", "");
                            else set("reserved", "scheduled");
                          }}
                        />
                      </Field>
                    ))}
                  </FieldGroup>
                  <FieldDescription className="mt-3">Times use {timeZone}.</FieldDescription>
                </CollapsibleContent>
              </Collapsible>
              {error ? (
                <FieldDescription role="alert" className="text-destructive">
                  {error}
                </FieldDescription>
              ) : null}
            </FieldGroup>
          </form>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button type="submit" form="workspace-filter-form" size="sm">
            Apply filters
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const next = new URLSearchParams(params);
              for (const key of workspaceFilterKeys) next.delete(key);
              if (global) {
                next.delete("list");
                next.delete("project");
              }
              next.delete("task");
              next.delete("reminder");
              navigate(workspacePath(next));
              setOpen(false);
            }}
          >
            Clear
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function WorkspaceFilterChips({
  params,
  timeZone,
  lists,
  projects,
}: {
  params: URLSearchParams;
  timeZone: string;
  lists: TaskList[];
  projects: TaskProject[];
}) {
  const navigate = useNavigate();
  const labels: Record<string, string> = {
    kind: "Type",
    status: "Status",
    priority: "Priority",
    tag: "Tag",
    due: "Deadline",
    reserved: "Reserved",
  };
  const values: Record<string, string> = {
    task: "Tasks",
    reminder: "Reminders",
    none: "None",
    overdue: "Overdue",
    dated: "Has date",
    scheduled: "Has time",
  };
  const chips: { key: string; keys: string[]; label: string }[] = [];
  for (const key of workspaceFilterKeys.filter(
    (key) => !key.endsWith("After") && !key.endsWith("Before"),
  )) {
    const value = params.get(key);
    if (value) chips.push({ key, keys: [key], label: `${labels[key]}: ${values[value] ?? value}` });
  }
  for (const [prefix, label] of [
    ["due", "Deadline"],
    ["scheduled", "Reserved"],
  ]) {
    const after = params.get(`${prefix}After`) ?? "";
    const before = params.get(`${prefix}Before`) ?? "";
    if (!after && !before) continue;
    const preset = identifyPreset({ after, before }, timeZone);
    const summary =
      preset !== "custom"
        ? datePresets.find(({ value }) => value === preset)?.label
        : [
            after
              ? `from ${Number.isFinite(Date.parse(after)) ? formatMaterialDateTime(after, timeZone) : "invalid date"}`
              : "",
            before
              ? `until ${Number.isFinite(Date.parse(before)) ? formatMaterialDateTime(before, timeZone) : "invalid date"}`
              : "",
          ]
            .filter(Boolean)
            .join(" ");
    chips.push({
      key: `${prefix}-range`,
      keys: [`${prefix}After`, `${prefix}Before`],
      label: `${label}: ${summary}`,
    });
  }
  if (params.get("view"))
    for (const [key, records] of [
      ["list", lists],
      ["project", projects],
    ] as const) {
      const id = params.get(key);
      if (id)
        chips.push({
          key,
          keys: [key, ...(key === "list" ? ["project"] : [])],
          label: records.find((record) => record.id === id)?.name ?? key,
        });
    }
  if (!chips.length) return null;
  return (
    <fieldset aria-label="Active task filters" className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <Button
          key={chip.key}
          size="xs"
          variant="secondary"
          aria-label={`Remove ${chip.label}`}
          onClick={() => {
            const next = new URLSearchParams(params);
            for (const key of chip.keys) next.delete(key);
            navigate(workspacePath(next));
          }}
        >
          <span className="max-w-64 truncate">{chip.label}</span>
          <XIcon aria-hidden="true" data-icon="inline-end" />
        </Button>
      ))}
    </fieldset>
  );
}
