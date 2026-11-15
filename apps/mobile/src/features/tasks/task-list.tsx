import type { TaskWorkspaceItem, TaskWorkspaceQuery } from "@personal-os/domain";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Modal, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { OptionsMenu } from "./options-menu";
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
  const query = {
    ...scope,
    sort: scope.sort ?? resources.settings.data?.preferences.taskSort ?? "default",
    group: scope.group ?? resources.settings.data?.preferences.taskGroup ?? "none",
    status:
      scope.status ??
      (resources.settings.data?.preferences.showCompletedTasks &&
      scope.view !== "history" &&
      scope.view !== "trash"
        ? "open_and_completed"
        : undefined),
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
  const items = uniqueItems(page.data?.pages.flatMap((result) => result.items) ?? []);
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
  const selectedItems = items.filter((item) => selected.includes(itemKey(item)));
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
            refreshing={page.isRefetching}
            onRefresh={() => void page.refetch()}
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
                {page.data ? `${page.data.pages[0].total} items` : ""}
                {` · ${menuChoices.find((choice) => choice.key === "sort")?.options.find((option) => option.value === query.sort)?.label ?? "Recommended"}`}
                {query.group && query.group !== "none" ? ` · Grouped by ${query.group}` : ""}
              </Text>
            </View>
            {selected.length > 0 && (
              <Section>
                <View style={styles.toolbar}>
                  <Text style={{ color: t.ink, padding: 12 }}>{selected.length} selected</Text>
                  <Action label="Cancel" onPress={() => setSelected([])} />
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
            loading={page.isPending}
            retry={page.isError ? () => void page.refetch() : undefined}
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
          return (
            <View>
              {query.group !== "none" &&
                (index === 0 || items[index - 1].groupKey !== item.groupKey) && (
                  <Text
                    accessibilityRole="header"
                    style={{ color: t.secondary, marginTop: 16, marginBottom: 8 }}
                  >
                    {groupTitle === "none" || !groupTitle ? "Ungrouped" : groupTitle}
                  </Text>
                )}
              <TaskRow
                item={item}
                marked={marked}
                selecting={selected.length > 0}
                pending={action.pending}
                first={
                  index === 0 ||
                  (query.group !== "none" && items[index - 1].groupKey !== item.groupKey)
                }
                last={
                  index === items.length - 1 ||
                  (query.group !== "none" && items[index + 1].groupKey !== item.groupKey)
                }
                onSelect={toggle}
                onOpen={() => edit(item)}
                onComplete={() => perform([item], done ? "reopen" : "complete")}
              />
            </View>
          );
        }}
        ListFooterComponent={
          page.hasNextPage ? (
            <Action
              label={page.isFetchingNextPage ? "Loading…" : "Load more"}
              disabled={page.isFetchingNextPage}
              onPress={() => void page.fetchNextPage()}
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
