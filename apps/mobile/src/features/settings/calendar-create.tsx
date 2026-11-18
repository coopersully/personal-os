import { createLocalCalendarInputSchema } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FormSave } from "../../components/forms/form-save";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { useAuth } from "../auth/context";
import { Field, FormBody, Section } from "../tasks/ui";
import { useSettingsAction } from "./data";

/** Creation stays explicit and revision-independent; opening or dismissing never writes. */
export function CalendarCreateScreen() {
  const { state } = useAuth();
  const cache = useQueryClient();
  const action = useSettingsAction();
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const dirty = !!name.trim() || !!color.trim();
  const permitDismiss = useDirtyDismiss(dirty, action.pending);
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: "New calendar",
          ...editorDismissOptions({
            label: dirty ? "Cancel" : "Close",
            disabled: action.pending,
            onPress: () => router.back(),
          }),
        }}
      />
      <FormBody>
        <Section>
          <Field
            label="Calendar name"
            icon="calendar"
            value={name}
            onChangeText={setName}
            maxLength={120}
            editable={!action.pending}
            placeholder="Personal projects"
          />
          <Field
            label="Color (optional)"
            value={color}
            onChangeText={setColor}
            editable={!action.pending}
            placeholder="#7928ff"
          />
        </Section>
      </FormBody>
      <FormSave
        label="Create calendar"
        workspace="calendar"
        disabled={action.pending || !name.trim() || !state.user?.planningTimezone}
        onPress={() => {
          void action
            .run(async (api) => {
              await api.createCalendar(
                createLocalCalendarInputSchema.parse({
                  name,
                  color: color.trim() || null,
                  timezone: state.user?.planningTimezone,
                }),
              );
              await cache.invalidateQueries({ queryKey: ["settings"] });
              await cache.invalidateQueries({ queryKey: ["calendar"] });
            }, "Calendar created")
            .then((result) => {
              if (result.ok) {
                permitDismiss();
                router.back();
              }
            });
        }}
      />
    </View>
  );
}
