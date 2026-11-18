import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import type { ComponentType } from "react";
import { GoalsSettingsScreen } from "../goals/settings";
import { RitualsSettingsScreen } from "../rituals/settings";
import { ActivitySettingsScreen } from "./activity";
import { AgentsSettingsScreen } from "./agents";
import { AppearanceSettingsScreen } from "./appearance";
import { ConnectionsSettingsScreen } from "./connections";
import { findSettingsDestination, type SettingsDestinationId } from "./navigation";
import { NotificationsSettingsScreen } from "./notifications";
import { ProfileSettingsScreen } from "./profile";
import { SecuritySettingsScreen } from "./security";
import { TextingSettingsScreen } from "./texting";
import {
  CalendarSettingsScreen,
  FinanceSettingsScreen,
  MailSettingsScreen,
  TaskSettingsScreen,
} from "./workspaces";

/** Only working native screens are registered; missing destinations stay out of the root. */
export const settingsScreens: Partial<Record<SettingsDestinationId, ComponentType>> = {
  tasks: TaskSettingsScreen,
  profile: ProfileSettingsScreen,
  security: SecuritySettingsScreen,
  activity: ActivitySettingsScreen,
  appearance: AppearanceSettingsScreen,
  goals: GoalsSettingsScreen,
  rituals: RitualsSettingsScreen,
  mail: MailSettingsScreen,
  calendar: CalendarSettingsScreen,
  finances: FinanceSettingsScreen,
  agents: AgentsSettingsScreen,
  connections: ConnectionsSettingsScreen,
  notifications: NotificationsSettingsScreen,
  texting: TextingSettingsScreen,
};
export function SettingsScreen() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const destination = findSettingsDestination(section);
  const Screen = destination && settingsScreens[destination.id];
  if (!destination || !Screen) return <Redirect href="/settings" />;
  return (
    <>
      <Stack.Screen options={{ title: destination.label }} />
      <Screen />
    </>
  );
}
