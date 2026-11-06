import type { TaskList, TaskProject } from "@personal-os/domain";
import { router } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "../../components/icons";
import { spacing, touchTarget, useTheme, workspaceColor } from "../../theme";
import { useTaskAction, useTaskApi, useTaskResources, useTaskSearch } from "./data";
import { TaskListScreen } from "./task-list";
import {
  Action,
  Group,
  groupEdges,
  Heading,
  NavigationRow,
  SearchField,
  State,
  styles,
} from "./ui";
export function TasksHub({
  mode,
}: {
  mode: "views" | "pinned" | "lists" | "projects" | "archive";
}) {
  const t = useTheme();
  const api = useTaskApi();
  const resources = useTaskResources();
  const action = useTaskAction();
  const { search, setSearch } = useTaskSearch();
  const lists = resources.lists.data ?? [];
  const projects = resources.projects.data ?? [];
  const preferences = resources.settings.data?.preferences;
  const activeLists = lists.filter((row) => !row.deletedAt && row.availability === "active");
  const activeProjects = projects.filter(
    (row) =>
      !row.deletedAt &&
      row.availability === "active" &&
      row.lifecycle === "open" &&
      activeLists.some((list) => list.id === row.listId),
  );
  const records: Array<{ kind: "list" | "project"; record: TaskList | TaskProject }> =
    mode === "lists"
      ? activeLists.map((record) => ({ kind: "list", record }))
      : mode === "projects"
        ? activeProjects.map((record) => ({ kind: "project", record }))
        : mode === "archive"
          ? [
              ...lists
                .filter((row) => !row.deletedAt && row.availability === "archived")
                .map((record) => ({ kind: "list" as const, record })),
              ...projects
                .filter(
                  (row) =>
                    !row.deletedAt &&
                    (row.availability === "archived" ||
                      row.lifecycle !== "open" ||
                      lists.some(
                        (list) => list.id === row.listId && list.availability === "archived",
                      )),
                )
                .map((record) => ({ kind: "project" as const, record })),
            ]
          : mode === "pinned"
            ? [
                ...activeLists
                  .filter((row) => preferences?.pinnedListIds.includes(row.id))
                  .map((record) => ({ kind: "list" as const, record })),
                ...activeProjects
                  .filter((row) => preferences?.pinnedProjectIds.includes(row.id))
                  .map((record) => ({ kind: "project" as const, record })),
              ]
            : [];
  const filtered = records
    .filter(({ record }) => record.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .sort((a, b) => {
      const sort = preferences?.taskContainerSort;
      if (sort === "updated") return b.record.updatedAt.localeCompare(a.record.updatedAt);
      if (sort === "newest") return b.record.createdAt.localeCompare(a.record.createdAt);
      if (sort === "target")
        return (("targetDate" in a.record ? a.record.targetDate : null) ?? "9999").localeCompare(
          ("targetDate" in b.record ? b.record.targetDate : null) ?? "9999",
        );
      return a.record.name.localeCompare(b.record.name);
    });
  const go = (title: string, params: Record<string, string>) =>
    router.push({ pathname: "/task-browser", params: { title, ...params } });
  const pin = (kind: "list" | "project", id: string) => {
    if (!resources.settings.data) return;
    const key = kind === "list" ? "pinnedListIds" : "pinnedProjectIds";
    const values = resources.settings.data.preferences[key];
    void action.run("Saving pin…", () =>
      api.updateWorkspaceSettings("tasks", {
        expectedRevision: resources.settings.data?.revision ?? 0,
        preferences: {
          [key]: values.includes(id) ? values.filter((value) => value !== id) : [...values, id],
        },
      }),
    );
  };
  const links: { label: string; icon: IconName; press: () => void }[] = [
    {
      label: "Inbox",
      icon: "inbox",
      press: () => {
        const inbox = lists.find((row) => row.kind === "inbox");
        if (inbox) go("inbox", { listId: inbox.id, kind: "task", view: "all" });
      },
    },
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
    {
      label: "Lists",
      icon: "views",
      press: () => router.push({ pathname: "/task-containers", params: { mode: "lists" } }),
    },
    {
      label: "Projects",
      icon: "target",
      press: () => router.push({ pathname: "/task-containers", params: { mode: "projects" } }),
    },
  ];
  const loading =
    resources.lists.isPending ||
    resources.projects.isPending ||
    (mode === "pinned" && resources.settings.isPending);
  const failed =
    resources.lists.isError ||
    resources.projects.isError ||
    (mode === "pinned" && resources.settings.isError);
  if (mode === "views" && search.trim())
    return <TaskListScreen title="search" scope={{ view: "all" }} />;
  return (
    <View style={{ flex: 1, backgroundColor: t.canvas }}>
      <FlatList
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ padding: spacing.page, paddingBottom: 100 }}
        data={filtered}
        keyExtractor={(item) => `${item.kind}:${item.record.id}`}
        ListHeaderComponent={
          <>
            <Heading>{mode}</Heading>
            {(mode === "lists" || mode === "projects" || mode === "archive") && (
              <SearchField
                accessibilityLabel="Search containers"
                placeholder="Search lists and projects"
                placeholderTextColor={t.secondary}
                value={search}
                onChangeText={setSearch}
              />
            )}

            {mode === "views" && (
              <Group>
                {links.map((link) => (
                  <NavigationRow
                    key={link.label}
                    label={link.label}
                    icon={link.icon}
                    onPress={link.press}
                    disabled={link.label === "Inbox" && !lists.some((row) => row.kind === "inbox")}
                  />
                ))}
              </Group>
            )}
            {mode === "views" && (
              <View style={{ marginTop: spacing.md }}>
                <Action label="Task preferences" onPress={() => router.push("/task-preferences")} />
              </View>
            )}
            {mode !== "archive" && (
              <View style={[styles.toolbar, { marginVertical: 12 }]}>
                <Action
                  label="New list"
                  onPress={() =>
                    router.push({ pathname: "/task-container", params: { kind: "list" } })
                  }
                />
                <Action
                  label="New project"
                  disabled={!activeLists.length}
                  onPress={() =>
                    router.push({ pathname: "/task-container", params: { kind: "project" } })
                  }
                />
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          mode === "views" ? undefined : (
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
                mode === "pinned"
                  ? "Pin a list or project from Views to keep it here."
                  : "No matching containers."
              }
            />
          )
        }
        renderItem={({ item: { kind, record }, index }) => {
          const pinned = (
            kind === "list" ? preferences?.pinnedListIds : preferences?.pinnedProjectIds
          )?.includes(record.id);
          return (
            <View
              style={[
                styles.row,
                groupEdges(index === 0, index === filtered.length - 1),
                { backgroundColor: t.surface },
              ]}
            >
              <Icon name={kind === "list" ? "views" : "target"} color={t.secondary} />
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  go(record.name, {
                    view: mode === "archive" ? "history" : "all",
                    kind: "task",
                    ...(kind === "list"
                      ? { listId: record.id }
                      : { projectId: record.id, listId: (record as TaskProject).listId }),
                  })
                }
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: touchTarget,
                  justifyContent: "center",
                  gap: 4,
                }}
              >
                <Text numberOfLines={2} style={{ color: t.ink, fontSize: 17 }}>
                  {record.name}
                </Text>
                <Text style={{ color: t.secondary, fontSize: 12 }}>
                  {kind === "project"
                    ? `${lists.find((list) => list.id === (record as TaskProject).listId)?.name ?? "List"} · ${(record as TaskProject).lifecycle}`
                    : record.availability}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${pinned ? "Unpin" : "Pin"} ${record.name}`}
                disabled={action.pending || !preferences || mode === "archive"}
                onPress={() => pin(kind, record.id)}
                style={({ pressed }) => ({
                  minWidth: touchTarget,
                  minHeight: touchTarget,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: pressed || action.pending ? 0.5 : 1,
                })}
              >
                <Icon
                  name="pin"
                  filled={pinned}
                  color={pinned ? workspaceColor(t, "tasks") : t.secondary}
                  size={19}
                />
              </Pressable>
              <Action
                disabled={"kind" in record && record.kind === "inbox"}
                label="Edit"
                onPress={() =>
                  router.push({ pathname: "/task-container", params: { kind, id: record.id } })
                }
              />
            </View>
          );
        }}
      />
    </View>
  );
}
