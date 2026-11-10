import { TextInput } from "react-native";
import { useTheme } from "../../theme";
export function SettingsSearch({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
}) {
  const t = useTheme();
  return (
    <TextInput
      accessibilityLabel="Search settings"
      placeholder="Search settings"
      placeholderTextColor={t.secondary}
      value={value}
      onChangeText={onChangeText}
      autoCorrect={false}
      returnKeyType="search"
      clearButtonMode="while-editing"
      style={{
        minHeight: 44,
        backgroundColor: t.surface,
        color: t.ink,
        borderRadius: 12,
        paddingHorizontal: 16,
        fontSize: 17,
      }}
    />
  );
}
