import type { TaskWorkspaceItem, TaskWorkspaceQuery } from "@personal-os/domain";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Modal, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { FloatingAdd } from "../../components/floating-add";
import { SheetHeader } from "../../components/sheet-header";
import { useWorkspaceHeaderInset } from "../../components/workspace-header-inset";
import { entityDictionary } from "../../product/entities";
import { spacing, useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { ActiveFilters } from "./active-filters";
import { projectAcceptsNewWork } from "./container-directory";
import {
  actWithUndo,
  errorMessage,
  type ItemAction,
  isOpen,
  itemKey,
  uniqueItems,
  useTaskAction,
  useTaskApi,
  useTaskResources,
  useTaskSearch,
} from "./data";
import { DateField } from "./date-field";
import {
  type DateShortcut,
  dateShortcuts,
  identifyShortcut,
  shortcutBounds,
} from "./date-shortcuts";
import { listOption } from "./list-presentation";
import { viewStatus } from "./navigation-counts";
import { OptionsMenu } from "./options-menu";
import { formatTargetDate, itemCount } from "./presentation";
import { SearchableChoice } from "./searchable-choice";
import { TaskRow } from "./task-row";
import {
  Action,
  Choice,
  confirm,
  Field,
  FormBody,
  Heading,
  SearchField,
  Section,
  State,
  styles,
} from "./ui";
import { buildViewOptions } from "./view-options";

export function TaskListScreen({
  title,
  scope,
  standalone = false,
  initialFilters = {},
}: {
  title: string;
  scope: Partial<TaskWorkspaceQuery>;
  standalone?: boolean;
  initialFilters?: Partial<TaskWorkspaceQuery>;
}) {
  const t = useTheme();
  const headerInset = useWorkspaceHeaderInset();
  const api = useTaskApi();
  const { state } = useAuth();
  const timeZone = state.user?.planningTimezone ?? "UTC";
  const resources = useTaskResources();
  const { search, setSearch } = useTaskSearch();
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const [filters, setFilters] = useState<Partial<TaskWorkspaceQuery>>(initialFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const action = useTaskAction();
  const preferences = resources.settings.data?.preferences;
  const lifecycleView = scope.view === "history" || scope.view === "trash";
  // "Include archived in search" widens a search to finished items, and to items in archived
  // Lists and archived or finished Projects, unless the destination or the person has already chosen a status.
  const widenSearch =
    !!debounced &&
    !!preferences?.includeArchivedInSearch &&
    !lifecycleView &&
    !scope.status &&
    !filters.status;
  const query = {
    ...scope,
    sort: scope.sort ?? preferences?.taskSort ?? "default",
    group: scope.group ?? preferences?.taskGroup ?? "none",
    status:
      scope.status ??
      (widenSearch ? ("all" as const) : viewStatus(scope, preferences?.showCompletedTasks)),
    ...filters,
    // Lists and projects only hold tasks; narrowing by one never returns reminders.
    ...(filters.listId || filters.projectId ? { kind: "task" as const } : {}),
    ...(debounced ? { query: debounced } : {}),
  };
  // A list or project browser keeps its own scope, and reminders have no container.
  const containerFilters = !scope.listId && !scope.projectId && scope.kind !== "reminder";
  const listChoices = (resources.lists.data ?? []).filter(
    (row) => !row.deletedAt && row.availability === "active",
  );
  const projectChoices = (resources.projects.data ?? []).filter(
    (row) =>
      !row.deletedAt &&
      row.availability === "active" &&
      listChoices.some((list) => list.id === row.listId) &&
      (!filters.listId || row.listId === filters.listId),
  );
  // Choices are offered only once both reads have answered, never from a partial directory.
  const containersReady = !!resources.lists.data && !!resources.projects.data;
  const directoryError = resources.lists.isError || resources.projects.isError;
  const containersFailed = !containersReady && directoryError;
  // A refresh that fails over a directory already read keeps those choices usable and offers
  // the retry; the query cache reports each failed read as one Sonner error.
  // A selection that is no longer offered stays in its row, named as its chip names it.
  // The row and its chip name a selection from this one place: the record's name when the
  // directory has it (archived and trashed included), otherwise "Unavailable".
  const selectedList = resources.lists.data?.find((row) => row.id === filters.listId);
  const selectedProject = resources.projects.data?.find((row) => row.id === filters.projectId);
  const selectedNames = {
    listId: filters.listId ? (selectedList?.name ?? "Unavailable") : undefined,
    projectId: filters.projectId ? (selectedProject?.name ?? "Unavailable") : undefined,
  };
  // A selection that is not on offer, or cannot be read, still appears as the row's value.
  const currentChoice = (key: "listId" | "projectId", offered: { id: string }[]) => {
    const value = filters[key];
    const label = selectedNames[key];
    return value && label && !offered.some((row) => row.id === value)
      ? [{ value, label, plain: true }]
      : [];
  };
  const anyContainer = (label: string) => ({
    value: "",
    label: containersFailed ? "Unavailable" : label,
    plain: true,
  });
  const dueShortcut = identifyShortcut(
    { after: filters.dueAfter, before: filters.dueBefore },
    timeZone,
  );
  const menuChoices = buildViewOptions(query, scope);
  const scopedProject = resources.projects.data?.find((row) => row.id === scope.projectId);
  const scopedList = resources.lists.data?.find((row) => row.id === scopedProject?.listId);
  // Until the project and its list are known, capture stays hidden rather than offered wrongly.
  const closedProject =
    !!scope.projectId &&
    !(scopedProject && scopedList && projectAcceptsNewWork(scopedProject, scopedList));
  const identity = JSON.stringify(query);
  // biome-ignore lint/correctness/useExhaustiveDependencies: selection belongs to this exact query scope.
  useEffect(() => {
    setSelected([]);
  }, [identity]);
  const page = useInfiniteQuery({
    queryKey: ["tasks", "workspace", query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listTaskWorkspace({ ...query, cursor: pageParam, limit: 30 }),
    refetchInterval: query.sort === "auto" ? 60_000 : false,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  // Outside a list or project the server leaves archived containers out of every status but
  // Archived, so a widened search reads them separately and lists them after the other matches.
  const searchArchived =
    widenSearch && !query.listId && !query.projectId && query.kind !== "reminder";
  const archivedQuery = { ...query, status: "archived" as const };
  const archivedPage = useInfiniteQuery({
    queryKey: ["tasks", "workspace", archivedQuery],
    enabled: searchArchived,
    // Reported below, so two failed reads of one search raise one Sonner error, not two.
    meta: { scopedReadFeedback: true },
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.listTaskWorkspace({ ...archivedQuery, cursor: pageParam, limit: 30 }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const archivedFailed = searchArchived && archivedPage.isError;
  // Seeded from the cache so a remount does not report a failure that was already reported.
  const reportedArchivedError = useRef(archivedPage.errorUpdatedAt);
  const { errorUpdatedAt: archivedErrorAt, error: archivedError } = archivedPage;
  const mainSettled = !page.isFetching;
  const mainFailed = page.isError;
  useEffect(() => {
    // Once the main read settles: its own failure already raised the error for this search.
    if (!archivedFailed || !mainSettled || reportedArchivedError.current === archivedErrorAt)
      return;
    reportedArchivedError.current = archivedErrorAt;
    if (!mainFailed) toast.error(errorMessage(archivedError));
  }, [archivedFailed, mainSettled, mainFailed, archivedErrorAt, archivedError]);
  const matches = uniqueItems(page.data?.pages.flatMap((result) => result.items) ?? []);
  // Archived matches follow the complete set of other matches, never interleave with a page.
  const archivedMatches =
    searchArchived && page.data && !page.hasNextPage
      ? uniqueItems(archivedPage.data?.pages.flatMap((result) => result.items) ?? []).filter(
          (item) => !matches.some((match) => itemKey(match) === itemKey(item)),
        )
      : [];
  const items = [...matches, ...archivedMatches];
  const archivedStart = archivedMatches.length ? matches.length : -1;
  const total =
    page.data && (!searchArchived || archivedPage.data || archivedFailed)
      ? page.data.pages[0].total + (searchArchived ? (archivedPage.data?.pages[0].total ?? 0) : 0)
      : null;
  const more = page.hasNextPage
    ? page
    : searchArchived && archivedPage.hasNextPage
      ? archivedPage
      : null;
  const listNames = new Map((resources.lists.data ?? []).map((row) => [row.id, row.name]));
  const projectNames = new Map((resources.projects.data ?? []).map((row) => [row.id, row.name]));
  const without = (current: Partial<TaskWorkspaceQuery>, keys: (keyof TaskWorkspaceQuery)[]) => {
    const next = { ...current };
    for (const key of keys) delete next[key];
    return next;
  };
  const updateFilter = (key: keyof TaskWorkspaceQuery, value: string) =>
    setFilters((current) => ({
      // A due state such as Overdue or No due date replaces a due-date range, and a range
      // picked by hand replaces a due state, as on the web.
      ...(key === "due" && value && value !== "any"
        ? without(current, ["dueAfter", "dueBefore"])
        : (key === "dueAfter" || key === "dueBefore") && value
          ? without(current, ["due"])
          : current),
      [key]: value || undefined,
    }));
  const chooseContainer = (key: "listId" | "projectId", value: string) =>
    setFilters((current) => ({
      // A project from another list is dropped, one in the chosen list stays; a container
      // makes the Type filter moot.
      ...without(current, [
        key,
        ...(key === "listId" && !(value && selectedProject?.listId === value)
          ? (["projectId"] as const)
          : []),
        ...(value ? (["kind"] as const) : []),
      ]),
      ...(value ? { [key]: value } : {}),
    }));
  const chooseDueShortcut = (shortcut: DateShortcut) => {
    const { after, before } = shortcutBounds(shortcut, timeZone);
    setFilters((current) => ({
      // A shortcut is a whole-day range; it replaces a due state it would contradict.
      ...without(current, [
        "dueAfter",
        "dueBefore",
        ...(shortcut === "any" ? [] : (["due"] as const)),
      ]),
      ...(after && before ? { dueAfter: after, dueBefore: before } : {}),
    }));
  };
  const edit = (item: TaskWorkspaceItem) =>
    router.push({
      pathname: "/task-editor",
      params: {
        id: item.record.id,
        kind: item.kind,
        readOnly: item.readOnly ? "1" : "0",
        deleted: item.deletedAt ? "1" : "0",
      },
    });
  const perform = (records: TaskWorkspaceItem[], operation: ItemAction) => {
    const outcome = {
      complete: "completed",
      reopen: "reopened",
      cancel: "cancelled",
      trash: "moved to Trash",
      restore: "restored",
    }[operation];
    const execute = () =>
      void action.run(
        "Updating…",
        async () => {
          const failed: string[] = [];
          const receipts: Awaited<ReturnType<typeof actWithUndo>>[] = [];
          for (const item of records) {
            try {
              receipts.push(await actWithUndo(api, item, operation));
            } catch {
              failed.push(itemKey(item));
            }
          }
          if (!receipts.length) throw new Error("No updates confirmed");
          return { failed, receipts };
        },
        ({ failed }) => setSelected(failed),
        undefined,
        ({ failed }) => ({
          message: failed.length
            ? `${records.length - failed.length} ${outcome}; ${failed.length} not confirmed. Refresh before retrying.`
            : `${records.length} ${outcome}`,
          error: failed.length > 0,
        }),
        async ({ receipts }) => {
          const results = await Promise.allSettled(receipts.map((receipt) => receipt.undo()));
          if (results.some((result) => result.status === "rejected"))
            throw new Error("Undo not confirmed");
        },
      );
    if (operation === "trash")
      confirm(
        "Move to Trash?",
        `${records.length} item${records.length === 1 ? "" : "s"}. You can restore them from Trash.`,
        execute,
        true,
      );
    else execute();
  };
  // The selection is what is still listed: a refresh that drops a row drops it from the count
  // and the actions together.
  const selectedItems = items.filter((item) => selected.includes(itemKey(item)));
  // Select all takes the loaded items that can change, up to the selection limit of 100; a
  // read-only item would block each action.
  const selectable = items
    .filter((item) => !item.readOnly)
    .slice(0, 100)
    .map(itemKey);
  const allSelected =
    selectedItems.length === selectable.length && selectable.every((key) => selected.includes(key));
  const canAct = selectedItems.length > 0 && selectedItems.every((item) => !item.readOnly);
  return (
    <View style={{ flex: 1, backgroundColor: t.canvas }}>
      <FlatList
        data={items}
        keyExtractor={itemKey}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentInsetAdjustmentBehavior={headerInset ? "never" : "automatic"}
        scrollIndicatorInsets={{ top: headerInset }}
        contentContainerStyle={{
          paddingHorizontal: spacing.page,
          paddingTop: headerInset + spacing.page,
          paddingBottom: 100,
        }}
        refreshControl={
          <RefreshControl
            refreshing={page.isRefetching || (searchArchived && archivedPage.isRefetching)}
            onRefresh={() => {
              void page.refetch();
              if (searchArchived) void archivedPage.refetch();
            }}
            tintColor={t.ink}
          />
        }
        ListHeaderComponent={
          <View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "space-between",
                marginBottom: spacing.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Heading
                  compact
                  icon={
                    scope.projectId
                      ? entityDictionary.project.icon
                      : scope.listId
                        ? entityDictionary.list.icon
                        : undefined
                  }
                >
                  {title}
                </Heading>
              </View>
              <View>
                <OptionsMenu
                  choices={menuChoices}
                  onChange={updateFilter}
                  onAdvanced={() => setShowFilters(true)}
                  onReset={() => {
                    setFilters(initialFilters);
                    setSearch("");
                  }}
                />
              </View>
            </View>
            {scopedProject && (scopedProject.why || scopedProject.targetDate) && (
              <View style={{ gap: spacing.xs, marginBottom: spacing.md }}>
                {!!scopedProject.why && (
                  <Text numberOfLines={3} style={{ color: t.secondary, fontSize: 15 }}>
                    {scopedProject.why}
                  </Text>
                )}
                {!!scopedProject.targetDate && (
                  <Text style={{ color: t.secondary, fontSize: 13 }}>
                    Target {formatTargetDate(scopedProject.targetDate)}
                  </Text>
                )}
              </View>
            )}
            <ActiveFilters
              filters={filters}
              choices={menuChoices}
              search={search}
              names={selectedNames}
              onRemove={(keys) => setFilters((current) => without(current, keys))}
              onClearSearch={() => setSearch("")}
              onClear={() => {
                setFilters({});
                setSearch("");
              }}
            />
            {standalone && (
              <SearchField
                accessibilityLabel="Search tasks"
                placeholder="Plan meals"
                placeholderTextColor={t.secondary}
                value={search}
                onChangeText={setSearch}
              />
            )}
            <View style={[styles.toolbar, { marginBottom: spacing.md }]}>
              <Text style={{ color: t.secondary, marginRight: "auto" }}>
                {total === null ? "" : itemCount(total)}
                {` · ${menuChoices.find((choice) => choice.key === "sort")?.options.find((option) => option.value === query.sort)?.label ?? "Recommended"}`}
                {query.group && query.group !== "none" ? ` · Grouped by ${query.group}` : ""}
              </Text>
            </View>
            {selectedItems.length > 0 && (
              <Section>
                <View style={styles.toolbar}>
                  <Text style={{ color: t.ink, padding: 12 }}>{selectedItems.length} selected</Text>
                  <Action label="Cancel" onPress={() => setSelected([])} />
                  {selectable.length > 0 && !allSelected && (
                    <Action
                      label="Select all"
                      disabled={action.pending}
                      onPress={() => setSelected(selectable)}
                    />
                  )}
                  {canAct && (
                    <>
                      {selectedItems.every((item) => !item.deletedAt && isOpen(item)) && (
                        <Action
                          label="Complete"
                          disabled={action.pending}
                          onPress={() => perform(selectedItems, "complete")}
                        />
                      )}
                      {selectedItems.every((item) => !item.deletedAt && !isOpen(item)) && (
                        <Action
                          label="Reopen"
                          disabled={action.pending}
                          onPress={() => perform(selectedItems, "reopen")}
                        />
                      )}
                      {selectedItems.every((item) => !!item.deletedAt) ? (
                        <Action
                          label="Restore"
                          disabled={action.pending}
                          onPress={() => perform(selectedItems, "restore")}
                        />
                      ) : (
                        selectedItems.every((item) => !item.deletedAt) && (
                          <Action
                            label="Trash"
                            destructive
                            disabled={action.pending}
                            onPress={() => perform(selectedItems, "trash")}
                          />
                        )
                      )}
                    </>
                  )}
                </View>
              </Section>
            )}
          </View>
        }
        ListEmptyComponent={
          <State
            loading={page.isPending || (searchArchived && archivedPage.isPending)}
            retry={
              page.isError || archivedFailed
                ? () => {
                    if (page.isError) void page.refetch();
                    if (archivedFailed) void archivedPage.refetch();
                  }
                : undefined
            }
            empty={
              debounced || Object.keys(filters).length
                ? "No matches. Adjust your filters or search."
                : "You’re all caught up here."
            }
          />
        }
        renderItem={({ item, index }) => {
          const marked = selected.includes(itemKey(item));
          const done = !isOpen(item);
          const groupTitle =
            query.group === "list"
              ? resources.lists.data?.find((list) => list.id === item.groupKey)?.name
              : query.group === "project"
                ? resources.projects.data?.find((project) => project.id === item.groupKey)?.name
                : item.groupKey;
          const toggle = () =>
            setSelected((keys) =>
              keys.includes(itemKey(item))
                ? keys.filter((key) => key !== itemKey(item))
                : keys.length < 100
                  ? [...keys, itemKey(item)]
                  : keys,
            );
          // A group or the archived section starts a new rounded block of rows.
          const starts = (at: number) =>
            at === 0 ||
            at === archivedStart ||
            (query.group !== "none" && items[at - 1].groupKey !== items[at].groupKey);
          const task = item.kind === "task" ? item.record : null;
          return (
            <View>
              {index === archivedStart && (
                <Text
                  accessibilityRole="header"
                  style={{ color: t.secondary, marginTop: 16, marginBottom: 8 }}
                >
                  In archived or finished lists and projects
                </Text>
              )}
              {query.group !== "none" && starts(index) && (
                <Text
                  accessibilityRole="header"
                  style={{ color: t.secondary, marginTop: 16, marginBottom: 8 }}
                >
                  {groupTitle === "none" || !groupTitle ? "Ungrouped" : groupTitle}
                </Text>
              )}
              <TaskRow
                item={item}
                details={preferences?.taskRowDetails}
                list={task && !query.listId ? listNames.get(task.listId) : undefined}
                project={
                  task?.projectId && !query.projectId ? projectNames.get(task.projectId) : undefined
                }
                marked={marked}
                selecting={selectedItems.length > 0}
                pending={action.pending}
                first={starts(index)}
                last={index === items.length - 1 || starts(index + 1)}
                onSelect={toggle}
                onOpen={() => edit(item)}
                onComplete={() => perform([item], done ? "reopen" : "complete")}
              />
            </View>
          );
        }}
        ListFooterComponent={
          // Ordinary matches page first; a failed archived read never hides their Load more.
          more && (page.hasNextPage || !archivedFailed) ? (
            <Action
              label={more.isFetchingNextPage ? "Loading…" : "Load more"}
              disabled={more.isFetchingNextPage}
              onPress={() => void more.fetchNextPage()}
            />
          ) : archivedFailed && items.length > 0 ? (
            // Other matches are showing, so the unread archived matches get their own retry.
            <Action
              label="Retry loading archived matches"
              disabled={archivedPage.isFetching}
              onPress={() => void archivedPage.refetch()}
            />
          ) : undefined
        }
      />
      <Modal
        visible={showFilters}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFilters(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
          <SheetHeader
            title="Filters"
            label="Done"
            dismiss="trailing"
            onClose={() => setShowFilters(false)}
          />
          <FormBody>
            <Section title="Match items">
              {menuChoices
                .filter((choice) => choice.section === "filter")
                .map((choice) => (
                  <Choice
                    key={choice.key}
                    label={choice.label}
                    value={choice.value}
                    options={choice.options}
                    onChange={(value) => updateFilter(choice.key, value)}
                  />
                ))}
              {containerFilters && (
                <>
                  <SearchableChoice
                    entity="list"
                    label="List"
                    disabled={!containersReady || query.kind === "reminder"}
                    value={filters.listId ?? ""}
                    options={[
                      anyContainer("Any list"),
                      ...listChoices.map(listOption),
                      ...currentChoice("listId", listChoices),
                    ]}
                    onChange={(value) => chooseContainer("listId", value)}
                  />
                  <SearchableChoice
                    entity="project"
                    label="Project"
                    disabled={!containersReady || query.kind === "reminder"}
                    value={filters.projectId ?? ""}
                    options={[
                      anyContainer("Any project"),
                      ...projectChoices.map((row) => ({ value: row.id, label: row.name })),
                      ...currentChoice("projectId", projectChoices),
                    ]}
                    onChange={(value) => chooseContainer("projectId", value)}
                  />
                  {directoryError && (
                    <Action
                      label="Retry loading lists and projects"
                      onPress={() => {
                        if (resources.lists.isError) void resources.lists.refetch();
                        if (resources.projects.isError) void resources.projects.refetch();
                      }}
                    />
                  )}
                </>
              )}
            </Section>
            <Section title="Dates & tags">
              <Field
                label="Tag"
                placeholder="errands"
                value={filters.tag ?? ""}
                onChangeText={(value) => updateFilter("tag", value.trim())}
                autoCapitalize="none"
              />
              <Choice
                label="Due within"
                value={dueShortcut}
                options={[
                  ...dateShortcuts,
                  ...(dueShortcut === "custom" ? [{ value: "custom", label: "Custom range" }] : []),
                ]}
                onChange={(value) => {
                  if (value !== "custom") chooseDueShortcut(value as DateShortcut);
                }}
              />
              <DateField
                label="Due after"
                value={filters.dueAfter ?? null}
                onChange={(value) => updateFilter("dueAfter", value ?? "")}
              />
              <DateField
                label="Due before"
                value={filters.dueBefore ?? null}
                onChange={(value) => updateFilter("dueBefore", value ?? "")}
              />
              <DateField
                label="Reserved after"
                value={filters.scheduledAfter ?? null}
                onChange={(value) => updateFilter("scheduledAfter", value ?? "")}
              />
              <DateField
                label="Reserved before"
                value={filters.scheduledBefore ?? null}
                onChange={(value) => updateFilter("scheduledBefore", value ?? "")}
              />
              <Action
                label="Reset filters"
                onPress={() =>
                  setFilters((current) => ({ sort: current.sort, group: current.group }))
                }
              />
            </Section>
            {query.sort !== "auto" && (
              <Section title="View preferences">
                <Action
                  disabled={!resources.settings.data || action.pending}
                  label="Save sort and grouping as defaults"
                  onPress={() => {
                    const sort = query.sort;
                    if (sort === "auto") return;
                    void action.run("Saving preferences…", () =>
                      api.updateWorkspaceSettings("tasks", {
                        expectedRevision: resources.settings.data?.revision ?? 0,
                        preferences: { taskSort: sort, taskGroup: query.group },
                      }),
                    );
                  }}
                />
              </Section>
            )}
          </FormBody>
        </SafeAreaView>
      </Modal>
      {standalone && scope.view !== "history" && scope.view !== "trash" && !closedProject && (
        <FloatingAdd
          label={scope.kind === "reminder" ? "Add reminder" : "Add task"}
          onPress={() =>
            router.push({
              pathname: "/task-editor",
              params: {
                kind: scope.kind === "reminder" ? "reminder" : "task",
                listId: scope.listId,
                projectId: scope.projectId,
              },
            })
          }
        />
      )}
    </View>
  );
}
