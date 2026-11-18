import type { PropsWithChildren, ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { EnumChoice } from "../../components/forms/enum-choice";
import { Screen } from "../../components/screen";
import { useTheme } from "../../theme";
import { SettingsActionRow } from "../settings/settings-row";
import { memoryLabel } from "./presentation";

export function MemoryBody({
  children,
  onRefresh,
  save,
}: PropsWithChildren<{ onRefresh?: () => Promise<unknown>; save?: ReactNode }>) {
  return (
    <View style={{ flex: 1 }}>
      <Screen onRefresh={onRefresh}>
        <View style={{ gap: 20, paddingBottom: save ? 84 : 0 }}>{children}</View>
      </Screen>
      {save}
    </View>
  );
}

export function MemoryText({ children }: PropsWithChildren) {
  const t = useTheme();
  return <Text style={{ color: t.secondary, fontSize: 16, lineHeight: 23 }}>{children}</Text>;
}

/** Text inside a grouped section, inset like its rows. */
export function MemoryNote({ children }: PropsWithChildren) {
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
      <MemoryText>{children}</MemoryText>
    </View>
  );
}

export function MemoryChoice<T extends string>({
  label,
  value,
  choices,
  onChange,
  disabled,
  labels,
}: {
  label: string;
  value: T;
  choices: readonly T[];
  onChange: (value: T) => void;
  disabled?: boolean;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <EnumChoice
      label={label}
      value={value}
      options={choices.map((entry) => ({
        value: entry,
        label: labels?.[entry] ?? memoryLabel(entry),
      }))}
      onChange={(next) => {
        const selected = choices.find((choice) => choice === next);
        if (selected !== undefined && !disabled) onChange(selected);
      }}
      disabled={disabled}
    />
  );
}

export function MemoryReadState({
  loading,
  failed,
  label,
  retry,
  busy,
}: {
  loading: boolean;
  failed?: boolean;
  label: string;
  retry: () => void;
  busy?: boolean;
}) {
  return (
    <>
      {loading && <ActivityIndicator accessibilityLabel={`Loading ${label}`} />}
      {failed && (
        <SettingsActionRow
          label={`Retry loading ${label}`}
          icon="refresh"
          onPress={retry}
          disabled={busy}
        />
      )}
    </>
  );
}
