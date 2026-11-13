import type { TaskList, TaskProject } from "@personal-os/domain";
import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { FilterChip } from "../../components/filter-chip";
import { Icon, type IconName } from "../../components/icons";
import { useWorkspaceHeaderInset } from "../../components/workspace-header-inset";
import { radius, spacing, useTheme, workspaceColor } from "../../theme";
import {
  containerDirectory,
  type ProjectStatus,
  projectEmptyMessage,
  projectStatusCounts,
  projectStatuses,
} from "./container-directory";
import { ListRow, PinnedContainers, ProjectRow } from "./container-rows";
import { useTaskAction, useTaskApi, useTaskResources, useTaskSearch } from "./data";
import { partitionPinned } from "./presentation";
import { TaskListScreen } from "./task-list";
import { Group, Heading, NavigationRow, SearchField, State } from "./ui";
export function TasksHub({ mode }: { mode: "views" | "lists" | "projects" | "archive" }) {
  const t = useTheme();
  const headerInset = useWorkspaceHeaderInset();
  const api = useTaskApi();
  const resources = useTaskResources();
  const action = useTaskAction();
  const { search, setSearch } = useTaskSearch();
  const lists = resources.lists.data ?? [];
  const projects = resources.projects.data ?? [];
  const preferences = resources.settings.data?.preferences;
  const [status, setStatus] = useState<ProjectStatus>("active");
  const filtered =
    mode === "views"
      ? []
      : containerDirectory({
          mode,
          status,
          search,
          sort: preferences?.taskContainerSort,
          lists,
          projects,
        });
  const statusCounts = projectStatusCounts(lists, projects);
  const { pinned: pinnedRows, directory: directoryRows } = partitionPinned(
    filtered,
    mode === "archive" ? undefined : preferences,
  );
  const go = (title: string, params: Record<string, string>) =>
    router.push({ pathname: "/task-browser", params: { title, ...params } });
  const openContainer = (kind: "list" | "project", record: TaskList | TaskProject) =>
    go(record.name, {
      view: "all",
      ...(mode === "archive" || (kind === "project" && (record as TaskProject).lifecycle !== "open")
        ? { status: "all" }
        : {}),
      kind: "task",
      ...(kind === "list"
        ? { listId: record.id }
        : { projectId: record.id, listId: (record as TaskProject).listId }),
    });
  const pin = (kind: "list" | "project", id: string) => {
    if (!resources.settings.data) return;
    const key = kind === "list" ? "pinnedListIds" : "pinnedProjectIds";
    const values = resources.settings.data.preferences[key];
    void action.run(
      "Updating pin…",
      () =>
        api.updateWorkspaceSettings("tasks", {
          expectedRevision: resources.settings.data?.revision ?? 0,
          preferences: {
            [key]: values.includes(id) ? values.filter((value) => value !== id) : [...values, id],
          },
        }),
      undefined,
      undefined,
      () => ({
        message: `${kind === "list" ? "List" : "Project"} ${values.includes(id) ? "unpinned" : "pinned"}`,
      }),
    );
  };
  const links: { label: string; icon: IconName; press: () => void }[] = [
    { label: "All tasks & reminders", icon: "views", press: () => go("all", { view: "all" }) },
    { label: "Upcoming", icon: "clock", press: () => go("upcoming", { view: "upcoming" }) },
    {
      label: "Scheduled",
      icon: "calendar",
      press: () => go("scheduled", { view: "all", reserved: "scheduled", sort: "reserved" }),
    },
    {
      label: "Reminders",
      icon: "attention",
      press: () => go("reminders", { view: "all", kind: "reminder" }),
    },
    { label: "Tasks", icon: "tasks", press: () => go("tasks", { view: "all", kind: "task" }) },
    { label: "Trash", icon: "trash", press: () => go("trash", { view: "trash" }) },
    {
      label: "Archive",
      icon: "archive",
      press: () => router.push({ pathname: "/task-containers", params: { mode: "archive" } }),
    },
    { label: "History", icon: "history", press: () => go("history", { view: "history" }) },
  ];
  const loading =
    resources.lists.isPending || resources.projects.isPending || resources.settings.isPending;
  const failed =
    resources.lists.isError || resources.projects.isError || resources.settings.isError;
  if (mode === "views" && search.trim())
    return <TaskListScreen title="search" scope={{ view: "all" }} />;
  return (
    <View style={{ flex: 1, backgroundColor: t.canvas }}>
      <FlatList
        contentInsetAdjustmentBehavior={headerInset ? "never" : "automatic"}
        scrollIndicatorInsets={{ top: headerInset }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          padding: spacing.page,
          paddingTop: headerInset + spacing.page,
          paddingBottom: 100,
        }}
        data={directoryRows}
        keyExtractor={(item) => `${item.kind}:${item.record.id}`}
        ListHeaderComponent={
          <>
            <Heading>{mode === "views" ? "browse" : mode}</Heading>
            {mode === "archive" && (
              <SearchField
                accessibilityLabel="Search containers"
                placeholder="Home"
                placeholderTextColor={t.secondary}
                value={search}
                onChangeText={setSearch}
              />
            )}

            {mode === "views" && (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
                >
                  {links
                    .filter((link) => ["Upcoming", "History"].includes(link.label))
                    .map((link) => (
                      <Pressable
                        key={link.label}
                        accessibilityRole="button"
                        accessibilityLabel={link.label}
                        onPress={link.press}
                        style={({ pressed }) => ({
                          width: 160,
                          minHeight: 104,
                          padding: spacing.lg,
                          gap: spacing.md,
                          borderRadius: radius.panel,
                          backgroundColor: t.surface,
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <Icon name={link.icon} size={24} color={workspaceColor(t, "tasks")} />
                        <Text style={{ color: t.ink, fontSize: 17, fontWeight: "600" }}>
                          {link.label}
                        </Text>
                        <Text style={{ color: t.secondary, fontSize: 13 }}>
                          {link.label === "Upcoming"
                            ? "Due or planned after today"
                            : link.label === "Scheduled"
                              ? "Tasks with reserved time"
                              : "Completed & cancelled"}
                        </Text>
                      </Pressable>
                    ))}
                </ScrollView>
                {[
                  {
                    title: "Task views",
                    labels: ["All tasks & reminders", "Tasks", "Reminders", "Scheduled"],
                  },
                  { title: "Storage", labels: ["Archive", "Trash"] },
                ].map((group) => (
                  <View key={group.title} style={{ marginBottom: spacing.xl }}>
                    <Text
                      accessibilityRole="header"
                      style={{
                        color: t.secondary,
                        fontSize: 13,
                        marginHorizontal: spacing.lg,
                        marginBottom: spacing.sm,
                      }}
                    >
                      {group.title}
                    </Text>
                    <Group>
                      {group.labels.map((label) => {
                        const link = links.find((item) => item.label === label);
                        return link ? (
                          <NavigationRow
                            key={label}
                            label={label}
                            icon={link.icon}
                            onPress={link.press}
                          />
                        ) : null;
                      })}
                    </Group>
                  </View>
                ))}
                <Text
                  accessibilityRole="header"
                  style={{
                    color: t.secondary,
                    fontSize: 13,
                    marginHorizontal: spacing.lg,
                    marginBottom: spacing.sm,
                  }}
                >
                  Preferences
                </Text>
                <Group>
                  <NavigationRow
                    label="Task preferences"
                    icon="settings"
                    onPress={() => router.push("/task-preferences")}
                  />
                </Group>
              </>
            )}
            {mode === "projects" && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.lg }}
              >
                {projectStatuses.map(({ value, label }) => (
                  <FilterChip
                    key={value}
                    label={`${label} · ${statusCounts[value]}`}
                    selected={status === value}
                    color={workspaceColor(t, "tasks")}
                    onPress={() => setStatus(value)}
                  />
                ))}
              </ScrollView>
            )}
            {(mode === "lists" || mode === "projects") && (
              <PinnedContainers
                kind={mode === "lists" ? "list" : "project"}
                items={pinnedRows.map(({ record }) => record)}
                disabled={action.pending || !preferences}
                onPin={(record) => pin(mode === "lists" ? "list" : "project", record.id)}
                onEdit={(record) =>
                  router.push({
                    pathname: "/task-container",
                    params: { kind: mode === "lists" ? "list" : "project", id: record.id },
                  })
                }
                loading={resources.settings.isPending}
                onRetry={
                  resources.settings.isError
                    ? () => {
                        void resources.settings.refetch();
                      }
                    : undefined
                }
                onOpen={(record) => openContainer(mode === "lists" ? "list" : "project", record)}
              />
            )}
          </>
        }
        ListEmptyComponent={
          mode === "views" || (pinnedRows.length > 0 && directoryRows.length === 0) ? undefined : (
            <State
              loading={loading}
              retry={
                failed
                  ? () => {
                      void resources.lists.refetch();
                      void resources.projects.refetch();
                      void resources.settings.refetch();
                    }
                  : undefined
              }
              empty={
                mode === "projects" ? projectEmptyMessage(status, search) : "No matching lists."
              }
            />
          )
        }
        renderItem={({ item: { kind, record }, index }) => {
          const pinned = (
            kind === "list" ? preferences?.pinnedListIds : preferences?.pinnedProjectIds
          )?.includes(record.id);
          const props = {
            first: index === 0,
            last: index === directoryRows.length - 1,
            pinned: !!pinned,
            disabled: action.pending || !preferences || mode === "archive",
            onOpen: () => openContainer(kind, record),
            onPin: () => pin(kind, record.id),
            onEdit: () =>
              router.push({ pathname: "/task-container", params: { kind, id: record.id } }),
          };
          return kind === "list" ? (
            <ListRow {...props} record={record as TaskList} />
          ) : (
            <ProjectRow
              {...props}
              record={record as TaskProject}
              listName={lists.find((list) => list.id === (record as TaskProject).listId)?.name}
            />
          );
        }}
      />
    </View>
  );
}
