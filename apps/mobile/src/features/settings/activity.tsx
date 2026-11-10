import type { AuditEvent } from "@personal-os/api-client";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";
import { useTheme } from "../../theme";
import { errorMessage } from "../tasks/data";
import { Action, Choice, FormBody, SearchField, Section, State } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
/** Deliberately omit before/after payloads: they may contain mail, credentials or private record content. */
export function activityMatches(event: AuditEvent, search: string, actor: string) {
  return (
    (actor === "all" || event.actorType === actor) &&
    `${event.action} ${event.entityType} ${event.actorType}`
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  );
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
        Latest 100 events. Search and filters apply to this loaded history.
      </Text>
      <SearchField
        accessibilityLabel="Search activity"
        placeholder="task"
        value={search}
        onChangeText={setSearch}
      />
      <Section>
        <Choice
          label="Actor"
          value={actor}
          options={[
            { value: "all", label: "All actors" },
            ...actors.map((value) => ({ value, label: value })),
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
                style={{ padding: 16, minHeight: 56, gap: 4 }}
              >
                <Text style={{ color: t.ink, fontSize: 17 }}>
                  {event.action.replaceAll("_", " ")}
                </Text>
                <Text style={{ color: t.secondary }}>
                  {event.entityType} · {new Date(event.createdAt).toLocaleString()}
                </Text>
              </Pressable>
              {selected === event.id && (
                <View style={{ padding: 16, gap: 8 }}>
                  {[
                    ["Actor", event.actorType],
                    ["Entity", event.entityId],
                    ["Request", event.requestId],
                  ].map(([label, value]) => (
                    <Text selectable key={label} style={{ color: t.secondary }}>
                      {label}: {value}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          ))}
      </Section>
    </FormBody>
  );
}
