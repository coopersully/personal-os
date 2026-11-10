import type { AuditEvent } from "@personal-os/api-client";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "../../components/icons";
import { Screen } from "../../components/screen";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { SearchField, Section, State } from "../tasks/ui";
import { useSettingsRefresh, useSettingsResource } from "./data";
import { SettingsViewSwitcher } from "./view-switcher";

/** Deliberately omit before/after payloads: they may contain mail, credentials or private record content. */
const resourceLabels: Record<string, string> = {
  task: "Task",
  task_list: "List",
  task_project: "Project",
  reminder: "Reminder",
  calendar_event: "Calendar event",
  mail_thread: "Email",
  finance_transaction: "Transaction",
  user: "Profile",
  access_token: "Agent token",
  session: "Device session",
  connector: "Connection",
  goal: "Goal",
  motive: "Motive",
  ritual_definition: "Ritual",
  notification_preferences: "Notification policy",
};
function resourceLabel(entityType: string) {
  const words = entityType.replaceAll("_", " ").replaceAll(".", " ");
  return resourceLabels[entityType] ?? words.charAt(0).toUpperCase() + words.slice(1);
}
function actorLabel(actorType: string) {
  return ["human", "user"].includes(actorType)
    ? "You"
    : actorType === "agent"
      ? "Agent"
      : actorType.charAt(0).toUpperCase() + actorType.slice(1);
}
export function activityTitle(action: string, entityType?: string) {
  const verbs: Record<string, string> = {
    create: "created",
    created: "created",
    update: "updated",
    updated: "updated",
    delete: "deleted",
    deleted: "deleted",
    complete: "completed",
    completed: "completed",
    restore: "restored",
    restored: "restored",
    archive: "archived",
    archived: "archived",
    connect: "connected",
    connected: "connected",
    disconnect: "disconnected",
    disconnected: "disconnected",
    revoke: "revoked",
    revoked: "revoked",
    save: "saved",
    saved: "saved",
    pause: "paused",
    paused: "paused",
  };
  const parts = action.split(/[._]/);
  const verb = verbs[parts.at(-1) ?? ""] ?? verbs[parts[0] ?? ""];
  if (entityType) return `${resourceLabel(entityType)} ${verb ?? "activity"}`;
  const words = parts.join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function activityMatches(event: AuditEvent, search: string, actor: string) {
  return (
    (actor === "all" || event.actorType === actor) &&
    `${event.action} ${event.entityType} ${event.actorType} ${activityTitle(event.action, event.entityType)} ${actorLabel(event.actorType)}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  );
}
export function ActivitySettingsScreen() {
  const { state, session } = useAuth();
  return state.user ? <Activity key={`${state.user.id}:${session.epoch()}`} /> : null;
}
function Activity() {
  const t = useTheme();
  const { state, session } = useAuth();
  const events = useSettingsResource("activity", (api) => api.listActivity(100));
  const { refresh } = useSettingsRefresh(
    [["settings", state.user?.id, session.epoch(), "activity"]],
    [() => events.refetch({ throwOnError: true })],
    "Activity refreshed",
  );
  const [search, setSearch] = useState("");
  const [actor, setActor] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const actors = [...new Set(events.data?.map((event) => event.actorType) ?? [])];
  return (
    <Screen onRefresh={refresh}>
      <Text style={{ color: t.secondary, marginBottom: 16 }}>
        Recent changes to your account · Latest 100 events
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Icon name="search" color={t.secondary} />
        <View style={{ flex: 1 }}>
          <SearchField
            accessibilityLabel="Search activity"
            placeholder="task"
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>
      <Section>
        <SettingsViewSwitcher
          value={actor}
          options={[
            { value: "all", label: "Everyone" },
            ...actors.map((value) => ({
              value,
              label: ["human", "user"].includes(value)
                ? "You"
                : value === "agent"
                  ? "Agents"
                  : value.charAt(0).toUpperCase() + value.slice(1),
            })),
          ]}
          onChange={setActor}
        />
      </Section>
      {!events.data && <State loading={events.isPending} retry={() => void events.refetch()} />}
      {events.data &&
        events.data.filter((event) => activityMatches(event, search, actor)).length === 0 && (
          <State empty="No matching events in this history." />
        )}
      <Section>
        {events.data
          ?.filter((event) => activityMatches(event, search, actor))
          .map((event) => (
            <View key={event.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: selected === event.id }}
                onPress={() => setSelected(selected === event.id ? null : event.id)}
                style={{
                  padding: 16,
                  minHeight: 64,
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <View style={{ width: 28, paddingTop: 2 }}>
                  <Icon
                    name={
                      event.entityType.includes("task")
                        ? "tasks"
                        : event.entityType.includes("mail")
                          ? "mail"
                          : event.entityType.includes("calendar")
                            ? "calendar"
                            : event.entityType.includes("finance")
                              ? "finances"
                              : "history"
                    }
                    color={t.secondary}
                    size={20}
                  />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: t.ink, fontSize: 16 }}>
                    {activityTitle(event.action, event.entityType)}
                  </Text>
                  <Text style={{ color: t.secondary, fontSize: 13 }}>
                    {actorLabel(event.actorType)} · {resourceLabel(event.entityType)}
                  </Text>
                </View>
                <Text
                  style={{ color: t.secondary, fontSize: 12, maxWidth: "27%", textAlign: "right" }}
                >
                  {new Date(event.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Text>
              </Pressable>
              {selected === event.id && (
                <View style={{ padding: 16, gap: 8 }}>
                  {[
                    ["Action", event.action],
                    ["Resource type", event.entityType],
                    ["Actor", event.actorType],
                    ["Entity", event.entityId],
                    ["Request", event.requestId],
                  ].map(([label, value]) => (
                    <View
                      key={label}
                      style={{ flexDirection: "row", alignItems: "center", gap: 16, minHeight: 44 }}
                    >
                      <Text style={{ color: t.ink, fontSize: 15 }}>{label}</Text>
                      <Text
                        selectable
                        style={{ color: t.secondary, textAlign: "right", flex: 1, fontSize: 13 }}
                      >
                        {value || "Not available"}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
      </Section>
    </Screen>
  );
}
