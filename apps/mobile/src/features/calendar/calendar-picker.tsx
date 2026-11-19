import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Action, formRow, Group } from "../../components/forms/form-rows";
import { Icon } from "../../components/icons";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { SheetHeader } from "../../components/sheet-header";
import { spacing, useTheme, workspaceColor } from "../../theme";
import { useCalendarScope, useCalendarSelection, useCalendars } from "./data";
import { calendarFreshness, calendarSourceLabel, fallbackEventColor } from "./logic";
import { CalendarDot, Copy } from "./ui";

/** Shown calendars are an account choice shared with web and Settings, not a local filter. */
export function CalendarPicker({ onClose }: { onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { timeZone } = useCalendarScope();
  const calendars = useCalendars();
  const selection = useCalendarSelection();
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.canvas }}>
        <SheetHeader title="Calendars" label="Done" dismiss="trailing" onClose={onClose} />
        <ScrollView
          contentContainerStyle={{
            gap: spacing.lg,
            paddingHorizontal: spacing.page,
            paddingBottom: Math.max(insets.bottom, spacing.page),
          }}
        >
          {calendars.isPending ? (
            <ActivityIndicator
              color={t.secondary}
              accessibilityLabel="Loading calendars"
              style={{ padding: 24 }}
            />
          ) : !calendars.data ? (
            <SettingsAccentProvider workspace="calendar">
              {/* The row sizes the action to its label, so the label starts on the page edge. */}
              <View style={{ flexDirection: "row", marginLeft: -spacing.md }}>
                <Action label="Retry loading" onPress={() => void calendars.refetch()} />
              </View>
            </SettingsAccentProvider>
          ) : !calendars.data.length ? (
            <Copy>No calendars yet. Connect or create one in Settings.</Copy>
          ) : (
            <Group>
              {calendars.data.map((calendar) => {
                const freshness = calendarFreshness(calendar, timeZone ?? "UTC");
                return (
                  <Pressable
                    key={calendar.id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={[
                      `Show ${calendar.name}`,
                      calendarSourceLabel(calendar),
                      calendar.isWritable ? null : "Read only",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    accessibilityHint={freshness.label}
                    accessibilityState={{
                      checked: calendar.isSelected,
                      disabled: selection.pending,
                    }}
                    disabled={selection.pending}
                    onPress={() => void selection.select(calendar, !calendar.isSelected)}
                    style={[
                      formRow,
                      { alignItems: "flex-start", opacity: selection.pending ? 0.6 : 1 },
                    ]}
                  >
                    <CalendarDot color={calendar.color ?? fallbackEventColor} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: t.ink, fontSize: 16, fontWeight: "500" }}>
                        {calendar.name}
                      </Text>
                      <Text style={{ color: t.secondary, fontSize: 14 }}>
                        {calendarSourceLabel(calendar)}
                        {calendar.isWritable ? "" : " · Read only"}
                      </Text>
                      <Text
                        style={{
                          color: freshness.attention ? t.warning : t.secondary,
                          fontSize: 14,
                        }}
                      >
                        {freshness.label}
                      </Text>
                    </View>
                    {calendar.isSelected && (
                      <Icon name="save" size={20} color={workspaceColor(t, "calendar")} />
                    )}
                  </Pressable>
                );
              })}
            </Group>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
