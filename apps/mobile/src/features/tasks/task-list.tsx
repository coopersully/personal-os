import type { TaskWorkspaceItem, TaskWorkspaceQuery } from "@personal-os/domain";
import { useInfiniteQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { spacing, useTheme, workspaceColor } from "../../theme";
import {
  actOnItem,
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
import { OptionsMenu, type OptionsMenuProps } from "./options-menu";
import { Action, confirm, groupEdges, Heading, SearchField, Section, State, styles } from "./ui";

export function TaskListScreen({
  title,
  scope,
  standalone = false,
}: {
  title: string;
  scope: Partial<TaskWorkspaceQuery>;
  standalone?: boolean;
}) {
  const t = useTheme();
  const api = useTaskApi();
  const resources = useTaskResources();
  const { search, setSearch } = useTaskSearch();
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const [filters, setFilters] = useState<Partial<TaskWorkspaceQuery>>({});
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
    ...(debounced ? { query: debounced } : {}),
  };
  const options = (values: string[]) =>
    values.map((value) => ({
      value,
      label: value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
    }));
  const menuChoices: OptionsMenuProps["choices"] = [
    ...(!scope.listId && !scope.projectId
      ? [
          {
            key: "kind" as const,
            label: "Type",
            value: query.kind ?? "all",
            section: "filter" as const,
            options: [
              { value: "all", label: "Tasks & reminders" },
              { value: "task", label: "Tasks" },
              { value: "reminder", label: "Reminders" },
            ],
          },
        ]
      : []),
    {
      key: "status",
      label: "Status",
      value: query.status ?? "",
      section: "filter",
      options: [
        { value: "", label: "View default" },
        ...options(["all", "open", "open_and_completed", "completed", "cancelled", "archived"]),
      ],
    },
    {
      key: "priority",
      label: "Priority",
      value: query.priority ?? "",
      section: "filter",
      options: [{ value: "", label: "Any" }, ...options(["high", "medium", "low"])],
    },
    {
      key: "due",
      label: "Due",
      value: query.due ?? "any",
      section: "filter",
      options: options(["any", "overdue", "dated", "none"]),
    },
    {
      key: "reserved",
      label: "Reserved time",
      value: query.reserved ?? "any",
      section: "filter",
      options: options(["any", "scheduled", "none"]),
    },
    {
      key: "sort",
      label: "Sort by",
      value: query.sort,
      section: "presentation",
      options: options([
        "default",
        "date",
        "reserved",
        "priority",
        "newest",
        "oldest",
        "title",
        "estimate",
      ]),
    },
    {
      key: "group",
      label: "Group by",
      value: query.group,
      section: "presentation",
      options: options(["none", "date", "list", "project"]),
    },
  ];
  const identity = JSON.stringify(query);
  // biome-ignore lint/correctness/useExhaustiveDependencies: selection belongs to this exact query scope.
  useEffect(() => {
    setSelected([]);
  }, [identity]);
  const page = useInfiniteQuery({
    queryKey: ["tasks", "workspace", query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listTaskWorkspace({ ...query, cursor: pageParam, limit: 30 }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = uniqueItems(page.data?.pages.flatMap((result) => result.items) ?? []);
  const updateFilter = (key: keyof TaskWorkspaceQuery, value: string) =>
    setFilters((current) => ({ ...current, [key]: value || undefined }));
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
    const execute = () =>
      void action.run(
        "Updating…",
        async () => {
          const failed: string[] = [];
          for (const item of records) {
            try {
              await actOnItem(api, item, operation);
            } catch {
              failed.push(itemKey(item));
            }
          }
          return failed;
        },
        setSelected,
        undefined,
        (failed) => ({
          message: failed.length
            ? `${records.length - failed.length} updated; ${failed.length} not confirmed. Refresh before retrying.`
            : `${records.length} updated`,
          error: failed.length > 0,
        }),
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
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: spacing.page,
          paddingTop: spacing.page,
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
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: spacing.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Heading>{title}</Heading>
              </View>
              <View style={{ marginBottom: spacing.lg }}>
                <OptionsMenu
                  choices={menuChoices}
                  onChange={updateFilter}
                  onAdvanced={() => setShowFilters(true)}
                  onReset={() => {
                    setFilters({});
                    setSearch("");
                  }}
                />
              </View>
            </View>
            {standalone && (
              <SearchField
                accessibilityLabel="Search tasks"
                placeholder="Search tasks and reminders"
                placeholderTextColor={t.secondary}
                value={search}
                onChangeText={setSearch}
              />
            )}
            <View style={styles.toolbar}>
              <Text style={{ color: t.secondary, marginRight: "auto" }}>
                {page.data ? `${page.data.pages[0].total} items` : ""}
              </Text>
              {scope.view === "history" && (
                <>
                  <Action
                    label="Trash"
                    onPress={() =>
                      router.push({
                        pathname: "/task-browser",
                        params: { view: "trash", title: "trash" },
                      })
                    }
                  />
                  <Action
                    label="Archive"
                    onPress={() =>
                      router.push({ pathname: "/task-containers", params: { mode: "archive" } })
                    }
                  />
                </>
              )}
              {standalone && (
                <Action
                  label="Add"
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
            {showFilters && (
              <Section title="Dates & tags">
                <Action label="Done" onPress={() => setShowFilters(false)} />
                <SearchField
                  accessibilityLabel="Filter by tag"
                  placeholder="Tag"
                  placeholderTextColor={t.secondary}
                  value={filters.tag ?? ""}
                  onChangeText={(value) => updateFilter("tag", value.trim())}
                  style={{ color: t.ink, padding: 12, minHeight: 44 }}
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
                  onPress={() => {
                    setFilters({});
                    setSearch("");
                  }}
                />
                <Action
                  disabled={!resources.settings.data || action.pending}
                  label="Save sort and grouping as defaults"
                  onPress={() =>
                    void action.run("Saving preferences…", () =>
                      api.updateWorkspaceSettings("tasks", {
                        expectedRevision: resources.settings.data?.revision ?? 0,
                        preferences: { taskSort: query.sort, taskGroup: query.group },
                      }),
                    )
                  }
                />
              </Section>
            )}
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
              <View
                style={[
                  styles.row,
                  groupEdges(
                    index === 0 ||
                      (query.group !== "none" && items[index - 1].groupKey !== item.groupKey),
                    index === items.length - 1 ||
                      (query.group !== "none" && items[index + 1].groupKey !== item.groupKey),
                  ),
                  {
                    backgroundColor: marked ? `${workspaceColor(t, "tasks")}22` : t.surface,
                    borderBottomColor: t.line,
                    borderBottomWidth:
                      index === items.length - 1 ||
                      (query.group !== "none" && items[index + 1].groupKey !== item.groupKey)
                        ? 0
                        : 0.5,
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${selected.length ? "Select" : done ? "Reopen" : "Complete"} ${item.record.title}`}
                  accessibilityState={{
                    checked: selected.length ? marked : done,
                    disabled: action.pending || item.readOnly || !!item.deletedAt,
                  }}
                  disabled={
                    action.pending || (!selected.length && (item.readOnly || !!item.deletedAt))
                  }
                  onPress={() =>
                    selected.length ? toggle() : perform([item], done ? "reopen" : "complete")
                  }
                  style={{
                    minWidth: 44,
                    minHeight: 44,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <View
                    style={{
                      width: 25,
                      height: 25,
                      borderRadius: 13,
                      borderWidth: 1.5,
                      borderColor: done || marked ? workspaceColor(t, "tasks") : t.secondary,
                      backgroundColor: done || marked ? workspaceColor(t, "tasks") : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {(done || marked) && <Icon name="check" size={19} color={t.canvas} />}
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.kind}: ${item.record.title}`}
                  onPress={() => (selected.length ? toggle() : edit(item))}
                  onLongPress={toggle}
                  style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center", gap: 5 }}
                >
                  <Text
                    style={{
                      color: t.ink,
                      fontSize: 17,
                      textDecorationLine: done ? "line-through" : "none",
                    }}
                  >
                    {item.record.title}
                  </Text>
                  <Text style={{ color: t.secondary, fontSize: 12 }}>
                    {[
                      item.kind,
                      item.record.priority !== "medium" ? `${item.record.priority} priority` : null,
                      item.record.dueAt
                        ? new Date(item.record.dueAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : null,
                      item.kind === "task" &&
                      resources.settings.data?.preferences.taskRowDetails.includes("estimate") &&
                      item.record.estimateMinutes
                        ? `${item.record.estimateMinutes} min`
                        : null,
                      item.kind === "task" &&
                      resources.settings.data?.preferences.taskRowDetails.includes("tags")
                        ? item.record.tags.join(", ")
                        : null,
                      resources.settings.data?.preferences.taskRowDetails.includes("notes")
                        ? item.record.notes?.slice(0, 100)
                        : null,
                      item.readOnly ? "Read-only" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </Pressable>
              </View>
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
    </View>
  );
}
