import type { AuditEvent } from "@personal-os/api-client";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";
import { Icon } from "../../components/icons";
import { useTheme } from "../../theme";
import { errorMessage } from "../tasks/data";
import { Action, FormBody, SearchField, Section, State } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
import { SettingsViewSwitcher } from "./view-switcher";
/** Deliberately omit before/after payloads: they may contain mail, credentials or private record content. */
export function activityMatches(event: AuditEvent, search: string, actor: string) {
  return (
    (actor === "all" || event.actorType === actor) &&
    `${event.action} ${event.entityType} ${event.actorType}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  );
}
export function activityTitle(action: string) {
  const words = (action.split(".").at(-1) ?? action).replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function ActivitySettingsScreen() {
  const t = useTheme();
  const action = useSettingsAction();
  const refreshing = useRef(false);
  const events = useSettingsResource("activity", (api) => api.listActivity(100), true, true);
  useEffect(() => {
    if (events.error && !events.data && !refreshing.current)
      toast.error(errorMessage(events.error));
  }, [events.error, events.data]);
  const [search, setSearch] = useState("");
  const [actor, setActor] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const actors = [...new Set(events.data?.map((event) => event.actorType) ?? [])];
  return (
    <FormBody>
      <Text style={{ color: t.secondary, marginBottom: 16 }}>
        Recent changes to your account · Latest 100 events
      </Text>
      <SearchField
        accessibilityLabel="Search activity"
        placeholder="task"
        value={search}
        onChangeText={setSearch}
      />
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
        <Action
          label="Refresh activity"
          disabled={action.pending}
          onPress={() => {
            refreshing.current = true;
            void action
              .run(async () => {
                const result = await events.refetch();
                if (result.error) throw result.error;
              }, "Activity refreshed")
              .finally(() => {
                refreshing.current = false;
              });
          }}
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
                  <Text style={{ color: t.ink, fontSize: 16 }}>{activityTitle(event.action)}</Text>
                  <Text style={{ color: t.secondary, fontSize: 13 }}>
                    {["human", "user"].includes(event.actorType)
                      ? "You"
                      : event.actorType === "agent"
                        ? "Agent"
                        : event.actorType}{" "}
                    · {event.entityType.replaceAll("_", " ")}
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
    </FormBody>
  );
}
