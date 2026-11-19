import { useState } from "react";
import { Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { toast } from "sonner-native";
import { Action, Actions, FormBody, Section, SectionItem } from "../../components/forms/form-rows";
import { PlanningPicker } from "../../components/forms/planning-picker";
import { Icon } from "../../components/icons";
import { RecordRow } from "../../components/record-row";
import { SettingsAccentProvider } from "../../components/settings-accent";
import { SheetHeader } from "../../components/sheet-header";
import { useTheme, workspaceColor } from "../../theme";
import { useMail } from "./data";
import { conversations, pickedSnooze, pickerDay, snoozeChoices, snoozeTime } from "./logic";

/**
 * Asks when snoozed mail should come back: a few common times, or any day and time ahead, all
 * read in the planning time zone. Choosing a time is the whole decision, so it closes the sheet
 * and the snooze starts. A time that is not ahead is refused here and nothing is sent.
 */
export function SnoozeSheet({
  count,
  choose,
  close,
}: {
  count: number;
  choose: (until: Date) => void;
  close: () => void;
}) {
  const t = useTheme();
  const { timeZone } = useMail();
  // Shown as of this render; the time that is sent is worked out again when a row is pressed.
  const shown = new Date();
  const choices = snoozeChoices(shown, timeZone);
  const [day, setDay] = useState(() => pickerDay(choices[1].until, timeZone));
  const [time, setTime] = useState("08:00");
  const accent = workspaceColor(t, "mail");
  const pick = (until: Date | null | undefined) => {
    if (until && until.getTime() > Date.now()) choose(until);
    else toast.error("Choose a day and time that are still ahead.");
  };
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SettingsAccentProvider workspace="mail">
        <SafeAreaView style={{ flex: 1, backgroundColor: t.canvas }}>
          <SheetHeader
            title={count === 1 ? "Snooze" : `Snooze ${conversations(count)}`}
            label="Cancel"
            onClose={close}
          />
          <FormBody>
            <Section>
              {choices.map((choice) => (
                <SectionItem key={choice.id}>
                  <RecordRow
                    centered
                    title={choice.label}
                    value={snoozeTime(choice.until, shown, timeZone)}
                    leading={<Icon name="clock" color={accent} />}
                    accessibilityHint="Snoozes until then."
                    onPress={() =>
                      // A sheet left open must not send the time it opened with.
                      pick(
                        snoozeChoices(new Date(), timeZone).find(({ id }) => id === choice.id)
                          ?.until,
                      )
                    }
                  />
                </SectionItem>
              ))}
            </Section>
            <Section title="Another time">
              <PlanningPicker
                label="Day"
                mode="date"
                value={day}
                onChange={setDay}
                timeZone={timeZone}
              />
              <PlanningPicker
                label="Time"
                mode="time"
                value={time}
                onChange={setTime}
                timeZone={timeZone}
              />
            </Section>
            <Actions>
              <Action
                label="Snooze until this time"
                onPress={() => pick(pickedSnooze(day, time, new Date(), timeZone))}
              />
            </Actions>
          </FormBody>
        </SafeAreaView>
      </SettingsAccentProvider>
    </Modal>
  );
}
